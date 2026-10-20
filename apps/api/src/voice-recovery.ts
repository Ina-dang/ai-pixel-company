import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, lstat, realpath, readdir, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../../scripts/voice-process-host.ps1', import.meta.url));
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type VoiceOwner = { version: 1; hostId: string; hostName: string; pid: number; created: string; sid: string; executable: string };
export type VoiceRecovery = { state: 'RECOVERED' | 'OWNER_ALIVE' | 'BLOCKED'; code: string | null; stopped: number; filesDeleted: number; automaticReplay: false };
export function nativeSpeechArguments(root: string, id: string) {
  return ['-m', path.join(root, '.local/voice-runtime/ggml-tiny.bin'), '-f', path.join(root, '.local/voice-temp', id, 'audio.wav'), '-l', 'ko', '-t', '2', '-ng', '-nt', '-np', '-bs', '1', '-bo', '1'];
}
async function hostCall(args: string[]) {
  if (process.platform !== 'win32') throw new Error('VOICE_RECOVERY_WINDOWS_ONLY');
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, ...args], { windowsHide: true, timeout: 15_000, maxBuffer: 32_768 }).catch(error => {
    let code = 'VOICE_PROCESS_UNVERIFIABLE';
    try { const body = JSON.parse(error.stdout); if (/^VOICE_[A-Z_]+$/.test(body.code)) code = body.code; } catch { /* Keep fixed diagnostic code. */ }
    throw new Error(code);
  });
  return JSON.parse(result.stdout.trim()) as { pid: number; created: string; sid: string; executable: string; state: string; stopped: number };
}
export class VoiceRecoveryHost {
  private owner: Promise<VoiceOwner> | undefined;
  constructor(private readonly root: string, private readonly executable: string) {}
  identity() { if (!this.owner) this.owner = this.loadIdentity(); return this.owner; }
  private async loadIdentity(): Promise<VoiceOwner> {
    const directory = path.join(this.root, '.local'); await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'voice-host.json');
    try { await writeFile(file, JSON.stringify({ id: randomUUID(), hostName: hostname() }), { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2048) throw new Error('VOICE_HOST_IDENTITY_INVALID');
    const local = JSON.parse(await readFile(file, 'utf8')) as { id: string; hostName: string };
    if (!guid.test(local.id) || local.hostName !== hostname()) throw new Error('VOICE_HOST_IDENTITY_CHANGED');
    const identity = await hostCall(['-Action', 'identity', '-OwnerProcessId', String(process.pid)]);
    if (identity.pid !== process.pid || !/^\d{15,20}$/.test(identity.created) || !identity.sid?.startsWith('S-1-')) throw new Error('VOICE_HOST_IDENTITY_INVALID');
    return { version: 1, hostId: local.id, hostName: local.hostName, pid: identity.pid, created: identity.created, sid: identity.sid, executable: identity.executable };
  }
  private async safeBase() {
    const local = path.join(this.root, '.local'), base = path.join(local, 'voice-temp');
    await mkdir(base, { recursive: true });
    for (const dir of [local, base]) {
      if ((await lstat(dir)).isSymbolicLink() || path.resolve(await realpath(dir)).toLowerCase() !== path.resolve(dir).toLowerCase()) throw new Error('VOICE_TEMP_PATH_UNVERIFIABLE');
    }
    return base;
  }
  async temporaryIds() {
    const base = await this.safeBase(), entries = await readdir(base, { withFileTypes: true });
    if (entries.some(entry => !guid.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink())) throw new Error('VOICE_TEMP_SCOPE_UNVERIFIABLE');
    return entries.map(entry => entry.name);
  }
  async recover(id: string, receipt: unknown): Promise<VoiceRecovery> {
    const blocked = (code: string): VoiceRecovery => ({ state: 'BLOCKED', code, stopped: 0, filesDeleted: 0, automaticReplay: false });
    try {
      if (!guid.test(id)) return blocked('VOICE_RECOVERY_SCOPE_INVALID');
      const owner = receipt as VoiceOwner | null, current = await this.identity();
      if (owner?.version !== 1 || owner.hostId !== current.hostId || owner.hostName !== current.hostName || owner.sid !== current.sid
        || !Number.isInteger(owner.pid) || owner.pid <= 0 || !/^\d{15,20}$/.test(owner.created) || owner.executable.toLowerCase() !== current.executable.toLowerCase()) return blocked('VOICE_RECOVERY_OWNER_UNVERIFIABLE');
      const base = await this.safeBase(), directory = path.join(base, id);
      let filePresent = false;
      try {
        const directoryStat = await lstat(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || path.resolve(await realpath(directory)).toLowerCase() !== path.resolve(directory).toLowerCase()) return blocked('VOICE_RECOVERY_PATH_UNVERIFIABLE');
        const entries = await readdir(directory);
        if (entries.some(name => name !== 'audio.wav')) return blocked('VOICE_RECOVERY_FILES_UNVERIFIABLE');
        if (entries.includes('audio.wav')) { const stat = await lstat(path.join(directory, 'audio.wav')); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 960044) return blocked('VOICE_RECOVERY_FILE_UNVERIFIABLE'); filePresent = true; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const args = [this.executable, ...nativeSpeechArguments(this.root, id)];
      const result = await hostCall(['-Action', 'recover', '-WorkspaceRoot', path.resolve(this.root), '-OwnerProcessId', String(owner.pid), '-OwnerCreated', owner.created, '-OwnerSid', owner.sid, '-ArgumentsBase64', Buffer.from(JSON.stringify(args)).toString('base64')]);
      if (result.state === 'OWNER_ALIVE') return { state: 'OWNER_ALIVE', code: null, stopped: 0, filesDeleted: 0, automaticReplay: false };
      if (result.state !== 'OWNER_GONE_NATIVE_CLOSED') return blocked('VOICE_PROCESS_UNVERIFIABLE');
      // Exact UUID file only; no recursive deletion or globbed paths.
      if (filePresent) await unlink(path.join(directory, 'audio.wav'));
      await rmdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      return { state: 'RECOVERED', code: 'VOICE_RECOVERED_AFTER_CRASH', stopped: result.stopped, filesDeleted: filePresent ? 1 : 0, automaticReplay: false };
    } catch (error) { return blocked(error instanceof Error && /^VOICE_[A-Z_]+$/.test(error.message) ? error.message : 'VOICE_RECOVERY_UNVERIFIABLE'); }
  }
}
