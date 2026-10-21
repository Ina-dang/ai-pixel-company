import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

test.each(['shutdown', 'disconnect'])('web child stops with its private parent IPC: %s', async mode => {
  const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('scripts/local-web-lifecycle.mjs')).href, '--input-type=module', '-e',
    "process.on('SIGTERM',()=>process.exit(0));process.on('message',m=>{if(m?.type==='ping')process.send({pong:true})});setInterval(()=>{},1000);process.send({ready:true});"],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exit = once(child, 'exit');
  try {
    expect((await once(child, 'message', { signal: AbortSignal.timeout(8000) }))[0]).toEqual({ ready: true });
    const pong = once(child, 'message', { signal: AbortSignal.timeout(3000) });
    child.send({ type: 'unrecognized' }); child.send({ type: 'ping' });
    expect((await pong)[0]).toEqual({ pong: true });
    if (mode === 'shutdown') child.send({ type: 'ai-pixel.shutdown' }); else child.disconnect();
    const result = await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('WEB_CHILD_DID_NOT_STOP')), 8000); timer.unref(); })]);
    expect(result).toEqual([0, null]);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await exit; }
});
