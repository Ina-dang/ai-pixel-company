import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,test,type BrowserContext,type Page} from '@playwright/test';
import type {CompanyState,ProjectOperations,ReviewsState,PerformanceReview} from '../../apps/web/app/ui/company-model';

const a='aaaaaaaa-4444-4555-8666-777777777777',b='bbbbbbbb-4444-4555-8666-777777777777',task='cccccccc-4444-4555-8666-777777777777',other='dddddddd-4444-4555-8666-777777777777',run='eeeeeeee-4444-4555-8666-777777777777',employee='ffffffff-4444-4555-8666-777777777777';
const policy={monthlyTokens:1000000,runTokens:500000,version:0},now='2026-10-19T13:00:00.000Z';
let cookies:Parameters<BrowserContext['addCookies']>[0]=[];
test.beforeAll(async({browser})=>{const context=await browser.newContext();try{const base=process.env.UI_BASE_URL??'http://127.0.0.1:3000';const response=await context.request.post(`${base}/api/v1/auth/session`,{data:{secret:process.env.E2E_OWNER_SECRET??readFileSync(resolve('.local/owner-key'),'utf8').trim()},headers:{Origin:base}});expect(response.status()).toBe(200);cookies=await context.cookies();}finally{await context.close();}});
test.beforeEach(async({context,page})=>{await context.addCookies(cookies);await page.addInitScript(()=>{class LocalEvents extends EventTarget{readyState=1;onopen:(()=>void)|null=null;onerror:(()=>void)|null=null;onmessage:(()=>void)|null=null;constructor(){super();queueMicrotask(()=>this.onopen?.());}close(){this.readyState=2;}}Object.assign(window,{EventSource:LocalEvents});});});
function review(type:string,index:number):PerformanceReview{return{id:`review-${index}`,projectId:a,taskId:task,runId:run,subjectEmployeeId:employee,subjectProfileVersion:1,type,reviewerEmployeeId:null,reviewerUserId:null,status:'DRAFT',revisionCount:1,generationCount:type==='AUTO'||type==='USER'?0:1,version:1,evidenceCurrent:true,
  revisions:[{revision:1,scores:type==='AUTO'?null:{accuracy:80,quality:90,collaboration:70,efficiency:60},score:type==='AUTO'?null:77,weights:{accuracy:.3,quality:.3,collaboration:.2,efficiency:.2},bodyEn:'A limited opinion based on supplied evidence.',originalKo:type==='USER'?'<img src=x onerror="window.reviewInjected=true"> 한국어 원문':null,summaryKo:type==='AUTO'?'실행 지표를 읽었습니다.':'근거에 기반한 의견 초안입니다.',evidenceHash:'e'.repeat(64),evidence:{runId:run,runVersion:4,runStatus:'WAITING_APPROVAL',candidateSha:'f'.repeat(64),subject:{employeeId:employee,nameKo:'기록된 개발자',profileVersion:1,role:'DEVELOPER',model:'codex-default'}},metrics:{completedResponseTokens:1234,roleCalls:1,rework:0,elapsedMs:1000,testPass:true,buildPass:true,qaVerdict:'PASS',ownerAccepted:false,taskFailed:false,taskCancelled:false,actualCost:null},flags:['SMALL_SAMPLE',...(type==='AUTO'?['UNSCORABLE']:['SAME_MODEL'])]}],jobs:[],ownerEvents:[]};}
