import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Database, Transaction } from '@ai-pixel/db';
import { GitHubAdapter, IntegrationError, LocalSecretStore, SlackAdapter, assertCandidateManifest, githubConfig, hash, operationKinds, safeText, slackConfig, verifyGitHubSignature, verifySlackSignature, type OperationKind, type Provider } from '@ai-pixel/integrations';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit, emit, lockOrganization, mutate } from './repository.js';
import { ApiError, type ApiEnv } from './security.js';
import type { WorkflowRow } from './workflows.js';
import { parseSlackCommand, SlackCommands, type SlackReceipt } from './slack-commands.js';
import { IntegrationMerges } from './integration-merges.js';
import {maintenanceReason} from './maintenance.js';

export type Connection = { id: string; organization_id: string; project_id: string; provider: Provider; config: unknown; secret_refs: Record<string, string>; enabled: boolean; version: number };
export type Operation = { id: string; connection_id: string; connection_version: number; organization_id: string; project_id: string; provider: Provider; kind: OperationKind; run_id: string; candidate_sha: string;
  request: { expectedRunVersion: number; title?: string; body?: string }; status: string; attempts: number; version: number; error_code: string | null; external_ref: Record<string, unknown> | null; created_at: Date; updated_at: Date };
type Receipt = SlackReceipt & { provider: Provider; payload: SlackReceipt['payload'] & { action?: string; headSha?: string }; attempts: number };
const id = z.uuid();
const requestSchema = z.strictObject({ kind: z.enum(operationKinds), runId: id, expectedRunVersion: z.number().int().positive(), title: z.string().min(1).max(200).optional(), body: z.string().min(1).max(6000).optional() });
const setup = { githubEnv: ['AI_PIXEL_GITHUB_PRIVATE_KEY', 'AI_PIXEL_GITHUB_WEBHOOK_SECRET'], slackEnv: ['AI_PIXEL_SLACK_BOT_TOKEN', 'AI_PIXEL_SLACK_SIGNING_SECRET'] };
const json = (tx: Transaction, value: unknown) => tx.json(JSON.parse(JSON.stringify(value)));
const publicOperation = (row: Operation) => ({ id: row.id, provider: row.provider, kind: row.kind, status: row.status, runId: row.run_id, candidateSha: row.candidate_sha, errorCode: row.error_code, externalRef: row.external_ref, attempts: row.attempts, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
function parseId(value: string) { const parsed = id.safeParse(value); if (!parsed.success) throw new ApiError(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.'); return parsed.data; }
async function input(request: Request) { try { return requestSchema.parse(await request.json()); } catch { throw new ApiError(400, 'INVALID_INPUT', '연동 요청 내용을 확인하세요.'); } }
async function rawBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 262_144) { await reader.cancel(); throw new IntegrationError('BODY_LIMIT', 413); }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function convert(error: unknown): never {
  if (error instanceof IntegrationError) {
    const status = error.status >= 500 ? 503 : error.status === 403 ? 403 : error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 413 ? 413 : error.status === 429 ? 429 : 400;
    throw new ApiError(status, error.code, '연동 설정·권한·검증 근거를 확인하세요.');
  }
  throw error;
}

export class IntegrationService {
  private secrets: LocalSecretStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastTickAt:string|null=null;
  private lastErrorAt:string|null=null;
  health(){return{running:this.timer!==null,busy:this.busy,lastTickAt:this.lastTickAt,lastErrorAt:this.lastErrorAt};}
  private commands: SlackCommands;
  readonly merges: IntegrationMerges;
  constructor(readonly database: Database, readonly root: string, private readonly fetcher: typeof fetch = fetch) {
    this.secrets = new LocalSecretStore(root);
    this.commands = new SlackCommands(database, { connection: id => this.connection(id), credential: (c, field) => this.credential(c, field), fetcher });
    this.merges = new IntegrationMerges(database, { connection: id => this.connection(id), evidence: (org, project, run, version) => this.evidence(org, project, run, version),
      adapter: (connection, operation, guard) => this.adapter(connection, operation, fetcher, guard) });
  }

  /** Owner-prepared local configuration only. No credential values or browser configuration endpoint. */
  async configureFromLocalFile() {
    if(await maintenanceReason(this.database.sql))return;
    let content: string;
    try { content = await readFile(resolve(this.root, '.local/integrations.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new IntegrationError('CONFIGURATION_UNREADABLE', 409); }
    if (content.length > 65_536) throw new IntegrationError('CONFIGURATION_INVALID', 409);
    let entries: Array<{ organizationId: string; projectId: string; provider: Provider; config: unknown; secretRefs: Record<string, string> }>;
    try { entries = JSON.parse(content).connections; } catch { throw new IntegrationError('CONFIGURATION_INVALID', 409); }
    if (!Array.isArray(entries) || entries.length > 20) throw new IntegrationError('CONFIGURATION_INVALID', 409);
    for (const entry of entries) {
      if (!id.safeParse(entry.organizationId).success || !id.safeParse(entry.projectId).success || !['GITHUB', 'SLACK'].includes(entry.provider)) throw new IntegrationError('CONFIGURATION_INVALID', 409);
      if (entry.provider === 'GITHUB') githubConfig(entry.config); else slackConfig(entry.config);
      const fields = entry.provider === 'GITHUB' ? ['privateKey', 'webhookSecret'] : ['botToken', 'signingSecret'];
      if (!entry.secretRefs || !fields.every(field => typeof entry.secretRefs[field] === 'string' && /^(?:env:AI_PIXEL_(?:GITHUB|SLACK)_[A-Z0-9_]+|file:[A-Za-z0-9_./-]+)$/.test(entry.secretRefs[field]))) throw new IntegrationError('SECRET_REFERENCE_DENIED', 403);
      await this.database.sql.begin(async tx => {
        await lockOrganization(tx, entry.organizationId);
        const project = await tx`select 1 from projects where organization_id=${entry.organizationId} and id=${entry.projectId}`;
        if (!project.length) throw new IntegrationError('PROJECT_SCOPE_MISMATCH', 403);
        await tx`insert into integration_connections(id,organization_id,project_id,provider,config,secret_refs)
          values(${randomUUID()},${entry.organizationId},${entry.projectId},${entry.provider},${json(tx, entry.config)},${json(tx, Object.fromEntries(fields.map(field => [field, entry.secretRefs[field]])))})
          on conflict(organization_id,project_id,provider) do update set config=excluded.config,secret_refs=excluded.secret_refs,
          enabled=true,version=integration_connections.version+1,updated_at=now()
          where integration_connections.config is distinct from excluded.config or integration_connections.secret_refs is distinct from excluded.secret_refs`;
      });
    }
  }
  private async connection(idValue: string): Promise<Connection> {
    const paused=await maintenanceReason(this.database.sql);if(paused)throw new IntegrationError(paused,503);
    const rows = await this.database.sql<Connection[]>`select * from integration_connections where id=${idValue}`;
    if (!rows[0]?.enabled) throw new IntegrationError('CONNECTION_UNAVAILABLE', 409);
    return rows[0];
  }
  private async credential(connection: Connection, field: string) {
    try { return await this.secrets.read(connection.secret_refs[field]); } catch { throw new IntegrationError('CREDENTIAL_UNCONFIGURED', 409); }
  }
  private async repositoryScope(connection: Connection) {
    const config = githubConfig(connection.config);
    const projects = await this.database.sql<{ repository_url: string; default_branch: string }[]>`select repository_url,default_branch from projects where organization_id=${connection.organization_id} and id=${connection.project_id}`;
    let url: URL;
    try { url = new URL(projects[0]?.repository_url ?? ''); } catch { throw new IntegrationError('PROJECT_REPOSITORY_CHANGED', 409); }
    const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash
      || path.toLowerCase() !== `/${config.owner}/${config.repo}`.toLowerCase() || projects[0]?.default_branch !== config.baseBranch) throw new IntegrationError('PROJECT_REPOSITORY_CHANGED', 409);
  }
  private async adapter(connection: Connection, operation?: Operation, transport = this.fetcher, guard?: () => Promise<void>) {
    await this.repositoryScope(connection);
    return new GitHubAdapter(githubConfig(connection.config), await this.credential(connection, 'privateKey'), transport, async () => {
      const current = await this.connection(connection.id);
      if (current.version !== connection.version) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
      await this.repositoryScope(current);
      if (operation) {
        const run = await this.evidence(operation.organization_id, operation.project_id, operation.run_id, operation.request.expectedRunVersion);
        if (run.checkpoint.workspace?.sha !== operation.candidate_sha) throw new IntegrationError('CANDIDATE_CHANGED', 409);
      }
      await guard?.();
    });
  }
  async status(organizationId: string, projectId: string) {
    const connections = await this.database.sql<Connection[]>`select * from integration_connections where organization_id=${organizationId} and project_id=${projectId}`;
    const summaries = [];
    for (const provider of ['GITHUB', 'SLACK'] as const) {
      const connection = connections.find(value => value.provider === provider);
      if (!connection) { summaries.push({ id: null, provider, configured: false, webhookConfigured: false, enabled: false, version: 0, publicConfig: null, reason: 'CREDENTIAL_UNCONFIGURED' }); continue; }
      let reason: string | null = connection.enabled ? null : 'DISABLED', publicConfig: unknown = null;
      try {
        if (provider === 'GITHUB') { const c = githubConfig(connection.config); publicConfig = { installationId: c.installationId, repositoryId: c.repositoryId, repository: `${c.owner}/${c.repo}`, baseBranch: c.baseBranch, requiredChecks: c.requiredChecks, policyVersion: c.policyVersion }; await this.repositoryScope(connection); await this.credential(connection, 'privateKey'); }
        else { const c = slackConfig(connection.config); publicConfig = { teamId: c.teamId, channelId: c.channelId, mappedUsers: Object.keys(c.userMappings).length }; await this.credential(connection, 'botToken'); }
      } catch (error) { reason = error instanceof IntegrationError ? error.code : 'CONFIGURATION_INVALID'; }
      let webhookConfigured = false;
      try { await this.credential(connection, provider === 'GITHUB' ? 'webhookSecret' : 'signingSecret'); webhookConfigured = connection.enabled; } catch { /* Inbound credentials do not gate outbound-only operations. */ }
      summaries.push({ id: connection.id, provider, configured: reason === null, webhookConfigured, enabled: connection.enabled, version: connection.version, publicConfig, reason });
    }
    const operations = await this.database.sql<Operation[]>`select * from integration_operations where organization_id=${organizationId} and project_id=${projectId} order by created_at desc,id desc limit 100`;
    const commands = await this.database.sql`select id,event_type as "eventType",status,error_code as "errorCode",result,reply_status as "replyStatus",created_at as "createdAt" from integration_inbox
      where organization_id=${organizationId} and project_id=${projectId} and provider='SLACK' order by created_at desc,id desc limit 30`;
    return { connections: summaries, operations: operations.map(publicOperation), mergeRequests: await this.merges.list(organizationId, projectId), commands, setup };
  }
  private async evidence(organizationId: string, projectId: string, runId: string, version: number) {
    const rows = await this.database.sql<WorkflowRow[]>`select * from workflow_runs where organization_id=${organizationId} and project_id=${projectId} and id=${runId}`;
    const row = rows[0], checkpoint = row?.checkpoint, qa = checkpoint?.roles.filter(role => role.role === 'QA').at(-1);
    if (!row || row.version !== version) throw new IntegrationError('RUN_VERSION_CHANGED', 409);
    if (!['WAITING_APPROVAL', 'SUCCEEDED'].includes(row.status) || !checkpoint.workspace?.diff || checkpoint.verification?.sha !== checkpoint.workspace.sha || checkpoint.verification.test.exitCode !== 0 || checkpoint.verification.build.exitCode !== 0
      || !Object.values(checkpoint.verification.sandbox).every(value => value === true) || qa?.candidateSha !== checkpoint.workspace.sha || qa.output.candidateSha !== checkpoint.workspace.sha || qa.output.verdict !== 'PASS' || qa.output.issues.length) throw new IntegrationError('EVIDENCE_REQUIRED', 409);
    assertCandidateManifest(checkpoint.workspace.files, checkpoint.workspace.sha);
    return row;
  }
  routes() {
    const routes = new Hono<ApiEnv>();
    routes.get('/projects/:id/integrations', async c => {
      const projectId = parseId(c.req.param('id')), organizationId = c.get('auth').organizationId;
      const project = await this.database.sql`select 1 from projects where organization_id=${organizationId} and id=${projectId}`;
      if (!project.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
      return c.json({ data: await this.status(organizationId, projectId), requestId: c.get('requestId') });
    });
    routes.post('/projects/:id/integrations/operations', async c => {
      const projectId = parseId(c.req.param('id')), body = await input(c.req.raw), auth = c.get('auth');
      try {
        const run = await this.evidence(auth.organizationId, projectId, body.runId, body.expectedRunVersion);
        const provider = body.kind === 'SLACK_REPORT' ? 'SLACK' : 'GITHUB';
        const rows = await this.database.sql<Connection[]>`select * from integration_connections where organization_id=${auth.organizationId} and project_id=${projectId} and provider=${provider} and enabled=true`;
        const connection = rows[0]; if (!connection) throw new IntegrationError('CREDENTIAL_UNCONFIGURED', 409);
        if (provider === 'GITHUB') { githubConfig(connection.config); await this.repositoryScope(connection); await this.credential(connection, 'privateKey'); } else { slackConfig(connection.config); await this.credential(connection, 'botToken'); }
        if (body.title) safeText(body.title, 200); if (body.body) safeText(body.body);
        return await mutate(this.database, c, body, async tx => {
          const active = await tx`select 1 from workflow_runs where organization_id=${auth.organizationId} and id=${body.runId} and version=${body.expectedRunVersion}`;
          if (!active.length) throw new ApiError(409, 'RUN_VERSION_CHANGED', '실행이 변경됐습니다.');
          const duplicate = await tx`select 1 from integration_operations where connection_id=${connection.id} and run_id=${body.runId} and kind=${body.kind} and status in ('PENDING','RUNNING','SUCCEEDED','UNKNOWN','DEFERRED')`;
          if (duplicate.length && !['CI_REFRESH', 'MERGE_REQUEST'].includes(body.kind)) throw new ApiError(409, 'OPERATION_EXISTS', '기존 연동 작업을 확인하세요. 결과 불명 작업은 재발행하지 않습니다.');
          const created = await tx<Operation[]>`insert into integration_operations(id,connection_id,connection_version,organization_id,project_id,provider,kind,run_id,candidate_sha,request)
            values(${randomUUID()},${connection.id},${connection.version},${auth.organizationId},${projectId},${provider},${body.kind},${body.runId},${run.checkpoint.workspace?.sha ?? ''},${json(tx, body)}) returning *`;
          await this.event(tx, created[0]); await audit(tx, c, 'integration.operation.requested', 'integration_operation', created[0].id, projectId);
          return { status: 202, data: publicOperation(created[0]) };
        });
      } catch (error) { convert(error); }
    });
    routes.post('/projects/:id/integrations/operations/:operationId/reconcile', async c => {
      const projectId = parseId(c.req.param('id')), operationId = parseId(c.req.param('operationId')), organizationId = c.get('auth').organizationId;
      const rows = await this.database.sql<Operation[]>`select * from integration_operations where id=${operationId} and organization_id=${organizationId} and project_id=${projectId}`;
      if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '연동 작업을 찾을 수 없습니다.');
      if (rows[0].status !== 'UNKNOWN' || rows[0].provider !== 'GITHUB') throw new ApiError(409, 'RECONCILIATION_UNAVAILABLE', '원격 조회로 확인할 수 있는 결과 불명 GitHub 작업만 조정할 수 있습니다.');
      try {
        const connection = await this.connection(rows[0].connection_id);
        if (connection.version !== rows[0].connection_version) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
        const pushed = rows[0].kind === 'DRAFT_PR_CREATE' ? await this.prerequisite(rows[0], 'PUSH_CANDIDATE') : null;
        const result = await (await this.adapter(connection)).reconcile(rows[0].kind, rows[0].id, `ai-pixel/${rows[0].run_id}`, typeof pushed?.headSha === 'string' ? pushed.headSha : undefined);
        return await mutate(this.database, c, {}, async tx => {
          const updated = await tx<Operation[]>`update integration_operations set status=${result ? 'SUCCEEDED' : 'UNKNOWN'},external_ref=${json(tx, result)},error_code=${result ? null : 'EFFECT_UNKNOWN'},version=version+1,updated_at=now() where id=${operationId} and status='UNKNOWN' returning *`;
          if (!updated[0]) throw new ApiError(409, 'VERSION_CONFLICT', '연동 작업 상태가 변경됐습니다.');
          await this.event(tx, updated[0]); return { status: 200, data: publicOperation(updated[0]) };
        });
      } catch (error) { convert(error); }
    });
    routes.route('/', this.merges.routes());
    return routes;
  }
  private async event(tx: Transaction, operation: Operation) {
    await emit(tx, { organizationId: operation.organization_id, projectId: operation.project_id, runId: operation.run_id, type: 'integration.operation.updated', aggregateVersion: operation.version,
      payload: { id: operation.id, provider: operation.provider, kind: operation.kind, status: operation.status } });
  }
  webhooks() {
    const routes = new Hono<ApiEnv>();
    for (const provider of ['GITHUB', 'SLACK'] as const) routes.post(`/${provider.toLowerCase()}/:id`, async c => {
      try {
        const connection = await this.connection(parseId(c.req.param('id')));
        if (connection.provider !== provider) throw new IntegrationError('CONNECTION_UNAVAILABLE', 403);
        const raw = await rawBody(c.req.raw);
        const secret = await this.credential(connection, provider === 'GITHUB' ? 'webhookSecret' : 'signingSecret');
        const verified = provider === 'GITHUB' ? verifyGitHubSignature(raw, c.req.header('x-hub-signature-256') ?? null, secret)
          : verifySlackSignature(raw, c.req.header('x-slack-signature') ?? null, c.req.header('x-slack-request-timestamp') ?? null, secret);
        if (!verified) throw new IntegrationError('SIGNATURE_INVALID', 403);
        let value: Record<string, unknown>;
        try { value = c.req.header('content-type')?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw); } catch { throw new IntegrationError('PAYLOAD_INVALID', 400); }
        let delivery: string, eventType: string, payload: unknown;
        if (provider === 'GITHUB') {
          const config = githubConfig(connection.config), installation = value.installation as { id?: number } | undefined, repository = value.repository as { id?: number } | undefined;
          delivery = c.req.header('x-github-delivery') ?? ''; eventType = c.req.header('x-github-event') ?? '';
          if (eventType === 'ping') {
            // Real App ping has hook.app_id but no installation/repository payload.
            const hook = value.hook as { app_id?: number } | undefined;
            if (hook?.app_id !== Number(config.appId)) throw new IntegrationError('REPOSITORY_SCOPE_MISMATCH', 403);
          } else if (installation?.id !== config.installationId || (repository?.id !== config.repositoryId && eventType !== 'installation')) throw new IntegrationError('REPOSITORY_SCOPE_MISMATCH', 403);
          const check = (value.check_run ?? value.check_suite) as { head_sha?: string } | undefined;
          const pull = value.pull_request as { head?: { sha?: string } } | undefined;
          payload = { action: typeof value.action === 'string' ? value.action.slice(0, 50) : null, headSha: check?.head_sha ?? pull?.head?.sha ?? value.after ?? null };
        } else {
          if (typeof value.payload === 'string') { try { value = JSON.parse(value.payload); } catch { throw new IntegrationError('PAYLOAD_INVALID'); } }
          const config = slackConfig(connection.config);
          if (value.type === 'url_verification') return c.json({ challenge: String(value.challenge ?? '').slice(0, 200) });
          const event = value.event as { user?: string; channel?: string; type?: string } | undefined;
          const team = typeof value.team === 'object' ? (value.team as { id?: string }).id : value.team_id;
          const user = typeof value.user === 'object' ? (value.user as { id?: string }).id : value.user_id ?? event?.user;
          const channel = typeof value.channel === 'object' ? (value.channel as { id?: string }).id : value.channel_id ?? event?.channel;
          if (team !== config.teamId || channel !== config.channelId || typeof user !== 'string' || !config.userMappings[user]) throw new IntegrationError('SLACK_MAPPING_DENIED', 403);
          const member = await this.database.sql`select 1 from memberships where organization_id=${connection.organization_id} and user_id=${config.userMappings[user]} and role='OWNER' and status='ACTIVE'`;
          if (!member.length) throw new IntegrationError('SLACK_MAPPING_DENIED', 403);
          if (value.command !== '/ai-pixel' || !c.req.header('content-type')?.includes('application/x-www-form-urlencoded')) throw new IntegrationError('SLACK_COMMAND_UNSUPPORTED', 400);
          const command = parseSlackCommand(value.text);
          delivery = typeof value.event_id === 'string' ? value.event_id : hash(raw); eventType = String(event?.type ?? value.type ?? value.command ?? 'command').slice(0, 50);
          payload = { teamId: config.teamId, userId: user, actorId: config.userMappings[user], channelId: config.channelId, eventType, command };
        }
        if (!/^[A-Za-z0-9-]{8,100}$/.test(delivery) || !/^[A-Za-z0-9_/-]{1,60}$/.test(eventType)) throw new IntegrationError('DELIVERY_INVALID', 400);
        const result = await this.database.sql.begin(async tx => {
          await lockOrganization(tx, connection.organization_id);
          const existing = await tx<{ body_hash: string }[]>`select body_hash from integration_inbox where connection_id=${connection.id} and delivery_id=${delivery}`;
          if (existing[0]) { if (existing[0].body_hash !== hash(raw)) throw new IntegrationError('DELIVERY_CONFLICT', 409); return { duplicate: true }; }
          await tx`insert into integration_inbox(id,connection_id,connection_version,organization_id,project_id,provider,delivery_id,body_hash,event_type,payload)
            values(${randomUUID()},${connection.id},${connection.version},${connection.organization_id},${connection.project_id},${provider},${delivery},${hash(raw)},${eventType},${json(tx, payload)})`;
          if (provider === 'GITHUB' && eventType === 'installation' && ['deleted', 'suspend'].includes(String(value.action))) await tx`update integration_connections set enabled=false,version=version+1,updated_at=now() where id=${connection.id}`;
          await emit(tx, { organizationId: connection.organization_id, projectId: connection.project_id, type: 'integration.webhook.received', aggregateVersion: connection.version, payload: { provider, eventType, deliveryId: delivery } });
          return { duplicate: false };
        });
        if (provider === 'SLACK') return c.json({ received: true, ...result, response_type: 'ephemeral', text: '명령을 접수했습니다. 처리 결과는 지정 채널과 웹 연결 기록에 표시됩니다. 실행·merge는 자동으로 시작하지 않습니다.' }, 200);
        return c.json({ received: true, ...result }, 202);
      } catch (error) { convert(error); }
    });
    return routes;
  }
  async start() {
    // A crash after dispatch may have produced a remote effect. Never resend it.
    await this.database.sql`update integration_operations set status='UNKNOWN',error_code='PROCESS_RESTART_EFFECT_UNKNOWN',version=version+1,updated_at=now() where status='RUNNING'`;
    await this.database.sql`update integration_inbox set status='RECEIVED' where status='PROCESSING' and attempts<3`;
    await this.database.sql`update integration_inbox set status='FAILED',error_code='PROCESS_RESTART_RETRY_LIMIT' where status='PROCESSING' and attempts>=3`;
    await this.database.sql`update integration_inbox set reply_status='UNKNOWN',error_code='PROCESS_RESTART_EFFECT_UNKNOWN' where reply_status='SENDING'`;
    await this.merges.recover();
    this.timer = setInterval(() => {this.lastTickAt=new Date().toISOString();void this.processOnce().catch(() => {this.lastErrorAt=new Date().toISOString();}); }, 1000);
  }
  async stop() { if (this.timer) clearInterval(this.timer);this.timer=null; while (this.busy) await new Promise(done => setTimeout(done, 20)); }
  async processOnce() {
    if (this.busy) return false; this.busy = true;
    try {
      if(await maintenanceReason(this.database.sql))return false;
      if (await this.merges.processOnce()) return true;
      if (await this.commands.replyOnce()) return true;
      const candidates = await this.database.sql<Operation[]>`select * from integration_operations where status in ('PENDING','DEFERRED') and attempts<3 and next_attempt_at<=now() order by created_at,id limit 1`;
      const candidate = candidates[0];
      if (!candidate) return this.processInboxOnce();
      const claimed = await this.database.sql.begin(async tx => {
        await lockOrganization(tx, candidate.organization_id);
        const rows = await tx<Operation[]>`update integration_operations set status='RUNNING',attempts=attempts+1,version=version+1,updated_at=now() where id=${candidate.id} and status in ('PENDING','DEFERRED') returning *`;
        if (rows[0]) await this.event(tx, rows[0]); return rows[0];
      });
      if (!claimed) return false;
      try { await this.complete(claimed, 'SUCCEEDED', await this.execute(claimed), null); }
      catch (error) {
        const failure = error instanceof IntegrationError ? error : new IntegrationError('INTEGRATION_UNVERIFIABLE', 503);
        await this.complete(claimed, failure.code === 'EFFECT_UNKNOWN' ? 'UNKNOWN' : failure.code === 'RATE_LIMITED' && claimed.attempts < 3 ? 'DEFERRED' : 'FAILED', null, failure.code, failure.retryAfter);
        if (failure.code === 'CREDENTIAL_REVOKED') await this.database.sql`update integration_connections set enabled=false,version=version+1,updated_at=now() where id=${claimed.connection_id}`;
      }
      return true;
    } finally { this.busy = false; }
  }
  private async complete(operation: Operation, status: string, reference: unknown, error: string | null, delay: number | null = null) {
    await this.database.sql.begin(async tx => {
      await lockOrganization(tx, operation.organization_id);
      const updated = await tx<Operation[]>`update integration_operations set status=${status},external_ref=${json(tx, reference)},error_code=${error},next_attempt_at=now()+(${delay ?? 0}*interval '1 second'),version=version+1,updated_at=now() where id=${operation.id} and status='RUNNING' returning *`;
      if (updated[0]) await this.event(tx, updated[0]);
    });
  }
  private async prerequisite(operation: Operation, kind: OperationKind) {
    const rows = await this.database.sql<Operation[]>`select * from integration_operations where connection_id=${operation.connection_id} and run_id=${operation.run_id} and kind=${kind} and status='SUCCEEDED' order by created_at desc limit 1`;
    if (!rows[0]?.external_ref) throw new IntegrationError('PREREQUISITE_REQUIRED', 409);
    return rows[0].external_ref;
  }
  private async execute(operation: Operation) {
    let effectMayExist = false;
    const transport: typeof fetch = async (url, init = {}) => {
      const mutation = (init.method ?? 'GET') !== 'GET' && !String(url).includes('/access_tokens') && !String(url).endsWith('/api/auth.test');
      try {
        const response = await this.fetcher(url, init);
        if (mutation && response.ok) {
          if (String(url).startsWith('https://slack.com/')) {
            try { const body = await response.clone().json(); if (body.ok !== false) effectMayExist = true; } catch { effectMayExist = true; }
          } else effectMayExist = true;
        }
        return response;
      } catch (error) { if (mutation) effectMayExist = true; throw error; }
    };
    try { return await this.executeAttempt(operation, transport); }
    catch (error) { if (effectMayExist) throw new IntegrationError('EFFECT_UNKNOWN', 503); throw error; }
  }
  private async executeAttempt(operation: Operation, transport: typeof fetch) {
    const connection = await this.connection(operation.connection_id);
    if (connection.version !== operation.connection_version) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
    const run = await this.evidence(operation.organization_id, operation.project_id, operation.run_id, operation.request.expectedRunVersion);
    if (run.checkpoint.workspace?.sha !== operation.candidate_sha) throw new IntegrationError('CANDIDATE_CHANGED', 409);
    const task = await this.database.sql<{ title: string }[]>`select title from tasks where organization_id=${operation.organization_id} and id=${run.task_id}`;
    const title = operation.request.title ?? task[0]?.title ?? 'AI Pixel 작업 결과';
    const body = operation.request.body ?? `작업 ${run.task_id}\n후보 SHA ${operation.candidate_sha}\n테스트·빌드 성공, 동일 후보 QA PASS. Owner 결과 수락과 원격 merge 승인은 별개입니다.`;
    if (operation.kind === 'SLACK_REPORT') {
      const adapter = new SlackAdapter(slackConfig(connection.config), await this.credential(connection, 'botToken'), transport, async () => {
        const live = await this.connection(connection.id);
        if (live.version !== operation.connection_version) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
        await this.evidence(operation.organization_id, operation.project_id, operation.run_id, operation.request.expectedRunVersion);
      });
      const current = await this.connection(connection.id);
      if (current.version !== operation.connection_version) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
      await this.evidence(operation.organization_id, operation.project_id, operation.run_id, operation.request.expectedRunVersion);
      return adapter.report(operation.id, `[QA | 결과 보고 | ${run.task_id}]\n${safeText(title, 200)}\n상태: ${run.status === 'SUCCEEDED' ? 'Owner 결과 수락' : 'Owner 결과 수락 대기'}\n테스트·빌드: 성공 / QA: PASS\n후보 SHA: ${operation.candidate_sha}\n원격 merge: 실행하지 않음`);
    }
    const adapter = await this.adapter(connection, operation, transport), branch = `ai-pixel/${operation.run_id}`;
    switch (operation.kind) {
      case 'ISSUE_CREATE': return adapter.createIssue(operation.id, title, body);
      case 'BRANCH_CREATE': return adapter.createBranch(operation.id, branch);
      case 'PUSH_CANDIDATE': {
        const previous = await this.prerequisite(operation, 'BRANCH_CREATE');
        const files = run.checkpoint.workspace?.files ?? [];
        return adapter.push(operation.id, branch, String(previous.headSha), operation.candidate_sha, files);
      }
      case 'DRAFT_PR_CREATE': {
        const previous = await this.prerequisite(operation, 'PUSH_CANDIDATE');
        return adapter.draftPr(operation.id, branch, String(previous.headSha), title, body);
      }
      case 'CI_REFRESH': {
        const previous = await this.prerequisite(operation, 'PUSH_CANDIDATE'); return adapter.ci(branch, String(previous.headSha));
      }
      case 'MERGE_REQUEST': {
        const pushed = await this.prerequisite(operation, 'PUSH_CANDIDATE'), pull = await this.prerequisite(operation, 'DRAFT_PR_CREATE');
        const ci = await adapter.ci(branch, String(pushed.headSha));
        if (ci.status !== 'PASS') throw new IntegrationError('CURRENT_HEAD_CI_REQUIRED', 409);
        const config = githubConfig(connection.config);
        if (!Number.isSafeInteger(pull.number) || Number(pull.number) < 1) throw new IntegrationError('PREREQUISITE_REQUIRED', 409);
        return this.merges.create(operation, connection, Number(pull.number), branch, String(pushed.headSha), config);
      }
    }
  }
  private async processInboxOnce() {
    const receipts = await this.database.sql<Receipt[]>`update integration_inbox set status='PROCESSING',attempts=attempts+1,updated_at=now()
      where id=(select id from integration_inbox where status='RECEIVED' and attempts<3 order by created_at,id for update skip locked limit 1) returning *`;
    const receipt = receipts[0]; if (!receipt) return false;
    try {
      if (receipt.provider === 'SLACK') { await this.commands.process(receipt); return true; }
      if (receipt.provider === 'GITHUB' && typeof receipt.payload.headSha === 'string' && /^[a-f0-9]{40}$/.test(receipt.payload.headSha)) {
        const connection = await this.connection(receipt.connection_id);
        const pushed = await this.database.sql<Operation[]>`select * from integration_operations where connection_id=${receipt.connection_id} and kind='PUSH_CANDIDATE' and status='SUCCEEDED' and external_ref->>'headSha'=${receipt.payload.headSha} order by created_at desc limit 1`;
        if (pushed[0]) {
          const current = await (await this.adapter(connection)).ci(`ai-pixel/${pushed[0].run_id}`, receipt.payload.headSha);
          await this.database.sql.begin(async tx => {
            await lockOrganization(tx, receipt.organization_id);
            const updated = await tx<Operation[]>`update integration_operations set external_ref=external_ref||${json(tx, { ci: current })},version=version+1,updated_at=now() where id=${pushed[0].id} returning *`;
            await this.event(tx, updated[0]);
          });
        }
      }
      await this.database.sql`update integration_inbox set status='PROCESSED',updated_at=now() where id=${receipt.id}`;
    } catch (error) {
      await this.database.sql.begin(async tx => {
        await lockOrganization(tx, receipt.organization_id);
        const errorCode = error instanceof IntegrationError ? error.code : 'RECONCILIATION_UNVERIFIABLE';
        await tx`update integration_inbox set status='FAILED',error_code=${errorCode},updated_at=now() where id=${receipt.id}`;
        await emit(tx, { organizationId: receipt.organization_id, projectId: receipt.project_id, type: 'integration.updated', aggregateVersion: receipt.connection_version ?? 1,
          payload: { receiptId: receipt.id, status: 'FAILED', errorCode } });
      });
    }
    return true;
  }
}
