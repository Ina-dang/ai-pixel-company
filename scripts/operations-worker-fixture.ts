import{resolve}from'node:path';
import{createDatabase}from'@ai-pixel/db';
import{WorkflowRepository}from'../apps/api/src/workflows.js';
import{WorkflowRunner,DockerSandbox,type AgentProvider}from'../packages/agents/src/index.js';

// Deliberately blocked, non-billable provider for a native worker-crash drill.
// This executable refuses the application database and never creates a Codex provider.
const url=process.env.TEST_DATABASE_URL,root=resolve(process.argv[2]??'');
if(process.argv[3]!=='--isolated-recovery-fixture'||!url||!/^pixel_recovery_test_[a-f0-9]{12}$/.test(new URL(url).pathname.slice(1))||!root.startsWith(`${resolve('.local/restore-verifications')}/`)&&!root.startsWith(`${resolve('.local/restore-verifications')}\\`))throw new Error('ISOLATED_RECOVERY_FIXTURE_REQUIRED');
const database=createDatabase(url),provider:AgentProvider={status:async()=>({ready:true,reason:null,authMode:'chatgpt',billingMode:'CHATGPT_SUBSCRIPTION',windows:[],checkedAt:new Date().toISOString()}),run:async input=>{await input.onStarted('controlled-native-recovery-thread',null);console.log(JSON.stringify({fixtureReady:true,pid:process.pid,modelCalled:false}));return new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('CONTROLLED_ABORT')),{once:true}));},close:async()=>undefined};
await new WorkflowRunner(new WorkflowRepository(database),provider,new DockerSandbox(root)).tick();
