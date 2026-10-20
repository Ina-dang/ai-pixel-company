import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createTaskSchema, idSchema } from '@ai-pixel/contracts';
import type { Database } from '@ai-pixel/db';
import { ApiError, type ApiEnv } from './security.js';
import { audit, mutate, taskView } from './repository.js';
import { createTaskCommand } from './task-commands.js';
import { maintenanceReason } from './maintenance.js';
import { LocalWhisper, type SpeechProvider, validateWave, VOICE_LIMITS } from './voice-provider.js';

type Candidate = { id: string; organization_id: string; project_id: string; actor_id: string; session_id: string; status: string; transcript: string | null; transcript_hash: string | null; duration_ms: number; version: number; error_code: string | null; task_id: string | null; expires_at: Date; owner_receipt: unknown; recovery_attempts: number; recovery_details: unknown; capture_source: string };
const view = (row: Candidate) => ({ id: row.id, projectId: row.project_id, status: row.status, transcript: row.status === 'READY' ? row.transcript : null, durationMs: row.duration_ms, version: row.version, errorCode: row.error_code, taskId: row.task_id, expiresAt: row.expires_at, captureSource: row.capture_source, recoveryAttempts: row.recovery_attempts, recoveryDetails: row.recovery_details });
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function uuid(value: string) { const id = idSchema.safeParse(value); if (!id.success) throw new ApiError(404, 'NOT_FOUND', '음성 후보를 찾을 수 없습니다.'); return id.data; }
export class VoiceService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = new Map<string, { controller: AbortController; finished: Promise<void> }>();
  private recovery: Promise<void> | undefined;
  private recoveryBlocked = false;
  private recoveryCode: string | null = null;
  readonly provider: SpeechProvider;
  constructor(private readonly db: Database, root: string, provider?: SpeechProvider) { this.provider = provider ?? new LocalWhisper(root); }
  async start() { await this.recoverPending(); await this.expire(); this.timer = setInterval(() => { void this.recoverPending().then(() => this.expire()).catch(() => { this.recoveryBlocked = true; this.recoveryCode = 'VOICE_RECOVERY_UNVERIFIABLE'; }); }, 30_000); this.timer.unref(); }
  async recoverPending() {
    if (this.recovery) return this.recovery;
    this.recovery = this.reconcile().finally(() => { this.recovery = undefined; });
    return this.recovery;
  }
  private async reconcile() {
    this.recoveryBlocked = false; this.recoveryCode = null;
    if (!this.provider.recoverExecution || !this.provider.temporaryIds) return;
    if (await maintenanceReason(this.db.sql)) { this.recoveryBlocked = true; this.recoveryCode = 'MAINTENANCE_MODE'; return; }
    const recover = this.provider.recoverExecution.bind(this.provider);
    try {
      const directories = await this.provider.temporaryIds();
      const rows = await this.db.sql<Candidate[]>`select * from voice_candidates where status='PROCESSING' or id::text=any(${directories}) order by created_at limit 20`;
      if (directories.some(id => !rows.some(row => row.id === id))) { this.recoveryBlocked = true; this.recoveryCode = 'VOICE_UNOWNED_TEMPORARY_FILES'; }
      for (const row of rows) {
        if (this.active.has(row.id)) continue;
        await this.db.sql.begin(async tx => {
          await tx`select pg_advisory_xact_lock(hashtextextended(${`voice-recovery:${row.id}`},0))`;
          const current = (await tx<Candidate[]>`select * from voice_candidates where id=${row.id} for update`)[0];
          if (!current || this.active.has(row.id)) return;
          if (current.status !== 'PROCESSING' && !(await this.provider.temporaryIds?.())?.includes(row.id)) return;
          if (current.recovery_attempts >= 2) { this.recoveryBlocked = true; this.recoveryCode = 'VOICE_RECOVERY_RETRY_LIMIT'; return; }
          const result = await recover(current.id, current.owner_receipt).catch(() => ({ state: 'BLOCKED' as const, code: 'VOICE_RECOVERY_UNVERIFIABLE', stopped: 0, filesDeleted: 0, automaticReplay: false as const }));
          if (result.state === 'OWNER_ALIVE') return;
          const safeResult = { state: result.state, code: result.code, stopped: result.stopped, filesDeleted: result.filesDeleted, automaticReplay: false, checkedAt: new Date().toISOString() };
          await tx`update voice_candidates set status=${result.state === 'RECOVERED' ? 'CANCELLED' : 'PROCESSING'},transcript=null,error_code=${result.code},
            recovery_attempts=recovery_attempts+1,recovery_details=${tx.json(safeResult)},version=version+1 where id=${current.id}`;
          await tx`insert into audit_logs(id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome)
            values(${randomUUID()},${current.organization_id},${current.project_id},'SYSTEM','voice-recovery','voice.recovery','voice_candidate',${current.id},${randomUUID()},${result.state === 'RECOVERED' ? 'SUCCESS' : 'DENIED'})`;
          if (result.state !== 'RECOVERED') { this.recoveryBlocked = true; this.recoveryCode = result.code; }
        });
      }
    } catch { this.recoveryBlocked = true; this.recoveryCode = 'VOICE_RECOVERY_UNVERIFIABLE'; }
  }
  async expire() {
    await this.db.sql`update voice_candidates set status='EXPIRED',transcript=null,version=version+1 where status='READY' and expires_at<=now()`;
  }
  private async authorized(row: Candidate) {
    const ok = await this.db.sql`select 1 from sessions s join memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
      join organizations o on o.id=s.organization_id join projects p on p.organization_id=o.id
      where s.id=${row.session_id} and s.user_id=${row.actor_id} and s.organization_id=${row.organization_id} and s.revoked_at is null and s.expires_at>now()
      and m.status='ACTIVE' and m.role='OWNER' and o.status='ACTIVE' and p.id=${row.project_id} and p.status='ACTIVE'`;
    return ok.length > 0 && !(await maintenanceReason(this.db.sql));
  }
  private launch(row: Candidate, wav: Buffer) {
    if (this.active.has(row.id) || row.status !== 'PROCESSING') return;
    const controller = new AbortController();
    const finished = (async () => {
      try {
        if (!(await this.authorized(row))) throw new Error('VOICE_PERMISSION_CHANGED');
        const transcript = await this.provider.transcribe(wav, row.id, controller.signal);
        if (controller.signal.aborted || !(await this.authorized(row))) throw new Error('VOICE_PERMISSION_CHANGED');
        await this.db.sql`update voice_candidates set status='READY',transcript=${transcript},transcript_hash=${hash(transcript)},version=version+1
          where id=${row.id} and status='PROCESSING' and error_code is distinct from 'VOICE_CANCEL_REQUESTED'`;
      } catch (error) {
        const message = error instanceof Error && /^VOICE_[A-Z_]+$/.test(error.message) ? error.message : 'VOICE_PROVIDER_FAILED';
        await this.db.sql`update voice_candidates set status=case when ${message}='VOICE_CLEANUP_REQUIRED' then 'PROCESSING' when error_code='VOICE_CANCEL_REQUESTED' then 'CANCELLED' else 'FAILED' end,transcript=null,error_code=${message},version=version+1 where id=${row.id} and status='PROCESSING'`;
        if (message === 'VOICE_NATIVE_CANCELLED') await this.db.sql`update voice_candidates set error_code=${message} where id=${row.id} and status='CANCELLED'`;
      } finally { wav.fill(0); this.active.delete(row.id); }
    })();
    this.active.set(row.id, { controller, finished });
    void finished.catch(() => undefined);
  }
  async stop() { if (this.timer) clearInterval(this.timer); for (const entry of this.active.values()) entry.controller.abort(); await Promise.allSettled([...this.active.values()].map(entry => entry.finished)); await this.recovery; }
  routes() {
    const app = new Hono<ApiEnv>();
    app.get('/voice/status', async c => {
      await this.expire();
      const ready = await this.provider.readiness();
      const usage = await this.db.sql`select count(*)::int as used from voice_candidates where organization_id=${c.get('auth').organizationId} and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`;
      const busy = await this.db.sql`select 1 from voice_candidates where status='PROCESSING' limit 1`;
      const recoveries = await this.db.sql<Candidate[]>`select * from voice_candidates where organization_id=${c.get('auth').organizationId} and actor_id=${c.get('auth').userId} and (status='PROCESSING' or recovery_details is not null) order by created_at desc limit 10`;
      return c.json({ data: { ...ready, provider: 'whisper.cpp b5454 / tiny 다국어 / 로컬 CPU', language: 'ko', audioDestination: '이 컴퓨터', rawAudioRetention: '처리·취소 후 임시 WAV 삭제', transcriptRetentionSeconds: VOICE_LIMITS.candidateTtlSeconds, limits: VOICE_LIMITS, usedToday: usage[0].used, busy: busy.length > 0, paidApiFallback: false, consentVersion: 'local-transcription-v1', recoveryBlocked: this.recoveryBlocked, recoveryCode: this.recoveryCode, recoveries: recoveries.map(view) }, requestId: c.get('requestId') });
    });
    app.post('/projects/:id/voice/candidates', async c => {
      const projectId = uuid(c.req.param('id'));
      await this.recoverPending();
      if (this.recoveryBlocked) throw new ApiError(409, 'VOICE_RECOVERY_REQUIRED', '잔여 음성 복구 확인이 필요합니다.');
      if (c.req.header('X-Voice-Consent') !== 'local-transcription-v1') throw new ApiError(400, 'VOICE_CONSENT_REQUIRED', '로컬 음성 처리와 보관 안내에 동의해 주세요.');
      if (c.req.header('Content-Type')?.split(';')[0] !== 'audio/wav') throw new ApiError(415, 'VOICE_INVALID_WAVE', '16kHz 모노 PCM WAV만 지원합니다.');
      if (!(await this.provider.readiness()).ready) throw new ApiError(503, 'VOICE_PROVIDER_UNAVAILABLE', '로컬 음성 모델이 준비되지 않았습니다. 텍스트로 입력해 주세요.');
      const wav = Buffer.from(await c.req.arrayBuffer());
      let duration: number;
      try { duration = validateWave(wav); } catch { wav.fill(0); throw new ApiError(400, 'VOICE_INVALID_WAVE', '0.25~30초, 16kHz 모노 16bit PCM WAV를 사용하세요.'); }
      let candidateId: string | undefined;
      try {
        const source = c.req.header('X-Voice-Input') ?? 'UNKNOWN';
        if (!['UNKNOWN','FILE','MICROPHONE'].includes(source)) throw new ApiError(400, 'VOICE_CAPTURE_SOURCE_INVALID', '음성 입력 경로를 확인하세요.');
        // Durable ownership is committed before any WAV write or native spawn, including the pre-spawn crash gap.
        const owner = await this.provider.prepareExecution?.();
        const response = await mutate(this.db, c, { projectId, audioHash: hash(wav), consent: 'local-transcription-v1', captureSource: source }, async tx => {
          if (await maintenanceReason(tx)) throw new ApiError(409, 'MAINTENANCE_MODE', '점검 중에는 새 음성 처리를 시작할 수 없습니다.');
          const project = await tx`select 1 from projects where id=${projectId} and organization_id=${c.get('auth').organizationId} and status='ACTIVE'`;
          if (!project.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
          if ((await tx`select 1 from voice_candidates where status='PROCESSING'`).length) throw new ApiError(409, 'VOICE_BUSY', '음성 처리 중입니다. 자동 재시도하지 않고 텍스트로 계속할 수 있습니다.');
          const used = await tx`select count(*)::int as count from voice_candidates where organization_id=${c.get('auth').organizationId} and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`;
          if (used[0].count >= VOICE_LIMITS.daily) throw new ApiError(429, 'VOICE_DAILY_LIMIT', '오늘의 로컬 전사 20회 한도에 도달했습니다. 텍스트 입력을 사용하세요.');
          const id = randomUUID(), actor = c.get('auth');
          await tx`insert into voice_candidates(id,organization_id,project_id,actor_id,session_id,status,audio_hash,duration_ms,consent_version,capture_source,owner_receipt)
            values(${id},${actor.organizationId},${projectId},${actor.userId},${actor.sessionId},'PROCESSING',${hash(wav)},${duration},'local-transcription-v1',${source},${tx.json(owner ?? null)})`;
          candidateId = id;
          await audit(tx, c, 'voice.requested', 'voice_candidate', id, projectId);
          return { status: 202, data: { id, status: 'PROCESSING' } };
        });
        // A replay has no candidateId and cannot run the provider twice.
        if (candidateId) {
          const rows = await this.db.sql<Candidate[]>`select * from voice_candidates where id=${candidateId}`;
          this.launch(rows[0], wav);
        } else wav.fill(0);
        return response;
      } catch (error) { wav.fill(0); throw error; }
    });
    app.get('/voice/candidates/:id', async c => {
      await this.expire();
      const rows = await this.db.sql<Candidate[]>`select * from voice_candidates where id=${uuid(c.req.param('id'))} and organization_id=${c.get('auth').organizationId} and actor_id=${c.get('auth').userId}`;
      if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '음성 후보를 찾을 수 없습니다.');
      return c.json({ data: view(rows[0]), requestId: c.get('requestId') });
    });
    app.delete('/voice/candidates/:id', async c => {
      const id = uuid(c.req.param('id'));
      // Even a replay cannot report success for a native process this instance cannot reconcile.
      const pending = await this.db.sql`select 1 from voice_candidates where id=${id} and organization_id=${c.get('auth').organizationId} and actor_id=${c.get('auth').userId} and status='PROCESSING'`;
      if (pending.length && !this.active.has(id)) throw new ApiError(409, 'VOICE_RECOVERY_REQUIRED', '이전 처리 프로세스와 파일 정리를 확인해야 합니다.');
      const response = await mutate(this.db, c, {}, async tx => {
        const rows = await tx<Candidate[]>`select * from voice_candidates where id=${id} and organization_id=${c.get('auth').organizationId} and actor_id=${c.get('auth').userId} for update`;
        if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '음성 후보를 찾을 수 없습니다.');
        if (rows[0].status === 'CONFIRMED') throw new ApiError(409, 'VOICE_ALREADY_CONFIRMED', '이미 등록한 업무는 업무 화면에서 관리하세요.');
        if (rows[0].status === 'PROCESSING' && !this.active.has(id)) throw new ApiError(409, 'VOICE_RECOVERY_REQUIRED', '이전 처리 프로세스 확인이 필요합니다. 자동 재실행하지 않습니다.');
        await tx`update voice_candidates set status=case when status='PROCESSING' then 'PROCESSING' else 'CANCELLED' end,transcript=null,
          error_code=case when status='PROCESSING' then 'VOICE_CANCEL_REQUESTED' else error_code end,version=version+1 where id=${id}`;
        await audit(tx, c, 'voice.cancelled', 'voice_candidate', id, rows[0].project_id);
        return { status: 200, data: { id, status: 'CANCELLED', transcript: null } };
      });
      const active = this.active.get(id); if (active) { active.controller.abort(); await active.finished; }
      const unresolved = await this.db.sql`select 1 from voice_candidates where id=${id} and status='PROCESSING' and error_code='VOICE_CLEANUP_REQUIRED'`;
      if (unresolved.length) throw new ApiError(503, 'VOICE_CLEANUP_REQUIRED', '임시 음성 파일 정리가 확인되지 않았습니다. 후속 전사를 차단하고 관리자 확인이 필요합니다.');
      await this.db.sql`update voice_candidates set status='CANCELLED',transcript=null,version=version+1 where id=${id} and status='PROCESSING' and error_code='VOICE_CANCEL_REQUESTED'`;
      return response;
    });
    app.post('/voice/candidates/:id/confirm', async c => {
      const id = uuid(c.req.param('id'));
      const body = await c.req.json().catch(() => null) as { expectedVersion?: unknown; confirmed?: unknown; task?: unknown } | null;
      const task = createTaskSchema.safeParse(body?.task);
      if (!task.success || task.data.source !== 'VOICE' || body?.confirmed !== true || !Number.isInteger(body.expectedVersion)) throw new ApiError(400, 'VOICE_CONFIRM_REQUIRED', '전사와 업무 내용을 확인해 주세요.');
      return mutate(this.db, c, body, async tx => {
        if (await maintenanceReason(tx)) throw new ApiError(409, 'MAINTENANCE_MODE', '점검 중에는 업무를 등록할 수 없습니다.');
        const rows = await tx<Candidate[]>`select * from voice_candidates where id=${id} and organization_id=${c.get('auth').organizationId} and actor_id=${c.get('auth').userId} for update`;
        const row = rows[0];
        if (!row) throw new ApiError(404, 'NOT_FOUND', '음성 후보를 찾을 수 없습니다.');
        if (row.status !== 'READY' || row.version !== body.expectedVersion || new Date(row.expires_at).getTime() <= Date.now()) throw new ApiError(409, 'VOICE_CANDIDATE_CHANGED', '전사 후보가 만료되었거나 변경됐습니다.');
        const created = await createTaskCommand(tx, c.get('auth'), row.project_id, task.data, true);
        await tx`update voice_candidates set status='CONFIRMED',transcript=null,task_id=${created.id},edited=${hash(task.data.commandOriginalKo) !== row.transcript_hash},confirmed_at=now(),version=version+1 where id=${id}`;
        await audit(tx, c, 'voice.confirmed', 'task', created.id, row.project_id);
        return { status: 201, data: taskView(created) };
      });
    });
    app.post('/voice/candidates/:id/recover', async c => {
      const id = uuid(c.req.param('id'));
      const input = await c.req.json().catch(() => null) as { expectedVersion?: unknown; confirmed?: unknown } | null;
      if (input?.confirmed !== true || !Number.isInteger(input.expectedVersion)) throw new ApiError(400, 'VOICE_RECOVERY_CONFIRM_REQUIRED', '음성 잔여 파일 삭제·복구 범위를 확인하세요.');
      const response = await mutate(this.db, c, input, async tx => {
        const row = (await tx<Candidate[]>`select * from voice_candidates where id=${id} and organization_id=${c.get('auth').organizationId} and actor_id=${c.get('auth').userId} for update`)[0];
        if (!row) throw new ApiError(404, 'NOT_FOUND', '음성 후보를 찾을 수 없습니다.');
        if (row.version !== input.expectedVersion || row.status !== 'PROCESSING' || this.active.has(id)) throw new ApiError(409, 'VOICE_RECOVERY_STATE_CHANGED', '현재 실행 중인 후보는 취소를 사용하고 복구 상태를 다시 확인하세요.');
        await tx`update voice_candidates set recovery_attempts=0,version=version+1 where id=${id}`;
        await audit(tx, c, 'voice.recovery.requested', 'voice_candidate', id, row.project_id);
        return { status: 202, data: { id, status: 'RECOVERY_REQUESTED', automaticReplay: false } };
      });
      await this.recoverPending();
      return response;
    });
    return app;
  }
}
