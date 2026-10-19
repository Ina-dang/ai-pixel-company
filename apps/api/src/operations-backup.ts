import {spawn} from 'node:child_process';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createDatabase,type Database} from '@ai-pixel/db';
import {DockerSandbox} from '@ai-pixel/agents';
import {sha256} from './operations-model.js';
import {jobAuthority,type OperationsJob} from './operations.js';
import {createApp} from './app.js';
import {serve} from '@hono/node-server';
import type {AddressInfo} from 'node:net';
import {createServer} from 'node:net';

const MAX=64*1024*1024,ID=/^[a-f0-9]{8}-[a-f0-9-]{27}$/;
type WorkspaceFile={path:string;content:string};
type TableDigest={name:string;rows:string;digest:string};
type Bundle={format:1;id:string;capturedAt:string;migration:string;tables:TableDigest[];workspaces:{runId:string;sha:string;files:WorkspaceFile[]}[];dump:string};
const MAGIC=Buffer.from('AIPXBK01');
export function sealBackup(plain:Buffer,key:Buffer){if(key.length!==32||plain.length>MAX*2)throw new Error('BACKUP_SIZE_OR_KEY_INVALID');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]);}
export function openBackup(blob:Buffer,key:Buffer){if(blob.length<37||blob.length>MAX*2||!blob.subarray(0,8).equals(MAGIC)||key.length!==32)throw new Error('BACKUP_AUTHENTICATION_FAILED');try{const cipher=createDecipheriv('aes-256-gcm',key,blob.subarray(8,20));cipher.setAuthTag(blob.subarray(20,36));return Buffer.concat([cipher.update(blob.subarray(36)),cipher.final()]);}catch{throw new Error('BACKUP_AUTHENTICATION_FAILED');}}
export function validateBundle(value:unknown):Bundle{
  const b=value as Bundle;if(b?.format!==1||!ID.test(b.id)||!Number.isFinite(Date.parse(b.capturedAt))||typeof b.migration!=='string'||!Array.isArray(b.tables)||!b.tables.length||b.tables.length>200||!Array.isArray(b.workspaces)||b.workspaces.length>500||typeof b.dump!=='string'||b.dump.length>MAX*1.4||!/^UEdETVA/.test(b.dump))throw new Error('BACKUP_MANIFEST_INVALID');
  const paths=new Set<string>();for(const w of b.workspaces){if(!ID.test(w.runId)||!/^[a-f0-9]{64}$/.test(w.sha)||!Array.isArray(w.files)||w.files.length>32)throw new Error('BACKUP_ARTIFACT_INVALID');for(const f of w.files){if(typeof f.path!=='string'||!(/^(?:package\.json|build\.mjs|(?:src|test)\/[A-Za-z0-9_./-]+\.mjs)$/.test(f.path))||f.path.split('/').some(p=>p==='..'||p==='.'||!p)||typeof f.content!=='string'||Buffer.byteLength(f.content)>100000||paths.has(`${w.runId}/${f.path}`))throw new Error('BACKUP_ARTIFACT_PATH_DENIED');paths.add(`${w.runId}/${f.path}`);}if(sha256(JSON.stringify([...w.files].sort((a,b)=>a.path.localeCompare(b.path,'en'))))!==w.sha)throw new Error('BACKUP_ARTIFACT_HASH_MISMATCH');}
  if(b.tables.some(t=>!/^[a-z_][a-z0-9_]{0,62}$/.test(t.name)||!/^\d+$/.test(t.rows)||!/^([a-f0-9]{32})$/.test(t.digest)))throw new Error('BACKUP_TABLE_MANIFEST_INVALID');return b;
}
async function safeDirectory(root:string,path:string){
  const base=await realpath(root),target=resolve(root,path),rel=relative(resolve(root),target);if(isAbsolute(rel)||rel==='..'||rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`))throw new Error('BACKUP_PATH_DENIED');
  let cursor=resolve(root);for(const segment of rel.split(/[\\/]/).filter(Boolean)){cursor=join(cursor,segment);try{if((await lstat(cursor)).isSymbolicLink())throw new Error('BACKUP_LINK_DENIED');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(cursor,{mode:0o700});}}
  const canonical=await realpath(target),inside=relative(base,canonical);if(isAbsolute(inside)||inside.startsWith('..'))throw new Error('BACKUP_PATH_DENIED');return target;
}
async function readRegular(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX*2)throw new Error('BACKUP_FILE_DENIED');return readFile(path);}
export async function dockerCommand(args:string[],input?:Buffer,timeout=30000):Promise<Buffer>{
  return new Promise((done,reject)=>{const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});const chunks:Buffer[]=[];let size=0,ended=false;const stop=(code:string)=>{if(ended)return;ended=true;child.kill('SIGKILL');reject(new Error(code));};const timer=setTimeout(()=>stop('DOCKER_TIMEOUT'),timeout);
    child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>MAX)stop('DOCKER_OUTPUT_LIMIT');else chunks.push(b);});child.stderr.resume();child.stdin.on('error',()=>undefined);child.on('error',()=>{clearTimeout(timer);stop('DOCKER_UNAVAILABLE');});child.on('close',code=>{clearTimeout(timer);if(ended)return;ended=true;if(code!==0)reject(new Error('DOCKER_OPERATION_FAILED'));else done(Buffer.concat(chunks));});child.stdin.end(input);});
}
export async function tableDigests(database:Database){
  const names=await database.sql<{tablename:string}[]>`select tablename from pg_tables where schemaname='public' order by tablename`,rows:TableDigest[]=[];
  for(const{name}of names.map(n=>({name:n.tablename}))){if(!/^[a-z_][a-z0-9_]{0,62}$/.test(name))throw new Error('BACKUP_TABLE_NAME_DENIED');const values=await database.sql.unsafe<{rows:string;digest:string}[]>(`select count(*)::text rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public."${name}" t`);rows.push({name,...values[0]});}return rows;
}
async function freeLoopbackPort(){const server=createServer();await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>done());});const port=(server.address() as AddressInfo).port;await new Promise<void>(done=>server.close(()=>done()));return port;}
export class BackupManager{
  constructor(private database:Database,private root:string,private databaseUrl:string){}
  private async key(){const dir=await safeDirectory(this.root,'.local/integration-secrets'),file=join(dir,'backup-key.bin');try{const key=await readRegular(file);if(key.length!==32)throw new Error('BACKUP_KEY_INVALID');return key;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const key=randomBytes(32);await writeFile(file,key,{flag:'wx',mode:0o600});return key;}}
  private async source(){const url=new URL(this.databaseUrl);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^[a-z_][a-z0-9_]+$/.test(url.pathname.slice(1)))throw new Error('BACKUP_SOURCE_DENIED');
    const ids=(await dockerCommand(['compose','--project-directory',this.root,'--env-file',join(this.root,'.local/compose.env'),'ps','-q','postgres'])).toString().trim();if(!/^[a-f0-9]{12,64}$/.test(ids))throw new Error('BACKUP_SOURCE_CONTAINER_REQUIRED');const metadata=JSON.parse((await dockerCommand(['inspect',ids])).toString())[0];
    if(metadata.Config?.Labels?.['com.docker.compose.service']!=='postgres'||metadata.Config?.Labels?.['com.docker.compose.project']!=='ai-pixel-company-phase0'||!String(metadata.Config?.Image).startsWith('postgres:18-alpine@sha256:'))throw new Error('BACKUP_SOURCE_CONTAINER_DENIED');return{container:ids,image:metadata.Image,user:decodeURIComponent(url.username),name:url.pathname.slice(1)};
  }
  execute=(job:OperationsJob)=>job.kind==='BACKUP'?this.backup(job):this.restore(job);
  private async backup(job:OperationsJob){
    await jobAuthority(this.database,job);const source=await this.source();const previous=(await this.database.sql`select paused,reason_ko from operations_controls where organization_id=${job.organization_id}`)[0];let fenced=false,success=false;
    try{await this.database.sql.begin(async tx=>{await tx`select pg_advisory_xact_lock(9700401)`;if((await tx`select count(*)::int n from organizations`)[0].n!==1)throw new Error('HOST_ADMIN_REQUIRED');const prior=(await tx`select * from operations_controls where organization_id=${job.organization_id} for update`)[0];if(prior?.maintenance_token||prior?.mode==='RESTORE_QUARANTINE')throw new Error('BACKUP_FENCE_ACTIVE');await tx`insert into operations_controls(organization_id,paused,reason_ko,maintenance_token) values(${job.organization_id},true,'일관된 로컬 백업을 위한 실행 점검 중입니다.',${job.id}) on conflict(organization_id) do update set paused=true,maintenance_token=excluded.maintenance_token,reason_ko=excluded.reason_ko,version=operations_controls.version+1,updated_at=now()`;});fenced=true;
      await sleep(100);
      const active=await this.database.sql`select 1 from workflow_runs where status='RUNNING' union all select 1 from performance_review_jobs where status='RUNNING' union all select 1 from integration_operations where status='RUNNING' union all select 1 from integration_inbox where reply_status='SENDING' union all select 1 from operations_notification_outbox where status='SENDING' limit 1`;if(active.length)throw new Error('BACKUP_ACTIVE_WORK_REQUIRES_DRAIN');
      await jobAuthority(this.database,job);const key=await this.key(),backupDir=await safeDirectory(this.root,'.local/backups');
      const bundle=await this.database.sql.begin('isolation level repeatable read read only',async tx=>{
        const point=(await tx`select pg_export_snapshot() snapshot,clock_timestamp() captured_at`)[0];const migration=(await tx`select name from app_migrations order by name desc limit 1`)[0].name as string;
        // All SQL fingerprints and pg_dump share this exported MVCC snapshot.
        const tables=await tableDigests({...this.database,sql:tx as unknown as Database['sql']}),workspaces:Bundle['workspaces']=[];
        const runs=await tx`select id,checkpoint->'workspace'->>'sha' sha from workflow_runs where checkpoint->'workspace' is not null and checkpoint->'workspace'<>'null'::jsonb order by id`;
        const sandbox=new DockerSandbox(join(this.root,'.local/agent-workspaces'));
        for(const run of runs){const physical=await sandbox.snapshot(run.id);if(physical.sha!==run.sha)throw new Error('BACKUP_ARTIFACT_HASH_MISMATCH');workspaces.push({runId:run.id,sha:physical.sha,files:physical.files});}
        const dump=await dockerCommand(['exec',source.container,'pg_dump','--username',source.user,'--dbname',source.name,'--format=custom','--no-owner','--no-privileges',`--snapshot=${point.snapshot}`],undefined,120000);
        return validateBundle({format:1,id:job.id,capturedAt:new Date(point.captured_at).toISOString(),migration,tables,workspaces,dump:dump.toString('base64')});
      });
      const encrypted=sealBackup(Buffer.from(JSON.stringify(bundle)),key);await writeFile(join(backupDir,`${job.id}.aipxbak`),encrypted,{flag:'wx',mode:0o600});const hash=sha256(encrypted);
      await this.database.sql`insert into operations_backups(id,organization_id,sha256,bytes,captured_at,table_count,artifact_count,migration) values(${job.id},${job.organization_id},${hash},${encrypted.length},${bundle.capturedAt},${bundle.tables.length},${bundle.workspaces.length},${bundle.migration})`;success=true;
      return{backupId:job.id,encrypted:true,algorithm:'AES-256-GCM',sha256:hash,bytes:encrypted.length,capturedAt:bundle.capturedAt,tableCount:bundle.tables.length,workspaceCount:bundle.workspaces.length,sourceChanged:false};
    }finally{if(fenced)await this.database.sql`update operations_controls set paused=${success?!!previous?.paused:true},reason_ko=${success?String(previous?.reason_ko??''):'백업 실패를 확인한 뒤 실행 재개를 검토하세요.'},maintenance_token=null,version=version+1,updated_at=now() where organization_id=${job.organization_id} and maintenance_token=${job.id}`;}
  }
  private async restore(job:OperationsJob){
    if(!job.backup_id||!ID.test(job.backup_id))throw new Error('BACKUP_NOT_FOUND');await jobAuthority(this.database,job);
    const record=(await this.database.sql`select * from operations_backups where id=${job.backup_id} and organization_id=${job.organization_id}`)[0];if(!record)throw new Error('BACKUP_NOT_FOUND');
    const dir=await safeDirectory(this.root,'.local/backups'),blob=await readRegular(join(dir,`${job.backup_id}.aipxbak`));if(sha256(blob)!==record.sha256)throw new Error('BACKUP_HASH_MISMATCH');
    const bundle=validateBundle(JSON.parse(openBackup(blob,await this.key()).toString('utf8')));if(bundle.id!==job.backup_id)throw new Error('BACKUP_ID_MISMATCH');const source=await this.source(),name=`ai-pixel-restore-${job.id}`,network=`ai-pixel-restore-net-${job.id}`,volume=`ai-pixel-restore-data-${job.id}`,databaseName=`pixel_restore_${job.id.replaceAll('-','')}`,started=Date.now();let created=false,networkCreated=false,volumeCreated=false,restored:Database|null=null;
    try{await jobAuthority(this.database,job);await dockerCommand(['network','create','--opt','com.docker.network.bridge.enable_ip_masquerade=false','--label',`ai-pixel-operation=${job.id}`,network]);networkCreated=true;
      await dockerCommand(['volume','create','--label',`ai-pixel-operation=${job.id}`,volume]);volumeCreated=true;
      const port=await freeLoopbackPort();await dockerCommand(['run','-d','--name',name,'--label','ai-pixel-purpose=restore-verification','--label',`ai-pixel-operation=${job.id}`,'--network',network,'--publish',`127.0.0.1:${port}:5432`,'--memory','768m','--cpus','1','--volume',`${volume}:/var/lib/postgresql`,'--security-opt','no-new-privileges:true','--env','POSTGRES_USER=pixel','--env',`POSTGRES_DB=${databaseName}`,'--env','POSTGRES_HOST_AUTH_METHOD=trust',source.image]);created=true;
      let ready=false;for(let i=0;i<12;i++){try{await dockerCommand(['exec',name,'pg_isready','-h','127.0.0.1','-U','pixel','-d',databaseName],undefined,10000);ready=true;break;}catch{await sleep(250);}}if(!ready)throw new Error('RESTORE_DATABASE_NOT_READY');
      await dockerCommand(['exec','-i',name,'pg_restore','--username','pixel','--dbname',databaseName,'--no-owner','--no-privileges','--exit-on-error','--single-transaction'],Buffer.from(bundle.dump,'base64'),120000);
      const metadata=JSON.parse((await dockerCommand(['inspect',name])).toString())[0],binding=metadata.NetworkSettings.Ports['5432/tcp'];if(binding?.length!==1||binding[0].HostIp!=='127.0.0.1'||!/^\d+$/.test(binding[0].HostPort))throw new Error('RESTORE_NETWORK_DENIED');
      restored=createDatabase(`postgresql://pixel@127.0.0.1:${binding[0].HostPort}/${databaseName}`,{max:2});const actual=await tableDigests(restored);if(JSON.stringify(actual)!==JSON.stringify(bundle.tables))throw new Error('RESTORE_TABLE_DIGEST_MISMATCH');
      const target=await safeDirectory(this.root,`.local/restore-verifications/${job.id}/workspaces`);for(const workspace of bundle.workspaces){for(const file of workspace.files){const filePath=join(await safeDirectory(this.root,relative(this.root,join(target,workspace.runId,dirname(file.path)))),file.path.split('/').at(-1)??'');await writeFile(filePath,file.content,{flag:'wx',mode:0o600});}if((await new DockerSandbox(target).snapshot(workspace.runId)).sha!==workspace.sha)throw new Error('RESTORE_ARTIFACT_HASH_MISMATCH');}
      await quarantineRestore(restored);
      const quarantined=await restored.sql`select count(*)::int n from operations_controls where mode='RESTORE_QUARANTINE' and paused=true`;if(quarantined[0].n!==1)throw new Error('RESTORE_QUARANTINE_FAILED');
      const databaseOutage=await this.testDatabaseRestart(restored,name);
      return{backupId:bundle.id,backupSha:record.sha256,tableDigestsMatched:true,tableCount:actual.length,workspaceCount:bundle.workspaces.length,artifactHashesMatched:true,quarantined:true,externalDispatches:0,sourceDomainChanged:false,measuredRestoreMs:Date.now()-started,snapshotAgeMs:Date.now()-Date.parse(bundle.capturedAt),databaseOutage,targetDestroyed:true,offHostRecoveryVerified:false};
    }finally{await restored?.close();await this.cleanupRestore(job.id,name,network,volume,created,networkCreated,volumeCreated);}
  }
  private async testDatabaseRestart(database:Database,container:string){
    const before=await tableDigests(database),app=createApp({database,config:{appOrigin:'http://127.0.0.1:3000',bootstrapSecretHash:'unused-quarantined-verification',sessionTtlSeconds:60,cookieSecure:false,ssePollMs:1000,sseHeartbeatMs:15000,sseBatchSize:100,sseRetentionDays:30,loginMaxAttempts:1,loginWindowMs:60000}});
    const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise<void>(done=>{if(server.listening)done();else server.once('listening',()=>done());});const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try{if((await fetch(`${base}/health/ready`)).status!==503)throw new Error('RESTORE_READINESS_NOT_FENCED');await dockerCommand(['stop','--time','3',container]);
      const live=await fetch(`${base}/health/live`),down=await fetch(`${base}/health/ready`),state=await down.json();if(live.status!==200||down.status!==503||state.status!=='unavailable')throw new Error('DATABASE_OUTAGE_NOT_DETECTED');
      await dockerCommand(['start',container]);let recovered=false;for(let i=0;i<30;i++){await sleep(500);try{const response=await fetch(`${base}/health/ready`),body=await response.json();if(body.status==='maintenance'){recovered=true;break;}}catch{/* Bounded wait for this owned test database only. */}}
      if(!recovered||JSON.stringify(await tableDigests(database))!==JSON.stringify(before))throw new Error('DATABASE_RESTART_STATE_MISMATCH');
      return{liveStatus:200,readinessStatus:503,unavailableDetected:true,reconnected:true,statePreserved:true,sourceDatabaseStopped:false};
    }finally{if('closeAllConnections'in server)server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
  }
  private async cleanupRestore(id:string,name:string,network:string,volume:string,created:boolean,networkCreated:boolean,volumeCreated:boolean){
    if(created){const metadata=JSON.parse((await dockerCommand(['inspect',name])).toString())[0];if(metadata.Config?.Labels?.['ai-pixel-operation']!==id||metadata.Name!==`/${name}`)throw new Error('RESTORE_CLEANUP_TARGET_DENIED');await dockerCommand(['rm','--force',name]);}
    if(networkCreated){const metadata=JSON.parse((await dockerCommand(['network','inspect',network])).toString())[0];if(metadata.Labels?.['ai-pixel-operation']!==id)throw new Error('RESTORE_CLEANUP_TARGET_DENIED');await dockerCommand(['network','rm',network]);}
    if(volumeCreated){const metadata=JSON.parse((await dockerCommand(['volume','inspect',volume])).toString())[0];if(metadata.Labels?.['ai-pixel-operation']!==id)throw new Error('RESTORE_CLEANUP_TARGET_DENIED');await dockerCommand(['volume','rm',volume]);}
  }
}
export async function quarantineRestore(database:Database){
  await database.sql.begin(async tx=>{
    await tx`insert into operations_controls(organization_id,paused,mode,reason_ko) select id,true,'RESTORE_QUARANTINE','복원 격리본: 외부 조정과 별도 승인 전 실행을 금지합니다.' from organizations on conflict(organization_id) do update set paused=true,mode='RESTORE_QUARANTINE',reason_ko=excluded.reason_ko,maintenance_token=null,version=operations_controls.version+1`;
    await tx`update sessions set revoked_at=coalesce(revoked_at,now())`;await tx`update integration_connections set enabled=false,version=version+1`;
    await tx`update task_schedules set enabled=false,version=version+1`;await tx`update integration_operations set status='UNKNOWN',error_code='RESTORE_REMOTE_RECONCILIATION_REQUIRED',version=version+1 where status in ('PENDING','DEFERRED','RUNNING')`;
    await tx`update integration_merge_requests set status='REVOKED',error_code='RESTORE_APPROVAL_REVOKED',version=version+1 where status in ('REQUESTED','APPROVED','QUEUED')`;
    await tx`update integration_inbox set reply_status='UNKNOWN',error_code='RESTORE_REMOTE_RECONCILIATION_REQUIRED' where reply_status in ('PENDING','SENDING')`;
    await tx`update operations_notification_outbox set status='UNKNOWN',error_code='RESTORE_REMOTE_RECONCILIATION_REQUIRED' where status in ('PENDING','SENDING','DEFERRED')`;
    await tx`update operations_notification_policies set enabled=false,version=version+1`;await tx`update operations_jobs set status='UNKNOWN',error_code='RESTORE_MANUAL_REVIEW_REQUIRED' where status in ('QUEUED','RUNNING')`;
  });
}
