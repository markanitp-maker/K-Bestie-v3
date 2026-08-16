import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Debug Login with qatesti-dev and TestChild', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  
  // 1. Try qatesti-dev
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(4000);
  console.log('qatesti-dev login URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/login_qatesti_dev.png' });

  // Clear storage / cookies
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());

  // 2. Try TestChild
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('TestChild');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(4000);
  console.log('TestChild login URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/login_TestChild.png' });
});
