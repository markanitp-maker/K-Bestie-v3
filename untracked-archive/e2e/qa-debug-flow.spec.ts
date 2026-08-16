import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Inspect onboarding / home flow for qatesti-dev', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  console.log('URL 1:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/flow_1.png', fullPage: true });
  console.log('Body Text 1:', (await page.innerText('body')).slice(0, 500));

  // If there are buttons or links on onboarding page, let's list them
  const buttons = await page.locator('button, a').allInnerTexts();
  console.log('Buttons/Links on flow_1:', buttons);

  // Try clicking next or direct navigate to /child/home
  await page.goto(`${DEV_BASE}/child/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  console.log('URL 2 (/child/home):', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/flow_2_child_home.png', fullPage: true });
  console.log('Body Text 2:', (await page.innerText('body')).slice(0, 500));

  // Try direct navigate to /chat
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  console.log('URL 3 (/chat):', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/flow_3_chat.png', fullPage: true });
});
