import { test } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Inspect Login and Child Selection', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  console.log('After login URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/inspect_login_url.png', fullPage: true });
  console.log('Body Text after login:', (await page.innerText('body')).slice(0, 1000));

  // Check if there is a child selection or onboarding skip button
  const buttons = await page.locator('button, a').allInnerTexts();
  console.log('Buttons/Links after login:', buttons);

  // Try going directly to /child/home, /chat, /mission
  for (const path of ['/child/home', '/chat', '/mission', '/child/chat', '/child/missions']) {
    await page.goto(`${DEV_BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    console.log(`Visited ${path} -> final URL:`, page.url());
    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    console.log(`Body text snippet for ${path}:`, (await page.innerText('body')).slice(0, 300));
  }
});
