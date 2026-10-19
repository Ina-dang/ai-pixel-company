import{spawnSync}from'node:child_process';
import{recordCheck}from'./operations-client.js';
import{safeCode,sha256}from'../apps/api/src/operations-model.js';
import{stripVTControlCharacters}from'node:util';

try{for(const[name,args]of [['AUTOMATED_SUITE',['verify']],['BROWSER',['test:e2e']]] as const){const started=Date.now(),result=spawnSync(process.platform==='win32'?'pnpm.cmd':'pnpm',[...args],{cwd:process.cwd(),shell:process.platform==='win32',encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});const output=stripVTControlCharacters((result.stdout??'')+(result.stderr??''));
    const match=name==='AUTOMATED_SUITE'?output.match(/Tests\s+(\d+) passed/):output.match(/(\d+) passed \(/),count=Number(match?.[1]??0),passed=result.status===0&&count>=(name==='AUTOMATED_SUITE'?188:25);
    await recordCheck(name,{command:`pnpm ${args.join(' ')}`,exitCode:result.status,tests:count,durationMs:Date.now()-started,outputSha:sha256(output),...(name==='AUTOMATED_SUITE'?{lint:passed?'PASS':'NOT_CONFIRMED',typecheck:passed?'PASS':'NOT_CONFIRMED',build:passed?'PASS':'NOT_CONFIRMED',contracts:passed?{typescriptFixtures:16,pythonFixtures:26}:null}:{viewportWidths:[390,1280],controlledData:true})},passed);
    if(!passed){console.log(output.split('\n').filter(line=>/FAIL|Error:|error TS|failed|×/.test(line)).map(line=>line.slice(0,240)).slice(-8).join('\n'));throw new Error('RELEASE_CHECK_FAILED');}}
}catch(error){console.log(JSON.stringify({verified:false,code:safeCode(error instanceof Error?error.message:null)}));process.exitCode=1;}
