import{readFileSync}from'node:fs';
import{mkdir,writeFile}from'node:fs/promises';
import{resolve}from'node:path';
import{randomUUID}from'node:crypto';
import{setTimeout as sleep}from'node:timers/promises';
import{request,type APIRequestContext}from'@playwright/test';
import{createDatabase}from'@ai-pixel/db';
import{loadRuntime}from'./runtime.js';
import{sha256,sourceDigest,safeCode}from'../apps/api/src/operations-model.js';

export type OperationJob={id:string;kind:string;status:string;error_code:string|null;result:Record<string,unknown>|null};
export class OperationsClient{
  private csrf='';private context:APIRequestContext|null=null;
  async login(){const base=loadRuntime().appOrigin;this.context=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base},timeout:10000});const response=await this.context.post('/api/v1/auth/session',{data:{secret:readFileSync(resolve('.local/owner-key'),'utf8').trim()}});if(!response.ok())throw new Error('OWNER_AUTHENTICATION_FAILED');this.csrf=(await response.json()).data.csrfToken;}
  async api<T=Record<string,unknown>>(path:string,body?:unknown):Promise<T>{if(!this.context)throw new Error('OWNER_AUTHENTICATION_REQUIRED');const response=await this.context.fetch(`/api/v1${path}`,{method:body===undefined?'GET':'POST',headers:{'X-CSRF-Token':this.csrf,'Idempotency-Key':randomUUID()},...(body===undefined?{}:{data:body})});const result=await response.json();if(!response.ok())throw new Error(safeCode(result.error?.code,'OPERATIONS_API_FAILED'));return result.data;}
  async job(kind:'BACKUP'|'RESTORE_VERIFY',backupId?:string){const job=await this.api<OperationJob>('/operations/jobs',{kind,...(backupId?{backupId}:{})});console.log(JSON.stringify({operation:kind,jobId:job.id,status:'QUEUED'}));return this.wait(job.id);}
  async wait(id:string){const deadline=Date.now()+300000;while(Date.now()<deadline){const state=await this.api<{jobs:OperationJob[]}>('/operations');const row=state.jobs.find(j=>j.id===id);if(row&&['SUCCEEDED','FAILED','UNKNOWN'].includes(row.status)){if(row.status!=='SUCCEEDED')throw new Error(row.error_code??'OPERATION_UNVERIFIABLE');return row;}await sleep(1000);}throw new Error('OPERATION_WAIT_TIMEOUT');}
  async close(){if(this.context){await this.context.delete('/api/v1/auth/session',{headers:{'X-CSRF-Token':this.csrf}}).catch(()=>undefined);await this.context.dispose();this.context=null;}}
}
export async function recordCheck(name:string,details:Record<string,unknown>,passed=true){
  const database=createDatabase(loadRuntime().databaseUrl),id=randomUUID(),digest=await sourceDigest(process.cwd());const proof={id,name,profile:'LOCAL_FIXTURE',checkedAt:new Date().toISOString(),sourceDigest:digest,passed,details},content=JSON.stringify(proof),hash=sha256(content);
  // Generated verification artifacts stay private and out of Git. No credentials or raw logs are included.
  const directory=resolve('.local/operations-evidence');await mkdir(directory,{recursive:true,mode:0o700});await writeFile(resolve(directory,`${id}.json`),content,{flag:'wx',mode:0o600});
  try{const org=(await database.sql`select id from organizations order by id`);if(org.length!==1)throw new Error('HOST_ADMIN_REQUIRED');await database.sql`insert into operations_release_checks(id,organization_id,name,status,profile,source_digest,artifact_sha,details) values(${id},${org[0].id},${name},${passed?'PASS':'FAIL'},'LOCAL_FIXTURE',${digest},${hash},${database.sql.json(JSON.parse(JSON.stringify(details)))})`;}finally{await database.close();}console.log(JSON.stringify({check:name,status:passed?'PASS':'FAIL',artifactId:id,artifactSha:hash,sourceDigest:digest}));return proof;
}
