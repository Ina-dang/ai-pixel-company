import type { IncomingMessage, RequestListener } from 'node:http';

const maximumBodyBytes = 262_144;
function body(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0, finished = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > maximumBodyBytes) { finished = true; reject(new Error('BODY_LIMIT')); return; }
      chunks.push(chunk);
    });
    request.once('end', () => { if (!finished) { finished = true; resolve(Buffer.concat(chunks)); } });
    request.once('error', () => { if (!finished) { finished = true; reject(new Error('REQUEST_ABORTED')); } });
    request.once('aborted', () => { if (!finished) { finished = true; reject(new Error('REQUEST_ABORTED')); } });
  });
}

/** Loopback relay for an explicitly approved temporary webhook tunnel only. */
export function webhookRelay(paths: ReadonlySet<string>, fetcher: typeof fetch = fetch): RequestListener {
  if (!paths.size || [...paths].some(path => !/^\/api\/webhooks\/(github|slack)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(path))) throw new Error('WEBHOOK_PATH_REQUIRED');
  let active = 0;
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const fail = (status: number, code: string) => { response.statusCode = status; response.end(JSON.stringify({ error: { code } })); };
    // Exact raw URL comparison rejects query strings, alternate IDs and encoded traversal.
    if (request.method !== 'POST' || !paths.has(request.url ?? '')) { request.resume(); fail(404, 'NOT_FOUND'); return; }
    if (active >= 32) { request.resume(); fail(429, 'RATE_LIMITED'); return; }
    active += 1;
    request.setTimeout(10_000, () => request.destroy());
    try {
      const bytes = await body(request);
      const headers = new Headers();
      for (const name of ['content-type', 'x-hub-signature-256', 'x-github-event', 'x-github-delivery', 'x-slack-signature', 'x-slack-request-timestamp']) {
        const value = request.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const result = await fetcher(`http://127.0.0.1:3001${request.url}`, {
        method: 'POST', headers, body: new Uint8Array(bytes).buffer, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      // Never forward upstream cookies, redirects or authorization headers.
      response.statusCode = result.status;
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { fail(error instanceof Error && error.message === 'BODY_LIMIT' ? 413 : 502, error instanceof Error && error.message === 'BODY_LIMIT' ? 'BODY_LIMIT' : 'UPSTREAM_UNAVAILABLE'); }
    finally { active -= 1; }
  };
}
