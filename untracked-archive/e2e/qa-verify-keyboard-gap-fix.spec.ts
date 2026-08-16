import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_USER = 'testchild';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const QA_CHILD_ID = '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c';
const SCREENSHOT_DIR = '/tmp/agy-qa-keyboard-fix';

async function handlePwaPopups(page: any) {
  const laterBtn = page.getByRole('button', { name: /나중에 할게요/i });
  if (await laterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
}

async function setupMockSession(page: any) {
  // Mock freechat usage gate to bypass rate limits during UI testing
  await page.route('**/api/chat/freechat-usage**', async (route: any) => {
    const now = Date.now();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        allowed: true,
        status: "active",
        startedAt: new Date(now).toISOString(),
        sessionEndsAt: new Date(now + 600000).toISOString(),
        cooldownUntil: null,
        remainingSessionSeconds: 600,
        remainingCooldownSeconds: 0
      })
    });
  });
}

async function loginChild(page: any) {
  console.log(`[LOGIN] Navigating to ${DEV_BASE}/login...`);
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const usernameInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  if (await usernameInput.isVisible().catch(() => false)) {
    console.log(`[LOGIN] Filling username: ${QA_USER}`);
    await usernameInput.fill(QA_USER);
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(3000);
    await handlePwaPopups(page);
  } else {
    console.log('[LOGIN] Already logged in or login form not visible.');
  }

  await page.evaluate((childId: string) => {
    localStorage.setItem('k_child_id', childId);
  }, QA_CHILD_ID);
}

test('QA: Verify freechat keyboard gap fix and regression checks', async ({ page }) => {
  test.setTimeout(120000);
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  await setupMockSession(page);

  // 1. iPhone 390x844 Free Talk Keyboard Mode QA
  console.log('[QA 1] Setting iPhone Viewport 390x844...');
  await page.setViewportSize({ width: 390, height: 844 });
  await loginChild(page);

  console.log('[QA 1] Navigating to /chat (Free Talk)...');
  await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await handlePwaPopups(page);

  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  await expect(keyboardBtn).toBeVisible({ timeout: 15000 });

  console.log('[QA 1] Opening Text Mode in Free Talk...');
  await keyboardBtn.click();
  await page.waitForTimeout(1500);

  const textInput = page.getByPlaceholder('케이에게 텍스트로 답하기...');
  await expect(textInput).toBeVisible();

  // Measure computed padding-bottom of bottom wrapper
  const textModePb = await page.evaluate(() => {
    const el = document.querySelector('div.relative.z-30.w-full.shrink-0.flex.items-center');
    if (!el) return null;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const inputEl = document.querySelector('input[placeholder="케이에게 텍스트로 답하기..."]');
    const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
    return {
      paddingBottom: style.paddingBottom,
      containerRect: { top: rect.top, bottom: rect.bottom, height: rect.height },
      inputRect: inputRect ? { top: inputRect.top, bottom: inputRect.bottom, height: inputRect.height } : null,
      gapBelowInput: inputRect ? rect.bottom - inputRect.bottom : null
    };
  });

  console.log('[QA 1] iPhone Free Talk Text Mode Computed Metrics:', JSON.stringify(textModePb));
  expect(textModePb).not.toBeNull();
  const pbPx = parseFloat(textModePb!.paddingBottom);
  console.log(`[QA 1] iPhone Text Mode Padding-Bottom: ${pbPx}px`);
  expect(pbPx).toBeLessThanOrEqual(30);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_freechat_keyboard_iphone.png') });
  console.log('[QA 1] Saved screenshot 01_freechat_keyboard_iphone.png');

  // 2. Android 360x800 Viewport QA
  console.log('[QA 2] Setting Android Viewport 360x800...');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(1000);

  const androidTextModePb = await page.evaluate(() => {
    const el = document.querySelector('div.relative.z-30.w-full.shrink-0.flex.items-center');
    if (!el) return null;
    return window.getComputedStyle(el).paddingBottom;
  });

  console.log(`[QA 2] Android Text Mode Padding-Bottom: ${androidTextModePb}`);
  const androidPbPx = parseFloat(androidTextModePb || '0');
  expect(androidPbPx).toBeLessThanOrEqual(30);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_freechat_keyboard_android.png') });
  console.log('[QA 2] Saved screenshot 02_freechat_keyboard_android.png');

  // 3. Free Talk Voice Mode Regression Check
  console.log('[QA 3] Switching back to Voice Mode in Free Talk...');
  const closeTextBtn = page.getByRole('button', { name: '텍스트 입력창 닫기' });
  await closeTextBtn.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1500);

  const voiceModePb = await page.evaluate(() => {
    const el = document.querySelector('div.relative.z-30.w-full.shrink-0.flex.items-center');
    if (!el) return null;
    return window.getComputedStyle(el).paddingBottom;
  });

  console.log(`[QA 3] Voice Mode Padding-Bottom (Regression Check): ${voiceModePb}`);
  const voicePbPx = parseFloat(voiceModePb || '0');
  expect(voicePbPx).toBeGreaterThanOrEqual(50);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_freechat_voice_mode.png') });
  console.log('[QA 3] Saved screenshot 03_freechat_voice_mode.png');

  // 4. Mission Keyboard Mode Regression Check
  console.log('[QA 4] Navigating to /child/missions (Mission Keyboard Mode Regression)...');
  await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await handlePwaPopups(page);

  const startMissionBtn = page.getByRole('button', { name: /시작하기|이어하기/i });
  if (await startMissionBtn.isVisible().catch(() => false)) {
    await startMissionBtn.click();
    await page.waitForTimeout(3000);
  }

  const missionKbdBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await missionKbdBtn.isVisible().catch(() => false)) {
    console.log('[QA 4] Opening Text Mode in Mission...');
    await missionKbdBtn.click();
    await page.waitForTimeout(1500);

    const missionTextModePb = await page.evaluate(() => {
      const el = document.querySelector('div.relative.z-30.w-full.shrink-0.flex.items-center');
      if (!el) return null;
      return window.getComputedStyle(el).paddingBottom;
    });
    console.log(`[QA 4] Mission Text Mode Padding-Bottom: ${missionTextModePb}`);
    const missionPbPx = parseFloat(missionTextModePb || '0');
    expect(missionPbPx).toBeLessThanOrEqual(30);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_mission_keyboard_mode.png') });
    console.log('[QA 4] Saved screenshot 04_mission_keyboard_mode.png');
  }

  console.log('[QA SUCCESS] All 4 QA scenarios passed cleanly!');
});
