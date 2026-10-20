import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { DockerSandbox, dockerCommand, type Verification, type WorkspaceFile, type WorkspaceSnapshot } from './index.js';

export const HOW_TO_TRASH_URL = 'https://github.com/Ina-dang/how-to-trash.git';
export const HOW_TO_TRASH_BASE_SHA = 'e98a537cada650e64a29b5e25c5cf6e94f5ced0f';
export const REPOSITORY_PATHS = ['src/app/page.tsx', 'src/components/region/RegionDirectory.tsx',
  'src/components/region/RegionDirectory.style.ts', 'src/lib/regions.ts', 'tests/regions.test.mjs', 'package.json'] as const;
export interface RepositorySource {
  profile: 'how-to-trash-v1'; repositoryUrl: string; baseSha: string; admissionSha: string; imageId: string;
}
export interface Admission {
  version: 1; source: Omit<RepositorySource, 'admissionSha'>;
  files: WorkspaceFile[]; assets: { path: string; base64: string }[];
}
const fail = (reason: string): never => { throw new Error(`Sandbox: ${reason}`); };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const validPath = (path: string) => /^(?:[A-Za-z0-9_@()[\].-]+\/)*[A-Za-z0-9_@()[\].-]+$/.test(path)
  && !path.split('/').some(part => part === '.' || part === '..' || part.endsWith('.') || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
async function noLinks(path: string) {
  let current = resolve(path);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('SYMLINK_DENIED'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
    current = dirname(current);
  }
}
export async function loadRepositoryAdmission(root: string): Promise<{ source: RepositorySource; admission: Admission }> {
  const path = join(resolve(root), '.local/repository-admissions/how-to-trash/manifest.json');
  await noLinks(path);
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 2_000_000) fail('ADMISSION_SIZE_LIMIT');
  const admission = JSON.parse(raw) as Admission;
  if (admission.version !== 1 || admission.source?.profile !== 'how-to-trash-v1'
    || admission.source.repositoryUrl !== HOW_TO_TRASH_URL || admission.source.baseSha !== HOW_TO_TRASH_BASE_SHA
    || !/^sha256:[a-f0-9]{64}$/.test(admission.source.imageId) || !Array.isArray(admission.files) || !Array.isArray(admission.assets)) fail('ADMISSION_INVALID');
  const paths = [...admission.files, ...admission.assets].map(file => file.path);
  if (paths.length > 64 || paths.some(path => !validPath(path)) || new Set(paths).size !== paths.length) fail('ADMISSION_INVALID');
  return { admission, source: { ...admission.source, admissionSha: hash(raw) } };
}

