import { createServer, type Server } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { webhookRelay } from '../src/ingress.js';

const path = '/api/webhooks/github/11111111-1111-4111-8111-111111111111';
const servers: Server[] = [];
async function start(fetcher: typeof fetch, allowedPath = path) {
  const server = createServer(webhookRelay(new Set([allowedPath]), fetcher)); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('LISTEN_FAILED');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }))); });

test('relay never exposes dashboard, Owner APIs, alternate connection IDs, query strings or GET', async () => {
  let calls = 0;
  const url = await start(async () => { calls += 1; return new Response('{}'); });
  for (const target of ['/', '/api/v1/projects', `${path}?query=1`, path.replace('111111111111', '222222222222')]) expect((await fetch(url + target, { method: 'POST' })).status).toBe(404);
  expect((await fetch(url + path)).status).toBe(404); expect(calls).toBe(0);
});
test('relay preserves exact signed bytes and only signature headers, with fixed upstream and no redirect', async () => {
  const raw = '{ "action": "test" }\n';
  const url = await start(async (target, init) => {
    expect(String(target)).toBe(`http://127.0.0.1:3001${path}`);
    const headers = new Headers(init?.headers);
    expect(headers.get('cookie')).toBeNull(); expect(headers.get('authorization')).toBeNull(); expect(headers.get('x-forwarded-host')).toBeNull();
    expect(headers.get('x-hub-signature-256')).toBe('sha256=signature');
    expect(Buffer.from(init?.body as Buffer).toString('utf8')).toBe(raw); expect(init?.redirect).toBe('error');
    return new Response('{"received":true}', { status: 202, headers: { 'Set-Cookie': 'must-not-forward=1' } });
  });
  const result = await fetch(url + path, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', Cookie: 'owner=secret', Authorization: 'Bearer private', 'X-Forwarded-Host': 'external', 'X-Hub-Signature-256': 'sha256=signature' } });
  expect(result.status).toBe(202); expect(result.headers.get('set-cookie')).toBeNull(); expect(result.headers.get('cache-control')).toBe('no-store'); expect(await result.json()).toEqual({ received: true });
});
test('relay bounds body size and reports upstream failure without leaking diagnostic secrets', async () => {
  let calls = 0;
  const url = await start(async () => { calls += 1; throw new Error('sensitive-upstream-detail'); });
  expect((await fetch(url + path, { method: 'POST', body: 'x'.repeat(262_145) })).status).toBe(413); expect(calls).toBe(0);
  const failed = await fetch(url + path, { method: 'POST', body: '{}' });
  expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('sensitive-upstream-detail'); expect(calls).toBe(1);
});
test('Slack-only relay keeps signed form bytes and blocks the GitHub path', async () => {
  const slackPath = path.replace('/github/', '/slack/'), raw = 'command=%2Fai-pixel&text=%EC%83%81%ED%83%9C'; let calls = 0;
  const url = await start(async (target, init) => {
    calls += 1; expect(String(target)).toBe(`http://127.0.0.1:3001${slackPath}`);
    expect(new Headers(init?.headers).get('x-slack-signature')).toBe('v0=signature');
    expect(new Headers(init?.headers).get('x-slack-request-timestamp')).toBe('123');
    expect(Buffer.from(init?.body as Buffer).toString('utf8')).toBe(raw);
    return new Response('{"received":true}');
  }, slackPath);
  expect((await fetch(url + path, { method: 'POST', body: raw })).status).toBe(404);
  expect((await fetch(url + slackPath, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Signature': 'v0=signature', 'X-Slack-Request-Timestamp': '123' } })).status).toBe(200);
  expect(calls).toBe(1);
});
