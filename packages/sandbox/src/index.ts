import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export interface WorkspaceFile { path: string; content: string }
export interface WorkspaceSnapshot { files: WorkspaceFile[]; sha: string; diff: string }
export interface Verification {
  sha: string;
  test: { command?: string[]; exitCode: number; output: string };
  build: { command?: string[]; exitCode: number; output: string };
  sandbox: { networkDisabled: boolean; readOnlyRoot: boolean; resourceLimited: boolean };
  verifiedAt: string;
}

// Pre-provisioned official image; neither the broker nor generated code can pull images.
export const SANDBOX_IMAGE = 'node:22.20.0-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTABLE = /^(src\/math\.mjs|test\/extra[a-zA-Z0-9_-]*\.mjs)$/;
const MAX_FILE = 65_536;
const MAX_TOTAL = 262_144;
const fixture: WorkspaceFile[] = [
  { path: 'package.json', content: '{"name":"node-functions-v1","private":true,"type":"module"}\n' },
  { path: 'src/math.mjs', content: 'export function add(a, b) {\n  return a - b;\n}\nexport function sum(values) {\n  return values.reduce(add, 0);\n}\n' },
  { path: 'test/math.test.mjs', content: "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add, sum } from '../src/math.mjs';\ntest('AC-01 add positive numbers', () => assert.equal(add(2, 3), 5));\ntest('AC-02 add negative and positive numbers', () => assert.equal(add(-2, 3), 1));\ntest('AC-03 sum numbers', () => assert.equal(sum([1, 2, 3]), 6));\ntest('AC-04 empty sum', () => assert.equal(sum([]), 0));\n" },
  { path: 'build.mjs', content: "import { spawnSync } from 'node:child_process';\nconst result = spawnSync(process.execPath, ['--check', 'src/math.mjs'], { encoding: 'utf8' });\nprocess.stdout.write(result.stdout || '');\nprocess.stderr.write(result.stderr || '');\nprocess.exit(result.status ?? 1);\n" },
];

const isolationProbe = `const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
assert.equal(process.versions.node, '22.20.0');
assert.equal(process.getuid(), 1000);
const processStatus = fs.readFileSync('/proc/self/status', 'utf8');
assert.match(processStatus, /^Seccomp:\\s+2$/m);
assert.match(processStatus, /^NoNewPrivs:\\s+1$/m);
assert.match(processStatus, /^CapEff:\\s+0+$/m);
assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), '268435456');
assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(), '64');
assert.equal(fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), '100000 100000');
for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'PIXEL_HOST_SECRET_SENTINEL']) assert.equal(process.env[name], undefined);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
assert.equal(fs.existsSync('/workspace'), false);
assert.throws(() => fs.writeFileSync('/pixel-root-write-probe', 'blocked'));
const socket = net.connect({host:'1.1.1.1', port:80});
socket.once('connect', () => { console.error('network escaped'); socket.destroy(); process.exitCode=1; });
socket.once('error', () => { socket.destroy(); console.log('ISOLATION_OK'); });
socket.setTimeout(1500, () => { socket.destroy(); console.log('ISOLATION_OK'); });`;

function fail(message: string): never { throw new Error(`Sandbox: ${message}`); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) fail('ABORTED'); }

