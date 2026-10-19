import {randomUUID} from 'node:crypto';
import type {Database,Transaction} from '@ai-pixel/db';
import {Hono} from 'hono';
import {z} from 'zod';
import {IntegrationError,LocalSecretStore,SlackAdapter,slackConfig} from '@ai-pixel/integrations';
import {audit,lockOrganization,mutate} from './repository.js';
import {ApiError,type ApiEnv} from './security.js';
import {maintenanceReason} from './maintenance.js';
import {RequestMetrics,safeCode,sourceDigest,type AlertCondition,type HealthProbes} from './operations-model.js';

type Control={organization_id:string;paused:boolean;mode:string;reason_ko:string;maintenance_token:string|null;version:number};
export type OperationsJob={id:string;organization_id:string;requested_by:string;session_id:string;kind:'BACKUP'|'RESTORE_VERIFY';backup_id:string|null;status:string};
type Job=OperationsJob;
export type OperationsExecutor=(job:Job)=>Promise<Record<string,unknown>>;
const version=z.number().int().nonnegative(),uuid=z.uuid();
const json=(tx:Transaction,value:unknown)=>tx.json(JSON.parse(JSON.stringify(value)));
async function input<T>(request:Request,schema:z.ZodType<T>){try{return schema.parse(await request.json());}catch{throw new ApiError(400,'INVALID_INPUT','운영 요청 내용을 확인하세요.');}}
export async function jobAuthority(database:Database,job:Job){
  const rows=await database.sql`select 1 from memberships m join sessions s on s.organization_id=m.organization_id and s.user_id=m.user_id
    where m.organization_id=${job.organization_id} and m.user_id=${job.requested_by} and m.status='ACTIVE' and m.role='OWNER'
    and s.id=${job.session_id} and s.revoked_at is null and s.expires_at>now()`;
  if(!rows.length)throw new Error('OWNER_PERMISSION_REVOKED');
}
export class OperationsService{
  readonly metrics=new RequestMetrics();
  private timer:ReturnType<typeof setInterval>|null=null;private busy=false;private jobsBusy=false;private notifyBusy=false;
  private digest:string|null=null;private lastCollectionError:string|null=null;
  constructor(readonly database:Database,readonly root:string,private readonly probes?:()=>Promise<HealthProbes>,private readonly executor?:OperationsExecutor,private readonly fetcher:typeof fetch=fetch){}
  async start(){
    this.digest=await sourceDigest(this.root);
    await this.database.sql`update operations_jobs set status='UNKNOWN',error_code='PROCESS_RESTART_UNVERIFIABLE',updated_at=now() where status='RUNNING'`;
    await this.database.sql`update operations_notification_outbox set status='UNKNOWN',error_code='PROCESS_RESTART_EFFECT_UNKNOWN',updated_at=now() where status='SENDING'`;
    this.timer=setInterval(()=>{void this.collect().catch(()=>{this.lastCollectionError='COLLECTION_UNAVAILABLE';});void this.processJob().catch(()=>undefined);void this.notifyOnce().catch(()=>undefined);},15000);
    await this.collect().catch(()=>{this.lastCollectionError='COLLECTION_UNAVAILABLE';});
  }
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=null;while(this.busy||this.jobsBusy||this.notifyBusy)await new Promise(done=>setTimeout(done,30));}
  async collect(){
    if(this.busy)return;this.busy=true;
    try{
      const health=await this.probes?.(),organizations=await this.database.sql<{id:string}[]>`select id from organizations order by id limit 100`;
      for(const org of organizations){const start=performance.now();
        const runs=(await this.database.sql`select count(*)::int total,count(*) filter(where status='RUNNING')::int running,
          count(*) filter(where status='QUEUED')::int queued,count(*) filter(where status='WAITING_APPROVAL')::int waiting,
          count(*) filter(where status='SUCCEEDED')::int succeeded,count(*) filter(where status='FAILED')::int failed,
          count(*) filter(where status='CANCELLED')::int cancelled,count(*) filter(where status='BLOCKED')::int blocked,
          count(*) filter(where status='RUNNING' and lease_expires_at<now())::int expired,
          count(*) filter(where stop_lease_token is not null or checkpoint->>'stopReason' in ('STOP_UNVERIFIABLE','RECOVERY_REQUIRED'))::int unsafe,
          coalesce(max(extract(epoch from now()-created_at)) filter(where status='QUEUED'),0)::int oldest_queue_seconds
          from workflow_runs where organization_id=${org.id}`)[0];
        const review=(await this.database.sql`select count(*) filter(where status='QUEUED')::int queued,count(*) filter(where status='RUNNING')::int running,count(*) filter(where status='UNKNOWN')::int unknown from performance_review_jobs where organization_id=${org.id}`)[0];
        const integrations=(await this.database.sql`select count(*) filter(where status in ('PENDING','DEFERRED'))::int pending,count(*) filter(where status='UNKNOWN')::int unknown,count(*) filter(where status='FAILED' and updated_at>now()-interval '24 hours')::int failed_last_day from integration_operations where organization_id=${org.id}`)[0];
        const unsafeJobs=(await this.database.sql`select count(*)::int n from operations_jobs where organization_id=${org.id} and status='UNKNOWN'`)[0].n;
        const usage=await this.database.sql`select project_id,sum(spent_tokens)::text completed_tokens,sum(case when status in ('HELD','UNKNOWN') then greatest(0,reserved_tokens-spent_tokens) else 0 end)::text unconfirmed_tokens from execution_allowances where organization_id=${org.id} and period_start=date_trunc('month',now() at time zone 'UTC')::date group by project_id`;
        const recentBackup=(await this.database.sql`select id,captured_at,bytes,table_count,artifact_count,migration from operations_backups where organization_id=${org.id} order by captured_at desc limit 1`)[0]??null;
        const lastRestore=(await this.database.sql`select id,updated_at,result from operations_jobs where organization_id=${org.id} and kind='RESTORE_VERIFY' and status='SUCCEEDED' order by updated_at desc limit 1`)[0]??null;
        const api=this.metrics.snapshot(),conditions:AlertCondition[]=[];
        const add=(key:string,critical:boolean,messageKo:string,evidence:Record<string,unknown>)=>conditions.push({key,severity:critical?'CRITICAL':'WARNING',messageKo,evidence});
        if(Number(runs.unsafe))add('WORKER_STOP_UNVERIFIABLE',true,'이전 실행의 종료를 확인할 수 없습니다. 호스트 프로세스·컨테이너를 확인하기 전 새 실행을 막습니다.',{count:runs.unsafe});
        if(Number(runs.expired))add('WORKFLOW_LEASE_EXPIRED',true,'실행 lease가 만료됐습니다. 자동 재실행 없이 복구 대상을 확인하세요.',{count:runs.expired});
        if(Number(runs.oldest_queue_seconds)>120)add('QUEUE_DELAY',false,'실행 큐 대기가 120초를 넘었습니다. 슬롯·예산·권한을 확인하세요.',{seconds:runs.oldest_queue_seconds});
        if(Number(review.unknown))add('REVIEW_UNKNOWN',true,'AI 평가 생성의 종료가 미확정입니다. 새 공급자 실행을 중단했습니다.',{count:review.unknown});
        if(Number(integrations.unknown))add('EXTERNAL_EFFECT_UNKNOWN',true,'외부 전송 결과가 불명입니다. 재전송하지 말고 원격 상태를 조회하세요.',{count:integrations.unknown});
        if(unsafeJobs)add('RECOVERY_JOB_UNKNOWN',true,'백업·복구 작업이 중단돼 결과가 불명입니다. 파일·격리 컨테이너·볼륨을 확인하기 전 반복하지 마세요.',{count:unsafeJobs});
        if(api.samples>=20&&api.p95Ms!==null&&api.p95Ms>1000)add('API_LATENCY',false,'최근 60초 API 응답 p95가 로컬 경보 기준 1초를 넘었습니다.',{samples:api.samples,p95Ms:api.p95Ms});
        if(api.errors5xx>=3)add('API_ERRORS',true,'최근 60초 서버 의존성 오류가 3건 이상 발생했습니다.',{count:api.errors5xx});
        if(!recentBackup||Date.now()-new Date(recentBackup.captured_at).getTime()>86400000)add('BACKUP_STALE',false,'최근 24시간의 로컬 백업이 없습니다. 복구 시험을 포함해 백업을 확인하세요.',{lastBackupAt:recentBackup?.captured_at??null});
        if(!lastRestore)add('RESTORE_NOT_VERIFIED',false,'성공한 격리 복원 시험이 없습니다. 백업 파일 존재만으로 복구 가능하다고 판정하지 않습니다.',{});
        if(health){if(!health.provider.ready)add('PROVIDER_UNAVAILABLE',false,'기존 Codex 구독이 실행 준비 상태가 아닙니다. 유료 API로 전환하지 않습니다.',{code:safeCode(health.provider.code)});
          if(!health.sandbox.ready)add('SANDBOX_UNAVAILABLE',true,'Docker Sandbox 의존성을 확인할 수 없습니다.',{code:safeCode(health.sandbox.code)});
          if(health.sandbox.orphanedContainers)add('SANDBOX_ORPHANED',true,'종료된 실행에 연결된 Sandbox 컨테이너가 남아 있습니다. 소유 범위를 확인한 뒤 정리하세요.',{count:health.sandbox.orphanedContainers});
          for(const[name,worker]of Object.entries(health.workers))if(!worker.running||!worker.lastTickAt||Date.now()-Date.parse(worker.lastTickAt)>45000)add(`WORKER_${name.toUpperCase()}_STALE`,true,'내부 worker heartbeat가 멈췄거나 시작되지 않았습니다.',{worker:name});}
        const snapshot={checkedAt:new Date().toISOString(),dbResponseMs:Math.round(performance.now()-start),runs,review,integrations,usage,recentBackup,lastRestore,api,
          health:health??null,actualCost:null,process:{rssBytes:process.memoryUsage().rss,uptimeSeconds:Math.round(process.uptime())},dependencies:{queue:'POSTGRESQL',redis:'NOT_IN_ACTIVE_ARCHITECTURE',engine:'CODEX_SUBSCRIPTION_WORKER'},thresholds:{queueSeconds:120,apiP95Ms:1000,workerStaleSeconds:45,backupAgeHours:24}};
        await this.database.sql.begin(async tx=>{await lockOrganization(tx,org.id);await tx`insert into operations_snapshots(organization_id,snapshot) values(${org.id},${json(tx,snapshot)}) on conflict(organization_id) do update set snapshot=excluded.snapshot,checked_at=now()`;await this.conditions(tx,org.id,conditions);});
      }this.lastCollectionError=null;
    }finally{this.busy=false;}
  }
  private async conditions(tx:Transaction,org:string,conditions:AlertCondition[]){
    const active=await tx<{id:string;rule_key:string;status:string;message_ko:string}[]>`select * from operations_alerts where organization_id=${org} and status in ('OPEN','ACKNOWLEDGED') and rule_key<>'NOTIFICATION_DRILL'`;
    for(const condition of conditions){const prior=active.find(a=>a.rule_key===condition.key);if(prior){await tx`update operations_alerts set last_seen_at=now(),evidence=${json(tx,condition.evidence)} where id=${prior.id}`;continue;}
      const id=randomUUID();await tx`insert into operations_alerts(id,organization_id,rule_key,severity,message_ko,evidence) values(${id},${org},${condition.key},${condition.severity},${condition.messageKo},${json(tx,condition.evidence)})`;await this.alertEvent(tx,org,id,'OPEN','operations-monitor',condition.messageKo);}
    for(const prior of active)if(!conditions.some(c=>c.key===prior.rule_key)){await tx`update operations_alerts set status='RESOLVED',resolved_at=now(),version=version+1 where id=${prior.id}`;await this.alertEvent(tx,org,prior.id,'RESOLVE','operations-monitor',prior.message_ko);}
  }
  private async alertEvent(tx:Transaction,org:string,alert:string,action:'OPEN'|'ACKNOWLEDGE'|'RESOLVE',actor:string,text:string){
    const id=randomUUID();await tx`insert into operations_alert_events(id,organization_id,alert_id,action,actor_id,original_ko) values(${id},${org},${alert},${action},${actor},${text})`;
    if(action==='ACKNOWLEDGE')return;
    const connections=await tx<{id:string;version:number}[]>`select c.id,c.version from operations_notification_policies p join integration_connections c on c.organization_id=p.organization_id and c.project_id=p.project_id and c.provider='SLACK' and c.enabled=true where p.organization_id=${org} and p.enabled=true`;
    if(connections[0])await tx`insert into operations_notification_outbox(id,organization_id,event_id,connection_id,connection_version,text_ko) values(${randomUUID()},${org},${id},${connections[0].id},${connections[0].version},${`[AI Pixel 운영 ${action==='OPEN'?'경보':'회복'}] ${text}\n경보 ID: ${alert}\n업무 수락·merge·운영 배포는 실행하지 않았습니다.`})`;
  }
  async notifyOnce(){
    if(this.notifyBusy)return false;this.notifyBusy=true;
    try{if(await maintenanceReason(this.database.sql))return false;
      const row=await this.database.sql.begin(async tx=>{const rows=await tx`select * from operations_notification_outbox where status in ('PENDING','DEFERRED') and attempts<3 and next_attempt_at<=now() order by created_at,id for update skip locked limit 1`;if(!rows[0])return null;return(await tx`update operations_notification_outbox set status='SENDING',attempts=attempts+1,updated_at=now() where id=${rows[0].id} returning *`)[0];});if(!row)return false;
      let dispatched=false;
      try{const connection=(await this.database.sql`select * from integration_connections where id=${row.connection_id} and organization_id=${row.organization_id}`)[0];
        const guard=async()=>{if(await maintenanceReason(this.database.sql))throw new IntegrationError('MAINTENANCE_PAUSED',409);const allowed=await this.database.sql`select 1 from operations_notification_policies p join integration_connections c on c.organization_id=p.organization_id and c.project_id=p.project_id where p.organization_id=${row.organization_id} and p.enabled=true and c.id=${row.connection_id} and c.enabled=true and c.version=${row.connection_version}`;if(!allowed.length)throw new IntegrationError('NOTIFICATION_PERMISSION_CHANGED',409);};
        await guard();if(!connection)throw new IntegrationError('CONNECTION_UNAVAILABLE',409);const config=slackConfig(connection.config),token=await new LocalSecretStore(this.root).read(connection.secret_refs.botToken);
        const adapter=new SlackAdapter(config,token,this.fetcher,guard);dispatched=true;const result=await adapter.report(row.id,row.text_ko);
        await this.database.sql`update operations_notification_outbox set status='SENT',external_ref=${this.database.sql.json(result)},error_code=null,updated_at=now() where id=${row.id}`;
      }catch(error){const code=error instanceof IntegrationError?error.code:'EFFECT_UNKNOWN',defer=code==='RATE_LIMITED'&&row.attempts<3,status=defer?'DEFERRED':code==='EFFECT_UNKNOWN'||dispatched&&!(error instanceof IntegrationError)?'UNKNOWN':'FAILED';
        const delay=Math.ceil(Math.max(60,error instanceof IntegrationError?error.retryAfter??60:60));
        await this.database.sql`update operations_notification_outbox set status=${status},error_code=${safeCode(code)},next_attempt_at=now()+${delay}*interval '1 second',updated_at=now() where id=${row.id}`;
        if(code==='CREDENTIAL_REVOKED')await this.database.sql`update integration_connections set enabled=false,version=version+1 where id=${row.connection_id}`;
      }return true;
    }finally{this.notifyBusy=false;}
  }
  async processJob(){
    if(this.jobsBusy||!this.executor)return false;this.jobsBusy=true;
    try{const job=await this.database.sql.begin(async tx=>{const rows=await tx<Job[]>`select * from operations_jobs where status='QUEUED' order by created_at for update skip locked limit 1`;if(!rows[0])return null;return(await tx<Job[]>`update operations_jobs set status='RUNNING',updated_at=now() where id=${rows[0].id} returning *`)[0];});if(!job)return false;
      try{await jobAuthority(this.database,job);const result=await this.executor(job);await this.database.sql`update operations_jobs set status='SUCCEEDED',result=${this.database.sql.json(JSON.parse(JSON.stringify(result)))},updated_at=now() where id=${job.id}`;}
      catch(error){await this.database.sql`update operations_jobs set status='FAILED',error_code=${safeCode(error instanceof Error?error.message:null,'OPERATION_UNVERIFIABLE')},updated_at=now() where id=${job.id}`;}return true;
    }finally{this.jobsBusy=false;}
  }
  async release(org:string){
    const digest=this.digest??await sourceDigest(this.root),checks=await this.database.sql`select distinct on(name) name,status,profile,source_digest,artifact_sha,details,checked_at from operations_release_checks where organization_id=${org} order by name,checked_at desc`;
    const restore=await this.database.sql`select j.id,j.updated_at from operations_jobs j join operations_backups b on b.id=j.backup_id and b.organization_id=j.organization_id where j.organization_id=${org} and j.kind='RESTORE_VERIFY' and j.status='SUCCEEDED' and j.result->>'backupSha'=b.sha256 and j.result->>'tableDigestsMatched'='true' and j.result->>'artifactHashesMatched'='true' and j.result->>'quarantined'='true' and j.result->>'targetDestroyed'='true' and j.result->>'externalDispatches'='0' and b.captured_at>now()-interval '24 hours' order by j.updated_at desc limit 1`;
    const required=['AUTOMATED_SUITE','BROWSER','RECOVERY','PERFORMANCE','EXTERNAL_PROBE'];const blockers=required.filter(name=>!checks.some(c=>c.name===name&&c.status==='PASS'&&c.source_digest===digest&&Date.now()-new Date(c.checked_at).getTime()<86400000));if(!restore.length)blockers.push('RESTORE_ROUNDTRIP');
    const snapshot=(await this.database.sql`select snapshot,checked_at from operations_snapshots where organization_id=${org}`)[0];
    if(!snapshot||Date.now()-new Date(snapshot.checked_at).getTime()>45000)blockers.push('OPERATIONS_SNAPSHOT_STALE');
    if(!snapshot?.snapshot?.health?.provider?.ready||!snapshot?.snapshot?.health?.sandbox?.ready)blockers.push('EXECUTION_DEPENDENCIES_UNAVAILABLE');
    if(snapshot?.snapshot?.health&&Object.values(snapshot.snapshot.health.workers as Record<string,{running:boolean;lastTickAt:string|null}>).some(w=>!w.running||!w.lastTickAt||Date.now()-Date.parse(w.lastTickAt)>45000))blockers.push('WORKER_HEARTBEAT_UNAVAILABLE');
    if((await this.database.sql`select 1 from operations_alerts where organization_id=${org} and severity='CRITICAL' and status<>'RESOLVED' limit 1`).length)blockers.push('UNRESOLVED_CRITICAL_ALERT');
    if(await maintenanceReason(this.database.sql))blockers.push('EXECUTION_PAUSED');
    const delivery=await this.database.sql`select e.alert_id from operations_alert_events e join operations_alerts a on a.id=e.alert_id join operations_notification_outbox n on n.event_id=e.id where e.organization_id=${org} and a.rule_key='NOTIFICATION_DRILL' and n.status='SENT' and e.created_at>now()-interval '24 hours' group by e.alert_id having count(distinct e.action) filter(where e.action in ('OPEN','RESOLVE'))=2 limit 1`;
    if(!delivery.length)blockers.push('ALERT_DELIVERY_VERIFICATION');
    return{profile:'LOCAL_FIXTURE',sourceDigest:digest,status:blockers.length?'NOT_READY':'READY_FOR_OWNER_REVIEW',blockers,checks,
      production:{status:'NO_GO',deploymentExecuted:false,mergeExecuted:false,blockers:['OWNER_DEPLOYMENT_NOT_APPROVED','PRODUCTION_ENVIRONMENT_NOT_CONFIGURED','OFF_HOST_BACKUP_NOT_VERIFIED','ALWAYS_ON_INGRESS_NOT_CONFIGURED','GENERAL_REPOSITORY_AND_LANGUAGE_EVALUATION_PENDING','PROVIDER_ORPHAN_SUPERVISOR_NOT_VERIFIED','HOST_SUPERVISOR_PROCESS_SEPARATION_REQUIRED']}};
  }
  routes(){const routes=new Hono<ApiEnv>();
    routes.get('/operations',async c=>{const org=c.get('auth').organizationId;const[snap,controls,alerts,events,backups,jobs,notifications,policy]=await Promise.all([
      this.database.sql`select snapshot,checked_at from operations_snapshots where organization_id=${org}`,this.database.sql<Control[]>`select * from operations_controls where organization_id=${org}`,
      this.database.sql`select * from operations_alerts where organization_id=${org} order by (status='RESOLVED'),opened_at desc limit 100`,this.database.sql`select * from operations_alert_events where organization_id=${org} order by created_at desc limit 100`,
      this.database.sql`select * from operations_backups where organization_id=${org} order by created_at desc limit 20`,this.database.sql`select id,kind,backup_id,status,result,error_code,created_at,updated_at from operations_jobs where organization_id=${org} order by created_at desc limit 20`,
      this.database.sql`select id,event_id,status,attempts,external_ref,error_code,updated_at from operations_notification_outbox where organization_id=${org} order by created_at desc limit 50`,this.database.sql`select * from operations_notification_policies where organization_id=${org}`]);
      return c.json({data:{snapshot:snap[0]?.snapshot??null,checkedAt:snap[0]?.checked_at??null,collectionError:this.lastCollectionError,control:controls[0]?{paused:controls[0].paused,mode:controls[0].mode,reasonKo:controls[0].reason_ko,version:controls[0].version,maintenanceActive:!!controls[0].maintenance_token}:{paused:false,mode:'LIVE',reasonKo:'',version:0,maintenanceActive:false},alerts,events,backups,jobs,notifications,notificationPolicy:policy[0]?{enabled:policy[0].enabled,projectId:policy[0].project_id,version:policy[0].version}:{enabled:false,projectId:null,version:0},release:await this.release(org)},requestId:c.get('requestId')});});
    routes.post('/operations/control',async c=>{const value=await input(c.req.raw,z.strictObject({paused:z.boolean(),expectedVersion:version,originalKo:z.string().min(1).max(1000)}));return mutate(this.database,c,value,async tx=>{await this.singleOrganization(tx);const org=c.get('auth').organizationId,prior=(await tx<Control[]>`select * from operations_controls where organization_id=${org}`)[0];if((prior?.version??0)!==value.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','운영 제어가 변경됐습니다.');if(prior?.maintenance_token||prior?.mode==='RESTORE_QUARANTINE')throw new ApiError(409,'RECOVERY_FENCE','백업 중이거나 복원 격리 상태여서 실행을 재개할 수 없습니다.');await tx`insert into operations_controls(organization_id,paused,reason_ko) values(${org},${value.paused},${value.originalKo}) on conflict(organization_id) do update set paused=excluded.paused,reason_ko=excluded.reason_ko,version=operations_controls.version+1,updated_at=now()`;await audit(tx,c,'operations.control','organization',org);return{status:200,data:{paused:value.paused}};});});
    routes.post('/operations/alerts/:id/acknowledge',async c=>{const value=await input(c.req.raw,z.strictObject({expectedVersion:version,originalKo:z.string().min(1).max(1000)}));if(!uuid.safeParse(c.req.param('id')).success)throw new ApiError(404,'NOT_FOUND','경보를 찾을 수 없습니다.');return mutate(this.database,c,value,async tx=>{const org=c.get('auth').organizationId,rows=await tx`update operations_alerts set status='ACKNOWLEDGED',version=version+1 where organization_id=${org} and id=${c.req.param('id')} and version=${value.expectedVersion} and status='OPEN' returning *`;if(!rows.length)throw new ApiError(409,'VERSION_CONFLICT','경보 상태가 변경됐습니다.');await this.alertEvent(tx,org,rows[0].id,'ACKNOWLEDGE',c.get('auth').userId,value.originalKo);await audit(tx,c,'operations.alert.acknowledge','operations_alert',rows[0].id);return{status:200,data:{acknowledged:true,resolved:false}};});});
    routes.post('/operations/notifications',async c=>{const value=await input(c.req.raw,z.strictObject({enabled:z.boolean(),projectId:uuid,expectedVersion:version}));return mutate(this.database,c,value,async tx=>{const org=c.get('auth').organizationId,p=(await tx`select * from operations_notification_policies where organization_id=${org}`)[0];if((p?.version??0)!==value.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','알림 정책이 변경됐습니다.');const connection=await tx`select 1 from integration_connections where organization_id=${org} and project_id=${value.projectId} and provider='SLACK' and enabled=true`;if(value.enabled&&!connection.length)throw new ApiError(409,'SLACK_CONNECTION_REQUIRED','이 프로젝트에 고정된 Slack 연결이 필요합니다.');await tx`insert into operations_notification_policies(organization_id,project_id,enabled) values(${org},${value.projectId},${value.enabled}) on conflict(organization_id) do update set project_id=excluded.project_id,enabled=excluded.enabled,version=operations_notification_policies.version+1`;await audit(tx,c,'operations.notifications','organization',org);return{status:200,data:{enabled:value.enabled}};});});
    routes.post('/operations/drill',async c=>{const value=await input(c.req.raw,z.strictObject({action:z.enum(['OPEN','RESOLVE'])}));return mutate(this.database,c,value,async tx=>{const org=c.get('auth').organizationId,old=(await tx`select * from operations_alerts where organization_id=${org} and rule_key='NOTIFICATION_DRILL' and status<>'RESOLVED'`)[0];let id=old?.id;if(value.action==='OPEN'&&!old){id=randomUUID();await tx`insert into operations_alerts(id,organization_id,rule_key,severity,message_ko) values(${id},${org},'NOTIFICATION_DRILL','WARNING','운영 알림 시험입니다. 실제 서비스 장애가 아닙니다.')`;await this.alertEvent(tx,org,id,'OPEN',c.get('auth').userId,'운영 알림 시험입니다. 실제 서비스 장애가 아닙니다.');}else if(value.action==='RESOLVE'&&old){await tx`update operations_alerts set status='RESOLVED',resolved_at=now(),version=version+1 where id=${id}`;await this.alertEvent(tx,org,id,'RESOLVE',c.get('auth').userId,'운영 알림 시험을 종료했습니다. 실제 장애 복구 통계와 구분합니다.');}await audit(tx,c,'operations.drill','organization',org);return{status:200,data:{id:id??null,action:value.action,synthetic:true}};});});
    routes.post('/operations/jobs',async c=>{const value=await input(c.req.raw,z.strictObject({kind:z.enum(['BACKUP','RESTORE_VERIFY']),backupId:uuid.optional()}));return mutate(this.database,c,value,async tx=>{if(!this.executor)throw new ApiError(409,'BACKUP_EXECUTOR_UNAVAILABLE','백업 supervisor가 구성되지 않았습니다.');await this.singleOrganization(tx);const auth=c.get('auth');const active=await tx`select 1 from operations_jobs where status in ('QUEUED','RUNNING','UNKNOWN')`;if(active.length)throw new ApiError(409,'OPERATION_ACTIVE','진행 중이거나 결과 불명인 운영 작업부터 확인하세요.');if((await tx`select 1 from operations_controls where mode='RESTORE_QUARANTINE'`).length)throw new ApiError(409,'RESTORE_QUARANTINE','복원 격리본에서는 새 백업·복구 작업을 실행할 수 없습니다.');if(value.kind==='RESTORE_VERIFY'&&(!value.backupId||!(await tx`select 1 from operations_backups where organization_id=${auth.organizationId} and id=${value.backupId}`).length))throw new ApiError(404,'BACKUP_NOT_FOUND','백업을 찾을 수 없습니다.');const id=randomUUID();await tx`insert into operations_jobs(id,organization_id,requested_by,session_id,kind,backup_id) values(${id},${auth.organizationId},${auth.userId},${auth.sessionId},${value.kind},${value.backupId??null})`;await audit(tx,c,'operations.job.queued','operations_job',id);return{status:202,data:{id,status:'QUEUED'}};});});return routes;
  }
  private async singleOrganization(tx:Transaction){if((await tx`select count(*)::int n from organizations`)[0].n!==1)throw new ApiError(409,'HOST_ADMIN_REQUIRED','전체 DB 백업과 호스트 운영 제어는 단일 조직 설치만 지원합니다.');}
}
