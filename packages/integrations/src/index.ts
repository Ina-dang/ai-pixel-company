import { createHash, createHmac, sign, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const operationKinds = ['ISSUE_CREATE', 'BRANCH_CREATE', 'PUSH_CANDIDATE', 'DRAFT_PR_CREATE', 'CI_REFRESH', 'MERGE_REQUEST', 'SLACK_REPORT'] as const;
export type OperationKind = typeof operationKinds[number];
export type Provider = 'GITHUB' | 'SLACK';
export class IntegrationError extends Error {
  constructor(readonly code: string, readonly status = 400, readonly retryAfter: number | null = null) { super(code); }
}
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyGitHubSignature(raw: string, signature: string | null, secret: string): boolean {
  return !!secret && !!signature && /^sha256=[a-f0-9]{64}$/.test(signature) && equal(signature, `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
}
export function verifySlackSignature(raw: string, signature: string | null, timestamp: string | null, secret: string, now = Date.now()): boolean {
  return !!secret && !!signature && !!timestamp && /^\d{10}$/.test(timestamp) && Math.abs(now / 1000 - Number(timestamp)) <= 300
    && /^v0=[a-f0-9]{64}$/.test(signature) && equal(signature, `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`);
}
export class LocalSecretStore {
  constructor(private readonly root: string, private readonly environment: NodeJS.ProcessEnv = process.env) {}
  async read(reference: string): Promise<string> {
    if (/^env:AI_PIXEL_(?:GITHUB|SLACK)_[A-Z0-9_]+$/.test(reference)) {
      const value = this.environment[reference.slice(4)];
      if (!value) throw new IntegrationError('CREDENTIAL_UNCONFIGURED', 409);
      return value;
    }
    if (!reference.startsWith('file:')) throw new IntegrationError('SECRET_REFERENCE_DENIED', 403);
    const base = resolve(this.root, '.local/integration-secrets');
    const requested = resolve(base, reference.slice(5));
    const inside = relative(base, requested);
    if (!inside || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) throw new IntegrationError('SECRET_REFERENCE_DENIED', 403);
    const workspace = resolve(this.root);
    let cursor = requested;
    for (;;) {
      if ((await lstat(cursor)).isSymbolicLink()) throw new IntegrationError('SECRET_REFERENCE_DENIED', 403);
      if (cursor === workspace) break;
      const parent = dirname(cursor);
      if (parent === cursor) throw new IntegrationError('SECRET_REFERENCE_DENIED', 403);
      cursor = parent;
    }
    const actualBase = await realpath(base), actual = await realpath(requested);
    const stats = await lstat(requested);
    if (relative(actualBase, actual).startsWith('..') || stats.size > 65_536 || !stats.isFile() || stats.nlink !== 1) throw new IntegrationError('SECRET_REFERENCE_DENIED', 403);
    return (await readFile(requested, 'utf8')).trim();
  }
}

export type GitHubConfig = { appId: string; installationId: number; repositoryId: number; owner: string; repo: string; baseBranch: string; requiredChecks: string[]; policyVersion: string; protectionRead?: boolean };
export type SlackConfig = { teamId: string; channelId: string; userMappings: Record<string, string>; mode?: 'HTTP' | 'SOCKET'; appId?: string };
export function githubConfig(value: unknown): GitHubConfig {
  const c = value as GitHubConfig;
  if (!c || !Object.keys(c).every(key => ['appId','installationId','repositoryId','owner','repo','baseBranch','requiredChecks','policyVersion','protectionRead'].includes(key)) || (c.protectionRead !== undefined && typeof c.protectionRead !== 'boolean') || !/^\d+$/.test(c.appId) || !Number.isSafeInteger(c.installationId) || c.installationId < 1 || !Number.isSafeInteger(c.repositoryId) || c.repositoryId < 1
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(c.owner) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(c.repo)
    || !validBranch(c.baseBranch) || !Array.isArray(c.requiredChecks) || c.requiredChecks.length > 32 || !c.requiredChecks.every(s => typeof s === 'string' && s.length > 0 && s.length < 100)
    || typeof c.policyVersion !== 'string' || !c.policyVersion) throw new IntegrationError('CONFIGURATION_INVALID', 409);
  return c;
}
export function slackConfig(value: unknown): SlackConfig {
  const c = value as SlackConfig;
  if (!c || !Object.keys(c).every(key => ['teamId','channelId','userMappings','mode','appId'].includes(key)) || !/^T[A-Z0-9]{2,30}$/.test(c.teamId) || !/^[CG][A-Z0-9]{2,30}$/.test(c.channelId) || !c.userMappings || typeof c.userMappings !== 'object'
    || (c.mode !== undefined && !['HTTP', 'SOCKET'].includes(c.mode)) || (c.mode === 'SOCKET' && !/^A[A-Z0-9]{2,30}$/.test(c.appId ?? '')) || (c.appId !== undefined && !/^A[A-Z0-9]{2,30}$/.test(c.appId))
    || !Object.entries(c.userMappings).every(([user, member]) => /^[UW][A-Z0-9]{2,30}$/.test(user) && /^[0-9a-f-]{36}$/i.test(member))) throw new IntegrationError('CONFIGURATION_INVALID', 409);
  return c;
}
export function validBranch(branch: string) { return typeof branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9/_-]{0,150}$/.test(branch) && !branch.includes('//') && !branch.endsWith('/'); }
export function assertSafeFiles(files: Array<{ path: string; content: string }>) {
  if (!Array.isArray(files) || !files.length || files.length > 32) throw new IntegrationError('FILES_DENIED');
  for (const file of files) if (!/^(src\/math\.mjs|test\/extra[A-Za-z0-9_-]*\.mjs)$/.test(file.path) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 65_536 || containsSecret(file.content)) throw new IntegrationError('FILES_DENIED');
}
export function assertCandidateManifest(files: Array<{ path: string; content: string }>, candidateSha: string) {
  const allowed = /^(package\.json|build\.mjs|test\/math\.test\.mjs|src\/math\.mjs|test\/extra[A-Za-z0-9_-]*\.mjs)$/;
  if (!Array.isArray(files) || files.length < 4 || files.length > 32 || new Set(files.map(file => file.path)).size !== files.length
    || files.some(file => !allowed.test(file.path) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 65_536 || containsSecret(file.content))
    || ['package.json', 'build.mjs', 'test/math.test.mjs', 'src/math.mjs'].some(path => !files.some(file => file.path === path))) throw new IntegrationError('CANDIDATE_MANIFEST_INVALID', 409);
  const canonical = files.map(file => ({ path: file.path, content: file.content })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (hash(JSON.stringify(canonical)) !== candidateSha) throw new IntegrationError('CANDIDATE_MANIFEST_CHANGED', 409);
}
export function containsSecret(text: string) { return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,})\b/.test(text); }
export function safeText(value: string, maximum = 6000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || containsSecret(value)) throw new IntegrationError('TEXT_DENIED');
  return value.replace(/<@[A-Z0-9]+>|<![^>]+>/g, '[mention]');
}
type Fetcher = typeof fetch;
async function jsonRequest(fetcher: Fetcher, url: string, token: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
  const effectful = method !== 'GET' && !url.endsWith('/api/auth.test') && !url.includes('/access_tokens');
  let response: Response;
  try {
    response = await fetcher(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { throw new IntegrationError(effectful ? 'EFFECT_UNKNOWN' : 'REMOTE_UNAVAILABLE', 503); }
  if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
    const supplied = Number(response.headers.get('retry-after') ?? '60');
    throw new IntegrationError('RATE_LIMITED', 429, Math.max(1, Math.min(3600, Number.isFinite(supplied) ? supplied : 60)));
  }
  if ([401, 403].includes(response.status)) throw new IntegrationError('CREDENTIAL_REVOKED', 409);
  if (response.status === 404) throw new IntegrationError('REMOTE_NOT_FOUND', 404);
  if (!response.ok) throw new IntegrationError(response.status >= 500 && effectful ? 'EFFECT_UNKNOWN' : 'REMOTE_REJECTED', response.status >= 500 ? 503 : 409);
  let text: string;
  try { text = await response.text(); } catch { throw new IntegrationError(effectful ? 'EFFECT_UNKNOWN' : 'REMOTE_UNAVAILABLE', 503); }
  if (text.length > 1_048_576) throw new IntegrationError(effectful ? 'EFFECT_UNKNOWN' : 'REMOTE_RESPONSE_LIMIT', 503);
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new IntegrationError(effectful ? 'EFFECT_UNKNOWN' : 'REMOTE_INVALID', 503); }
}
const sha = (value: unknown) => { if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new IntegrationError('REMOTE_SHA_INVALID', 503); return value; };
const marker = (id: string) => `<!-- ai-pixel-operation:${id} -->`;

export class GitHubAdapter {
  private tokenValue: string | null = null;
  constructor(readonly config: GitHubConfig, private readonly privateKey: string, private readonly fetcher: Fetcher = fetch, private readonly beforeRequest: () => Promise<void> = async () => undefined) { githubConfig(config); }
  private async token() {
    if (this.tokenValue) return this.tokenValue;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.config.appId })).toString('base64url');
    let signature: string;
    try { signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), this.privateKey).toString('base64url'); } catch { throw new IntegrationError('CREDENTIAL_INVALID', 409); }
    await this.beforeRequest();
    const result = await jsonRequest(this.fetcher, `https://api.github.com/app/installations/${this.config.installationId}/access_tokens`, `${header}.${body}.${signature}`, 'POST', {
      repository_ids: [this.config.repositoryId], permissions: { metadata: 'read', contents: 'write', issues: 'write', pull_requests: 'write', checks: 'read', actions: 'read', statuses: 'read', ...(this.config.protectionRead ? { administration: 'read' } : {}) },
    });
    if (typeof result.token !== 'string' || !result.token) throw new IntegrationError('CREDENTIAL_INVALID', 409);
    await this.beforeRequest();
    const repository = await jsonRequest(this.fetcher, `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`, result.token);
    if (repository.id !== this.config.repositoryId || String(repository.full_name).toLowerCase() !== `${this.config.owner}/${this.config.repo}`.toLowerCase()) throw new IntegrationError('REPOSITORY_SCOPE_MISMATCH', 403);
    this.tokenValue = result.token;
    return this.tokenValue;
  }
  private async call(path: string, method = 'GET', body?: unknown) {
    const token = this.tokenValue ?? await this.token();
    await this.beforeRequest();
    return jsonRequest(this.fetcher, `https://api.github.com/repos/${this.config.owner}/${this.config.repo}${path}`, token, method, body);
  }
  async repository() { await this.token(); return { repositoryId: this.config.repositoryId, name: `${this.config.owner}/${this.config.repo}`, baseBranch: this.config.baseBranch }; }
  async head(branch: string) { if (!validBranch(branch)) throw new IntegrationError('BRANCH_DENIED'); const value = await this.call(`/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`); return sha((value.object as { sha?: string })?.sha); }
  async createIssue(id: string, title: string, body: string) {
    const result = await this.call('/issues', 'POST', { title: safeText(title, 200), body: `${safeText(body)}\n\n${marker(id)}` });
    return this.reference(result);
  }
  async createBranch(id: string, branch: string) {
    if (!/^ai-pixel\/[0-9a-f-]{36}$/.test(branch) || branch === this.config.baseBranch) throw new IntegrationError('BRANCH_DENIED');
    const baseSha = await this.head(this.config.baseBranch);
    const result = await this.call('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: baseSha });
    return { branch, baseSha, headSha: sha((result.object as { sha?: string })?.sha), operationMarker: marker(id) };
  }
  async push(id: string, branch: string, expectedHead: string, candidateSha: string, files: Array<{ path: string; content: string }>) {
    if (!/^ai-pixel\/[0-9a-f-]{36}$/.test(branch) || branch === this.config.baseBranch) throw new IntegrationError('BRANCH_DENIED');
    assertCandidateManifest(files, candidateSha);
    const mutable = files.filter(file => /^(src\/math\.mjs|test\/extra[A-Za-z0-9_-]*\.mjs)$/.test(file.path));
    assertSafeFiles(mutable);
    if (await this.head(branch) !== expectedHead) throw new IntegrationError('REMOTE_HEAD_CHANGED', 409);
    // Only a dedicated fixture base with the exact independently tested harness
    // may receive these changes. Never replace an arbitrary project's package.
    for (const file of files.filter(file => !mutable.includes(file))) {
      let original: Record<string, unknown>;
      try { original = await this.call(`/contents/${file.path}?ref=${sha(expectedHead)}`); }
      catch (error) { if (error instanceof IntegrationError && error.code === 'REMOTE_NOT_FOUND') throw new IntegrationError('REMOTE_FIXTURE_BASE_MISMATCH', 409); throw error; }
      if (original.encoding !== 'base64' || typeof original.content !== 'string' || !Buffer.from(original.content.replace(/\s/g, ''), 'base64').equals(Buffer.from(file.content, 'utf8'))) throw new IntegrationError('REMOTE_FIXTURE_BASE_MISMATCH', 409);
    }
    const commit = await this.call(`/git/commits/${sha(expectedHead)}`);
    const tree = [];
    for (const file of mutable) { const blob = await this.call('/git/blobs', 'POST', { content: file.content, encoding: 'utf-8' }); tree.push({ path: file.path, mode: '100644', type: 'blob', sha: sha(blob.sha) }); }
    const createdTree = await this.call('/git/trees', 'POST', { base_tree: sha((commit.tree as { sha?: string })?.sha), tree });
    const createdCommit = await this.call('/git/commits', 'POST', { message: `AI Pixel candidate ${candidateSha}\n\n${marker(id)}`, tree: sha(createdTree.sha), parents: [expectedHead] });
    const headSha = sha(createdCommit.sha);
    // A concurrent branch change is rejected by GitHub's non-force update.
    await this.call(`/git/refs/heads/${branch}`, 'PATCH', { sha: headSha, force: false });
    if (await this.head(branch) !== headSha) throw new IntegrationError('EFFECT_UNKNOWN', 503);
    return { branch, headSha, candidateSha, operationMarker: marker(id) };
  }
  async draftPr(id: string, branch: string, expectedHead: string, title: string, body: string) {
    if (!/^ai-pixel\/[0-9a-f-]{36}$/.test(branch) || await this.head(branch) !== expectedHead) throw new IntegrationError('REMOTE_HEAD_CHANGED', 409);
    const result = await this.call('/pulls', 'POST', { title: safeText(title, 200), body: `${safeText(body)}\n\n${marker(id)}`, base: this.config.baseBranch, head: branch, draft: true, maintainer_can_modify: false });
    if ((result.head as { sha?: string })?.sha !== expectedHead) throw new IntegrationError('EFFECT_UNKNOWN', 503);
    return { ...this.reference(result), branch, headSha: expectedHead };
  }
  async ci(branch: string, expectedHead: string) {
    if (await this.head(branch) !== expectedHead) throw new IntegrationError('REMOTE_HEAD_CHANGED', 409);
    const checks = await this.call(`/commits/${sha(expectedHead)}/check-runs?per_page=100`);
    const statuses = await this.call(`/commits/${expectedHead}/status?per_page=100`);
    const runs = Array.isArray(checks.check_runs) ? checks.check_runs as Array<Record<string, unknown>> : [];
    const contexts = Array.isArray(statuses.statuses) ? statuses.statuses as Array<Record<string, unknown>> : [];
    const required = this.config.requiredChecks.map(name => {
      const check = runs.filter(item => item.name === name && item.head_sha === expectedHead).sort((a, b) => Number(b.id) - Number(a.id))[0];
      const status = contexts.filter(item => item.context === name).sort((a, b) => Number(b.id) - Number(a.id))[0];
      const evidenceId = check?.id ?? status?.id;
      return { name, source: check ? 'CHECK_RUN' : status ? 'COMMIT_STATUS' : 'NONE', evidenceId: Number.isSafeInteger(evidenceId) ? Number(evidenceId) : null,
        state: check ? check.status === 'completed' && check.conclusion === 'success' ? 'PASS' : check.status === 'completed' ? 'FAIL' : 'PENDING' : status ? status.state === 'success' ? 'PASS' : status.state === 'pending' ? 'PENDING' : 'FAIL' : 'MISSING' };
    });
    if (await this.head(branch) !== expectedHead) throw new IntegrationError('REMOTE_HEAD_CHANGED', 409);
    return { headSha: expectedHead, required, status: required.length > 0 && required.every(item => item.state === 'PASS') ? 'PASS' : 'NOT_PASSED' };
  }
  async mergeSnapshot(pullNumber: number, branch: string, expectedHead: string) {
    if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new IntegrationError('PULL_REQUEST_INVALID', 409);
    const pull = await this.call(`/pulls/${pullNumber}`);
    const head = pull.head as { sha?: string; ref?: string; repo?: { id?: number } } | undefined;
    const base = pull.base as { sha?: string; ref?: string; repo?: { id?: number } } | undefined;
    if (pull.number !== pullNumber || pull.state !== 'open' || pull.merged !== false || typeof pull.draft !== 'boolean' || head?.ref !== branch || head.repo?.id !== this.config.repositoryId
      || base?.ref !== this.config.baseBranch || base.repo?.id !== this.config.repositoryId || head.sha !== expectedHead) throw new IntegrationError('PULL_REQUEST_SCOPE_CHANGED', 409);
    const target = await this.call(`/branches/${encodeURIComponent(this.config.baseBranch)}`);
    const baseSha = sha((target.commit as { sha?: string })?.sha);
    if (base.sha !== baseSha || typeof target.protected !== 'boolean') throw new IntegrationError('BASE_BRANCH_UNVERIFIABLE', 409);
    // Rulesets may apply independently of classic branch protection. Never infer "no policy" from a 404/403.
    const rules = await this.call(`/rules/branches/${encodeURIComponent(this.config.baseBranch)}`);
    if (!Array.isArray(rules)) throw new IntegrationError('BRANCH_PROTECTION_UNVERIFIABLE', 409);
    let protection: unknown = null;
    if (target.protected) {
      if (!this.config.protectionRead) throw new IntegrationError('BRANCH_PROTECTION_READ_REQUIRED', 409);
      protection = await this.call(`/branches/${encodeURIComponent(this.config.baseBranch)}/protection`);
    }
    const ci = await this.ci(branch, expectedHead);
    const finalTarget = await this.call(`/branches/${encodeURIComponent(this.config.baseBranch)}`);
    if (sha((finalTarget.commit as { sha?: string })?.sha) !== baseSha || finalTarget.protected !== target.protected) throw new IntegrationError('BASE_BRANCH_CHANGED', 409);
    return { pullNumber, branch, headSha: expectedHead, base: this.config.baseBranch, baseSha, draft: pull.draft === true,
      mergeable: pull.mergeable === true, mergeableState: typeof pull.mergeable_state === 'string' ? pull.mergeable_state : 'unknown',
      protected: target.protected, protectionHash: hash(stable({ protection, rules })), ci };
  }
  async merge(pullNumber: number, branch: string, expected: Awaited<ReturnType<GitHubAdapter['mergeSnapshot']>>) {
    const current = await this.mergeSnapshot(pullNumber, branch, expected.headSha);
    if (stable(current) !== stable(expected)) throw new IntegrationError('MERGE_SCOPE_CHANGED', 409);
    if (current.draft || !current.mergeable || current.mergeableState !== 'clean' || current.ci.status !== 'PASS') throw new IntegrationError('MERGE_NOT_READY', 409);
    const result = await this.call(`/pulls/${pullNumber}/merge`, 'PUT', { sha: expected.headSha, merge_method: 'squash' });
    try {
      if (result.merged !== true) throw new IntegrationError('EFFECT_UNKNOWN', 503);
      const mergeSha = sha(result.sha);
      const confirmed = await this.call(`/pulls/${pullNumber}`);
      if (confirmed.merged !== true || confirmed.merge_commit_sha !== mergeSha) throw new IntegrationError('EFFECT_UNKNOWN', 503);
      return { merged: true, mergeSha, pullNumber, headSha: expected.headSha, baseSha: expected.baseSha,
        url: `https://github.com/${this.config.owner}/${this.config.repo}/pull/${pullNumber}` };
    } catch { throw new IntegrationError('EFFECT_UNKNOWN', 503); }
  }
  async mergedResult(pullNumber: number, branch: string, headSha: string, baseSha: string) {
    const pull = await this.call(`/pulls/${pullNumber}`);
    const head = pull.head as { sha?: string; ref?: string; repo?: { id?: number } } | undefined;
    const base = pull.base as { ref?: string; repo?: { id?: number } } | undefined;
    if (pull.number !== pullNumber || head?.sha !== headSha || head.ref !== branch || head.repo?.id !== this.config.repositoryId
      || base?.ref !== this.config.baseBranch || base.repo?.id !== this.config.repositoryId) throw new IntegrationError('PULL_REQUEST_SCOPE_CHANGED', 409);
    if (pull.merged !== true) return null;
    const mergeSha = sha(pull.merge_commit_sha), commit = await this.call(`/git/commits/${mergeSha}`);
    const parents = commit.parents as Array<{ sha?: string }> | undefined;
    if (!Array.isArray(parents) || parents.length !== 1 || parents[0].sha !== baseSha) throw new IntegrationError('MERGED_BASE_UNVERIFIABLE', 409);
    return { merged: true, mergeSha, pullNumber, headSha, baseSha, observedRemote: true,
      url: `https://github.com/${this.config.owner}/${this.config.repo}/pull/${pullNumber}` };
  }
  async reconcile(kind: OperationKind, id: string, branch: string, expectedHead?: string) {
    if (kind === 'ISSUE_CREATE' || kind === 'DRAFT_PR_CREATE') {
      const result = await this.call(kind === 'ISSUE_CREATE' ? '/issues?state=all&per_page=100' : `/pulls?state=all&head=${encodeURIComponent(`${this.config.owner}:${branch}`)}&base=${encodeURIComponent(this.config.baseBranch)}&per_page=100`);
      const rows = Array.isArray(result) ? result as Array<Record<string, unknown>> : [];
      const found = rows.find(row => typeof row.body === 'string' && row.body.includes(marker(id)) && (kind !== 'DRAFT_PR_CREATE' || (typeof expectedHead === 'string' && (row.head as { sha?: string })?.sha === expectedHead && (row.base as { ref?: string })?.ref === this.config.baseBranch)));
      return found ? { ...this.reference(found), ...(kind === 'DRAFT_PR_CREATE' ? { branch, headSha: expectedHead } : {}) } : null;
    }
    if (kind === 'BRANCH_CREATE' || kind === 'PUSH_CANDIDATE') {
      const headSha = await this.head(branch);
      const commit = await this.call(`/git/commits/${headSha}`);
      // A commit marker alone cannot prove the complete published tree. Leave
      // ambiguous pushes/branch creation UNKNOWN for explicit remote inspection.
      return typeof commit.message === 'string' && commit.message.includes(marker(id)) && kind === 'BRANCH_CREATE' ? { branch, headSha } : null;
    }
    return null;
  }
  private reference(result: Record<string, unknown>) {
    if (!Number.isSafeInteger(result.number) || typeof result.html_url !== 'string' || !result.html_url.startsWith(`https://github.com/${this.config.owner}/${this.config.repo}/`)) throw new IntegrationError('EFFECT_UNKNOWN', 503);
    return { number: Number(result.number), url: result.html_url };
  }
}

