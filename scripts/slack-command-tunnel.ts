import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { webhookRelay } from '../packages/integrations/src/ingress.js';

// Start only after a fresh Owner approval of this exact 30-minute exposure.
const [connectionId, approved] = process.argv.slice(2);
assert(/^[a-f0-9-]{36}$/.test(connectionId ?? '') && approved === '--approved-30-minutes', 'Usage: slack-command-tunnel.ts <connectionId> --approved-30-minutes');
const path = `/api/webhooks/slack/${connectionId}`, startedAt = new Date().toISOString();
const state = { sessionId: randomUUID(), pid: process.pid, tunnelPid: null as number | null, startedAt, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  allowedPostPaths: [path], publicUrl: null as string | null, closed: false, closeReason: null as string | null };
const save = () => writeFileSync('.local/slack-command-tunnel.json', JSON.stringify(state, null, 2));
let tunnel: ChildProcess | undefined, stopping = false;
const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10_000 }, webhookRelay(new Set([path])));
server.maxConnections = 32;
function stop(reason: string) {
  if (stopping) return; stopping = true;
  clearTimeout(expiry); clearInterval(control);
  server.close(); server.closeAllConnections();
  if (tunnel && tunnel.exitCode === null) tunnel.kill();
  state.closed = true; state.closeReason = reason; save();
  console.log(JSON.stringify({ closed: true, reason, sessionId: state.sessionId }));
}
const expiry = setTimeout(() => stop('APPROVED_WINDOW_EXPIRED'), 30 * 60_000);
const control = setInterval(() => {
  try { if (JSON.parse(readFileSync('.local/slack-command-tunnel-stop.json', 'utf8')).sessionId === state.sessionId) stop('TEST_COMPLETED'); }
  catch { /* A stop file is optional and never supplies a path or command. */ }
}, 500);
process.on('SIGINT', () => stop('INTERRUPTED')); process.on('SIGTERM', () => stop('INTERRUPTED'));
process.on('exit', () => { if (tunnel && tunnel.exitCode === null) tunnel.kill(); });
server.on('error', () => { stop('RELAY_UNAVAILABLE'); process.exitCode = 1; });
server.listen(3002, '127.0.0.1', () => {
  save();
  tunnel = spawn(process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared', ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3002'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.tunnelPid = tunnel.pid ?? null; save();
  let buffer = '';
  const observe = (chunk: Buffer) => {
    buffer = (buffer + chunk.toString('utf8')).slice(-8192);
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buffer)?.[0];
    if (url && !state.publicUrl) { state.publicUrl = url; save(); console.log(JSON.stringify(state)); }
  };
  tunnel.stdout?.on('data', observe); tunnel.stderr?.on('data', observe);
  tunnel.on('error', () => { stop('TUNNEL_UNAVAILABLE'); process.exitCode = 1; });
  tunnel.on('exit', () => stop('TUNNEL_EXITED'));
});
