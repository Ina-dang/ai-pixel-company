import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { RepositorySandbox, loadRepositoryAdmission } from '../packages/sandbox/src/repository.js';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';
import { workflowView, type WorkflowRow } from '../apps/api/src/workflows.js';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('../', import.meta.url));
const workerId = process.argv[2] === '--worker' ? process.argv[3] : null;
const baseline404 = process.argv.includes('--baseline404');
let proof: { status: string; runId: string; candidateSha: string; source: NonNullable<ReturnType<typeof workflowView>['repositorySource']> };
if (baseline404) {
  const source = (await loadRepositoryAdmission(root)).source;
  const runId = JSON.parse(await readFile(join(root, '.local/how-to-trash-baseline.json'), 'utf8')).baselineRunId as string;
  proof = { status: 'BASELINE', runId, source, candidateSha: (await new RepositorySandbox(root, source).snapshot(runId)).sha };
} else if (workerId) {
  assert.match(workerId, /^[a-f0-9-]{36}$/);
  const db = createDatabase(loadRuntime().databaseUrl);
  try {
    const [row] = await db.sql<WorkflowRow[]>`select * from workflow_runs where id=${workerId} and fixture='how-to-trash-v1'`;
    assert(row); const workflow = workflowView(row); assert(workflow.repositorySource && workflow.checkpoint.workspace);
    proof = { status: 'CANDIDATE', runId: workerId, candidateSha: workflow.checkpoint.workspace.sha, source: workflow.repositorySource };
  } finally { await db.close(); }
} else {
  proof = JSON.parse(await readFile(join(root, '.local/how-to-trash-live.json'), 'utf8'));
  assert.equal(proof.status, 'PASS');
}
const sandbox = new RepositorySandbox(root, proof.source);
assert.equal((await sandbox.snapshot(proof.runId)).sha, proof.candidateSha);
const name = `pixel-preview-${proof.runId}`, run = promisify(execFile);
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
const errors: { message: string; stack: string; step: string; mode: string; viewport: string }[] = [], checks: string[] = [];
const controlMetrics: Record<string, unknown>[] = [];
const result: Record<string, unknown> = { status: 'STARTED', candidateSha: proof.candidateSha, runId: proof.runId, startedAt: new Date().toISOString() };
const output = join(root, baseline404 ? '.local/how-to-trash-baseline404.json' : '.local/how-to-trash-browser.json');
const record = async (change: Record<string, unknown>) => { Object.assign(result, change); await writeFile(output, JSON.stringify(result, null, 2)); };
// Browser transport only: candidate code remains in network=none containers.
// The relay accepts GET/HEAD on loopback and forwards no credentials/host headers.
const relay = createServer(async (request, response) => {
  try {
    if (!['GET','HEAD'].includes(request.method ?? '') || !request.url?.startsWith('/') || request.url.startsWith('//')) { response.writeHead(405); response.end(); return; }
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => ['accept','rsc','next-router-state-tree','next-router-prefetch','next-url'].includes(key)));
    const data = Buffer.from(JSON.stringify({ path: request.url, headers })).toString('base64');
    const code = "const input=JSON.parse(Buffer.from(process.argv[1],'base64'));fetch('http://127.0.0.1:3000'+input.path,{headers:input.headers,redirect:'manual'}).then(async r=>{const b=Buffer.from(await r.arrayBuffer());if(b.length>4000000)throw Error('response limit');process.stdout.write(JSON.stringify({status:r.status,headers:Object.fromEntries([...r.headers].filter(([k])=>['content-type','cache-control','location'].includes(k))),body:b.toString('base64')}),()=>process.exit(0))}).catch(()=>process.exit(1))";
    const fetched = await run('docker', ['exec', '--user=1000:1000', name, 'node', '-e', code, data], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 6000000 });
    const body = JSON.parse(fetched.stdout);
    response.writeHead(body.status, body.headers); response.end(request.method === 'HEAD' ? undefined : Buffer.from(body.body, 'base64'));
  } catch { response.writeHead(502); response.end('Preview unavailable'); }
});
try {
  await new Promise<void>((fulfill, reject) => { relay.once('error', reject); relay.listen(3002, '127.0.0.1', fulfill); });
  for (const mapMode of (baseline404 ? ['MISSING_KEY'] : ['MISSING_KEY', 'SDK_BLOCKED']) as ('MISSING_KEY'|'SDK_BLOCKED')[]) {
  await record({ status: 'BUILDING_PREVIEW', mapMode });
  const created = await run('docker', ['run', '--detach', '--name', name, '--label', `ai-pixel-preview=${proof.runId}`,
    '--pull=never', '--network=none', '--read-only', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
    '--pids-limit=128', '--cpus=2', '--memory=2g', '--memory-swap=2g', '--tmpfs=/tmp:rw,nosuid,size=512m,mode=1777',
    '--env=NEXT_TELEMETRY_DISABLED=1', '--env=CI=1', '--env=NODE_OPTIONS=--max-old-space-size=1536',
    ...(mapMode === 'SDK_BLOCKED' ? ['--env=NEXT_PUBLIC_KAKAO_MAP_APP_KEY=non-secret-blocked-sdk-test'] : []),
    '--mount', `type=bind,source=${join(root, '.local/repository-workspaces', proof.runId)},target=/candidate,readonly`,
    '--entrypoint=node', proof.source.imageId, '/opt/broker/verify.cjs', 'preview'], { windowsHide: true, timeout: 15000 });
  assert.match(created.stdout.trim(), /^[a-f0-9]{64}$/);
  const deadline = Date.now() + 100000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const response = await fetch('http://127.0.0.1:3002', { signal: AbortSignal.timeout(1500) }); if (response.ok) { ready = true; break; } } catch { /* startup */ }
    await sleep(1000);
  }
  assert(ready, 'Preview did not start');
  await mkdir(join(root, '.local/browser-evidence'), { recursive: true });
  for (const [width, height, label] of (baseline404 ? [[1440,1000,'desktop']] : [[1440,1000,'desktop'],[375,812,'mobile']]) as [number,number,string][]) {
    const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
    let step = 'home';
    page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack ?? '', step, mode: mapMode, viewport: label }));
    const external: string[] = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.origin !== 'http://127.0.0.1:3002') external.push(url.origin); });
    await page.context().route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3002' ? route.continue() : route.abort('failed'));
    if (baseline404) {
      step = 'not-found';
      await page.addInitScript(() => {
        const diagnostics: unknown[] = [];
        (window as unknown as Record<string, unknown>).__resourceErrors = diagnostics;
        window.addEventListener('unhandledrejection', event => {
          const reason = event.reason as unknown, target = reason instanceof Event ? reason.target : null;
          diagnostics.push({ type: Object.prototype.toString.call(reason), target: target instanceof HTMLElement ? target.outerHTML.slice(0,1500) : null });
        });
      });
      const response = await page.goto('http://127.0.0.1:3002/region/unknown-region');
      await page.waitForLoadState('networkidle'); assert.equal(response?.status(), 404);
      await record({ baselineErrors: errors, diagnostics: await page.evaluate(() => (window as unknown as Record<string, unknown>).__resourceErrors), httpStatus: response.status() });
      await page.close(); continue;
    }
    await page.goto('http://127.0.0.1:3002');
    await page.waitForLoadState('networkidle');
    const input = page.getByLabel('지역 검색', { exact: true });
    await expect(input).toBeVisible();
    const links = page.locator('a[href^="/region/"]');
    await expect(links).toHaveCount(25);
    await expect(page.getByText(/현재는 관악구/)).toHaveCount(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: join(root, `.local/browser-evidence/how-to-trash-${mapMode}-${label}.png`), fullPage: true });
    await input.fill('  관악  '); await expect(links).toHaveCount(1);
    await expect(page.getByRole('link', { name: '관악구', exact: true })).toHaveAttribute('href', '/region/gwanak');
    await input.fill('존재하지않는지역'); await expect(links).toHaveCount(0);
    await expect(page.getByText(/검색.*없|일치.*없|찾.*없/).first()).toBeVisible();
    const reset = page.getByRole('button', { name: '검색 초기화', exact: true });
    await reset.focus(); await page.keyboard.press('Enter');
    await expect(input).toHaveValue(''); await expect(links).toHaveCount(25);
    await expect(input).toBeFocused();
    await input.fill(' \t '); await expect(links).toHaveCount(25);
    await input.fill('관악');
    step = 'detail';
    const link = page.getByRole('link', { name: '관악구', exact: true });
    await input.focus(); await page.keyboard.press('Tab'); await expect(reset).toBeFocused();
    await page.keyboard.press('Tab'); await expect(link).toBeFocused();
    const inputBox = await input.boundingBox(), resetBox = await reset.boundingBox(), linkBox = await link.boundingBox();
    assert(inputBox && resetBox && linkBox); assert(inputBox.height >= 44 && resetBox.height >= 44 && linkBox.height >= 44);
    const focus = await link.evaluate(node => { const style = getComputedStyle(node); return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow }; });
    assert((focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) > 0) || focus.boxShadow !== 'none');
    controlMetrics.push({ mode: mapMode, viewport: label, inputHeight: inputBox.height, resetHeight: resetBox.height, linkHeight: linkBox.height, focus });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/region\/gwanak$/);
    await expect(page.getByRole('heading', { name: /관악구/ }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const missing = await page.request.get('http://127.0.0.1:3002/region/unknown-region');
    assert.equal(missing.status(), 404);
    if (mapMode === 'MISSING_KEY') assert(!external.some(origin => origin.includes('kakao.com')), 'No-key path must not request the map SDK');
    else assert(external.some(origin => origin.includes('kakao.com')), 'SDK failure must actually be exercised');
    checks.push(`${mapMode}/${label}:25-regions,trimmed-search,empty,reset-input-focus,keyboard-detail,http404,no-overflow,external-blocked`);
    await page.close();
  }
  await run('docker', ['rm', '--force', name], { windowsHide: true, timeout: 15000 });
  }
  if (!baseline404) assert.deepEqual(errors, []);
  assert.equal((await sandbox.snapshot(proof.runId)).sha, proof.candidateSha);
  await record({ status: baseline404 ? 'BASELINE_OBSERVED' : 'PASS', checks, errors, controlMetrics,
    knownBaselineLimitations: baseline404 ? [] : [{ route: '/region/unknown-region', observation: '404 UI stylesheet rejection Event reproduced on unchanged baseline; feature routes have no page errors. Only HTTP404 is required by this scope.', evidence: '.local/how-to-trash-baseline404.json' }],
    previewScope: 'network=none candidate containers; credential-free loopback GET/HEAD relay port3002; external browser requests aborted.', completedAt: new Date().toISOString() });
  console.log(JSON.stringify(result));
} catch (error) {
  await record({ status: 'FAIL', checks, error: error instanceof Error ? error.message : 'Unknown failure' });
  throw error;
} finally {
  await browser.close();
  await new Promise<void>(fulfill => relay.close(() => fulfill()));
  await run('docker', ['rm', '--force', name], { windowsHide: true, timeout: 15000 }).catch(() => undefined);
}
