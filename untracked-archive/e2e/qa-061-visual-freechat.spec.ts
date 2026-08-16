import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

async function loginAsChild(page: any) {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(2500);

  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const laterBtn2 = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn2.count().catch(() => 0)) {
    await laterBtn2.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

test('B. 061 자유대화 화면 비주얼 검증 (iPhone 390x844 & Android 412x915)', async ({ page }) => {
  test.setTimeout(60000);
  await loginAsChild(page);

  // 1. Viewport: iPhone (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/B_iphone_390x844.png', fullPage: false });

  // 2. Viewport: Android (412x915)
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/agy-qa-071-061-064/B_android_412x915.png', fullPage: false });

  // DOM Checks
  const bodyText = await page.innerText('body');

  // Check 1: Progress / Star gauge (should NOT exist in /chat)
  const progressCount = await page.locator('[class*="progress"], [role="progressbar"], [aria-label*="진행률"]').count();
  const starCount = await page.locator('text="☆"', 'text="★"', 'text="1 / 3"').count();
  console.log('[B Check 1] Progress/Star count:', progressCount, starCount);

  // Check 2: Mute/Sound card on left of mascot (should NOT exist)
  const soundCardCount = await page.locator('text="소리 켜짐"', 'text="소리 꺼짐"').count();
  console.log('[B Check 2] Sound card count:', soundCardCount);

  // Check 3: Auto/Manual pill toggle exists
  const autoBtn = page.getByRole('button', { name: '자동' });
  const manualBtn = page.getByRole('button', { name: '수동' });
  const hasPillToggle = (await autoBtn.count() > 0) && (await manualBtn.count() > 0);
  console.log('[B Check 3] Pill toggle present:', hasPillToggle);

  // Check 4: Horizontal scroll check
  const hasHorizontalOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log('[B Check 4] Horizontal overflow:', hasHorizontalOverflow);

  // Summary assertions
  expect(starCount).toBe(0);
  expect(soundCardCount).toBe(0);
  expect(hasPillToggle).toBe(true);
  expect(hasHorizontalOverflow).toBe(false);

  console.log('B Visual Test PASSED cleanly.');
});
