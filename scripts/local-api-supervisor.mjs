import { setTimeout as delay } from 'node:timers/promises';

export class StartupError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function sameProcessOwner(saved, observed) {
  return Boolean(saved && observed && Number.isSafeInteger(saved.pid) && saved.pid > 0
    && saved.pid === observed.pid && typeof saved.createdAt === 'string' && saved.createdAt === observed.createdAt);
}

export function webBuildReady(buildId, routes) {
  if (typeof buildId !== 'string' || !buildId.trim() || buildId.length > 200 || !routes?.rewrites) return false;
  const rewrite = routes.rewrites;
  if (!Array.isArray(rewrite) && !['beforeFiles', 'afterFiles', 'fallback'].every(key => Array.isArray(rewrite[key]))) return false;
  const rules = Array.isArray(rewrite) ? rewrite : [...rewrite.beforeFiles, ...rewrite.afterFiles, ...rewrite.fallback];
  return rules.length === 1 && rules[0]?.source === '/api/v1/:path*' && rules[0]?.destination === 'http://127.0.0.1:3001/api/v1/:path*';
}

export function workspaceState(services) {
  const states = [services.api.state, services.web.state];
  const state = states.every(value => value === 'RUNNING') ? 'RUNNING'
    : states.every(value => value === 'STOPPED') ? 'STOPPED'
    : states.some(value => value === 'RUNNING' || value === 'ERROR') ? 'DEGRADED' : 'STARTING';
  return { state, apiPid: services.api.apiPid ?? null, webPid: services.web.webPid ?? null, attempt: services.api.attempt ?? 0, services };
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
export async function supervise({ prepare, launch, stopped, record, sleep = delay, maxRestarts = 3, service = 'API' }) {
  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    if (stopped()) { record({ state: 'STOPPED', attempt }); return 0; }
    let child;
    try {
      record({ state: 'STARTING', attempt }); await prepare();
      if (stopped()) { record({ state: 'STOPPED', attempt }); return 0; }
      child = await launch();
      if (!await child.ready(stopped)) throw new StartupError(stopped() ? 'STOP_REQUESTED' : `${service}_START_TIMEOUT`);
      record({ state: 'RUNNING', attempt, [service === 'WEB' ? 'webPid' : 'apiPid']: child.pid });
      while (!stopped() && !child.exited()) await sleep(500);
      if (stopped()) {
        await child.stop(); record({ state: 'STOPPED', attempt }); return 0;
      }
      throw new StartupError(`${service}_EXITED`);
    } catch (error) {
      if (child) await child.stop();
      if (stopped()) { record({ state: 'STOPPED', attempt }); return 0; }
      const errorCode = error instanceof StartupError ? error.code : 'STARTUP_FAILED';
      const terminal = ['PORT_IN_USE', 'LOCAL_CONFIG_MISSING', 'WEB_BUILD_MISSING', 'WEB_BUILD_INVALID'].includes(errorCode);
      record({ state: terminal || attempt === maxRestarts ? 'ERROR' : 'RETRY_WAIT', attempt, errorCode });
      if (terminal || attempt === maxRestarts) return 1;
      await sleep(15_000);
    }
  }
  return 1;
}
