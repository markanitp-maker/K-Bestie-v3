import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

async function loginAndDismiss(page: any) {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(2000);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

test('B. 061 자유대화 화면 비주얼 검증 (iPhone 390x844 & Android 412x915)', async ({ page }) => {
  test.setTimeout(90000);
  await loginAndDismiss(page);

  // Go to /chat
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Viewport 1: iPhone (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/B_iphone_390x844.png', fullPage: false });

  // Viewport 2: Android (412x915)
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/B_android_412x915.png', fullPage: false });

  // Check visual elements in DOM
  const pageText = await page.innerText('body');
  
  // 1. Progress / Star gauge check (should NOT exist in /chat)
  const progressGaugeCount = await page.locator('[class*="progress"], [role="progressbar"], [aria-label*="진행률"]').count();
  console.log('[B Visual] Progress gauge count:', progressGaugeCount);

  // 2. Mute/Sound card on left of mascot (should NOT exist)
  const soundCardCount = await page.locator('text="소리 켜짐"', 'text="소리 꺼짐"').count();
  console.log('[B Visual] Sound card count:', soundCardCount);

  // 3. Check horizontal scroll overflow
  const overflowiPhone = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log('[B Visual] Horizontal overflow (iPhone 390):', overflowiPhone);
});
