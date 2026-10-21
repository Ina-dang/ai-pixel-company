import { expect, test } from 'vitest';
import { redactLog, sameProcessOwner, StartupError, supervise, waitUntil } from '../scripts/local-api-supervisor.mjs';

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
