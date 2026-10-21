import { setTimeout as delay } from 'node:timers/promises';

export class StartupError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function sameProcessOwner(saved, observed) {
  return Boolean(saved && observed && Number.isSafeInteger(saved.pid) && saved.pid > 0
    && saved.pid === observed.pid && typeof saved.createdAt === 'string' && saved.createdAt === observed.createdAt);
}

export async function waitUntil(check, { timeoutMs, intervalMs = 1000, stopped = () => false, sleep = delay, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  while (!stopped()) {
    if (await check()) return true;
    if (now() >= deadline) return false;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  return false;
}

export function redactLog(text) {
  return text.replace(/(?:postgres(?:ql)?:\/\/)[^\s"']+/gi, '[DATABASE_URL]')
    .replace(/\b(?:xapp-|xox[baprs]-|gh[opusr]_|github_pat_|sk-)[A-Za-z0-9_-]+/g, '[CREDENTIAL]')
    .replace(/\bwss:\/\/[^\s"']+/gi, '[WEBSOCKET_URL]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [CREDENTIAL]');
}

// Four launches at most (initial + three restarts). The scheduler does not add
// another restart policy; a persistent failure requires a manual start/logon.
export async function supervise({ prepare, launch, stopped, record, sleep = delay, maxRestarts = 3 }) {
  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    if (stopped()) { record({ state: 'STOPPED', attempt }); return 0; }
    let child;
    try {
      record({ state: 'STARTING', attempt }); await prepare();
      if (stopped()) { record({ state: 'STOPPED', attempt }); return 0; }
      child = await launch();
      if (!await child.ready(stopped)) throw new StartupError(stopped() ? 'STOP_REQUESTED' : 'API_START_TIMEOUT');
      record({ state: 'RUNNING', attempt, apiPid: child.pid });
      while (!stopped() && !child.exited()) await sleep(500);
      if (stopped()) {
        await child.stop(); record({ state: 'STOPPED', attempt }); return 0;
      }
      throw new StartupError('API_EXITED');
    } catch (error) {
      if (child) await child.stop();
      if (stopped()) { record({ state: 'STOPPED', attempt }); return 0; }
      const errorCode = error instanceof StartupError ? error.code : 'STARTUP_FAILED';
      const terminal = errorCode === 'PORT_IN_USE' || errorCode === 'LOCAL_CONFIG_MISSING';
      record({ state: terminal || attempt === maxRestarts ? 'ERROR' : 'RETRY_WAIT', attempt, errorCode });
      if (terminal || attempt === maxRestarts) return 1;
      await sleep(15_000);
    }
  }
  return 1;
}
