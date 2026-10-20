import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { SANDBOX_IMAGE } from '../packages/sandbox/src/index.js';
import { HOW_TO_TRASH_BASE_SHA, HOW_TO_TRASH_URL, loadRepositoryAdmission, RepositorySandbox, type Admission } from '../packages/sandbox/src/repository.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkout = join(root, '.local/repositories/how-to-trash');
const run = promisify(execFile);
const directory = join(root, '.local/repository-admissions/how-to-trash');
async function baseline(source: Awaited<ReturnType<typeof loadRepositoryAdmission>>['source']) {
  const id = randomUUID(), sandbox = new RepositorySandbox(root, source);
  await sandbox.prepare(id);
  const verified = await sandbox.verify(id);
  const result = { baselineRunId: id, test: verified.test, build: verified.build, sandbox: verified.sandbox };
  await writeFile(join(root, '.local/how-to-trash-baseline.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (verified.test.exitCode === 0 || verified.build.exitCode !== 0) throw new Error('Expected missing-feature tests to fail and the unchanged baseline to build');
}
if (existsSync(join(directory, 'manifest.json'))) {
  const admitted = await loadRepositoryAdmission(root);
  const harness = await readFile(join(root, 'scripts/repository/verify.cjs'));
  if (!harness.equals(await readFile(join(directory, 'image/verify.cjs')))) throw new Error('Broker changed; prepare a separately versioned admission instead of replacing pinned runs');
  const inspected = await run('docker', ['image', 'inspect', admitted.source.imageId, '--format', '{{.Id}}'], { windowsHide: true });
  if (inspected.stdout.trim() !== admitted.source.imageId) throw new Error('Pinned dependency image unavailable');
  console.log(JSON.stringify({ reused: true, source: admitted.source }));
  if (process.argv.includes('--baseline')) await baseline(admitted.source);
  process.exit(0);
}
async function git(args: string[]) { return (await run('git', args, { cwd: checkout, encoding: 'utf8', windowsHide: true, maxBuffer: 2_000_000 })).stdout; }
if ((await git(['remote', 'get-url', 'origin'])).trim() !== HOW_TO_TRASH_URL || (await git(['rev-parse', 'HEAD'])).trim() !== HOW_TO_TRASH_BASE_SHA
  || (await git(['status', '--porcelain'])).trim()) throw new Error('Provisioning requires the exact clean selected repository commit');
await mkdir(directory, { recursive: true });
const entries = (await git(['ls-tree', '-rz', '--full-tree', 'HEAD'])).split('\0').filter(Boolean);
const files: Admission['files'] = [], assets: Admission['assets'] = [];
for (const entry of entries) {
  const match = /^(100644) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
  if (!match || match[3].includes('..') || match[3].includes('\\') || match[3].includes(':')) throw new Error('Unsupported repository path or mode');
  const content = (await run('git', ['cat-file', 'blob', match[2]], { cwd: checkout, encoding: 'buffer', windowsHide: true, maxBuffer: 1_000_000 })).stdout;
  if (match[3] === 'src/app/favicon.ico') assets.push({ path: match[3], base64: content.toString('base64') });
  else {
    const text = content.toString('utf8');
    if (text.includes('\0') || !Buffer.from(text).equals(content)) throw new Error('Unsupported non-text source');
    files.push({ path: match[3], content: text });
  }
}
const context = join(directory, 'image');
await mkdir(context, { recursive: true });
const required = (name: string) => { const file = files.find(item => item.path === name); if (!file) throw new Error(`Required source missing: ${name}`); return file.content; };
for (const name of ['package.json', 'package-lock.json']) await writeFile(join(context, name), required(name));
await writeFile(join(context, 'verify.cjs'), await readFile(join(root, 'scripts/repository/verify.cjs')));
await writeFile(join(context, 'Dockerfile'), `FROM ${SANDBOX_IMAGE}\nWORKDIR /opt/deps\nCOPY package.json package-lock.json ./\nRUN npm ci --ignore-scripts --no-audit --no-fund\nCOPY verify.cjs /opt/broker/verify.cjs\n`);
const tag = `ai-pixel-how-to-trash:${createHash('sha256').update(required('package-lock.json')).digest('hex').slice(0,16)}`;
const built = await run('docker', ['build', '--pull=false', '--tag', tag, context], { windowsHide: true, timeout: 240_000, maxBuffer: 2_000_000 });
if (built.stderr) console.log(built.stderr.slice(-1600));
const imageId = (await run('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { windowsHide: true })).stdout.trim();
const admission: Admission = { version: 1, source: { profile: 'how-to-trash-v1', repositoryUrl: HOW_TO_TRASH_URL, baseSha: HOW_TO_TRASH_BASE_SHA, imageId }, files, assets };
await writeFile(join(directory, 'manifest.json'), JSON.stringify(admission), { mode: 0o600 });
console.log(JSON.stringify({ provisioned: (await loadRepositoryAdmission(root)).source, textFiles: files.length, assets: assets.length, installScripts: false, paidProvider: false }));
if (process.argv.includes('--baseline')) {
  await baseline((await loadRepositoryAdmission(root)).source);
}
