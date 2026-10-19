import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import type {WorkflowRun,SubscriptionState} from '../packages/agents/src/types.js';
import type {CompanyState,ProjectOperations,ReviewsState} from '../apps/web/app/ui/company-model.js';

// Explicit opt-in: two real fixture workflows and three bounded AI review calls.
// No result acceptance, review publication, integration dispatch or merge is performed.
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('.local/playwright');
const{chromium,expect}=await import('@playwright/test');
const browser=await chromium.launch({headless:true}),context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width:1440,height:1100}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
let csrf='',passed=false;const projects:{id:string;name:string}[]=[],createdTasks:{id:string;projectId:string}[]=[],runs:WorkflowRun[]=[];
const original='add(a,b)는 두 수를 더하고 sum(values)는 배열 합계를 반환하도록 오류를 고쳐 주세요. 양수·음수·빈 배열을 테스트하고 같은 후보의 테스트·빌드 결과를 검토해 주세요.';
async function api<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST',expected?:number):Promise<T>{
  const response=await page.request.fetch(`/api/v1${path}`,{method,headers:{Origin:'http://127.0.0.1:3000','X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},...(body===undefined?{}:{data:body})});
  const result=await response.json();assert(expected?response.status()===expected:response.ok(),`API ${path}: HTTP ${response.status()} ${result.error?.code??''}`);return result.data;
}
try{
  await page.goto('/');await page.getByLabel('Owner 비밀키',{exact:true}).fill(readFileSync(resolve('.local/owner-key'),'utf8').trim());await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();csrf=(await api<{csrfToken:string}>('/me')).csrfToken;
  const subscription=await api<SubscriptionState>('/subscription');assert(subscription.ready,`Subscription not ready: ${subscription.reason}`);
  const suffix=randomUUID().slice(0,6);
  let child:{id:string;version:number};
  if(process.argv[2]==='--review-existing'){
    const [projectA,projectB,runA,runB,childId]=process.argv.slice(3);for(const id of [projectA,projectB,runA,runB,childId])assert(/^[a-f0-9-]{36}$/.test(id??''),'Invalid existing smoke fixture ID');
    const available=await api<{id:string;name:string}[]>('/projects');for(const id of [projectA,projectB]){const p=available.find(p=>p.id===id);assert(p,'Existing smoke project missing');assert(p.name.startsWith('Phase 4 실제 검증 '),'Only this smoke fixture may be continued');projects.push(p);}
    for(const [i,id]of [runA,runB].entries()){const r=await api<WorkflowRun>(`/runs/${id}`);assert.equal(r.status,'WAITING_APPROVAL');createdTasks.push({id:r.taskId,projectId:projects[i].id});}
    child=await api(`/tasks/${childId}`);createdTasks.push({id:child.id,projectId:projects[0].id});
  }else{
  for(const name of ['A','B'])projects.push(await api('/projects',{name:`Phase 4 실제 검증 ${name} ${suffix}`,repositoryUrl:'https://github.com/Ina-dang/ai-pixel-company-integration-tests.git',defaultBranch:'fixture-base'}));
  for(const p of projects){const t=await api<{id:string;version:number}>(`/projects/${p.id}/tasks`,{title:`Phase 4 프로젝트 ${p===projects[0]?'A':'B'} 실제 코드·테스트 검증`,commandOriginalKo:original,acceptanceCriteria:[{id:'AC-1',descriptionKo:'덧셈·음수·배열 합계·빈 배열의 테스트와 빌드가 통과한다.',method:'unit-test',required:true}],priority:p===projects[0]?'URGENT':'HIGH'});createdTasks.push({...t,projectId:p.id});}
  child=await api<{id:string;version:number}>(`/projects/${projects[0].id}/tasks`,{title:'Phase 4 Owner 수락 전 실행 금지 후속 업무',commandOriginalKo:'선행 결과를 Owner가 수락한 뒤 실행하는 시험용 예약입니다.',acceptanceCriteria:[{id:'AC-1',descriptionKo:'선행 결과 수락 전에는 실행하지 않는다.',method:'manual',required:true}],priority:'LOW'});createdTasks.push({...child,projectId:projects[0].id});
  await api(`/projects/${projects[0].id}/dependencies/add`,{taskId:child.id,prerequisiteId:createdTasks[0].id,expectedTaskVersion:child.version},'POST',200);
  for(const t of createdTasks){const current=await api<{version:number}>(`/tasks/${t.id}`);await api(`/projects/${t.projectId}/tasks/${t.id}/schedule`,{enabled:true,expectedTaskVersion:current.version},'POST',200);}
  }
  console.log(JSON.stringify({phase:'QUEUED',projects:projects.map(p=>p.id),tasks:createdTasks.map(t=>t.id),subscriptionReady:true,paidFallback:false}));
  const deadline=Date.now()+900000,observed=new Set<string>();let maxRunning=0;
  while(Date.now()<deadline){
    runs.length=0;for(const t of createdTasks.slice(0,2)){const list=await api<{items:WorkflowRun[]}>(`/tasks/${t.id}/runs`);if(list.items[0])runs.push(await api<WorkflowRun>(`/runs/${list.items[0].id}`));}
    const company=await api<CompanyState>('/company');const running=company.projects.reduce((n,p)=>n+p.runningCount,0);maxRunning=Math.max(maxRunning,running);assert(running<=1,'Shared subscription slot exceeded');
    for(const r of runs){const marker=`${r.taskId}:${r.status}:${r.checkpoint.stage}`;if(!observed.has(marker)){observed.add(marker);console.log(JSON.stringify({phase:'WORKFLOW',runId:r.id,state:`${r.status}:${r.checkpoint.stage}`}));}assert(!['FAILED','BLOCKED','CANCELLED'].includes(r.status),`Workflow ${r.id} stopped: ${r.checkpoint.stopReason}`);}
    if(runs.length===2&&runs.every(r=>r.status==='WAITING_APPROVAL'))break;await sleep(1200);
  }
  assert.equal(runs.length,2);assert(runs.every(r=>r.status==='WAITING_APPROVAL'),'Workflows did not reach verified approval wait');if(process.argv[2]!=='--review-existing')assert.equal(maxRunning,1);
  for(const r of runs){assert.equal(r.checkpoint.verification?.test.exitCode,0);assert.equal(r.checkpoint.verification?.build.exitCode,0);const qa=r.checkpoint.roles.filter(role=>role.role==='QA').at(-1);assert.equal(qa?.output.verdict,'PASS');assert.equal(qa?.candidateSha,r.checkpoint.verification?.sha);assert(r.checkpoint.roles.some(role=>role.role==='DEVELOPER'&&role.output.files.length>0));assert.deepEqual(new Set(r.checkpoint.roles.map(role=>role.role)),new Set(['PM','DEVELOPER','QA']));}
  const childRuns=await api<{items:WorkflowRun[]}>(`/tasks/${child.id}/runs`);assert.equal(childRuns.items.length,0);const ops=await api<ProjectOperations>(`/projects/${projects[0].id}/operations`);assert.equal(ops.schedules.find(s=>s.taskId===child.id)?.reason,'DEPENDENCY');
  // Stop this test-only pending intent so a future business acceptance cannot trigger it.
  const childNow=await api<{version:number}>(`/tasks/${child.id}`);await api(`/projects/${projects[0].id}/tasks/${child.id}/schedule`,{enabled:false,expectedTaskVersion:childNow.version},'POST',200);
  const target=runs[0],staff=target.staffing??[],subject=staff.find(s=>s.role==='DEVELOPER'),pm=staff.find(s=>s.role==='PM'),qa=staff.find(s=>s.role==='QA');assert(subject&&pm&&qa,'Pinned staffing missing');
  const existing=await api<ReviewsState>(`/projects/${projects[0].id}/reviews`);
  if(process.argv[2]!=='--review-existing'||existing.items.length===0){for(const type of ['AUTO','USER','SELF','PEER','PM'])await api(`/projects/${projects[0].id}/reviews`,{runId:target.id,subjectEmployeeId:subject.employeeId,type,...(type==='USER'?{originalKo:'Phase 4 통합 시험용 Owner 입력입니다. 실제 결과 수락 전이므로 의견 점수는 미산정으로 남깁니다.',scores:{accuracy:null,quality:null,collaboration:null,efficiency:null}}:{}),...(['SELF','PEER','PM'].includes(type)?{reviewerEmployeeId:type==='SELF'?subject.employeeId:type==='PEER'?qa.employeeId:pm.employeeId}:{})});}
  else assert(existing.items.length===5&&existing.items.every(item=>item.runId===target.id),'Existing smoke opinions do not match the pinned run');
  let reviews:ReviewsState|null=null;const reviewDeadline=Date.now()+600000;
  while(Date.now()<reviewDeadline){reviews=await api<ReviewsState>(`/projects/${projects[0].id}/reviews`);assert(!reviews.items.some(r=>['INVALID','UNKNOWN'].includes(r.status)),'AI review failed or stop uncertain');if(reviews.items.length===5&&reviews.items.every(r=>r.revisions.length===1))break;await sleep(1500);}
  assert(reviews&&reviews.items.length===5&&reviews.items.every(r=>r.revisions.length===1),'Five review types not completed');assert(reviews.items.every(r=>r.status==='DRAFT'),'AI/Owner drafts were automatically published');
  for(const item of reviews.items){assert.equal(item.revisions[0].evidence.candidateSha,target.checkpoint.verification?.sha);assert(item.revisions[0].flags.includes('RESULT_NOT_FINAL'));if(['SELF','PEER','PM'].includes(item.type)){assert.equal(item.generationCount,1);assert(item.jobs.every(j=>j.status==='SUCCEEDED'));assert(item.revisions[0].flags.includes('SAME_MODEL'));}}
  const otherReviews=await api<ReviewsState>(`/projects/${projects[1].id}/reviews`);assert.equal(otherReviews.items.length,0);assert(otherReviews.contexts.every(c=>c.runId!==target.id));
  const totals=await api<CompanyState>('/company');for(const p of projects)assert(Number(totals.usage.find(u=>u.projectId===p.id)?.spentTokens)>0);
  await page.reload();await page.getByLabel('현재 프로젝트',{exact:true}).selectOption(projects[0].id);await page.getByRole('tab',{name:'회사 운영',exact:true}).click();await expect(page.getByRole('heading',{name:'프로젝트 전체 현황'})).toBeVisible();await page.getByLabel('프로젝트 이름·저장소 검색',{exact:true}).fill('Phase 4 실제 검증');mkdirSync(resolve('test-results'),{recursive:true});await page.getByRole('region',{name:'회사와 프로젝트 운영'}).screenshot({path:resolve('test-results/phase4-company-live.png')});
  await page.getByRole('tab',{name:'직원 평가',exact:true}).click();await expect(page.locator('.review-card')).toHaveCount(5);await expect(page.getByRole('button',{name:'검토한 의견 게시'}).first()).toBeDisabled();await page.getByRole('region',{name:'직원 평가와 근거'}).screenshot({path:resolve('test-results/phase4-reviews-live.png')});
  await page.getByRole('button',{name:'자동 지표',exact:true}).click();await expect(page.locator('.review-card')).toHaveCount(1);await page.getByRole('region',{name:'직원 평가와 근거'}).screenshot({path:resolve('test-results/phase4-review-preview.png')});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow');await page.getByRole('region',{name:'직원 평가와 근거'}).screenshot({path:resolve('test-results/phase4-reviews-mobile.png')});assert.deepEqual(errors,[]);
  passed=true;console.log(JSON.stringify({verified:true,projects:projects.map(p=>p.id),runs:runs.map(r=>({id:r.id,status:r.status,candidateSha:r.checkpoint.verification?.sha,roles:r.checkpoint.roles.map(role=>role.role),usage:r.checkpoint.usage})),reviewTypes:reviews.items.map(r=>({type:r.type,status:r.status,score:r.revisions[0].score,generations:r.generationCount})),sharedMaxRunning:process.argv[2]==='--review-existing'?null:maxRunning,dependentRuns:0,testIntentDisabled:true,ownerAcceptance:'PENDING',mergeExecuted:false,browserErrors:errors.length,mobile:390,usage:totals.usage.filter(u=>projects.some(p=>p.id===u.projectId))}));
}catch(error){console.log(JSON.stringify({verified:false,error:(error instanceof Error?error.message:String(error)).replaceAll(readFileSync(resolve('.local/owner-key'),'utf8').trim(),'[REDACTED]').slice(0,2500),projects:projects.map(p=>p.id),runs:runs.map(r=>r.id),browserErrors:errors}));process.exitCode=1;
}finally{
  if(!passed){
    // Remove every pending intent before releasing an active workflow's shared slot.
    for(const t of createdTasks){try{const current=await api<{version:number}>(`/tasks/${t.id}`);await api(`/projects/${t.projectId}/tasks/${t.id}/schedule`,{enabled:false,expectedTaskVersion:current.version},'POST',200);}catch{/* Continue cleanup for the other fixture tasks. */}}
    for(const t of createdTasks){try{const list=await api<{items:WorkflowRun[]}>(`/tasks/${t.id}/runs`);for(const r of list.items)if(['QUEUED','RUNNING','PAUSED','BLOCKED'].includes(r.status))await api(`/runs/${r.id}/control`,{action:'cancel',expectedVersion:r.version});}catch{/* Existing worker independently enforces all limits. */}}
  }
  if(csrf)await api('/auth/session',{},'DELETE').catch(()=>undefined);await context.close();await browser.close();
}