/** One explicitly admitted repository; generated code never runs on the host. */
export class RepositorySandbox {
  constructor(private root: string, private source: RepositorySource) { this.root = resolve(root); }
  private path(runId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId)) fail('INVALID_RUN_ID');
    return join(this.root, '.local/repository-workspaces', runId.toLowerCase());
  }
  private async admitted() {
    const actual = await loadRepositoryAdmission(this.root);
    if (!isDeepStrictEqual(actual.source, this.source)) fail('REPOSITORY_SOURCE_CHANGED');
    return actual.admission;
  }
  async prepare(runId: string): Promise<WorkspaceSnapshot> {
    const admission = await this.admitted(), path = this.path(runId);
    await noLinks(path);
    await mkdir(dirname(path), { recursive: true });
    await mkdir(path); // Existing/unknown workspaces must never be overwritten.
    for (const file of admission.files) {
      await mkdir(dirname(join(path, file.path)), { recursive: true });
      await writeFile(join(path, file.path), file.content, { flag: 'wx' });
    }
    for (const asset of admission.assets) {
      await mkdir(dirname(join(path, asset.path)), { recursive: true });
      await writeFile(join(path, asset.path), Buffer.from(asset.base64, 'base64'), { flag: 'wx' });
    }
    return this.snapshot(runId);
  }
  async snapshot(runId: string): Promise<WorkspaceSnapshot> {
    const admission = await this.admitted(), path = this.path(runId);
    await noLinks(path);
    const files: WorkspaceFile[] = [], seen = new Set<string>();
    const expected = new Map(admission.files.map(file => [file.path, file.content]));
    const assets = new Map(admission.assets.map(file => [file.path, Buffer.from(file.base64, 'base64')]));
    const allowed = new Set([...expected.keys(), ...assets.keys(), ...REPOSITORY_PATHS]);
    let bytes = 0;
    const walk = async (directory: string, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name, absolute = join(directory, entry.name);
        if (!validPath(relative) || entry.isSymbolicLink()) fail('PATH_DENIED');
        if (entry.isDirectory()) {
          if (![...allowed].some(file => file.startsWith(`${relative}/`))) fail('PATH_DENIED');
          await walk(absolute, `${relative}/`); continue;
        }
        const stat = await lstat(absolute);
        if (!entry.isFile() || stat.nlink !== 1 || stat.size > 300_000 || !allowed.has(relative)) fail('FILE_DENIED');
        seen.add(relative); bytes += stat.size;
        if (bytes > 1_000_000 || seen.size > 64) fail('SIZE_LIMIT');
        const content = await readFile(absolute);
        const asset = assets.get(relative);
        if (asset) { if (!content.equals(asset)) fail('TRUSTED_FILE_CHANGED'); continue; }
        const text = content.toString('utf8');
        if (text.includes('\0') || !Buffer.from(text).equals(content)) fail('INVALID_TEXT');
        if (!(REPOSITORY_PATHS as readonly string[]).includes(relative) && text !== expected.get(relative)) fail('TRUSTED_FILE_CHANGED');
        if (relative === 'package.json') assertPackage(expected.get(relative) ?? fail('ADMISSION_INVALID'), text);
        files.push({ path: relative, content: text });
      }
    };
    await walk(path);
    for (const required of [...expected.keys(), ...assets.keys()]) if (!seen.has(required)) fail('REQUIRED_FILE_MISSING');
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const sha = hash(JSON.stringify({ admissionSha: this.source.admissionSha, files }));
    const diff = files.flatMap(file => file.content === expected.get(file.path) ? [] : [
      `--- ${expected.has(file.path) ? `a/${file.path}` : '/dev/null'}\n+++ b/${file.path}\n${(expected.get(file.path) ?? '').split('\n').map(line => `-${line}`).join('\n')}\n${file.content.split('\n').map(line => `+${line}`).join('\n')}`,
    ]).join('\n');
    return { files, sha, diff };
  }
  async apply(runId: string, files: WorkspaceFile[]): Promise<WorkspaceSnapshot> {
    await this.snapshot(runId);
    if (!Array.isArray(files) || files.length < 1 || files.length > 6 || new Set(files.map(file => file.path)).size !== files.length) fail('SIZE_LIMIT');
    const admission = await this.admitted();
    for (const file of files) {
      if (!(REPOSITORY_PATHS as readonly string[]).includes(file.path)) fail('PATH_DENIED');
      if (typeof file.content !== 'string' || file.content.includes('\0') || Buffer.byteLength(file.content) > 32_000) fail('SIZE_LIMIT');
      if (file.path === 'package.json') assertPackage(admission.files.find(item => item.path === file.path)?.content ?? fail('ADMISSION_INVALID'), file.content);
      await noLinks(join(this.path(runId), file.path));
    }
    for (const file of files) {
      await mkdir(dirname(join(this.path(runId), file.path)), { recursive: true });
      await writeFile(join(this.path(runId), file.path), file.content);
    }
    return this.snapshot(runId);
  }
  private async container(runId: string, mode: 'test' | 'build', signal?: AbortSignal) {
    const image = await dockerCommand(['image', 'inspect', this.source.imageId, '--format', '{{.Id}}'], 10_000, signal);
    if (image.exitCode !== 0 || image.output.trim() !== this.source.imageId) fail('PINNED_IMAGE_UNAVAILABLE');
    const name = `pixel-sandbox-${runId}-${randomUUID()}`;
    try {
      const result = await dockerCommand(['create', '--name', name, '--label', `ai-pixel-run=${runId}`, '--pull=never',
        '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
        '--pids-limit=128', '--cpus=2', '--memory=2g', '--memory-swap=2g', '--tmpfs=/tmp:rw,nosuid,size=512m,mode=1777', '--log-driver=none',
        '--env=NEXT_TELEMETRY_DISABLED=1', '--env=CI=1', '--env=NODE_OPTIONS=--max-old-space-size=1536',
        '--mount', `type=bind,source=${this.path(runId)},target=/candidate,readonly`, '--entrypoint=node',
        this.source.imageId, '/opt/broker/verify.cjs', mode], 10_000, signal);
      if (result.exitCode !== 0) fail('CONTAINER_CREATE_FAILED');
      const inspected = await dockerCommand(['inspect', name, '--format', '{{json .}}'], 10_000, signal);
      if (inspected.exitCode !== 0) fail('CONTAINER_INSPECT_FAILED');
      const actual = JSON.parse(inspected.output), host = actual.HostConfig;
      if (actual.Image !== this.source.imageId || host.NetworkMode !== 'none' || !host.ReadonlyRootfs || host.Privileged
        || host.Memory !== 2_147_483_648 || host.MemorySwap !== 2_147_483_648 || host.PidsLimit !== 128 || host.NanoCpus !== 2_000_000_000
        || !host.CapDrop.includes('ALL') || !host.SecurityOpt.includes('no-new-privileges:true') || actual.Config.User !== '1000:1000'
        || actual.Mounts.some((mount: { Destination: string; RW: boolean }) => mount.Destination === '/candidate' && mount.RW)) fail('CONTAINER_POLICY_MISMATCH');
      const attached = await dockerCommand(['start', '--attach', name], 120_000, signal);
      if ([124, 125].includes(attached.exitCode)) return attached;
      const stateResult = await dockerCommand(['inspect', name, '--format', '{{json .State}}'], 10_000, signal);
      if (stateResult.exitCode !== 0) fail('CONTAINER_STATE_UNVERIFIABLE');
      const state = JSON.parse(stateResult.output);
      if (state.Running) fail('CONTAINER_STILL_RUNNING');
      return { exitCode: state.ExitCode as number, output: attached.output + (state.OOMKilled ? '\nMEMORY_LIMIT' : '') };
    } finally {
      const removed = await dockerCommand(['rm', '--force', name]);
      if (removed.exitCode !== 0 && !removed.output.includes('No such container')) fail('CONTAINER_CLEANUP_FAILED');
    }
  }
  async verify(runId: string, signal?: AbortSignal): Promise<Verification> {
    await new DockerSandbox().preflight();
    const before = await this.snapshot(runId);
    const test = { command: ['node', '/opt/broker/verify.cjs', 'test'], ...await this.container(runId, 'test', signal) };
    const build = { command: ['node', '/opt/broker/verify.cjs', 'build'], ...await this.container(runId, 'build', signal) };
    if (test.exitCode === 0 && build.exitCode === 0) {
      build.output += '\nBROKER_IMAGE_COMMANDS: eslint . exit0; next build --webpack exit0; tsc --noEmit exit0. Fixed image executes sequentially and exits on any failure.\n';
      const browser = await this.browser(runId, signal);
      build.output += `BROWSER_VERIFICATION_EXIT=${browser.exitCode}\n${browser.output}`;
      if (browser.exitCode !== 0) build.exitCode = browser.exitCode;
    }
    if ((await this.snapshot(runId)).sha !== before.sha) fail('CANDIDATE_CHANGED_DURING_VERIFICATION');
    return { sha: before.sha, test, build, sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: new Date().toISOString() };
  }
  private async browser(runId: string, signal?: AbortSignal): Promise<{ exitCode: number; output: string }> {
    if (signal?.aborted) fail('ABORTED');
    try {
      return await new Promise((fulfill, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', join(this.root, 'scripts/verify-repository-browser.ts'), '--worker', runId], {
          cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '', timedOut = false;
        const stop = () => { timedOut = true; if (process.platform === 'win32' && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); else child.kill('SIGKILL'); };
        const timer = setTimeout(stop, 150_000);
        signal?.addEventListener('abort', stop, { once: true });
        const append = (data: Buffer) => { output = (output + data.toString()).slice(-32_000); };
        child.stdout.on('data', append); child.stderr.on('data', append);
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
        child.on('error', error => { cleanup(); reject(error); });
        child.on('close', code => { cleanup(); fulfill({ exitCode: timedOut ? 124 : code ?? 1, output }); });
      });
    } finally {
      const removed = await dockerCommand(['rm', '--force', `pixel-preview-${runId}`]);
      if (removed.exitCode !== 0 && !removed.output.includes('No such container')) fail('CONTAINER_CLEANUP_FAILED');
    }
  }
}
function assertPackage(original: string, candidate: string) {
  const before = JSON.parse(original), after = JSON.parse(candidate);
  if (after.scripts?.test !== undefined && after.scripts.test !== 'node --test tests/*.test.mjs') fail('PACKAGE_CHANGE_DENIED');
  const normalized = structuredClone(after);
  if (normalized.scripts) delete normalized.scripts.test;
  if (!isDeepStrictEqual(normalized, before)) fail('PACKAGE_CHANGE_DENIED');
}
