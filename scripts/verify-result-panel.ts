import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const projectId = 'c50bedb0-29e8-4582-a3ff-f04168aff93a', taskId = '2db930ba-577c-4394-ab13-b9c8556b8c44';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().endsWith('/auth/session')) writes.push(new URL(request.url()).pathname); });
  await page.goto(`/?project=${projectId}&task=${taskId}#task-inspector`);
  await page.getByLabel('Owner 비밀키', { exact: true }).fill(readFileSync(resolve('.local/owner-key'), 'utf8').trim());
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: '프로젝트와 업무 상세', exact: true });
  const summary = inspector.getByRole('region', { name: '선택 업무 결과 요약', exact: true });
  await expect(summary.getByRole('link', { name: /변경 커밋 7b07edc/ })).toHaveAttribute('href', 'https://github.com/Ina-dang/how-to-trash/commit/7b07edc348864f1135c5716d43ef04719b188d41');
  await expect(summary.getByText('PASS · 동일 후보', { exact: true })).toBeVisible();
  await expect(summary.locator('.result-files li')).toHaveCount(6);
  const response = await page.request.get(`/api/v1/tasks/${taskId}/runs`); assert(response.ok());
  const current = (await response.json()).data.items[0]; assert(['WAITING_APPROVAL', 'SUCCEEDED'].includes(current.status)); assert.equal(current.checkpoint.turns, 6);
  mkdirSync('.local/browser-evidence', { recursive: true });
  await page.screenshot({ path: '.local/browser-evidence/result-inspector-desktop.png', fullPage: false });
  await page.reload(); await expect(summary).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(summary.getByRole('link', { name: /변경 커밋/ })).toBeVisible();
  const mobilePanel = await inspector.boundingBox(); assert(mobilePanel && mobilePanel.height < 3000, 'Historical evidence must stay collapsed by default');
  await inspector.screenshot({ path: '.local/browser-evidence/result-inspector-mobile.png' });
  const after = (await (await page.request.get(`/api/v1/tasks/${taskId}/runs`)).json()).data.items[0];
  assert.equal(after.status, current.status); assert.equal(after.version, current.version); assert.equal(after.checkpoint.turns, current.checkpoint.turns);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ verified: true, projectId, taskId, deliveryCommit: current.checkpoint.delivery.commitSha, files: 6, qa: 'PASS', runStatus: current.status, turns: current.checkpoint.turns, businessWrites: writes.length, pageErrors: errors.length, screenshots: ['.local/browser-evidence/result-inspector-desktop.png', '.local/browser-evidence/result-inspector-mobile.png'] }));
  await context.close();
} finally { await browser.close(); }
