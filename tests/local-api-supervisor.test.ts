import { expect, test } from 'vitest';
import { redactLog, sameProcessOwner, startLocalDatabase, StartupError, supervise, waitUntil, webBuildReady, workspaceState } from '../scripts/local-api-supervisor.mjs';

test('existing database with matching pinned image starts without registry-cache recreation', async () => {
  const calls: string[][] = [], pinned = `postgres:18-alpine@sha256:${'a'.repeat(64)}`;
  const code = await startLocalDatabase(async (args: string[]) => {
    calls.push(args);
    return { code: 0, output: args.includes('ps') ? 'b'.repeat(64) : args.includes('config') || args[0] === 'inspect' ? pinned : '' };
  });
  expect(code).toBe(0);
  expect(calls.at(-1)).toEqual(['compose', '--env-file', '.local/compose.env', 'start', '--wait', '--wait-timeout', '90', 'postgres']);
  expect(calls.some(args => args.includes('up') || args.includes('pull'))).toBe(false);
});

test.each(['missing', 'mismatched', 'unpinned', 'inspection-failed'])('database %s keeps the pinned no-download provisioning path', async scenario => {
  const calls: string[][] = [], pinned = `postgres:18-alpine@sha256:${'a'.repeat(64)}`;
  const code = await startLocalDatabase(async (args: string[]) => {
    calls.push(args);
    return { code: args[0] === 'inspect' && scenario === 'inspection-failed' ? 1 : 0,
      output: args.includes('ps') ? scenario === 'missing' ? '' : 'b'.repeat(64)
        : args.includes('config') ? scenario === 'unpinned' ? 'postgres:18-alpine' : pinned
          : args[0] === 'inspect' ? scenario === 'mismatched' ? 'other-image' : pinned : '' };
  });
  expect(code).toBe(0);
  expect(calls.at(-1)).toEqual(['compose', '--env-file', '.local/compose.env', 'up', '-d', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '90', 'postgres']);
  expect(calls.some(args => args.includes('start'))).toBe(false);
});

test('existing database readiness failure propagates without recreation or downloads', async () => {
  const pinned = `postgres:18-alpine@sha256:${'a'.repeat(64)}`;
  expect(await startLocalDatabase(async (args: string[]) => ({ code: args.includes('start') ? 1 : 0,
    output: args.includes('ps') ? 'b'.repeat(64) : pinned }))).toBe(1);
});

test('readiness waits through delayed Docker startup and respects a bounded timeout', async () => {
  let time = 0, checks = 0;
  const sleep = async (ms: number) => { time += ms; };
  expect(await waitUntil(async () => ++checks === 3, { timeoutMs: 5000, intervalMs: 1000, now: () => time, sleep })).toBe(true);
  expect(time).toBe(2000);
  expect(await waitUntil(async () => false, { timeoutMs: 2000, intervalMs: 1000, now: () => time, sleep })).toBe(false);
  expect(time).toBe(4000);
});

test('stop cancels prerequisite waiting without starting the API', async () => {
  expect(await waitUntil(async () => { throw new Error('must not check'); }, { timeoutMs: 1000, stopped: () => true })).toBe(false);
  let launches = 0;
  expect(await supervise({ prepare: async () => undefined, launch: async () => { launches++; throw new Error('must not launch'); }, stopped: () => true, record: () => undefined })).toBe(0);
  expect(launches).toBe(0);
});

test('persistent prerequisite failure stops at four attempts without leaking raw errors', async () => {
  let prepares = 0; const states: Array<Record<string, unknown>> = [], delays: number[] = [];
  const code = await supervise({ prepare: async () => { prepares++; throw new Error('postgresql://private'); }, launch: async () => { throw new Error('must not launch'); },
    stopped: () => false, record: (state: Record<string, unknown>) => states.push(state), sleep: async (ms: number) => { delays.push(ms); } });
  expect(code).toBe(1); expect(prepares).toBe(4); expect(delays).toEqual([15000, 15000, 15000]);
  expect(states.at(-1)).toMatchObject({ state: 'ERROR', attempt: 3, errorCode: 'STARTUP_FAILED' }); expect(JSON.stringify(states)).not.toContain('private');
});

test.each(['PORT_IN_USE', 'LOCAL_CONFIG_MISSING'])('terminal %s fails closed without touching another server', async reason => {
  let prepares = 0; const states: Array<Record<string, unknown>> = [];
  const code = await supervise({ prepare: async () => { prepares++; throw new StartupError(reason); }, launch: async () => { throw new Error('must not launch'); }, stopped: () => false,
    record: (state: Record<string, unknown>) => states.push(state), sleep: async () => { throw new Error('must not retry'); } });
  expect(code).toBe(1); expect(prepares).toBe(1); expect(states.at(-1)).toMatchObject({ state: 'ERROR', errorCode: reason });
});

