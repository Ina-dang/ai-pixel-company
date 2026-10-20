import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';
import { sourceDigest, sha256 } from '../apps/api/src/operations-model.js';

process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('.local/playwright');
const {chromium,expect}=await import('@playwright/test');
const runtime=loadRuntime(),base=runtime.appOrigin,db=createDatabase(runtime.databaseUrl),browser=await chromium.launch({headless:true}),context=await browser.newContext({baseURL:base,viewport:{width:1440,height:1100}}),page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let csrf='';
try {
  const live=JSON.parse(await readFile(resolve('.local/voice-evidence/live.json'),'utf8')) as {projectId:string};
  const login=await page.request.post('/api/v1/auth/session',{headers:{Origin:base},data:{secret:(await readFile(resolve('.local/owner-key'),'utf8')).trim()}});assert.equal(login.status(),200);csrf=(await login.json()).data.csrfToken;
  const fixtureProject=(await db.sql`select name,status,version from projects where id=${live.projectId}`)[0];assert.equal(fixtureProject.name,'Phase 5 로컬 음성 검증');
  if(fixtureProject.status==='ARCHIVED'){const restored=await page.request.post(`/api/v1/projects/${live.projectId}/lifecycle`,{headers:{Origin:base,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:{action:'restore',expectedVersion:fixtureProject.version}});assert.equal(restored.status(),200);}
  await page.goto('/');await page.getByLabel('현재 프로젝트',{exact:true}).selectOption(live.projectId);
  const form=page.getByRole('region',{name:'새 업무 등록',exact:true});
  await expect(form.getByRole('button',{name:'마이크로 입력'})).toBeDisabled();
  await form.getByRole('checkbox',{name:/이 컴퓨터에서 음성을 처리/}).check();
  await form.getByLabel('음성 파일 선택').setInputFiles(resolve('.local/voice-fixtures/korean-test.wav'));
  await expect(form.getByLabel('한국어 요청 원문',{exact:true})).toHaveValue(/[가-힣]/,{timeout:75000});
  await expect(form.getByRole('button',{name:'업무 등록',exact:true})).toBeDisabled();
  const original=await form.getByLabel('한국어 요청 원문',{exact:true}).inputValue();
  await form.getByLabel('업무 제목',{exact:true}).fill('Phase 5 브라우저 음성 확인 시험');
  await form.getByLabel('한국어 요청 원문',{exact:true}).fill('브라우저에서 수정·확인한 한국어 음성 요청입니다. 실행과 merge·배포는 하지 않습니다.');
  await form.getByLabel('수용 기준',{exact:true}).fill('명시적 확인 전 업무를 생성하지 않는다.\n확인 후에도 실행을 자동 시작하지 않는다.');
  await mkdir(resolve('.local/voice-evidence'),{recursive:true});
  await form.screenshot({path:resolve('.local/voice-evidence/voice-live-desktop.png')});
  await page.setViewportSize({width:390,height:844});await expect(form).toBeVisible();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await form.screenshot({path:resolve('.local/voice-evidence/voice-live-mobile.png')});
  await form.getByRole('checkbox',{name:/프로젝트와 전사 수정 내용/}).check();
  const responsePromise=page.waitForResponse(r=>r.url().includes('/voice/candidates/')&&r.url().endsWith('/confirm')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'업무 등록',exact:true}).click();const confirmed=await responsePromise;assert.equal(confirmed.status(),201);const task=(await confirmed.json()).data;assert.equal(task.source,'VOICE');assert.equal(task.status,'TODO');
  assert.equal((await db.sql`select count(*)::int as n from workflow_runs where project_id=${live.projectId}`)[0].n,0);
  // Archive only this verifier's newly created fixture project; retain evidence without active test clutter.
  const project=(await db.sql`select version from projects where id=${live.projectId}`)[0];
  const archived=await page.request.post(`/api/v1/projects/${live.projectId}/lifecycle`,{headers:{Origin:base,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:{action:'archive',expectedVersion:project.version}});assert.equal(archived.status(),200);
  assert.deepEqual(errors,[]);
  const proof={checkedAt:new Date().toISOString(),sourceDigest:await sourceDigest(process.cwd()),projectId:live.projectId,taskId:task.id,actualTranscript:original,desktop:true,mobileWidth:390,horizontalOverflow:false,pageErrors:errors,confirmedSource:task.source,taskState:task.status,automaticRuns:0,fixtureProjectArchived:true,realMicrophoneTested:false,externalSpeechRequests:0};
  await writeFile(resolve('.local/voice-evidence/browser.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,proofSha:sha256(JSON.stringify(proof,null,2))}));
}finally{if(csrf)await page.request.delete('/api/v1/auth/session',{headers:{Origin:base,'X-CSRF-Token':csrf}}).catch(()=>undefined);await context.close();await browser.close();await db.close();}
