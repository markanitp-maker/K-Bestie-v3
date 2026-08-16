import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('Debug Login and Route Test', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  console.log('Login page loaded');

  // Fill in child login info
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('testchild');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  
  await page.waitForTimeout(3000);
  console.log('After login click URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/debug_after_login.png' });

  // Handle any popup or onboarding if redirected
  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Try direct navigation to freechat (/chat or /child/chat)
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('Direct /chat URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/debug_chat.png' });

  // Try /child/chat
  await page.goto(`${DEV_BASE}/child/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('Direct /child/chat URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/debug_child_chat.png' });

  // Try /child/missions
  await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('Direct /child/missions URL:', page.url());
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/debug_child_missions.png' });
});
