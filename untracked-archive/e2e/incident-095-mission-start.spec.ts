import { test, expect } from '@playwright/test';

/**
 * 2026-08-14 장애 최종 검증 — 저녁(17:50 이후)에 미션을 실제로 시작할 수 있는가.
 *
 * 장애 당시 아이는 미션 화면에 들어가는 순간 "케이랑 접속이 끊겼네?"에 막혀
 * 미션 세션이 생성조차 되지 않았다. 진입만이 아니라 「미션 시작하기」를 눌러
 * 서버에 세션이 만들어지는 것까지 확인한다.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://app.k-bestie.com';
const USERNAME = process.env.QA_CHILD_USERNAME || 'psh160202';

test('장애 095 최종: 저녁에도 미션이 시작된다', async ({ page }) => {
  test.setTimeout(180000);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill(USERNAME);
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: /나중에 할게요/ }).click({ timeout: 20000 }).catch(() => {});
  await page.waitForURL('**/child**', { timeout: 30000 });

  const startCalls: string[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/mission/v3/start')) startCalls.push(`${res.status()}`);
  });

  await page.goto(`${BASE}/child/missions`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const beforeStart = await page.locator('body').innerText();
  console.log('[095] 진입 화면:', beforeStart.replace(/\s+/g, ' ').slice(0, 200));
  expect(beforeStart, '진입만으로 재시도 오버레이가 뜨면 안 된다').not.toContain('케이랑 접속이 끊겼네');

  const startButton = page.getByRole('button', { name: /미션 시작하기|미션 이어하기/ });
  await expect(startButton).toBeVisible({ timeout: 15000 });
  await startButton.click();
  await page.waitForTimeout(12000);

  const afterStart = await page.locator('body').innerText();
  console.log('[095] 시작 후 화면:', afterStart.replace(/\s+/g, ' ').slice(0, 250));
  console.log('[095] /api/mission/v3/start 응답:', startCalls);

  expect(startCalls.length, '시작을 눌렀으면 서버에 세션 생성 요청이 가야 한다').toBeGreaterThan(0);
  expect(startCalls.some((s) => s === '200'), `start 응답: ${startCalls.join(',')}`).toBe(true);
});
