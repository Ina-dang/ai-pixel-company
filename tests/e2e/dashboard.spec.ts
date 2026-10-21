import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

function ownerSecret(): string {
  const value = process.env.E2E_OWNER_SECRET ?? readFileSync(resolve('.local/owner-key'), 'utf8').trim();
  if (!value) throw new Error('E2E owner credential must be configured.');
  return value;
}

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Owner 비밀키', { exact: true }).fill(ownerSecret());
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
}

async function createTask(page: Page, title: string, original: string): Promise<void> {
  await page.getByLabel('업무 제목', { exact: true }).fill(title);
  await page.getByLabel('한국어 요청 원문', { exact: true }).fill(original);
  await page.getByLabel('수용 기준', { exact: true }).fill('새로고침 후 한국어 원문이 정확히 유지된다');
  await page.getByRole('button', { name: '업무 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: `업무 상세: ${title}`, exact: true })).toBeVisible();
}

test('project and Korean task persist; another authenticated browser receives SSE; logout denies access', async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const suffix = randomUUID().slice(0, 8);
  const projectName = `브라우저 검증 ${suffix}`;
  const title = `원문 보존 ${suffix}`;
  const original = '헴의 원문: 한글, 공백 두 칸  유지\n둘째 줄 <script>alert(1)</script> & 따옴표 "검증"';
  await login(page);
  if (!(await page.getByLabel('프로젝트 이름', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: '새 프로젝트', exact: false }).click();
  }
  await page.getByLabel('프로젝트 이름', { exact: true }).fill(projectName);
  await page.getByLabel('저장소 URL', { exact: true }).fill('https://github.com/Ina-dang/ai-pixel-company.git');
  await page.getByLabel('기본 브랜치', { exact: true }).fill('main');
  await page.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
  await expect(page.getByLabel('현재 프로젝트', { exact: true })).toContainText(projectName);
  await createTask(page, title, original);
  await page.reload();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption({ label: projectName });
  await page.getByRole('button', { name: `업무 상세: ${title}`, exact: true }).click();
  await page.getByText('요청 원문·수용 기준·상태 이력 확인', { exact: true }).click();
  await expect(page.getByText(original, { exact: true })).toBeVisible();
  await expect(page.locator('script').filter({ hasText: 'alert(1)' })).toHaveCount(0);

  const second = await browser.newContext();
  try {
    const secondPage = await second.newPage();
    secondPage.on('pageerror', error => pageErrors.push(error.message));
    await login(secondPage);
    await secondPage.getByLabel('현재 프로젝트', { exact: true }).selectOption({ label: projectName });
    const liveTitle = `실시간 도착 ${suffix}`;
    await createTask(secondPage, liveTitle, '두 번째 브라우저에서 등록한 업무입니다.');
    await expect(page.getByRole('button', { name: `업무 상세: ${liveTitle}`, exact: true })).toBeVisible();
    await expect(page.getByText('시간 정보 없음 KST', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: `업무 상세: ${liveTitle}`, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page.getByLabel('Owner 비밀키', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Owner 비밀키', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `업무 상세: ${title}`, exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await second.close();
  }
});
