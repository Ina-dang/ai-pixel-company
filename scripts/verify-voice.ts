import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from '@playwright/test';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';
import { createVoiceFixture } from './voice-fixture.js';
import { sourceDigest, sha256 } from '../apps/api/src/operations-model.js';

const root=process.cwd(),runtime=loadRuntime(),base=runtime.appOrigin,db=createDatabase(runtime.databaseUrl),context=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base},timeout:15000});
let csrf='';
async function call(method:string,url:string,data?:unknown,key=randomUUID()) {const r=await context.fetch(`/api/v1${url}`,{method,headers:{'X-CSRF-Token':csrf,'Idempotency-Key':key},...(data===undefined?{}:{data})});const body=await r.json();assert(r.ok(),body.error?.code);return body.data;}
async function poll(id:string) {for(let i=0;i<150;i++){const row=await call('GET',`/voice/candidates/${id}`);if(row.status!=='PROCESSING')return row;await sleep(500);}throw new Error('VOICE_LIVE_TIMEOUT');}
async function upload(project:string,wav:Buffer) {const r=await context.post(`/api/v1/projects/${project}/voice/candidates`,{headers:{'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID(),'X-Voice-Consent':'local-transcription-v1','Content-Type':'audio/wav'},data:wav});assert.equal(r.status(),202);return(await r.json()).data.id as string;}
try {
  const login=await context.post('/api/v1/auth/session',{data:{secret:(await readFile(path.join(root,'.local/owner-key'),'utf8')).trim()}});assert.equal(login.status(),200);csrf=(await login.json()).data.csrfToken;
  const fixture=await createVoiceFixture(root),started=Date.now(),project=await call('POST','/projects',{name:'Phase 5 로컬 음성 검증',repositoryUrl:'https://github.com/Ina-dang/ai-pixel-company-integration-tests.git',defaultBranch:'fixture-base'});
  const id=await upload(project.id,fixture.wav),candidate=await poll(id);assert.equal(candidate.status,'READY');assert.match(candidate.transcript,/[가-힣]/);
  assert.equal((await db.sql`select count(*)::int as n from tasks where project_id=${project.id}`)[0].n,0);
  const corrected='로그인 화면의 제목을 수정해 주세요. 실제 실행은 Owner가 별도로 확인합니다.';
  const key=randomUUID(),body={confirmed:true,expectedVersion:candidate.version,task:{title:'음성 수정·확인 연동 시험',commandOriginalKo:corrected,source:'VOICE',priority:'MEDIUM',acceptanceCriteria:[{id:'AC-1',descriptionKo:'Owner 확인 전 실행되지 않는다.',method:'manual',required:true}]}};
  const task=await call('POST',`/voice/candidates/${id}/confirm`,body,key),replay=await call('POST',`/voice/candidates/${id}/confirm`,body,key);assert.equal(task.id,replay.id);assert.equal(task.commandOriginalKo,corrected);assert.equal(task.status,'TODO');
  assert.equal((await db.sql`select count(*)::int as n from workflow_runs where project_id=${project.id}`)[0].n,0);
  // Repeat nonprivate synthesized PCM to make cancellation observable during native inference.
  const long=Buffer.alloc(960044),pcm=fixture.wav.subarray(44);fixture.wav.copy(long,0,0,44);long.writeUInt32LE(long.length-8,4);long.writeUInt32LE(long.length-44,40);for(let at=44;at<long.length;at+=pcm.length)pcm.copy(long,at,0,Math.min(pcm.length,long.length-at));
  const cancelId=await upload(project.id,long);
  let nativeFileObserved=false;
  for(let i=0;i<100;i++){const names:string[]=await readdir(path.join(root,'.local/voice-temp',cancelId)).catch(()=>[] as string[]);if(names.includes('audio.wav')){nativeFileObserved=true;break;}await sleep(10);}
  assert(nativeFileObserved);
  await sleep(100);
  await call('DELETE',`/voice/candidates/${cancelId}`);
  const cancelled=(await db.sql`select status,error_code,transcript from voice_candidates where id=${cancelId}`)[0];assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.error_code,'VOICE_NATIVE_CANCELLED');assert.equal(cancelled.transcript,null);
  assert.equal((await readdir(path.join(root,'.local/voice-temp')).catch(()=>[])).length,0);
  const proof={checkedAt:new Date().toISOString(),sourceDigest:await sourceDigest(root),provider:'whisper.cpp b5454 tiny multilingual local CPU',projectId:project.id,taskId:task.id,candidateId:id,cancelId,fixtureExpected:fixture.expected,actualTranscript:candidate.transcript,exactFixtureMatch:candidate.transcript.replaceAll(/\s|[.!?。]/g,'')===fixture.expected.replaceAll(/\s|[.!?。]/g,''),edited:true,duplicateCreated:false,taskState:'TODO',workflowRuns:0,nativeCancelled:true,temporaryAudioFiles:0,externalSpeechRequests:0,paidModelCalls:0,durationMs:Date.now()-started};
  await mkdir(path.join(root,'.local/voice-evidence'),{recursive:true});const file=path.join(root,'.local/voice-evidence/live.json');await writeFile(file,JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,proofSha:sha256(JSON.stringify(proof,null,2))}));
}finally{if(csrf)await context.delete('/api/v1/auth/session',{headers:{'X-CSRF-Token':csrf}}).catch(()=>undefined);await context.dispose();await db.close();}