test('unexpected API exit restarts only the owned child and a stop gracefully closes the replacement', async () => {
  let launches = 0, stopped = false, closes = 0; const states: Array<Record<string, unknown>> = [];
  const code = await supervise({ prepare: async () => undefined, stopped: () => stopped, record: (state: Record<string, unknown>) => states.push(state),
    launch: async () => { const index = ++launches; return { pid: index, ready: async () => true, exited: () => index === 1, stop: async () => { closes++; } }; },
    sleep: async (ms: number) => { if (ms === 500) stopped = true; } });
  expect(code).toBe(0); expect(launches).toBe(2); expect(closes).toBe(2);
  expect(states.filter(s => s.state === 'RUNNING').map(s => s.apiPid)).toEqual([1, 2]); expect(states.at(-1)?.state).toBe('STOPPED');
});

test('unready child is stopped before retry and final failure', async () => {
  let stops = 0;
  expect(await supervise({ prepare: async () => undefined, stopped: () => false, record: () => undefined, maxRestarts: 0,
    launch: async () => ({ pid: 1, ready: async () => false, exited: () => false, stop: async () => { stops++; } }) })).toBe(1);
  expect(stops).toBe(1);
});

test('startup logs redact credentials, database connections and ephemeral websocket addresses', () => {
  const text = 'postgresql://user:password@localhost/db xapp-sensitive-key xoxb-sensitive-key Bearer private-token wss://socket.slack.test/?ticket=private';
  const safe = redactLog(text);
  expect(safe).not.toMatch(/password|sensitive|private/); expect(safe).toContain('[DATABASE_URL]'); expect(safe).toContain('[WEBSOCKET_URL]');
});

test('a reused PID is not the saved supervisor and malformed ownership fails closed', () => {
  const saved = { pid: 123, createdAt: '2026-10-21T01:00:00.000Z' };
  expect(sameProcessOwner(saved, { ...saved })).toBe(true);
  expect(sameProcessOwner(saved, { pid: 123, createdAt: '2026-10-21T02:00:00.000Z' })).toBe(false);
  expect(sameProcessOwner(saved, null)).toBe(false); expect(sameProcessOwner({ pid: 123 }, saved)).toBe(false);
});

test('only a prepared dashboard build with the pinned local API rewrite can start', () => {
  const route = { source: '/api/v1/:path*', destination: 'http://127.0.0.1:3001/api/v1/:path*' };
  const manifest = { rewrites: { beforeFiles: [], afterFiles: [route], fallback: [] } };
  expect(webBuildReady('approved-local-build', manifest)).toBe(true);
  expect(webBuildReady('', manifest)).toBe(false); expect(webBuildReady('build', {})).toBe(false);
  expect(webBuildReady('build', { rewrites: [{ ...route, destination: 'https://external.test/api/v1/:path*' }] })).toBe(false);
  expect(webBuildReady('build', { rewrites: [route, { source: '/:path*', destination: 'https://external.test/:path*' }] })).toBe(false);
});

test('combined workspace readiness distinguishes partial failure and preserves the healthy service', () => {
  const api = { state: 'RUNNING', apiPid: 1, attempt: 0 }, web = { state: 'RUNNING', webPid: 2, attempt: 1 };
  expect(workspaceState({ api, web })).toMatchObject({ state: 'RUNNING', apiPid: 1, webPid: 2 });
  expect(workspaceState({ api, web: { state: 'ERROR', errorCode: 'WEB_BUILD_MISSING' } })).toMatchObject({ state: 'DEGRADED', apiPid: 1, webPid: null });
  expect(workspaceState({ api: { state: 'ERROR' }, web })).toMatchObject({ state: 'DEGRADED', apiPid: null, webPid: 2 });
  expect(workspaceState({ api: { state: 'STOPPED' }, web: { state: 'STOPPED' } }).state).toBe('STOPPED');
});

test('web child recovery has its own PID and retry budget without changing the API state', async () => {
  let launches = 0, stopped = false; const api = { state: 'RUNNING', apiPid: 77 }, states: Array<Record<string, unknown>> = [];
  const code = await supervise({ service: 'WEB', prepare: async () => undefined, stopped: () => stopped,
    record: (web: Record<string, unknown>) => { states.push(workspaceState({ api, web })); },
    launch: async () => { const index = ++launches; return { pid: index, ready: async () => true, exited: () => index === 1, stop: async () => undefined }; },
    sleep: async (ms: number) => { if (ms === 500) stopped = true; } });
  expect(code).toBe(0); expect(launches).toBe(2); expect(states.every(state => state.apiPid === 77)).toBe(true);
  expect(states.some(state => state.state === 'DEGRADED')).toBe(true);
  expect(states.filter(state => state.state === 'RUNNING').map(state => state.webPid)).toEqual([1, 2]);
});

test('missing web build fails once while a healthy API remains represented as running', async () => {
  const api = { state: 'RUNNING', apiPid: 77 }; let last: Record<string, unknown> = {};
  expect(await supervise({ service: 'WEB', prepare: async () => { throw new StartupError('WEB_BUILD_MISSING'); },
    launch: async () => { throw new Error('must not launch'); }, stopped: () => false, record: (web: Record<string, unknown>) => { last = workspaceState({ api, web }); },
    sleep: async () => { throw new Error('must not retry'); } })).toBe(1);
  expect(last).toMatchObject({ state: 'DEGRADED', apiPid: 77, webPid: null });
});
