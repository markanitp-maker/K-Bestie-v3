import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const OUTPUT_DIR = '/tmp/agy-qa-visual';

test.beforeAll(() => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

async function loginAsChild(page: any) {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const idInput = page.getByPlaceholder(/아이 아이디|아이디/);
  await idInput.fill('qatesti-dev');

  const pwInput = page.getByPlaceholder(/비밀번호/);
  await pwInput.fill(QA_PASSWORD);

  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(2500);

  // Handle any modal/dialog like "나중에 할게요"
  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

test.describe('AGY E2E QA Visual Capture & Verification', () => {
  test('1. 자유대화 화면 비주얼 검증 (iPhone 390x844 & Android 412x915)', async ({ page }) => {
    test.setTimeout(60000);
    await loginAsChild(page);

    // Go to freechat
    await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // 1-1. iPhone (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'freechat_iphone_390x844.png'), fullPage: false });
    console.log('[Freechat] Captured freechat_iphone_390x844.png');

    // 1-2. Android (412x915)
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'freechat_android_412x915.png'), fullPage: false });
    console.log('[Freechat] Captured freechat_android_412x915.png');

    // Verification 1: No progress gauge / star gauge
    const progressCount = await page.locator('[role="progressbar"], [class*="progress"]').count();
    const starTextCount = await page.locator('text="1 / 3"').count();
    console.log('[Freechat Check 1] Progress bar / Star text count:', progressCount, starTextCount);

    // Verification 2: Sound card on mascot left (should NOT exist)
    const soundCardCount = await page.locator('text="소리 켜짐"').count() + await page.locator('text="소리 꺼짐"').count();
    console.log('[Freechat Check 2] Sound card count:', soundCardCount);

    // Verification 3: Mascot scale / Halo check (presence of halo container / img)
    const mascotImg = page.locator('img[alt*="케이"], img[src*="mascot"], img[alt*="mascot"]').first();
    const hasMascot = await mascotImg.count() > 0;
    console.log('[Freechat Check 3] Mascot present:', hasMascot);

    // Verification 4: Auto/Manual pill toggle
    const autoPill = page.getByRole('button', { name: '자동' });
    const manualPill = page.getByRole('button', { name: '수동' });
    const hasPillToggle = (await autoPill.count() > 0) || (await manualPill.count() > 0);
    console.log('[Freechat Check 4] Pill toggle present:', hasPillToggle);

    // Verification 5: Horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log('[Freechat Check 5] Horizontal overflow:', hasHorizontalOverflow);

    expect(progressCount).toBe(0);
    expect(starTextCount).toBe(0);
    expect(soundCardCount).toBe(0);
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('2. 미션(오늘의 미션) 화면 비주얼 검증 (iPhone 390x844, Android 360x800, Android 412x915)', async ({ page }) => {
    test.setTimeout(60000);
    await loginAsChild(page);

    // Go to mission
    await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Start mission if button present
    const startBtn = page.getByRole('button', { name: /시작하기|이어하기|미션 수행/ });
    if (await startBtn.count().catch(() => 0)) {
      await startBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    // 2-1. iPhone (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'mission_iphone_390x844.png'), fullPage: false });
    console.log('[Mission] Captured mission_iphone_390x844.png');

    // 2-2. Android (360x800)
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'mission_android_360x800.png'), fullPage: false });
    console.log('[Mission] Captured mission_android_360x800.png');

    // 2-3. Android (412x915)
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'mission_android_412x915.png'), fullPage: false });
    console.log('[Mission] Captured mission_android_412x915.png');

    // Check vertical layout structure (utterances & mascot spacing)
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log('[Mission Check 1] Horizontal overflow:', hasHorizontalOverflow);

    expect(hasHorizontalOverflow).toBe(false);
  });
});
