import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Read-only live verification. No task creation, model invocation, acceptance or external write.
const projectId = process.argv[2];
assert(projectId && /^[0-9a-f-]{36}$/.test(projectId), 'Usage: office-visual-smoke.ts <existingProjectId>');
const screenshotPrefix = process.argv.includes('--reference') ? 'office-reference-live' : process.argv.includes('--original') ? 'office-original-live' : 'office-pilot';
const screenshotDirectory = process.argv.includes('--reference') ? '.local/browser-evidence' : 'test-results';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = [], writes: string[] = [], externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !request.url().endsWith('/auth/session')) writes.push(new URL(request.url()).pathname);
    const url = new URL(request.url()); if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests.push(url.hostname);
  });
  await page.goto('/');
  await page.getByLabel('Owner 비밀키', { exact: true }).fill(readFileSync(resolve('.local/owner-key'), 'utf8').trim());
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(projectId);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  const response = await page.request.get(`/api/v1/projects/${projectId}/snapshot`);
  assert(response.ok()); const snapshot = (await response.json()).data;
  for (const agent of snapshot.agents) {
    await expect(office.locator(`[data-office-agent="${agent.role}"]`)).toHaveAttribute('data-agent-state', agent.state);
  }
  await office.getByRole('button', { name: 'Developer 직원 상세', exact: true }).focus(); await page.keyboard.press('Enter');
  const developer = snapshot.agents.find((agent: { role: string }) => agent.role === 'DEVELOPER');
  await expect(office.getByRole('note', { name: '선택 직원 현재 활동', exact: true })).toContainText(developer.activityKo);
  mkdirSync(screenshotDirectory, { recursive: true });
  await office.screenshot({ path: `${screenshotDirectory}/${screenshotPrefix}-desktop.png` });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  await office.screenshot({ path: `${screenshotDirectory}/${screenshotPrefix}-mobile.png` });
  await office.getByRole('button', { name: '그래픽 끄기', exact: true }).click();
  await expect(office.locator('canvas')).toHaveCount(0);
  await office.getByRole('button', { name: '그래픽 켜기', exact: true }).click();
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  await expect(office.locator('canvas')).toHaveCount(1);
  await page.reload();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(projectId);
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  for (const agent of snapshot.agents) {
    await expect(office.locator(`[data-office-agent="${agent.role}"]`)).toHaveAttribute('data-agent-state', agent.state);
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(externalRequests, []);
  console.log(JSON.stringify({ projectId, verified: true, readOnly: true, states: snapshot.agents.map((agent: { role: string; state: string }) => ({ role: agent.role, state: agent.state })), mobileWidth: 390, pageErrors: errors.length, businessWrites: writes.length, externalRequests: externalRequests.length, screenshots: [`${screenshotDirectory}/${screenshotPrefix}-desktop.png`, `${screenshotDirectory}/${screenshotPrefix}-mobile.png`] }));
  await context.close();
} finally { await browser.close(); }
