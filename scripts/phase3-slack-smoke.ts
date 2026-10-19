import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Read-only verification of an already received Slack command. Never posts to Slack or starts work.
const [projectId, taskId] = process.argv.slice(2);
assert(projectId && taskId && /^[a-f0-9-]{36}$/.test(projectId) && /^[a-f0-9-]{36}$/.test(taskId));
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), errors: string[] = [], mutations: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET','HEAD','OPTIONS'].includes(request.method()) && !request.url().endsWith('/auth/session')) mutations.push(new URL(request.url()).pathname); });
  await page.goto('/'); await page.getByLabel('Owner 비밀키', { exact: true }).fill(readFileSync('.local/owner-key','utf8').trim()); await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(projectId);
  const taskResponse = await page.request.get(`/api/v1/tasks/${taskId}`); assert(taskResponse.ok()); const task = (await taskResponse.json()).data;
  assert.equal(task.source, 'SLACK'); assert.equal(task.status, 'TODO'); assert.equal(task.projectId, projectId);
  assert.equal(createHash('sha256').update(task.commandOriginalKo).digest('hex'), task.commandHash);
  const runs = await page.request.get(`/api/v1/tasks/${taskId}/runs`); assert(runs.ok()); assert.equal((await runs.json()).data.items.length, 0);
  const area = page.getByRole('region', { name: '업무와 협업 관리', exact: true });
  await area.getByRole('button', { name: `보드 업무 열기: ${task.title}`, exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await area.getByRole('tab', { name: '연동 현황', exact: true }).click();
  const integrationResponse = await page.request.get(`/api/v1/projects/${projectId}/integrations`); assert(integrationResponse.ok()); const integrations = (await integrationResponse.json()).data;
  assert(integrations.commands.length >= 3); assert(integrations.commands.every((value: { status: string; replyStatus: string }) => value.status === 'PROCESSED' && value.replyStatus === 'SENT'));
  const history = area.getByRole('region', { name: 'Slack 명령 처리 기록', exact: true });
  await expect(history.getByText('명령 처리 완료', { exact: true })).toHaveCount(integrations.commands.length);
  await expect(history.getByText(new RegExp(taskId))).toBeVisible();
  mkdirSync('test-results', { recursive: true }); await history.screenshot({ path: 'test-results/phase3-slack-live-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await history.screenshot({ path: 'test-results/phase3-slack-live-mobile.png' });
  assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
  console.log(JSON.stringify({ verified: true, readOnly: true, projectId, taskId, commandCount: integrations.commands.length, taskStatus: task.status, source: task.source,
    originalHashVerified: true, modelRunsForTask: 0, pageErrors: errors.length, businessWrites: mutations.length,
    screenshots: ['test-results/phase3-slack-live-desktop.png','test-results/phase3-slack-live-mobile.png'] }));
  await context.close();
} finally { await browser.close(); }
