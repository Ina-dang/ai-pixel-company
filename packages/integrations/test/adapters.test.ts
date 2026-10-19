import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitHubAdapter, IntegrationError, LocalSecretStore, SlackAdapter, githubConfig, hash, safeText, verifyGitHubSignature, verifySlackSignature, type GitHubConfig } from '../src/index';

const config: GitHubConfig = { appId: '123', installationId: 12, repositoryId: 34, owner: 'Ina-dang', repo: 'ai-pixel-company', baseBranch: 'main', requiredChecks: ['unit'], policyVersion: 'v1' };
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const HEAD = '1'.repeat(40);
const RUN = '12345678-1234-4123-8123-123456789abc';
const respond = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
function mock(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe('https://api.github.com');
    expect(init.redirect).toBe('error');
    calls.push({ path: parsed.pathname + parsed.search, init });
    if (parsed.pathname.endsWith('/access_tokens')) return respond({ token: 'test-installation-token' });
    if (parsed.pathname === '/repos/Ina-dang/ai-pixel-company') return respond({ id: 34, full_name: 'Ina-dang/ai-pixel-company' });
    return handler(parsed.pathname + parsed.search, init);
  };
  return { calls, fetcher };
}

describe('signed ingress and secret references', () => {
  it('validates exact raw bytes, signature framing and Slack replay window', () => {
    const raw = '{"message":"한글"}', secret = 'test-signing-value';
    const github = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyGitHubSignature(raw, github, secret)).toBe(true);
    expect(verifyGitHubSignature(`${raw} `, github, secret)).toBe(false);
    expect(verifyGitHubSignature(raw, 'sha256=short', secret)).toBe(false);
    const timestamp = '1792368000';
    const slack = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
    expect(verifySlackSignature(raw, slack, timestamp, secret, Number(timestamp) * 1000)).toBe(true);
    expect(verifySlackSignature(raw, slack, timestamp, secret, (Number(timestamp) + 301) * 1000)).toBe(false);
    expect(verifySlackSignature(raw, slack, timestamp, secret, (Number(timestamp) - 301) * 1000)).toBe(false);
  });
  it('never falls back to ambient PATs and denies file traversal/foreign env names', async () => {
    const store = new LocalSecretStore(process.cwd(), { GH_TOKEN: 'ambient-test-pat', AI_PIXEL_GITHUB_PRIVATE_KEY: 'test-value' });
    await expect(store.read('env:AI_PIXEL_GITHUB_PRIVATE_KEY')).resolves.toBe('test-value');
    await expect(store.read('env:GH_TOKEN')).rejects.toThrow('SECRET_REFERENCE_DENIED');
    await expect(store.read('file:../owner-key')).rejects.toThrow('SECRET_REFERENCE_DENIED');
    await expect(store.read('env:AI_PIXEL_SLACK_BOT_TOKEN')).rejects.toThrow('CREDENTIAL_UNCONFIGURED');
    expect(() => safeText(`token ${'gh' + 'p_'}${'x'.repeat(30)}`)).toThrow('TEXT_DENIED');
    expect(() => githubConfig({ ...config, owner: 'https://127.0.0.1' })).toThrow('CONFIGURATION_INVALID');
    expect(() => githubConfig({ ...config, apiBase: 'http://169.254.169.254' })).toThrow('CONFIGURATION_INVALID');
  });
  it('rejects an actual secret-directory junction pointing outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pixel-secret-reference-'));
    const outside = await mkdtemp(join(tmpdir(), 'pixel-secret-outside-'));
    try {
      await mkdir(join(root, '.local'));
      await writeFile(join(outside, 'key'), 'test-only-value');
      await symlink(outside, join(root, '.local', 'integration-secrets'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(new LocalSecretStore(root).read('file:key')).rejects.toThrow('SECRET_REFERENCE_DENIED');
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});

describe('scoped GitHub App adapter', () => {
  it('mints signed repository-scoped installation tokens and creates an operation-marked Issue', async () => {
    const { calls, fetcher } = mock((_path, init) => {
      const body = JSON.parse(String(init.body)); expect(body.body).toContain(`ai-pixel-operation:${RUN}`);
      return respond({ number: 7, html_url: 'https://github.com/Ina-dang/ai-pixel-company/issues/7' });
    });
    const result = await new GitHubAdapter(config, key, fetcher).createIssue(RUN, '실제 작업', '검증 근거');
    expect(result.number).toBe(7);
    const tokenRequest = calls[0];
    expect(JSON.parse(String(tokenRequest.init.body)).repository_ids).toEqual([34]);
    expect(JSON.parse(String(tokenRequest.init.body)).permissions.statuses).toBe('read');
    const authorization = (tokenRequest.init.headers as Record<string, string>).Authorization.slice(7);
    const [header, payload, signature] = authorization.split('.');
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss).toBe('123');
    expect(JSON.stringify(result)).not.toContain('test-installation-token');
  });
  it('does not publish to main, after revocation or through changed connection scope', async () => {
    const { calls, fetcher } = mock(() => respond({}));
    const adapter = new GitHubAdapter(config, key, fetcher);
    await expect(adapter.createBranch(RUN, 'main')).rejects.toThrow('BRANCH_DENIED');
    expect(calls).toHaveLength(0);
    let checks = 0;
    const guarded = new GitHubAdapter(config, key, fetcher, async () => { if (++checks === 3) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409); });
    await expect(guarded.createIssue(RUN, '제목', '본문')).rejects.toThrow('CONNECTION_VERSION_CHANGED');
    expect(calls.filter(call => call.path.endsWith('/issues'))).toHaveLength(0);
    const revoked = new GitHubAdapter(config, key, async () => respond({ message: 'private provider detail' }, 403));
    await expect(revoked.repository()).rejects.toThrow('CREDENTIAL_REVOKED');
  });
  it('records unknown mutation outcomes, bounded rate limits and safe marker reconciliation', async () => {
    let unknown = true;
    const { calls, fetcher } = mock((path, init) => {
      if (init.method === 'POST' && unknown) { unknown = false; throw new Error('simulated post-response timeout'); }
      if (path.startsWith('/repos/Ina-dang/ai-pixel-company/issues?')) return respond([{ number: 8, html_url: 'https://github.com/Ina-dang/ai-pixel-company/issues/8', body: `done <!-- ai-pixel-operation:${RUN} -->` }]);
      return respond({}, 429, { 'retry-after': '120' });
    });
    const adapter = new GitHubAdapter(config, key, fetcher);
    await expect(adapter.createIssue(RUN, '제목', '본문')).rejects.toThrow('EFFECT_UNKNOWN');
    expect(await adapter.reconcile('ISSUE_CREATE', RUN, `ai-pixel/${RUN}`)).toMatchObject({ number: 8 });
    expect(calls.filter(call => call.init.method === 'POST' && call.path.endsWith('/issues'))).toHaveLength(1);
    try { await adapter.head('main'); throw new Error('Expected rate limit'); } catch (error) { expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 120 }); }
  });
  it('requires every configured check on the exact current remote head', async () => {
    let reads = 0;
    const { fetcher } = mock(path => {
      if (path.includes('/git/ref/heads/')) return respond({ object: { sha: ++reads > 1 ? '2'.repeat(40) : HEAD } });
      if (path.includes('/check-runs')) return respond({ check_runs: [{ id: 1, name: 'unit', head_sha: HEAD, status: 'completed', conclusion: 'success' }] });
      return respond({ statuses: [] });
    });
    await expect(new GitHubAdapter(config, key, fetcher).ci(`ai-pixel/${RUN}`, HEAD)).rejects.toThrow('REMOTE_HEAD_CHANGED');
    const stable = mock(path => path.includes('/git/ref/') ? respond({ object: { sha: HEAD } }) : path.includes('/check-runs') ? respond({ check_runs: [{ id: 1, name: 'unit', head_sha: '2'.repeat(40), status: 'completed', conclusion: 'success' }] }) : respond({ statuses: [] }));
    expect((await new GitHubAdapter(config, key, stable.fetcher).ci(`ai-pixel/${RUN}`, HEAD)).status).toBe('NOT_PASSED');
  });
  it('rejects a reconciled PR when its head changed despite a matching operation marker', async () => {
    const { fetcher } = mock(() => respond([{ number: 9, html_url: 'https://github.com/Ina-dang/ai-pixel-company/pull/9', body: `<!-- ai-pixel-operation:${RUN} -->`, head: { sha: '2'.repeat(40) }, base: { ref: 'main' } }]));
    expect(await new GitHubAdapter(config, key, fetcher).reconcile('DRAFT_PR_CREATE', RUN, `ai-pixel/${RUN}`, HEAD)).toBeNull();
  });
  it('rejects forged manifests and missing or different immutable fixture files before any repository write', async () => {
    const files = [{ path: 'package.json', content: 'package' }, { path: 'build.mjs', content: 'build' }, { path: 'test/math.test.mjs', content: 'trusted test' }, { path: 'src/math.mjs', content: 'export const add=(a,b)=>a+b;' }].sort((a,b) => a.path.localeCompare(b.path, 'en'));
    const candidate = hash(JSON.stringify(files));
    for (const missing of [false, true]) {
      const { calls, fetcher } = mock(path => path.includes('/git/ref/') ? respond({ object: { sha: HEAD } }) : missing ? respond({}, 404) : respond({ encoding: 'base64', content: Buffer.from('wrong base').toString('base64') }));
      const adapter = new GitHubAdapter(config, key, fetcher);
      await expect(adapter.push(RUN, `ai-pixel/${RUN}`, HEAD, 'a'.repeat(64), files)).rejects.toThrow('CANDIDATE_MANIFEST_CHANGED');
      expect(calls).toHaveLength(0);
      await expect(adapter.push(RUN, `ai-pixel/${RUN}`, HEAD, candidate, files)).rejects.toThrow('REMOTE_FIXTURE_BASE_MISMATCH');
      expect(calls.filter(call => call.init.method !== 'GET' && !call.path.endsWith('/access_tokens'))).toHaveLength(0);
    }
  });
});

