import { randomUUID } from 'node:crypto';
import type { Database } from '@ai-pixel/db';
import { taskLabels, type TaskStatus } from '@ai-pixel/contracts';
import { containsSecret, IntegrationError, slackConfig, SlackAdapter } from '@ai-pixel/integrations';
import type { Connection } from './integrations.js';
import { emit, lockOrganization } from './repository.js';
import { createTaskCommand } from './task-commands.js';

export type SlackCommand = { kind: 'HELP' | 'STATUS' | 'TASK'; original?: string };
export function parseSlackCommand(text: unknown): SlackCommand {
  if (typeof text !== 'string' || text.length > 20020 || containsSecret(text)) throw new IntegrationError('SLACK_COMMAND_INVALID', 400);
  if (!text.trim() || /^(?:help|도움말)\s*$/i.test(text)) return { kind: 'HELP' };
  if (/^(?:status|상태)\s*$/i.test(text)) return { kind: 'STATUS' };
  const match = /^(?:task|업무)[ \t]([\s\S]+)$/i.exec(text);
  if (match?.[1].trim() && match[1].length <= 20000) return { kind: 'TASK', original: match[1] };
  throw new IntegrationError('SLACK_COMMAND_UNSUPPORTED', 400);
}
export type SlackReceipt = { id: string; connection_id: string; connection_version: number; organization_id: string; project_id: string;
  payload: { actorId: string; userId: string; command: SlackCommand }; result: { text: string; taskId?: string } | null };
