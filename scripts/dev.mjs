import { spawn } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid && process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
for (const name of ['@ai-pixel/api', '@ai-pixel/web']) {
  const child = spawn(pnpm, ['--filter', name, 'dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
