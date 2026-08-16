import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Test login flow with qatesti-dev and TestChild', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });

  console.log('--- Testing qatesti-dev login ---');
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  console.log('After qatesti-dev login URL:', page.url());
  const ls1 = await page.evaluate(() => ({ ...localStorage }));
  console.log('qatesti-dev localStorage:', ls1);

  console.log('--- Testing TestChild login ---');
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());

  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('TestChild');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  console.log('After TestChild login URL:', page.url());
  const ls2 = await page.evaluate(() => ({ ...localStorage }));
  console.log('TestChild localStorage:', ls2);
});
