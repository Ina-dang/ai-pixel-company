import { randomUUID } from 'node:crypto';
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, writeFile, realpath, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { expect, test } from 'vitest';
import { initializeOwner } from '../apps/api/src/app.js';
import { LocalWhisper } from '../apps/api/src/voice-provider.js';
import { VoiceService } from '../apps/api/src/voice.js';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !/(?:^|[_-])test(?:$|[_-])/.test(new URL(testUrl).pathname.slice(1))) throw new Error('ISOLATED_DATABASE_REQUIRED');
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
function alive(pid: number) {
  return Boolean(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.Id }; exit 0`], { windowsHide: true, encoding: 'utf8' }).trim());
}
async function closeChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${child.pid} -Force -ErrorAction Stop`], { windowsHide: true, timeout: 10000, stdio: 'pipe' });
  await closed;
}

for (const mode of ['controlled-native', 'real-whisper'] as const) test(`actual API parent crash recovery: ${mode}`, async () => {
  const admin = postgres(testUrl, { max: 1 }), marker = randomUUID(), name = `pixel_voice_recovery_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const isolated = new URL(testUrl); isolated.pathname = `/${name}`;
  const root = await mkdtemp(path.join(workspace, '.local/voice-crash-test-'));
  let created = false, db: ReturnType<typeof createDatabase> | undefined, child: ChildProcess | undefined, voice: VoiceService | undefined;
  let candidateId = '', nativePid = 0;
  const runtime = path.join(root, '.local/voice-runtime'), exe = path.join(runtime, 'bin/Release/whisper-cli.exe');
  try {
    await writeFile(path.join(root, 'fixture-owner'), marker, { flag: 'wx' });
    await admin.unsafe(`create database "${name}"`); created = true;
    await admin.unsafe(`comment on database "${name}" is '${marker}'`);
    db = createDatabase(isolated.toString()); await migrateDatabase(db); await initializeOwner(db);
    if (mode === 'real-whisper') {
      const verified = new LocalWhisper(workspace); expect((await verified.readiness()).ready).toBe(true);
      await cp(path.join(workspace, '.local/voice-runtime'), runtime, { recursive: true, errorOnExist: true, force: false });
    } else {
      await mkdir(path.dirname(exe), { recursive: true });
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; Add-Type -OutputAssembly ${quote(exe)} -OutputType ConsoleApplication -TypeDefinition 'public class PixelVoiceCrashFixture { public static void Main(string[] args) { System.Threading.Thread.Sleep(600000); } }'`], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
    }
    const provider = new LocalWhisper(root);
    if (mode === 'controlled-native') Object.assign(provider, { checked: true, executable: exe });
    await provider.prepareExecution();
    child = fork(fileURLToPath(new URL('./fixtures/voice-crash-worker.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], cwd: workspace, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, VOICE_CRASH_ROOT: root, VOICE_CRASH_DATABASE: isolated.toString(), VOICE_CRASH_MODE: mode } });
    const started = await new Promise<{ id: string; pid: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('FIXTURE_START_TIMEOUT')), 20000);
      child?.on('message', (message: { type?: string; id: string; pid: number }) => {
        if (message.type === 'native') { clearTimeout(timer); resolve(message); }
        if (message.type === 'failed') { clearTimeout(timer); reject(new Error('FIXTURE_FAILED')); }
      });
      child?.once('error', error => { clearTimeout(timer); reject(error); });
      child?.once('exit', () => { clearTimeout(timer); reject(new Error('FIXTURE_EXITED')); });
    });
    candidateId = started.id; nativePid = started.pid;
    expect((await db.sql`select status,owner_receipt,capture_source from voice_candidates where id=${candidateId}`)[0]).toMatchObject({ status: 'PROCESSING', capture_source: 'FILE', owner_receipt: { pid: child.pid } });
    await access(path.join(root, '.local/voice-temp', candidateId, 'audio.wav'));
    const nativeBeforeCrash = alive(nativePid);
    if (mode === 'controlled-native') expect(nativeBeforeCrash).toBe(true);
    // Terminate only the API owner. Its native child is deliberately left for recovery.
    await closeChild(child);
    const nativeWasAlive = alive(nativePid);
    voice = new VoiceService(db, root, provider); await voice.start();
    const row = (await db.sql`select status,transcript,error_code,recovery_attempts,recovery_details from voice_candidates where id=${candidateId}`)[0];
    expect(row).toMatchObject({ status: 'CANCELLED', transcript: null, error_code: 'VOICE_RECOVERED_AFTER_CRASH', recovery_attempts: 1, recovery_details: { filesDeleted: 1, automaticReplay: false } });
    if (nativeWasAlive) expect(row.recovery_details.stopped).toBe(1);
    expect(await readdir(path.join(root, '.local/voice-temp'))).toEqual([]);
    expect(alive(nativePid)).toBe(false);
    await voice.recoverPending();
    expect((await db.sql`select recovery_attempts from voice_candidates where id=${candidateId}`)[0].recovery_attempts).toBe(1);
    expect((await db.sql`select count(*)::int n from tasks`)[0].n).toBe(0);
    expect((await db.sql`select count(*)::int n from workflow_runs`)[0].n).toBe(0);
    console.log(JSON.stringify({ mode, ownerKilled: true, nativeBeforeCrash, nativeWasAlive, ...row.recovery_details, tasks: 0, runs: 0, residualAudio: 0 }));
  } finally { await cleanup(); }
  async function cleanup() {
    if (child) await closeChild(child);
    await voice?.stop();
    // If an assertion failed before startup, still use the exact same ownership boundary.
    if (db && candidateId) {
      const receipt = (await db.sql`select owner_receipt from voice_candidates where id=${candidateId}`)[0]?.owner_receipt;
      if (receipt) {
        const cleanup = new LocalWhisper(root);
        if (mode === 'controlled-native') Object.assign(cleanup, { checked: true, executable: exe });
        const result = await cleanup.recoverExecution(candidateId, receipt);
        if (result.state === 'BLOCKED') throw new Error('FIXTURE_CLEANUP_UNVERIFIABLE');
      }
    }
    await db?.close();
    if (created) {
      const owned = await admin`select shobj_description(oid,'pg_database') marker from pg_database where datname=${name}`;
      if (owned[0]?.marker !== marker || !/^pixel_voice_recovery_test_[a-f0-9]{12}$/.test(name)) throw new Error('DATABASE_CLEANUP_SCOPE_INVALID');
      await admin.unsafe(`drop database "${name}" with (force)`);
    }
    await admin.end();
    if (path.resolve(await realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase()
      || !root.startsWith(path.join(workspace, '.local/voice-crash-test-'))
      || await readFile(path.join(root, 'fixture-owner'), 'utf8') !== marker) throw new Error('DIRECTORY_CLEANUP_SCOPE_INVALID');
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