type Dependencies = { connection: (id: string) => Promise<Connection>; credential: (connection: Connection, field: string) => Promise<string>; fetcher: typeof fetch };
export function slackDashboardLink(projectId: string, taskId?: string) {
  const query = new URLSearchParams({ project: projectId }); if (taskId) query.set('task', taskId);
  return `<http://127.0.0.1:3000/?${query}#task-inspector|대시보드 우측 상세 열기 (이 PC)>`;
}
export class SlackCommands {
  constructor(private database: Database, private deps: Dependencies) {}
  private async authorized(receipt: SlackReceipt, expectedReplyStatus?: string) {
    const connection = await this.deps.connection(receipt.connection_id), config = slackConfig(connection.config);
    if (connection.version !== receipt.connection_version || connection.organization_id !== receipt.organization_id || connection.project_id !== receipt.project_id
      || config.userMappings[receipt.payload.userId] !== receipt.payload.actorId) throw new IntegrationError('SLACK_MAPPING_CHANGED', 403);
    const member = await this.database.sql`select 1 from memberships m join organizations o on o.id=m.organization_id
      join projects p on p.organization_id=m.organization_id and p.id=${receipt.project_id}
      where m.organization_id=${receipt.organization_id} and m.user_id=${receipt.payload.actorId} and m.role='OWNER' and m.status='ACTIVE' and o.status='ACTIVE' and p.status='ACTIVE'`;
    if (!member.length) throw new IntegrationError('SLACK_MAPPING_DENIED', 403);
    if (expectedReplyStatus) {
      const current = await this.database.sql`select 1 from integration_inbox where id=${receipt.id} and reply_status=${expectedReplyStatus}`;
      if (!current.length) throw new IntegrationError('SLACK_REPLY_STATE_CHANGED', 409);
    }
    return connection;
  }
  async process(receipt: SlackReceipt) {
    await this.authorized(receipt);
    await this.database.sql.begin(async tx => {
      await lockOrganization(tx, receipt.organization_id);
      await this.authorized(receipt);
      const current = await tx`select 1 from integration_inbox where id=${receipt.id} and status='PROCESSING' for update`;
      if (!current.length) return;
      const command = receipt.payload.command;
      let result: { text: string; taskId?: string };
      if (command.kind === 'TASK') {
        const original = command.original ?? '';
        const task = await createTaskCommand(tx, { organizationId: receipt.organization_id, userId: receipt.payload.actorId }, receipt.project_id, {
          title: Array.from((original.split(/\r?\n/).find(line => line.trim()) ?? '').trim()).slice(0, 100).join(''), commandOriginalKo: original, source: 'SLACK',
          acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '업무 원문에 따른 결과와 검증 근거를 Owner가 확인한다.', method: 'manual', required: true }],
        });
        result = { taskId: task.id, text: `업무를 등록했습니다.\n상태: 할 일 · 실행 전\n${slackDashboardLink(receipt.project_id, task.id)}\n열면 요청 원문·수용 기준·직원 보고·검증 결과·확인된 커밋을 볼 수 있습니다.\n다음: 수용 기준을 검토하고 웹에서 실행을 요청하세요. 자동 실행·수락·merge는 하지 않습니다.\n업무 ID: ${task.id}` };
      } else if (command.kind === 'STATUS') {
        const counts = await tx<{ status: TaskStatus; count: number }[]>`select status,count(*)::int as count from tasks where organization_id=${receipt.organization_id} and project_id=${receipt.project_id} group by status order by status`;
        result = { text: `서버에 기록된 업무 현황\n${counts.map(row => `${taskLabels[row.status]}: ${row.count}`).join('\n') || '등록된 업무 없음'}\n${slackDashboardLink(receipt.project_id)}\n업무를 선택하면 우측에서 변경 요약·테스트·QA·확인된 커밋을 볼 수 있습니다. merge 승인은 별도입니다.` };
      } else result = { text: `/ai-pixel 상태 — 서버 업무 상태 조회\n/ai-pixel 업무 <원문> — 할 일 등록 (자동 실행 없음)\n/ai-pixel 도움말 — 명령 안내\n${slackDashboardLink(receipt.project_id)}\n프로젝트·업무 선택 → 우측 상세에서 결과·변경 파일·검증·커밋 확인 → 수락 여부 결정. 실행·merge·배포는 자동으로 시작하지 않습니다.` };
      await tx`update integration_inbox set status='PROCESSED',result=${tx.json(result)},reply_status='PENDING',updated_at=now() where id=${receipt.id}`;
      await tx`insert into audit_logs(id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome,metadata)
        values(${randomUUID()},${receipt.organization_id},${receipt.project_id},'USER',${receipt.payload.actorId},'slack.command.processed','integration_inbox',${receipt.id},${receipt.id},'SUCCESS',${tx.json({ kind: command.kind, taskId: result.taskId ?? null })})`;
      await emit(tx, { organizationId: receipt.organization_id, projectId: receipt.project_id, type: 'integration.updated', aggregateVersion: receipt.connection_version,
        payload: { commandId: receipt.id, status: 'PROCESSED', kind: command.kind, taskId: result.taskId ?? null } });
    });
  }
  async replyOnce() {
    const rows = await this.database.sql<SlackReceipt[]>`update integration_inbox set reply_status='SENDING',updated_at=now()
      where id=(select id from integration_inbox where provider='SLACK' and reply_status='PENDING' order by created_at,id for update skip locked limit 1) returning *`;
    const receipt = rows[0]; if (!receipt) return false;
    let dispatched = false;
    try {
      const connection = await this.authorized(receipt, 'SENDING');
      const transport: typeof fetch = async (url, init) => {
        if (String(url).endsWith('/api/chat.postMessage')) dispatched = true;
        return this.deps.fetcher(url, init);
      };
      const adapter = new SlackAdapter(slackConfig(connection.config), await this.deps.credential(connection, 'botToken'), transport, async () => { await this.authorized(receipt, 'SENDING'); });
      const reference = await adapter.report(receipt.id, `[AI Pixel | 명령 결과 | ${receipt.id}]\n${receipt.result?.text ?? '처리 결과를 웹에서 확인하세요.'}`);
      await this.database.sql`update integration_inbox set reply_status='SENT',reply_ref=${this.database.sql.json(reference)},updated_at=now() where id=${receipt.id} and reply_status='SENDING'`;
    } catch (error) {
      // Never repeat a possibly delivered notification, including after restart.
      const unknown = error instanceof IntegrationError ? error.code === 'EFFECT_UNKNOWN' : dispatched;
      await this.database.sql`update integration_inbox set reply_status=${unknown ? 'UNKNOWN' : 'FAILED'},error_code=${error instanceof IntegrationError ? error.code : 'SLACK_REPLY_FAILED'},updated_at=now() where id=${receipt.id} and reply_status='SENDING'`;
    }
    await this.database.sql.begin(async tx => {
      await lockOrganization(tx, receipt.organization_id);
      await emit(tx, { organizationId: receipt.organization_id, projectId: receipt.project_id, type: 'integration.updated', aggregateVersion: receipt.connection_version,
        payload: { commandId: receipt.id, replyUpdated: true } });
    });
    return true;
  }
}
