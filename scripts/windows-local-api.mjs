import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StartupError, redactLog, sameProcessOwner, supervise, waitUntil, webBuildReady, workspaceState } from './local-api-supervisor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const area = resolve(root, '.local/windows-api'), launchId = randomUUID();
const lockPath = resolve(area, 'owner.json'), statusPath = resolve(area, 'status.json'), stopPath = resolve(area, 'stop.json');
let stopping = false;
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const stopped = () => stopping || read(stopPath)?.launchId === launchId;
const record = value => writeFileSync(statusPath, JSON.stringify({ ...value, supervisorPid: process.pid, launchId, updatedAt: new Date().toISOString() }));
const services = { api: { state: 'STARTING' }, web: { state: 'STARTING' } };
const serviceRecord = name => value => { services[name] = value; record(workspaceState(services)); };

function command(args, timeout = 15_000) {
  return new Promise(resolveCommand => {
    const dockerPath = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Docker/Docker/resources/bin/docker.exe');
    const child = spawn(dockerPath, args, { cwd: root, windowsHide: true, stdio: 'ignore' });
    let done = false;
    const finish = code => { if (done) return; done = true; clearTimeout(timer); resolveCommand(code); };
    const timer = setTimeout(() => { child.kill(); finish(1); }, timeout);
    child.on('error', () => finish(1)); child.on('exit', code => finish(code ?? 1));
  });
}

function logStream(stream, service) {
  let buffer = '', privateKey = false;
  const log = resolve(area, `${service}.log`);
  const line = text => {
    if (/-----BEGIN .*PRIVATE KEY-----/.test(text)) privateKey = true;
    const end = /-----END .*PRIVATE KEY-----/.test(text);
    const safe = privateKey ? '[PRIVATE_KEY_REDACTED]' : redactLog(text);
    if (end) privateKey = false;
    if (existsSync(log) && statSync(log).size > 2_000_000) renameSync(log, `${log}.previous`);
    appendFileSync(log, `${safe}\n`);
  };
  stream.setEncoding('utf8'); stream.on('data', chunk => {
    buffer += chunk;
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
    }
    if (buffer.length > 16_384) { line('[OVERSIZED_LOG_LINE_REDACTED]'); buffer = ''; }
  });
  stream.on('end', () => { if (buffer) line(buffer); });
}

async function prepare(report) {
  if (!existsSync(resolve(root, '.local/runtime.json')) || !existsSync(resolve(root, '.local/compose.env'))) throw new StartupError('LOCAL_CONFIG_MISSING');
  report({ state: 'WAITING_DOCKER' });
  if (!await waitUntil(async () => await command(['info', '--format', '{{.ServerVersion}}']) === 0, { timeoutMs: 180_000, intervalMs: 5000, stopped })) throw new StartupError('DOCKER_NOT_READY');
  report({ state: 'WAITING_DATABASE' });
  // Existing pinned image/volume only. Never download an image, build, or reset data at logon.
  if (await command(['compose', '--env-file', '.local/compose.env', 'up', '-d', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '90', 'postgres'], 100_000) !== 0) throw new StartupError('DATABASE_NOT_READY');
}

async function portAvailable(port) {
  return new Promise(resolvePort => {
    const server = createServer(); server.once('error', () => resolvePort(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)));
  });
}

