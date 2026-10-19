import { createHash,randomUUID } from 'node:crypto';
import {createDatabase,migrateDatabase} from '@ai-pixel/db';
import {hash} from '@node-rs/argon2';
import {beforeAll,beforeEach,afterAll,describe,test,expect} from 'vitest';
import {createApp,initializeOwner} from '../apps/api/src/app.js';
import {WorkflowRepository} from '../apps/api/src/workflows.js';
import {ReviewService} from '../apps/api/src/reviews.js';
import {settleExecution,sharedSlotAvailable} from '../apps/api/src/execution-policy.js';
import {lockOrganization} from '../apps/api/src/repository.js';
import {initialCheckpoint,ExecutionBlocked,type AgentProvider,type Checkpoint,type StaffingProfile} from '../packages/agents/src/types.js';
import {reviewTotal} from '../apps/api/src/review-evidence.js';

const ORG='11111111-1111-4111-8111-111111111111',USER='22222222-2222-4222-8222-222222222222',ORIGIN='http://127.0.0.1:3000',SECRET='phase4-controlled-owner-test';
const url=process.env.TEST_DATABASE_URL;
if(!url||!/(?:^|[_-])test(?:$|[_-])/.test(decodeURIComponent(new URL(url).pathname.slice(1)))||url===process.env.DATABASE_URL)throw new Error('Phase4 tests require isolated test database');
const database=createDatabase(url),repository=new WorkflowRepository(database),SHA=createHash('sha256').update('controlled candidate').digest('hex');
let app:ReturnType<typeof createApp>,reviews:ReviewService,secretHash='',cookie='',csrf='',projectId='',calls=0,ready=true,mode='valid';
const scores={accuracy:80,quality:90,collaboration:70,efficiency:60};
const provider:AgentProvider={status:async()=>({ready,reason:ready?null:'SUBSCRIPTION_LIMIT',authMode:'chatgpt',billingMode:'CHATGPT_SUBSCRIPTION',windows:[],checkedAt:new Date().toISOString()}),close:async()=>undefined,
  run:async input=>{calls++;await input.onStarted(`controlled-review-${randomUUID()}`,null);const evidence=JSON.parse(input.prompt.split('\nEvidence: ')[1]);
    if(mode==='stop')throw new ExecutionBlocked('STOP_UNVERIFIABLE');
    if(mode==='revoke-stop'){await database.sql`update memberships set status='REVOKED' where organization_id=${ORG} and user_id=${USER}`;await new Promise(done=>setTimeout(done,2300));throw new ExecutionBlocked('STOP_UNVERIFIABLE');}
    if(mode==='revoke')await database.sql`update memberships set status='REVOKED' where organization_id=${ORG} and user_id=${USER}`;
    if(mode==='stale')await database.sql`update workflow_runs set version=version+1 where id=${evidence.refs[0].split(':')[1]}`;
    return{role:input.role,threadId:'controlled-review-thread',turnId:null,candidateSha:SHA,completedAt:new Date().toISOString(),usage:{inputTokens:20,cachedInputTokens:0,outputTokens:10},
      output:{summaryKo:'실행 근거를 확인한 의견입니다.',specEn:JSON.stringify({scores:mode==='high'?{accuracy:99,quality:99,collaboration:99,efficiency:99}:mode==='bad-score'?{...scores,accuracy:101}:scores,bodyEn:'Opinion based on the supplied immutable execution evidence; no objective ranking.',summaryKo:'실제 근거에 기반한 제한된 의견입니다.',evidenceRefs:mode==='bad-ref'?['fabricated-evidence']:evidence.refs}),
        acceptanceCriteria:[],files:mode==='files'?[{path:'src/forbidden.ts',content:'not applied'}]:[],verdict:'NA',candidateSha:mode==='bad-sha'?'f'.repeat(64):SHA,issues:[]}};
  }};
