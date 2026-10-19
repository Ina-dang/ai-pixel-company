import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Explicit opt-in only: Owner must approve both connection paths and this 30-minute exposure.
const [githubId, slackId] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (!githubId || !slackId || !uuid.test(githubId) || !uuid.test(slackId)) throw new Error('Usage: webhook-tunnel.ts <githubConnectionId> <slackConnectionId>');
const secrets = resolve('.local/integration-secrets');
for (const directory of [resolve('.local'), secrets]) {
  if (!existsSync(directory)) mkdirSync(directory);
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== directory.toLowerCase()) throw new Error('SECRET_DIRECTORY_DENIED');
}
const secret = resolve(secrets, 'github-webhook.txt');
if (!existsSync(secret)) writeFileSync(secret, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
if (lstatSync(secret).isSymbolicLink() || !lstatSync(secret).isFile() || lstatSync(secret).nlink !== 1) throw new Error('SECRET_FILE_DENIED');
if (!/^[0-9a-f]{64}$/.test(readFileSync(secret, 'utf8').trim())) throw new Error('WEBHOOK_SECRET_FORMAT_INVALID');
const relay = spawn(process.execPath, ['--import', 'tsx', 'scripts/webhook-relay.ts', githubId, slackId], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let tunnel: ReturnType<typeof spawn> | undefined, stopped = false, published = false;
const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const lifetime = setTimeout(() => stop('EXPIRED'), 30 * 60 * 1000);
const startup = setTimeout(() => stop('START_TIMEOUT'), 60_000);
function stop(reason: string) {
  if (stopped) return;
  stopped = true; clearTimeout(lifetime); clearTimeout(startup);
  tunnel?.kill(); relay.kill();
  console.log(JSON.stringify({ stopped: true, reason }));
}
relay.once('error', () => stop('RELAY_UNAVAILABLE'));
relay.once('exit', () => stop('RELAY_EXITED'));
relay.stdout.on('data', data => {
  if (tunnel || stopped || !String(data).includes('allowedPostPaths')) return;
  tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3002', '--protocol', 'http2'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(JSON.stringify({ supervisorPid: process.pid, relayPid: relay.pid, tunnelPid: tunnel.pid, maximumMinutes: 30, expiresAt, allowedPostPaths: [`/api/webhooks/github/${githubId}`, `/api/webhooks/slack/${slackId}`] }));
  const observe = (data: Buffer) => {
    const url = String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
    if (!published && url) { published = true; clearTimeout(startup); console.log(JSON.stringify({ publicUrl: url, maximumMinutes: 30 })); }
  };
  tunnel.stdout?.on('data', observe); tunnel.stderr?.on('data', observe);
  tunnel.once('error', () => stop('TUNNEL_UNAVAILABLE')); tunnel.once('exit', () => stop('TUNNEL_EXITED'));
});
process.on('SIGINT', () => stop('INTERRUPTED'));
process.on('SIGTERM', () => stop('TERMINATED'));