async function fixture(page:Page){
  const requests:{path:string;body:Record<string,unknown>;csrf?:string;key?:string}[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const projects=[a,b].map((id,i)=>({id,name:`검증 프로젝트 ${i?'B':'A'}`,status:'ACTIVE',version:1,repositoryUrl:'https://github.com/Ina-dang/ai-pixel-company-integration-tests.git',defaultBranch:'fixture-base',taskCount:2,runningCount:0,queuedCount:0,approvalCount:1}));
  const company:CompanyState={projects,usage:[{projectId:a,spentTokens:'1234',heldTokens:'0'}],queue:[],departments:[],placements:[],policy:{...policy,monthlyTokens:2000000},periodStart:'2026-10-01',providerSlots:1,actualCost:null};
  const operations:ProjectOperations={policy:{company:company.policy,project:policy},dependencies:[],schedules:[],tasks:[{id:task,title:'후속 검증',status:'TODO',priority:'HIGH',version:1,blockedReason:'DEPENDENCY'},{id:other,title:'선행 검증',status:'APPROVAL_REQUIRED',priority:'MEDIUM',version:1,blockedReason:null}],usage:{spentTokens:'1234',heldTokens:'0'},periodStart:'2026-10-01',providerSlots:1,scheduler:'priority-fifo-v1'};
  const reviews:ReviewsState={items:['AUTO','SELF','PEER','PM','USER'].map(review),contexts:[{runId:run,taskId:task,title:'실제 실행 기록',status:'WAITING_APPROVAL',version:4,staff:[{employeeId:employee,profileVersion:1,nameKo:'현재 개발자',role:'DEVELOPER',model:'codex-default'}]}],rubric:{version:1,weights:{accuracy:.3,quality:.3,collaboration:.2,efficiency:.2},minimumAggregateSamples:3},aggregates:[],rankingEnabled:false,sampleWindow:100};
  let reject=false;
  await page.route('**/api/v1/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');const send=(data:unknown)=>route.fulfill({json:{data,...(path==='/projects'?{pagination:{nextCursor:null}}:{})}});
    if(request.method()==='GET'){
      if(path==='/projects')return send(projects);
      if(path.endsWith('/snapshot'))return send({projectId:path.split('/')[2],cursor:'1',syncedAt:now,tasks:[],agents:[],approvals:[]});
      if(path==='/company')return send(company);
      if(path.endsWith('/operations'))return send(operations);
      if(path.endsWith('/reviews'))return send(path.includes(b)?{...reviews,items:[],contexts:[]}:reviews);
      if(path==='/employees'||path.endsWith('/staffing')||path==='/employees/templates')return send({items:[]});
      if(path.endsWith('/integrations'))return send({connections:[],operations:[],mergeRequests:[],commands:[],setup:{githubEnv:[],slackEnv:[]}});
      if(path==='/subscription')return send({ready:true,reason:null,authMode:'chatgpt',billingMode:'CHATGPT_SUBSCRIPTION',windows:[],checkedAt:now});
      return route.continue();
    }
    if(path==='/company/policy'||path.includes('/dependencies/')||path.endsWith('/schedule')||path.includes('/reviews')){
      const body=request.postDataJSON() as Record<string,unknown>;requests.push({path,body,csrf:request.headers()['x-csrf-token'],key:request.headers()['idempotency-key']});
      if(reject)return route.fulfill({status:409,json:{error:{code:'CONFLICT',messageKo:'실행 근거 또는 버전이 변경되었습니다. 새로 확인하세요.'}}});
      if(path.endsWith('/schedule'))operations.schedules=[{taskId:task,enabled:true,version:1,runId:null,reason:'DEPENDENCY'}];
      return send({id:'controlled-result'});
    }
    return route.continue();
  });
  await page.goto('/');await expect(page.getByLabel('현재 프로젝트',{exact:true})).toBeVisible();await page.getByLabel('현재 프로젝트',{exact:true}).selectOption(a);
  return{requests,errors,reviews,operations,reject:()=>{reject=true;}};
}
test('company overview switches project scope and explicit consent gates a dependency-blocked schedule',async({page})=>{const s=await fixture(page);await page.getByRole('tab',{name:'회사 운영',exact:true}).click();await expect(page.getByRole('heading',{name:'프로젝트 전체 현황'})).toBeVisible();expect(s.requests).toEqual([]);
  await page.getByLabel('예약할 업무',{exact:true}).selectOption(task);const submit=page.getByRole('button',{name:'확인한 업무 실행 예약'});await expect(submit).toBeDisabled();await page.getByRole('checkbox',{name:/선행 업무와 권한/}).check();await submit.click();await expect(page.getByText(/후속 검증 · 예약됨 · 선행 업무 완료 대기/)).toBeVisible();expect(s.requests[0]).toMatchObject({path:`/projects/${a}/tasks/${task}/schedule`,body:{enabled:true,expectedTaskVersion:1}});expect(s.requests[0].csrf).toBeTruthy();expect(s.requests[0].key).toBeTruthy();
  await page.getByRole('region',{name:'프로젝트 검증 프로젝트 B',exact:true}).getByRole('button',{name:'이 프로젝트 열기'}).click();await expect(page.getByLabel('현재 프로젝트',{exact:true})).toHaveValue(b);expect(s.errors).toEqual([]);
});
test('policy and DAG conflicts show server denial and preserve idempotent retry',async({page})=>{const s=await fixture(page);s.reject();await page.getByRole('tab',{name:'회사 운영',exact:true}).click();await page.getByText('조직·현재 프로젝트 토큰 정책',{exact:true}).click();const form=page.getByRole('form',{name:'조직 정책',exact:true});await form.getByRole('button',{name:'토큰 정책 저장'}).click();await expect(page.getByRole('region',{name:'회사와 프로젝트 운영'}).getByRole('alert')).toContainText('실행 근거');await form.getByRole('button',{name:'토큰 정책 저장'}).click();await expect.poll(()=>s.requests.length).toBe(2);expect(s.requests[0].key).toBe(s.requests[1].key);
  await page.getByLabel('후속 업무',{exact:true}).selectOption(task);await page.getByLabel('선행 업무',{exact:true}).selectOption(task);await expect(page.getByRole('button',{name:'선행 업무 연결'})).toBeDisabled();await page.getByLabel('선행 업무',{exact:true}).selectOption(other);await page.getByRole('button',{name:'선행 업무 연결'}).click();await expect.poll(()=>s.requests.length).toBe(3);expect(s.requests[2].body).toEqual({taskId:task,prerequisiteId:other,expectedTaskVersion:1});expect(s.errors).toEqual([]);
});
test('five review types separate facts and opinions, preserve escaped Korean and block nonfinal publication',async({page})=>{const s=await fixture(page);await page.getByRole('tab',{name:'직원 평가',exact:true}).click();await expect(page.locator('.review-card')).toHaveCount(5);await expect(page.locator('.review-card').first()).toContainText('종합 점수: 평가 불가');await expect(page.getByRole('heading',{name:'기록된 개발자 · 자기 의견',exact:true})).toBeVisible();
  const owner=page.locator('.review-card').last();await owner.getByText('원문·점수·근거·수정 이력',{exact:true}).click();await expect(owner.locator('pre').first()).toContainText('<img src=x onerror=');expect(await page.evaluate(()=>Object.hasOwn(window,'reviewInjected'))).toBe(false);await expect(owner.getByRole('button',{name:'검토한 의견 게시'})).toBeDisabled();await page.getByRole('button',{name:'동료 의견',exact:true}).click();await expect(page.locator('.review-card')).toHaveCount(1);expect(s.requests).toEqual([]);expect(s.errors).toEqual([]);
});
test('review generation limits and stale evidence prevent loops and publication',async({page})=>{const s=await fixture(page);s.reviews.items[1].generationCount=2;s.reviews.items[1].revisionCount=2;s.reviews.items[2].evidenceCurrent=false;s.reviews.items[2].status='NEEDS_REVIEW';s.reviews.items[2].revisions[0].evidence.runStatus='SUCCEEDED';await page.getByRole('tab',{name:'직원 평가',exact:true}).click();const self=page.locator('.review-card').nth(1),peer=page.locator('.review-card').nth(2);await expect(self.getByRole('button',{name:'AI 평가 한 번 수정'})).toBeDisabled();await expect(peer).toContainText('재검토 필요');await expect(peer.getByRole('button',{name:'검토한 의견 게시'})).toBeDisabled();expect(s.requests).toEqual([]);expect(s.errors).toEqual([]);
});
test('mobile review layout and keyboard tab navigation remain usable',async({page})=>{const s=await fixture(page);await page.setViewportSize({width:390,height:844});const tab=page.getByRole('tab',{name:'회사 운영',exact:true});await tab.focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'직원 평가',exact:true})).toBeFocused();await expect(page.locator('.review-card')).toHaveCount(5);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByLabel('평가 대상 실행',{exact:true}).selectOption(run);await page.getByLabel('평가 대상 직원',{exact:true}).selectOption(employee);await page.getByLabel('평가 유형',{exact:true}).selectOption('SELF');await expect(page.getByText(/최초·수정 합계 2회/)).toBeVisible();expect(s.errors).toEqual([]);
});