export class SlackAdapter {
  constructor(readonly config: SlackConfig, private readonly token: string, private readonly fetcher: Fetcher = fetch, private readonly beforeRequest: () => Promise<void> = async () => undefined) { slackConfig(config); }
  async identity() {
    await this.beforeRequest();
    const result = await jsonRequest(this.fetcher, 'https://slack.com/api/auth.test', this.token, 'POST', {});
    if (!result.ok) throw new IntegrationError(['invalid_auth', 'token_revoked', 'account_inactive'].includes(String(result.error)) ? 'CREDENTIAL_REVOKED' : 'REMOTE_REJECTED', 409);
    if (result.team_id !== this.config.teamId) throw new IntegrationError('SLACK_TEAM_MISMATCH', 403);
    return { teamId: this.config.teamId, botUserId: typeof result.user_id === 'string' ? result.user_id : null };
  }
  async report(id: string, text: string, threadTs?: string) {
    await this.identity();
    await this.beforeRequest();
    const result = await jsonRequest(this.fetcher, 'https://slack.com/api/chat.postMessage', this.token, 'POST', { channel: this.config.channelId, text: safeText(text), client_msg_id: id, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false,
      ...(threadTs && /^\d+\.\d+$/.test(threadTs) ? { thread_ts: threadTs } : {}) });
    if (!result.ok) throw new IntegrationError(result.error === 'ratelimited' ? 'RATE_LIMITED' : ['invalid_auth', 'token_revoked', 'account_inactive'].includes(String(result.error)) ? 'CREDENTIAL_REVOKED' : 'REMOTE_REJECTED', result.error === 'ratelimited' ? 429 : 409, result.error === 'ratelimited' ? 60 : null);
    if (result.channel !== this.config.channelId || typeof result.ts !== 'string' || !/^\d+\.\d+$/.test(result.ts)) throw new IntegrationError('EFFECT_UNKNOWN', 503);
    return { channelId: this.config.channelId, timestamp: result.ts };
  }
}
