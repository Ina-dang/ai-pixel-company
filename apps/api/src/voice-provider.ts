import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { VoiceRecoveryHost, nativeSpeechArguments, type VoiceOwner, type VoiceRecovery } from './voice-recovery.js';

export const VOICE_LIMITS = { bytes: 960_044, durationMs: 30_000, daily: 20, timeoutMs: 60_000, candidateTtlSeconds: 3600 } as const;
export interface SpeechProvider {
  readiness(): Promise<{ ready: boolean; code: string | null }>;
  transcribe(wav: Buffer, id: string, signal: AbortSignal): Promise<string>;
  prepareExecution?(): Promise<VoiceOwner>;
  recoverExecution?(id: string, receipt: unknown): Promise<VoiceRecovery>;
  temporaryIds?(): Promise<string[]>;
}
export function validateWave(wav: Buffer) {
  if (wav.length < 44 || wav.length > VOICE_LIMITS.bytes || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
    || wav.readUInt32LE(4) !== wav.length - 8 || wav.toString('ascii', 12, 16) !== 'fmt ' || wav.readUInt32LE(16) !== 16
    || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000
    || wav.readUInt32LE(28) !== 32000 || wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16
    || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44 || (wav.length - 44) % 2) throw new Error('VOICE_INVALID_WAVE');
  const durationMs = (wav.length - 44) / 32;
  if (durationMs < 250 || durationMs > VOICE_LIMITS.durationMs) throw new Error('VOICE_DURATION_LIMIT');
  return Math.ceil(durationMs);
}
export class LocalWhisper implements SpeechProvider {
  private readonly runtime: string;
  private executable: string | null = null;
  private checked = false;
  private recoveryHost: VoiceRecoveryHost | undefined;
  constructor(private readonly root: string, private readonly onNativeStarted?: (id: string, pid: number) => void) { this.runtime = path.join(root, '.local/voice-runtime'); }
  async readiness() {
    if (this.checked) return { ready: Boolean(this.executable), code: this.executable ? null : 'VOICE_PROVIDER_UNAVAILABLE' };
    this.checked = true;
    try {
      const manifest = JSON.parse(await readFile(path.join(this.runtime, 'manifest.json'), 'utf8')) as { release: string; archiveSha: string; executable: string; files: Record<string, string> };
      if (manifest.release !== 'b5454' || manifest.archiveSha !== '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
        || !manifest.files['ggml-tiny.bin'] || !manifest.executable.endsWith('/whisper-cli.exe') || !manifest.files[manifest.executable]) throw new Error('MANIFEST_INVALID');
      for (const [relative, hash] of Object.entries(manifest.files)) {
        if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error('PATH_INVALID');
        const file = path.join(this.runtime, relative), stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || createHash('sha256').update(await readFile(file)).digest('hex') !== hash) throw new Error('HASH_INVALID');
      }
      this.executable = path.join(this.runtime, manifest.executable);
    } catch { this.executable = null; }
    return { ready: Boolean(this.executable), code: this.executable ? null : 'VOICE_PROVIDER_UNAVAILABLE' };
  }
  async transcribe(wav: Buffer, id: string, signal: AbortSignal) {
    if (!(await this.readiness()).ready || !this.executable) throw new Error('VOICE_PROVIDER_UNAVAILABLE');
    const executable = this.executable;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('VOICE_PATH_INVALID');
    validateWave(wav);
    const directory = path.join(this.root, '.local/voice-temp', id);
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'audio.wav');
    let transcription = '', originalError: unknown, failed = false, cleanupFailed = false;
    try {
      await writeFile(file, wav, { flag: 'wx', mode: 0o600 });
      signal.throwIfAborted();
      transcription = await new Promise<string>((resolve, reject) => {
        const child = spawn(executable, nativeSpeechArguments(this.root, id), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: this.runtime });
        child.once('spawn', () => { if (child.pid) this.onNativeStarted?.(id, child.pid); });
        let output = '', failed = false, timedOut = false;
        const stop = () => { failed = true; child.kill(); };
        const timer = setTimeout(() => { timedOut = true; stop(); }, VOICE_LIMITS.timeoutMs);
        signal.addEventListener('abort', stop, { once: true });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { if (output.length + chunk.length > 40_000) stop(); else output += chunk; });
        // Native diagnostic output never enters application logs or API responses.
        child.stderr.resume();
        // An error alone does not prove native termination. Spawn failure also emits close.
        child.once('error', () => { failed = true; });
        child.once('close', code => {
          clearTimeout(timer); signal.removeEventListener('abort', stop);
          if (timedOut) return reject(new Error('VOICE_TIMEOUT'));
          if (signal.aborted) return reject(new Error('VOICE_NATIVE_CANCELLED'));
          if (failed || code !== 0) return reject(new Error('VOICE_PROVIDER_FAILED'));
          const text = output.trim();
          if (!text || text.length > 10_000 || /^\[.*\]$/.test(text)) return reject(new Error('VOICE_EMPTY_TRANSCRIPT'));
          resolve(text);
        });
      });
    } catch (error) { failed = true; originalError = error; }
    finally {
      // Runs after the native child close event, including timeout and cancellation.
      try { await rm(directory, { recursive: true, force: true }); }
      catch { cleanupFailed = true; }
    }
    if (cleanupFailed) throw new Error('VOICE_CLEANUP_REQUIRED');
    if (failed) throw originalError;
    return transcription;
  }
  private async host() {
    if (!(await this.readiness()).ready || !this.executable) throw new Error('VOICE_PROVIDER_UNAVAILABLE');
    if (!this.recoveryHost) this.recoveryHost = new VoiceRecoveryHost(this.root, this.executable);
    return this.recoveryHost;
  }
  async prepareExecution() { return (await this.host()).identity(); }
  async recoverExecution(id: string, receipt: unknown) { return (await this.host()).recover(id, receipt); }
  async temporaryIds() { return (await this.host()).temporaryIds(); }
}
