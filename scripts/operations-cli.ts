import{setTimeout as sleep}from'node:timers/promises';
import{loadRuntime}from'./runtime.js';
import{OperationsClient}from'./operations-client.js';
import{safeCode}from'../apps/api/src/operations-model.js';

const client=new OperationsClient();
try{const command=process.argv[2];if(command==='watch'){let previous='';const base=new URL(loadRuntime().appOrigin);base.port='3001';for(let i=0;i<12;i++){let status='API_UNREACHABLE';try{const response=await fetch(new URL('/health/ready',base),{signal:AbortSignal.timeout(3000)}),state=await response.json();status=response.ok?'READY':state.status==='maintenance'?'MAINTENANCE':'DEPENDENCY_UNAVAILABLE';}catch{/* Independent of API/DB workers. */}if(status!==previous){console.log(JSON.stringify({check:'API_EXTERNAL_WATCH',status,checkedAt:new Date().toISOString(),automaticRepair:false}));previous=status;}await sleep(5000);}}
  else{await client.login();if(command==='backup')console.log(JSON.stringify(await client.job('BACKUP')));else if(command==='restore'&&/^[a-f0-9-]{36}$/.test(process.argv[3]??''))console.log(JSON.stringify(await client.job('RESTORE_VERIFY',process.argv[3])));else if(command==='status')console.log(JSON.stringify(await client.api('/operations')));else throw new Error('USE_BACKUP_RESTORE_STATUS_OR_WATCH');}
}catch(error){console.log(JSON.stringify({verified:false,code:safeCode(error instanceof Error?error.message:null)}));process.exitCode=1;}finally{await client.close();}