async function request(path:string,body?:unknown,headers:Record<string,string>={}){return app.request(`http://127.0.0.1:3001/api/v1${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:ORIGIN,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID(),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function ok(path:string,body?:unknown,expected=body===undefined?200:201){const response=await request(path,body);const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(expected);return result.data;}
async function project(){return ok('/projects',{name:`회사 검증 ${randomUUID().slice(0,6)}`,repositoryUrl:'https://github.com/Ina-dang/ai-pixel-company-integration-tests.git',defaultBranch:'fixture-base'});}
async function task(project=projectId,priority='MEDIUM'){return ok(`/projects/${project}/tasks`,{title:`근거 업무 ${randomUUID().slice(0,6)}`,commandOriginalKo:'한국어 원문을 보존하고 검증해 주세요.',acceptanceCriteria:[{id:'AC-1',descriptionKo:'검증 근거를 확인한다',method:'unit-test',required:true}],priority});}
async function queued(project=projectId,priority='MEDIUM'){const t=await task(project,priority);const r=await ok(`/tasks/${t.id}/runs`,{fixture:'node-functions-v1'});return{task:t,run:r};}
async function complete(status:'SUCCEEDED'|'WAITING_APPROVAL'|'FAILED'='SUCCEEDED',project=projectId){
  const seed=await queued(project),runId=seed.run.id,now=new Date().toISOString(),staff=seed.run.staffing as StaffingProfile[];
  const checkpoint:Checkpoint={...initialCheckpoint(),stage:'QA',startedAt:new Date(Date.now()-1000).toISOString(),turns:3,usage:{inputTokens:150,cachedInputTokens:0,outputTokens:30},
    workspace:{sha:SHA,diff:'+ actual fixture change',files:[{path:'src/math.mjs',content:'export const add=(a,b)=>a+b;'}]},
    verification:{sha:SHA,test:{exitCode:status==='FAILED'?1:0,output:'controlled test evidence'},build:{exitCode:0,output:'controlled build evidence'},sandbox:{networkDisabled:true,readOnlyRoot:true,resourceLimited:true},verifiedAt:now},
    roles:(['PM','DEVELOPER','QA'] as const).map(role=>({role,threadId:`controlled-${role}`,turnId:null,candidateSha:role==='PM'?null:SHA,completedAt:now,usage:{inputTokens:50,cachedInputTokens:0,outputTokens:10},output:{summaryKo:'검증 근거입니다.',specEn:'Implement the accepted fixture requirements.',acceptanceCriteria:[{id:'AC-1',description:'Verify evidence'}],files:role==='DEVELOPER'?[{path:'src/math.mjs',content:'export const add=(a,b)=>a+b;'}]:[],verdict:role==='QA'?status==='FAILED'?'FAIL':'PASS':'NA',candidateSha:role==='PM'?'':SHA,issues:status==='FAILED'&&role==='QA'?['Observed test failure']:[]}}))};
  await database.sql.begin(async tx=>{await lockOrganization(tx,ORG);await tx`update workflow_runs set status=${status},checkpoint=${tx.json(JSON.parse(JSON.stringify(checkpoint)))},version=version+1 where id=${runId}`;
    await tx`update tasks set status=${status==='SUCCEEDED'?'COMPLETED':status==='FAILED'?'FAILED':'APPROVAL_REQUIRED'},version=version+1 where id=${seed.task.id}`;await settleExecution(tx,ORG,runId,180,'SETTLED');});
  const subject=staff.find(s=>s.role==='DEVELOPER'),pm=staff.find(s=>s.role==='PM'),qa=staff.find(s=>s.role==='QA');
  if(!subject||!pm||!qa)throw new Error('Controlled fixture requires all three pinned staff');
  return{...seed,staff,runId,subject,pm,qa};
}
async function list(){return ok(`/projects/${projectId}/reviews`);}
async function createReview(seed:Awaited<ReturnType<typeof complete>>,type:string,extra:Record<string,unknown>={}){return ok(`/projects/${projectId}/reviews`,{runId:seed.runId,subjectEmployeeId:seed.subject.employeeId,type,...extra},['SELF','PEER','PM'].includes(type)?202:201);}
beforeAll(async()=>{await migrateDatabase(database);secretHash=await hash(SECRET);});
beforeEach(async()=>{
  await database.sql`truncate organizations,users cascade`;await initializeOwner(database);calls=0;ready=true;mode='valid';reviews=new ReviewService(database,provider);
  app=createApp({database,workflowProvider:provider,reviews,config:{appOrigin:ORIGIN,bootstrapSecretHash:secretHash,sessionTtlSeconds:3600,cookieSecure:false,ssePollMs:10,sseHeartbeatMs:100,sseBatchSize:1000,sseRetentionDays:30,loginMaxAttempts:100,loginWindowMs:60000}});
  const login=await app.request('http://127.0.0.1:3001/api/v1/auth/session',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({secret:SECRET})});expect(login.status).toBe(200);csrf=(await login.json()).data.csrfToken;cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');projectId=(await project()).id;
});
afterAll(async()=>{await reviews.stop();await database.close();});

describe('Phase4 evidence-separated performance reviews',()=>{
  test('rubric calculation is versioned and missing values are not zero-imputed',()=>{expect(reviewTotal(scores)).toBe(77);expect(reviewTotal({...scores,quality:null})).toBeNull();});
  test('AUTO retains objective facts, null score and nullable cost without calling a model',async()=>{const seed=await complete();await createReview(seed,'AUTO');const r=(await list()).items[0];expect(r.type).toBe('AUTO');expect(r.revisions[0]).toMatchObject({score:null,scores:null,metrics:{completedResponseTokens:60,testPass:true,ownerAccepted:true,actualCost:null}});expect(calls).toBe(0);
    expect((await request(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version,action:'CONFIRM',originalKo:'지표 확인'})).status).toBe(409);});
  test('USER original/score/evidence and one revision survive immutable history and Owner publication',async()=>{const seed=await complete(),original='  원문 평가\n공백을 보존해 주세요.  ';const r=await createReview(seed,'USER',{scores,originalKo:original,summaryKo:'근거 기반 의견'});
    const published=await ok(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version,action:'CONFIRM',originalKo:'근거와 의견을 구분해 확인했습니다.'},200);expect(published.status).toBe('PUBLISHED');
    let listed=(await list());expect(listed.items[0].revisions[0].originalKo).toBe(original);expect(listed.items[0].revisions[0].score).toBe(77);expect(listed.aggregates[0]).toMatchObject({sampleCount:1,meanScore:null,reason:'SMALL_SAMPLE'});
    const revised=await ok(`/projects/${projectId}/reviews/${r.id}/revise`,{expectedVersion:published.version,scores:{...scores,accuracy:null},originalKo:'추가 근거가 필요함',summaryKo:'미산정 항목 포함'},200);expect(revised.status).toBe('DRAFT');listed=await list();expect(listed.items[0].revisions).toHaveLength(2);expect(listed.items[0].revisions[0].originalKo).toBe(original);expect(listed.items[0].revisions[1].score).toBeNull();
    expect((await request(`/projects/${projectId}/reviews/${r.id}/revise`,{expectedVersion:revised.version,scores,originalKo:'세 번째',summaryKo:'금지'})).status).toBe(409);
    await expect(database.sql`update performance_review_revisions set summary_ko='changed' where review_id=${r.id}`).rejects.toThrow();
  });
  test.each(['SELF','PEER','PM'])('%s runs one bounded provider call, remains DRAFT and records same-model bias',async type=>{const seed=await complete();const reviewer=type==='SELF'?seed.subject.employeeId:type==='PM'?seed.pm.employeeId:seed.qa.employeeId;
    const created=await createReview(seed,type,{reviewerEmployeeId:reviewer});expect(created.status).toBe('QUEUED');expect(calls).toBe(0);expect(await reviews.processOnce()).toBe(true);
    const r=(await list()).items[0];expect(r).toMatchObject({type,status:'DRAFT',generationCount:1,revisionCount:1});expect(r.revisions[0].flags).toContain('SAME_MODEL');expect(r.revisions[0].score).toBe(77);expect(calls).toBe(1);
    await ok(`/projects/${projectId}/reviews/${r.id}/regenerate`,{expectedVersion:r.version},202);await reviews.processOnce();const updated=(await list()).items[0];expect(updated.revisions).toHaveLength(2);expect((await request(`/projects/${projectId}/reviews/${r.id}/regenerate`,{expectedVersion:updated.version})).status).toBe(409);expect(calls).toBe(2);
  });
  test.each(['bad-score','bad-ref','bad-sha','files','stale','revoke'])('invalid AI outcome %s cannot become a score or publication',async failure=>{const seed=await complete();await createReview(seed,'PEER',{reviewerEmployeeId:seed.qa.employeeId});mode=failure;await reviews.processOnce();const rows=await database.sql`select status,revision_count from performance_reviews`;expect(rows[0]).toMatchObject({status:'INVALID',revision_count:0});expect(await database.sql`select id from performance_review_jobs where status='FAILED'`).toHaveLength(1);});
  test('reviewer shape, forged automatic scores, stale versions and duplicate opinions are refused',async()=>{const seed=await complete();
    for(const value of [{type:'SELF',reviewerEmployeeId:seed.qa.employeeId},{type:'PEER',reviewerEmployeeId:seed.subject.employeeId},{type:'PM',reviewerEmployeeId:seed.subject.employeeId},{type:'AUTO',scores}])expect((await request(`/projects/${projectId}/reviews`,{runId:seed.runId,subjectEmployeeId:seed.subject.employeeId,...value})).status).toBeGreaterThanOrEqual(400);
    const r=await createReview(seed,'USER',{scores,originalKo:'근거 의견'});expect((await request(`/projects/${projectId}/reviews`,{runId:seed.runId,subjectEmployeeId:seed.subject.employeeId,type:'USER',scores,originalKo:'중복'})).status).toBe(409);
    expect((await request(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version-1,action:'CONFIRM',originalKo:'오래된 버전'})).status).toBe(409);
  });
  test('missing evidence and unaccepted result cannot publish; changing source invalidates a published opinion',async()=>{const seed=await complete('WAITING_APPROVAL');let r=await createReview(seed,'USER',{scores,originalKo:'대기 중 의견'});
    expect((await request(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version,action:'CONFIRM',originalKo:'근거 검토'})).status).toBe(409);
    await database.sql`update workflow_runs set status='SUCCEEDED',version=version+1 where id=${seed.runId}`;
    r=await ok(`/projects/${projectId}/reviews/${r.id}/revise`,{expectedVersion:r.version,scores,originalKo:'수락 후 수정',summaryKo:'최신 근거'},200);
    await ok(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version,action:'CONFIRM',originalKo:'최신 근거 확인'},200);
    await database.sql`update workflow_runs set version=version+1 where id=${seed.runId}`;const data=await list();expect(data.items[0]).toMatchObject({status:'NEEDS_REVIEW',evidenceCurrent:false});expect(data.aggregates).toHaveLength(0);
  });
  test('scores without local verification stay unpublishable and database rejects evidence-free publication',async()=>{const seed=await complete();await database.sql`update workflow_runs set checkpoint=jsonb_set(checkpoint,'{verification}','null') where id=${seed.runId}`;const r=await createReview(seed,'USER',{scores,originalKo:'근거 미실행'});expect((await list()).items[0].revisions[0].flags).toContain('EVIDENCE_INCOMPLETE');expect((await request(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version,action:'CONFIRM',originalKo:'확인'})).status).toBe(409);
    const auto=await createReview(seed,'AUTO');await expect(database.sql`update performance_reviews set status='PUBLISHED' where id=${auto.id}`).rejects.toThrow();
  });
  test('database publication rejects an absent required evidence field instead of accepting SQL NULL',async()=>{const seed=await complete(),r=await createReview(seed,'USER',{scores,originalKo:'게시 근거 필드 시험'});
    await expect(database.sql.begin(async tx=>{await tx`insert into performance_review_revisions(organization_id,review_id,revision,scores,weights,score,body_en,original_ko,summary_ko,evidence,evidence_hash,metrics,flags) select organization_id,review_id,2,scores,weights,score,body_en,original_ko,summary_ko,evidence-'runId',evidence_hash,metrics,flags from performance_review_revisions where review_id=${r.id} and revision=1`;await tx`update performance_reviews set revision_count=2,status='PUBLISHED' where id=${r.id}`;})).rejects.toMatchObject({code:'23514'});
    expect((await list()).items[0]).toMatchObject({status:'DRAFT',revisionCount:1});
  });
  test('failed work remains in facts; reciprocal high scores flag review without changing employment/permissions',async()=>{const seed=await complete('FAILED');mode='high';await createReview(seed,'PEER',{reviewerEmployeeId:seed.qa.employeeId});await reviews.processOnce();
    await ok(`/projects/${projectId}/reviews`,{runId:seed.runId,subjectEmployeeId:seed.qa.employeeId,type:'PEER',reviewerEmployeeId:seed.subject.employeeId},202);await reviews.processOnce();const data=await list();expect(data.items).toHaveLength(2);expect(data.items.every((r:{revisions:{flags:string[];metrics:{taskFailed:boolean}}[]})=>r.revisions[0].flags.includes('RECIPROCAL_HIGH_WITH_LOW_QUALITY')&&r.revisions[0].metrics.taskFailed)).toBe(true);
    expect((await database.sql`select employment_status from employees where id=${seed.subject.employeeId}`)[0].employment_status).toBe('ACTIVE');
  });
  test('provider quota after enqueue stops without retry or paid fallback; unconfirmed stop fences the shared slot',async()=>{const seed=await complete();await createReview(seed,'SELF',{reviewerEmployeeId:seed.subject.employeeId});ready=false;await reviews.processOnce();expect(calls).toBe(0);expect(await reviews.processOnce()).toBe(false);
    ready=true;const row=(await list()).items[0];await ok(`/projects/${projectId}/reviews/${row.id}/regenerate`,{expectedVersion:row.version},202);mode='stop';await reviews.processOnce();expect((await list()).items[0].status).toBe('UNKNOWN');expect(await database.sql.begin(tx=>sharedSlotAvailable(tx))).toBe(false);
  });
  test('project/tenant scope, session revocation and CSRF protect all review decisions',async()=>{const seed=await complete(),other=await project();expect((await request(`/projects/${other.id}/reviews`,{runId:seed.runId,subjectEmployeeId:seed.subject.employeeId,type:'AUTO'})).status).toBe(404);
    const r=await createReview(seed,'USER',{scores,originalKo:'권한 테스트'});expect((await request(`/projects/${projectId}/reviews/${r.id}/decision`,{expectedVersion:r.version,action:'CONFIRM',originalKo:'검토'},{'X-CSRF-Token':'invalid'})).status).toBe(403);
    await database.sql`update sessions set revoked_at=now() where user_id=${USER}`;expect((await request(`/projects/${projectId}/reviews`)).status).toBe(401);
  });
  test('an unconfirmed provider stop remains UNKNOWN even after an authority heartbeat already aborted the review',async()=>{const seed=await complete();await createReview(seed,'SELF',{reviewerEmployeeId:seed.subject.employeeId});mode='revoke-stop';await reviews.processOnce();const jobs=await database.sql`select status,error_code from performance_review_jobs`;expect(jobs[0]).toMatchObject({status:'UNKNOWN',error_code:'STOP_UNVERIFIABLE'});expect(await database.sql.begin(tx=>sharedSlotAvailable(tx))).toBe(false);});
});

describe('Phase4 project scopes, graph and shared execution budgets',()=>{
  test('dependency-blocked reservations beyond a former scan limit cannot starve later eligible work',async()=>{const prerequisite=await task();
    for(let index=0;index<31;index++){const child=await task(projectId,'URGENT');await ok(`/projects/${projectId}/dependencies/add`,{taskId:child.id,prerequisiteId:prerequisite.id,expectedTaskVersion:child.version},200);const current=await ok(`/tasks/${child.id}`);await ok(`/projects/${projectId}/tasks/${child.id}/schedule`,{enabled:true,expectedTaskVersion:current.version},200);}
    const readyTask=await task(projectId,'LOW');await ok(`/projects/${projectId}/tasks/${readyTask.id}/schedule`,{enabled:true,expectedTaskVersion:readyTask.version},200);const claimed=await repository.claim();expect(claimed?.taskId).toBe(readyTask.id);expect((await database.sql`select count(*)::int n from workflow_runs`)[0].n).toBe(1);
  });
  test('same-project DAG blocks self/cycle/cross-project edges and preserves TODO until prerequisites are accepted',async()=>{const a=await task(),b=await task(),c=await task(),other=await project(),foreign=await task(other.id);
    await ok(`/projects/${projectId}/dependencies/add`,{taskId:b.id,prerequisiteId:a.id,expectedTaskVersion:1},200);await ok(`/projects/${projectId}/dependencies/add`,{taskId:c.id,prerequisiteId:b.id,expectedTaskVersion:1},200);
    expect((await request(`/projects/${projectId}/dependencies/add`,{taskId:a.id,prerequisiteId:c.id,expectedTaskVersion:1})).status).toBe(409);
    expect((await request(`/projects/${projectId}/dependencies/add`,{taskId:a.id,prerequisiteId:a.id,expectedTaskVersion:1})).status).toBe(409);
    expect((await request(`/projects/${projectId}/dependencies/add`,{taskId:a.id,prerequisiteId:foreign.id,expectedTaskVersion:1})).status).toBe(404);
    expect((await request(`/tasks/${b.id}/runs`,{fixture:'node-functions-v1'})).status).toBe(409);expect(await database.sql`select id from workflow_runs where task_id=${b.id}`).toHaveLength(0);
    const data=await ok(`/projects/${projectId}/operations`);expect(data.tasks.find((t:{id:string})=>t.id===b.id)).toMatchObject({status:'TODO',blockedReason:'DEPENDENCY'});
    await expect(database.sql`insert into task_dependencies(organization_id,project_id,task_id,prerequisite_id,created_by) values(${ORG},${projectId},${a.id},${c.id},${USER})`).rejects.toThrow();
  });
  test('concurrent reverse edges serialize under project lock and permit only one direction',async()=>{const a=await task(),b=await task();const responses=await Promise.all([request(`/projects/${projectId}/dependencies/add`,{taskId:a.id,prerequisiteId:b.id,expectedTaskVersion:1}),request(`/projects/${projectId}/dependencies/add`,{taskId:b.id,prerequisiteId:a.id,expectedTaskVersion:1})]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);expect(await database.sql`select * from task_dependencies`).toHaveLength(1);});
  test('only explicitly enrolled ready work enters the queue; failure/approval wait does not satisfy dependencies',async()=>{const parent=await task(),child=await task();await ok(`/projects/${projectId}/dependencies/add`,{taskId:child.id,prerequisiteId:parent.id,expectedTaskVersion:1},200);
    await ok(`/projects/${projectId}/tasks/${child.id}/schedule`,{enabled:true,expectedTaskVersion:2},200);expect(await repository.claim()).toBeNull();expect(await database.sql`select id from workflow_runs`).toHaveLength(0);
    await database.sql`update tasks set status='FAILED' where id=${parent.id}`;expect(await repository.claim()).toBeNull();await database.sql`update tasks set status='APPROVAL_REQUIRED' where id=${parent.id}`;expect(await repository.claim()).toBeNull();
    await database.sql`update tasks set status='COMPLETED' where id=${parent.id}`;const claimed=await repository.claim();expect(claimed?.taskId).toBe(child.id);expect(await repository.claim()).toBeNull();
    const schedule=(await ok(`/projects/${projectId}/operations`)).schedules[0];expect(schedule).toMatchObject({enabled:false,runId:claimed?.id});
  });
  test('priority then FIFO chooses urgent work across projects while sharing the one global slot',async()=>{const low=await queued(),other=await project(),urgent=await queued(other.id,'URGENT');
    const first=await repository.claim();expect(first?.id).toBe(urgent.run.id);expect(await repository.claim()).toBeNull();
    if(!first?.leaseToken)throw new Error('Expected lease');await repository.save(first.id,first.leaseToken,{status:'FAILED'});expect((await repository.claim())?.id).toBe(low.run.id);
  });
  test('parallel monthly reservation cannot exceed organization/project tokens and settlement releases unused allowance',async()=>{
    await ok('/company/policy',{monthlyTokens:600000,runTokens:500000,expectedVersion:0},200);
    const first=await queued();const secondTask=await task();expect((await request(`/tasks/${secondTask.id}/runs`,{fixture:'node-functions-v1'})).status).toBe(409);
    const claim=await repository.claim();if(!claim?.leaseToken)throw new Error('Expected lease');await repository.save(first.run.id,claim.leaseToken,{status:'FAILED',checkpoint:{...initialCheckpoint(),usage:{inputTokens:100,cachedInputTokens:0,outputTokens:20}}});
    expect((await request(`/tasks/${secondTask.id}/runs`,{fixture:'node-functions-v1'})).status).toBe(201);const company=await ok('/company');expect(company.usage[0]).toMatchObject({spentTokens:'120',heldTokens:'500000'});expect(company.actualCost).toBeNull();
  });
  test('policy tightening fences a queued run and rechecks at the role execution boundary',async()=>{const seed=await queued();await ok(`/projects/${projectId}/execution-policy`,{expectedVersion:0,monthlyTokens:1000,runTokens:1000},200);
    const claim=await repository.claim();expect(claim).not.toBeNull();if(!claim?.leaseToken)throw new Error('Expected lease');
    const checkpoint={...initialCheckpoint(),usage:{inputTokens:1000,cachedInputTokens:0,outputTokens:1}};await repository.save(seed.run.id,claim.leaseToken,{checkpoint});
    await expect(repository.authorizeRole(seed.run.id,'DEVELOPER',['EDIT_FILES'])).rejects.toThrow('TOKEN_LIMIT');
  });
  test('project archive blocks new work, rejects unresolved work, and leaves independent integration scope/history intact',async()=>{const other=await project();await ok(`/projects/${other.id}/lifecycle`,{action:'archive',expectedVersion:1},200);const t=await task();await queued();expect((await request(`/projects/${projectId}/lifecycle`,{action:'archive',expectedVersion:1})).status).toBe(409);
    expect((await request(`/projects/${other.id}/tasks`,{title:'금지',commandOriginalKo:'보관한 프로젝트',acceptanceCriteria:[{id:'AC-1',descriptionKo:'차단',method:'manual',required:true}]})).status).toBeGreaterThanOrEqual(400);
    const overview=await ok('/company');expect(overview.projects.find((p:{id:string})=>p.id===other.id).status).toBe('ARCHIVED');expect((await ok(`/projects/${projectId}/operations`)).tasks.some((r:{id:string})=>r.id===t.id)).toBe(true);
  });
  test('department transfer creates immutable profiles; retirement and rehire preserve review/task/usage evidence',async()=>{const seed=await complete(),review=await createReview(seed,'AUTO'),d=await ok('/departments',{nameKo:'검증 부서'});const employee=(await ok(`/employees/${seed.subject.employeeId}`));
    await ok(`/employees/${employee.id}/department`,{departmentId:d.id,expectedVersion:employee.version},200);expect((await ok(`/runs/${seed.runId}`)).staffing.find((p:StaffingProfile)=>p.employeeId===employee.id).profileVersion).toBe(1);
    expect((await request(`/departments/${d.id}/archive`,{expectedVersion:1})).status).toBe(409);const current=await ok(`/employees/${employee.id}`);
    await ok(`/employees/${employee.id}/employment`,{action:'retire',expectedVersion:current.version},200);expect((await list()).items[0].id).toBe(review.id);expect((await list()).items[0].evidenceCurrent).toBe(true);
    const retired=await ok(`/employees/${employee.id}`);await ok(`/employees/${employee.id}/employment`,{action:'rehire',expectedVersion:retired.version},200);expect((await ok(`/employees/${employee.id}`)).employmentHistory.length).toBeGreaterThan(2);
    expect(await database.sql`select id from workflow_runs where id=${seed.runId}`).toHaveLength(1);expect(await database.sql`select * from execution_allowances where operation_id=${seed.runId}`).toHaveLength(1);
  });
  test('cross-project schedule and invalid identifiers never mutate another project',async()=>{const other=await project(),foreign=await task(other.id);expect((await request(`/projects/${projectId}/tasks/${foreign.id}/schedule`,{enabled:true,expectedTaskVersion:1})).status).toBe(404);
    expect((await request('/projects/not-a-uuid/operations')).status).toBe(404);expect((await request('/departments/not-a-uuid/archive',{expectedVersion:1})).status).toBe(404);expect(await database.sql`select * from task_schedules`).toHaveLength(0);
  });
});