async function assertNoLinks(path: string) {
  let cursor = resolve(path);
  for (;;) {
    try {
      if ((await lstat(cursor)).isSymbolicLink()) fail('SYMLINK_DENIED');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (cursor === parse(cursor).root) break;
    cursor = dirname(cursor);
  }
}

function command(args: string[], timeoutMs = 10_000, signal?: AbortSignal): Promise<{ exitCode: number; output: string }> {
  checkAbort(signal);
  return new Promise((fulfill, reject) => {
    const child = spawn('docker', args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    let overflow = false;
    let aborted = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const abort = () => { aborted = true; child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    const append = (chunk: Buffer) => {
      if (output.length >= 131_072) return;
      output += chunk.toString('utf8');
      if (output.length > 131_072) { output = output.slice(0, 131_072); overflow = true; child.kill(); }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const release = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', (error) => { release(); reject(new Error(`Sandbox: DOCKER_UNAVAILABLE (${(error as NodeJS.ErrnoException).code})`)); });
    child.on('close', (code) => {
      release();
      if (aborted) { reject(new Error('Sandbox: ABORTED')); return; }
      fulfill({ exitCode: timedOut ? 124 : overflow ? 125 : code ?? 1, output: `${output}${timedOut ? '\nTIME_LIMIT' : ''}${overflow ? '\nOUTPUT_LIMIT' : ''}` });
    });
  });
}

export class DockerSandbox {
  readonly root: string;
  private readonly timeoutMs: number;
  private readonly locks = new Map<string, Promise<unknown>>();
  private preflightPromise?: Promise<void>;

  constructor(root = resolve('.local/agent-workspaces'), options: { timeoutMs?: number } = {}) {
    this.root = resolve(root);
    if (!isAbsolute(this.root) || /[,\r\n]/.test(this.root)) fail('INVALID_ROOT');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (this.timeoutMs < 500 || this.timeoutMs > 60_000) fail('INVALID_TIME_LIMIT');
  }

  private path(runId: string) {
    if (!UUID.test(runId)) fail('INVALID_RUN_ID');
    return join(this.root, runId.toLowerCase());
  }

  private async locked<T>(runId: string, action: () => Promise<T>): Promise<T> {
    this.path(runId);
    const key = runId.toLowerCase();
    const previous = this.locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.locks.set(key, current);
    try { return await current; } finally { if (this.locks.get(key) === current) this.locks.delete(key); }
  }

  async prepare(runId: string): Promise<WorkspaceSnapshot> {
    return this.locked(runId, async () => {
      const path = this.path(runId);
      await assertNoLinks(path);
      await mkdir(this.root, { recursive: true });
      try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('WORKSPACE_EXISTS'); throw error; }
      await mkdir(join(path, 'src'));
      await mkdir(join(path, 'test'));
      for (const file of fixture) await writeFile(join(path, file.path), file.content, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
      return this.readSnapshot(runId);
    });
  }

  async snapshot(runId: string): Promise<WorkspaceSnapshot> {
    return this.locked(runId, () => this.readSnapshot(runId));
  }

  private async readSnapshot(runId: string): Promise<WorkspaceSnapshot> {
    const path = this.path(runId);
    await assertNoLinks(path);
    const files: WorkspaceFile[] = [];
    let total = 0;
    const walk = async (directory: string, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        const absolute = join(directory, entry.name);
        if (entry.isSymbolicLink()) fail('SYMLINK_DENIED');
        if (entry.isDirectory()) {
          if (relative !== 'src' && relative !== 'test') fail('UNEXPECTED_DIRECTORY');
          await walk(absolute, `${relative}/`);
          continue;
        }
        if (!entry.isFile()) fail('NON_FILE_DENIED');
        if (!MUTABLE.test(relative) && !fixture.some((file) => file.path === relative)) fail('UNEXPECTED_FILE');
        const stats = await lstat(absolute);
        if (stats.size > MAX_FILE || stats.nlink !== 1) fail('SIZE_OR_HARDLINK_LIMIT');
        const content = await readFile(absolute, 'utf8');
        total += Buffer.byteLength(content);
        if (total > MAX_TOTAL || files.length >= 32) fail('SIZE_LIMIT');
        files.push({ path: relative, content });
      }
    };
    await walk(path);
    for (const expected of fixture) {
      const actual = files.find((file) => file.path === expected.path);
      if (!actual) fail('REQUIRED_FILE_MISSING');
      if (!MUTABLE.test(expected.path) && actual.content !== expected.content) fail('TRUSTED_FILE_CHANGED');
    }
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const sha = createHash('sha256').update(JSON.stringify(files)).digest('hex');
    const diff = files.flatMap((file) => {
      const initial = fixture.find((candidate) => candidate.path === file.path);
      if (initial?.content === file.content) return [];
      return [`--- ${initial ? `a/${file.path}` : '/dev/null'}\n+++ b/${file.path}\n${(initial?.content ?? '').split('\n').map((line) => `-${line}`).join('\n')}\n${file.content.split('\n').map((line) => `+${line}`).join('\n')}`];
    }).join('\n');
    return { files, sha, diff };
  }

  async apply(runId: string, files: WorkspaceFile[]): Promise<WorkspaceSnapshot> {
    return this.locked(runId, async () => {
      const before = await this.readSnapshot(runId);
      if (!Array.isArray(files) || files.length < 1 || files.length > 29) fail('SIZE_LIMIT');
      const unique = new Set<string>();
      for (const file of files) {
        if (typeof file?.path !== 'string' || !MUTABLE.test(file.path)) fail('PATH_DENIED');
        if (typeof file.content !== 'string' || Buffer.byteLength(file.content) > MAX_FILE || file.content.includes('\0')) fail('SIZE_LIMIT');
        if (unique.has(file.path)) fail('DUPLICATE_PATH');
        unique.add(file.path);
        await assertNoLinks(join(this.path(runId), file.path));
      }
      const merged = new Map(before.files.map((file) => [file.path, file.content]));
      for (const file of files) merged.set(file.path, file.content);
      if (merged.size > 32 || [...merged.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0) > MAX_TOTAL) fail('SIZE_LIMIT');
      for (const file of files) await writeFile(join(this.path(runId), file.path), file.content, { encoding: 'utf8', mode: 0o644 });
      return this.readSnapshot(runId);
    });
  }

  async preflight(): Promise<void> {
    if (!this.preflightPromise) {
      this.preflightPromise = (async () => {
        const inspected = await command(['image', 'inspect', SANDBOX_IMAGE, '--format', '{{json .RepoDigests}}']);
        if (inspected.exitCode !== 0 || !inspected.output.includes('sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af')) fail('PINNED_IMAGE_UNAVAILABLE');
        const result = await this.container(randomUUID(), ['-e', isolationProbe]);
        if (result.exitCode !== 0 || !result.output.includes('ISOLATION_OK')) fail(`ISOLATION_PREFLIGHT_FAILED ${result.output.slice(-1000)}`);
      })().catch((error) => { this.preflightPromise = undefined; throw error; });
    }
    return this.preflightPromise;
  }

  private async container(runId: string, nodeArgs: string[], workspace?: string, signal?: AbortSignal) {
    const name = `pixel-sandbox-${runId.toLowerCase()}-${randomUUID()}`;
    const args = ['create', '--name', name, '--label', `ai-pixel-run=${runId.toLowerCase()}`, '--pull=never', '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64', '--cpus=1', '--memory=256m', '--memory-swap=256m', '--tmpfs=/tmp:rw,noexec,nosuid,size=16m', '--log-driver=none', '--entrypoint=node'];
    if (workspace) args.push('--mount', `type=bind,source=${workspace},target=/workspace,readonly`, '--workdir=/workspace');
    args.push(SANDBOX_IMAGE, ...nodeArgs);
    try {
      const created = await command(args, 10_000, signal);
      if (created.exitCode !== 0) fail(`CONTAINER_CREATE_FAILED ${created.output.slice(-1000)}`);
      const inspected = await command(['inspect', name, '--format', '{{json .}}'], 10_000, signal);
      if (inspected.exitCode !== 0) fail('CONTAINER_INSPECT_FAILED');
      const actual = JSON.parse(inspected.output) as { HostConfig: { NetworkMode: string; ReadonlyRootfs: boolean; Privileged: boolean; Memory: number; MemorySwap: number; NanoCpus: number; PidsLimit: number; CapDrop: string[]; SecurityOpt: string[] }; Config: { User: string } };
      const host = actual.HostConfig;
      if (host.NetworkMode !== 'none' || !host.ReadonlyRootfs || host.Privileged || host.Memory !== 268_435_456 || host.MemorySwap !== 268_435_456 || host.NanoCpus !== 1_000_000_000 || host.PidsLimit !== 64 || !host.CapDrop.includes('ALL') || !host.SecurityOpt.includes('no-new-privileges:true') || actual.Config.User !== '1000:1000') fail('CONTAINER_POLICY_MISMATCH');
      const attached = await command(['start', '--attach', name], this.timeoutMs, signal);
      if (attached.exitCode === 124 || attached.exitCode === 125) return attached;
      const state = await command(['inspect', name, '--format', '{{json .State}}'], 10_000, signal);
      if (state.exitCode !== 0) fail('CONTAINER_STATE_UNVERIFIABLE');
      const result = JSON.parse(state.output) as { ExitCode: number; Running: boolean; OOMKilled: boolean };
      if (result.Running) fail('CONTAINER_STILL_RUNNING');
      return { exitCode: result.ExitCode, output: `${attached.output}${result.OOMKilled ? '\nMEMORY_LIMIT' : ''}` };
    } finally {
      const removed = await command(['rm', '--force', name], 10_000);
      if (removed.exitCode !== 0 && !removed.output.includes('No such container')) fail('CONTAINER_CLEANUP_FAILED');
    }
  }

  async verify(runId: string, signal?: AbortSignal): Promise<Verification> {
    return this.locked(runId, async () => {
      checkAbort(signal);
      await this.preflight();
      checkAbort(signal);
      const before = await this.readSnapshot(runId);
      const tests = before.files.filter((file) => file.path.startsWith('test/') && file.path.endsWith('.mjs')).map((file) => file.path);
      const testArgs = ['--test', ...tests];
      const test = { command: ['node', ...testArgs], ...await this.container(runId, testArgs, this.path(runId), signal) };
      checkAbort(signal);
      const buildArgs = ['build.mjs'];
      const build = { command: ['node', ...buildArgs], ...await this.container(runId, buildArgs, this.path(runId), signal) };
      const after = await this.readSnapshot(runId);
      if (after.sha !== before.sha) fail('CANDIDATE_CHANGED_DURING_VERIFICATION');
      return { sha: before.sha, test, build, sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: new Date().toISOString() };
    });
  }

  async activeContainers(runId: string): Promise<string[]> {
    this.path(runId);
    const result = await command(['ps', '--all', '--filter', `label=ai-pixel-run=${runId.toLowerCase()}`, '--format', '{{.Names}}']);
    if (result.exitCode !== 0) fail('DOCKER_STATE_UNVERIFIABLE');
    return result.output.trim().split(/\r?\n/).filter(Boolean);
  }

  async cleanup(runId: string): Promise<void> {
    return this.locked(runId, async () => {
      if ((await this.activeContainers(runId)).length) fail('ACTIVE_CONTAINER');
      await assertNoLinks(this.path(runId));
      await rm(this.path(runId), { recursive: true, force: true });
    });
  }
}
