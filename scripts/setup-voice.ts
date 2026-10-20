import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Explicit local setup only. The service never downloads or installs a provider.
const root = path.resolve('.local/voice-runtime');
const release = 'b5454';
const archiveSha = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb';
const modelSha1 = 'bd577a113a864445d4c299885e0cb97d4ba92b5f';
async function download(url: string, target: string, algorithm: string, expected?: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error('VOICE_DOWNLOAD_FAILED');
  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = createHash(algorithm).update(buffer).digest('hex');
  if (expected && hash !== expected) throw new Error('VOICE_DOWNLOAD_HASH_MISMATCH');
  await writeFile(target, buffer, { flag: 'wx' });
  return hash;
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('VOICE_SETUP_WINDOWS_X64_ONLY');
await mkdir(root, { recursive: true });
const alreadyInstalled = await readFile(path.join(root, 'manifest.json')).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
if (alreadyInstalled) {
  const { LocalWhisper } = await import('../apps/api/src/voice-provider.js');
  if (!(await new LocalWhisper(process.cwd()).readiness()).ready) throw new Error('VOICE_INSTALLATION_REPAIR_REQUIRED');
  console.log(JSON.stringify({ installed: true, release, reusedVerifiedInstallation: true, downloadedBytes: 0 }));
  process.exit(0);
}
const archive = path.join(root, 'whisper-bin-x64.zip');
await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${release}/whisper-bin-x64.zip`, archive, 'sha256', archiveSha);
const bin = path.join(root, 'bin');
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(bin)}`], { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin', path.join(root, 'ggml-tiny.bin'), 'sha1', modelSha1);
await download(`https://raw.githubusercontent.com/ggml-org/whisper.cpp/${release}/LICENSE`, path.join(root, 'LICENSE-whisper-cpp'), 'sha256');
await download('https://raw.githubusercontent.com/openai/whisper/main/LICENSE', path.join(root, 'LICENSE-whisper-model'), 'sha256');
const files: Record<string, string> = {};
async function walk(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(exe|dll|bin)$/.test(entry.name)) files[path.relative(root, file).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
await walk(bin);
const executable = Object.keys(files).find(file => file.endsWith('/whisper-cli.exe'));
if (!executable) throw new Error('VOICE_BINARY_NOT_FOUND');
files['ggml-tiny.bin'] = createHash('sha256').update(await readFile(path.join(root, 'ggml-tiny.bin'))).digest('hex');
await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ release, archiveSha, modelSha1, executable, files }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ installed: true, release, executable, model: 'tiny-multilingual', files: Object.keys(files).length, externalSpeechRequests: 0 }));