async function prepareWeb(report) {
  const folder = resolve(root, 'apps/web/.next');
  if (!existsSync(resolve(folder, 'BUILD_ID')) || !existsSync(resolve(folder, 'routes-manifest.json'))) throw new StartupError('WEB_BUILD_MISSING');
  let valid = false;
  try { valid = webBuildReady(readFileSync(resolve(folder, 'BUILD_ID'), 'utf8'), read(resolve(folder, 'routes-manifest.json'))); } catch { /* fail closed */ }
  if (!valid) throw new StartupError('WEB_BUILD_INVALID');
  report({ state: 'WAITING_API' });
  if (!await waitUntil(async () => {
    if (services.api.state !== 'RUNNING') return false;
    try { return (await fetch('http://127.0.0.1:3001/health/live', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  }, { timeoutMs: 300_000, stopped })) throw new StartupError('API_NOT_READY');
}

async function launch(service = 'API') {
  const web = service === 'WEB', port = web ? 3000 : 3001;
  if (!await portAvailable(port)) throw new StartupError('PORT_IN_USE');
  const args = web ? ['--import', pathToFileURL(resolve(root, 'scripts/local-web-lifecycle.mjs')).href, resolve(root, 'apps/web/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3000']
    : ['--import', 'tsx', resolve(root, 'apps/api/src/server.ts')];
  const child = spawn(process.execPath, args, {
    cwd: web ? resolve(root, 'apps/web') : root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, API_PORT: '3001' },
  });
  let exited = false;
  child.on('error', () => { exited = true; }); child.on('exit', () => { exited = true; });
  logStream(child.stdout, web ? 'web' : 'api'); logStream(child.stderr, web ? 'web' : 'api');
  return {
    pid: child.pid, exited: () => exited,
    ready: stop => waitUntil(async () => {
      if (exited) throw new StartupError(`${service}_EXITED`);
      try { return (await fetch(web ? 'http://127.0.0.1:3000/' : 'http://127.0.0.1:3001/health/live', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
    }, { timeoutMs: 90_000, stopped: stop }),
    async stop() {
      if (exited) return;
      if (child.connected) child.send({ type: 'ai-pixel.shutdown' }, () => undefined);
      if (!await waitUntil(() => exited, { timeoutMs: web ? 7000 : 30_000, intervalMs: 200 })) child.kill();
    },
  };
}

if (process.platform !== 'win32') throw new StartupError('WINDOWS_REQUIRED');
mkdirSync(area, { recursive: true });
function processOwner(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new StartupError('OWNER_FILE_INVALID');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$item = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($item) { @{pid = [int]$item.ProcessId; createdAt = $item.CreationDate.ToUniversalTime().ToString('o'); executable = $item.ExecutablePath; command = $item.CommandLine} | ConvertTo-Json -Compress }`], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  if (result.status !== 0) throw new StartupError('OWNER_IDENTITY_UNAVAILABLE');
  if (!result.stdout.trim()) return null;
  const identity = JSON.parse(result.stdout);
  if (identity.executable?.toLowerCase() !== process.execPath.toLowerCase() || !identity.command?.includes(fileURLToPath(import.meta.url))) return null;
  return { pid: identity.pid, createdAt: identity.createdAt };
}
const previous = read(lockPath);
if (previous) {
  const observed = processOwner(previous.pid);
  // Legacy locks from the first installation have no creation timestamp.
  if (observed && (!previous.createdAt || sameProcessOwner(previous, observed))) process.exit(0);
  unlinkSync(lockPath);
}
const identity = processOwner(process.pid);
if (!identity) throw new StartupError('OWNER_IDENTITY_UNAVAILABLE');
try { writeFileSync(lockPath, JSON.stringify({ ...identity, launchId }), { flag: 'wx' }); }
catch (error) { if (error.code === 'EEXIST') process.exit(0); throw error; }
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
try {
  const results = await Promise.all([
    supervise({ prepare: () => prepare(serviceRecord('api')), launch: () => launch('API'), stopped, record: serviceRecord('api') }),
    supervise({ prepare: () => prepareWeb(serviceRecord('web')), launch: () => launch('WEB'), stopped, record: serviceRecord('web'), service: 'WEB' }),
  ]);
  record({ ...workspaceState(services), state: stopped() ? 'STOPPED' : 'ERROR' });
  process.exitCode = stopped() ? 0 : Math.max(...results);
}
finally { if (read(lockPath)?.launchId === launchId) unlinkSync(lockPath); }
