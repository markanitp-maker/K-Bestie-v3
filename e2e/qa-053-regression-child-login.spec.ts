import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';

test('QA-053 회귀: 053 배포 후 기존 아이 계정(testi02) 로그인·홈 접근 정상', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="text"]').fill('testi02');
  await page.locator('input[type="password"]').fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await page.waitForURL('**/child**', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('Application error');
  expect(page.url()).toContain('/child');
});