describe('Slack outbox transport', () => {
  it('sends only to the mapped channel and preserves unknown send outcomes', async () => {
    const adapter = new SlackAdapter({ teamId: 'T123', channelId: 'C123', userMappings: {} }, 'test-bot-token', async (url, init) => {
      if (String(url).endsWith('/auth.test')) return respond({ ok: true, team_id: 'T123', user_id: 'U456' });
      expect(String(url)).toBe('https://slack.com/api/chat.postMessage');
      expect(JSON.parse(String(init?.body))).toMatchObject({ channel: 'C123', client_msg_id: RUN, unfurl_links: false });
      throw new Error('simulated unknown send');
    });
    await expect(adapter.report(RUN, '[QA | 결과 보고 | task] 테스트를 통과했어요.')).rejects.toThrow('EFFECT_UNKNOWN');
  });
  it('rejects a token for another workspace before sending any message', async () => {
    const paths: string[] = [];
    const adapter = new SlackAdapter({ teamId: 'T123', channelId: 'C123', userMappings: {} }, 'test-bot-token', async url => { paths.push(String(url)); return respond({ ok: true, team_id: 'T999' }); });
    await expect(adapter.report(RUN, '작업 결과')).rejects.toThrow('SLACK_TEAM_MISMATCH');
    expect(paths).toEqual(['https://slack.com/api/auth.test']);
  });
});
