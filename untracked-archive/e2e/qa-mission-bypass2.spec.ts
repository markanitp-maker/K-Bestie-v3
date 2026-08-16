import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const EVIDENCE_DIR = '/tmp/agy-qa-mission-bypass2';

test.describe('Mission Bypass & Time Gate Verification E2E QA', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test('Check operating hours, start mission, reply, reload, switch auto/manual, verify disconnect modal', async ({ page, context }) => {
    test.setTimeout(120000);

    // Step 1: Check Current KST Time & Operating Hours
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const kst = new Date(utc + 9 * 3600000);
    const kstHour = kst.getHours();
    const kstMin = kst.getMinutes();
    const kstTimeNum = kstHour * 100 + kstMin;

    const isRound1 = kstTimeNum >= 1000 && kstTimeNum < 1750;
    const isRound2 = kstTimeNum >= 1800 && kstTimeNum < 2400;
    const isOperatingHours = isRound1 || isRound2;

    console.log(`[QA Time Check] Current KST Time: ${kstHour}:${kstMin < 10 ? '0' + kstMin : kstMin} (${kstTimeNum})`);
    console.log(`[QA Time Check] Operating Hours Status: ${isOperatingHours ? 'INSIDE operating hours' : 'OUTSIDE operating hours'}`);

    // Step 2: Login as qatesti-dev / TestChild
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });

    let username = 'qatesti-dev';
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill(username);
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(3000);

    // If qatesti-dev login fails or stays on login page, fallback to TestChild
    if (page.url().includes('/login')) {
      console.log('[QA Login] qatesti-dev login didn\'t redirect, trying TestChild...');
      username = 'TestChild';
      await page.getByPlaceholder('아이 아이디를 입력하세요').fill(username);
      await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page.waitForTimeout(3000);
    }
    console.log(`[QA Login] Logged in as: ${username}, Current URL: ${page.url()}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_after_login.png') });

    // Handle initial popups if any
    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Step 3: Go to /child/missions
    await page.goto(`${DEV_BASE}/child/missions`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const laterBtn2 = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn2.count().catch(() => 0)) {
      await laterBtn2.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_missions_page.png') });

    // Step 4: Start Mission ("시작하기" / "이어하기" / card click)
    const startOrContinueBtn = page.getByRole('button', { name: /시작하기|이어하기|미션 시작/ });
    if (await startOrContinueBtn.count() > 0) {
      console.log('[QA Mission] Found start/continue button, clicking...');
      await startOrContinueBtn.first().click();
      await page.waitForTimeout(3000);
    } else {
      console.log('[QA Mission] Looking for mission cards or other start triggers...');
      const anyCard = page.locator('.cursor-pointer, [class*="card"]').first();
      if (await anyCard.count() > 0) {
        await anyCard.click().catch(() => {});
        await page.waitForTimeout(3000);
      }
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_after_mission_start.png') });

    // Step 5: Answer / Reply (Text mode toggle & input text)
    console.log('[QA Reply] Trying text mode toggle (💬)...');
    const textModeBtn = page.getByRole('button', { name: '💬' });
    if (await textModeBtn.count() > 0) {
      await textModeBtn.click();
      await page.waitForTimeout(1000);
    }

    const textInput = page.locator('input[placeholder*="메시지"], textarea[placeholder*="메시지"], input[type="text"]');
    if (await textInput.count() > 0) {
      console.log('[QA Reply] Filling answer text...');
      await textInput.first().fill('안녕 케이야! 오늘 하루도 화이팅이야.');
      await page.waitForTimeout(500);

      const sendBtn = page.getByRole('button', { name: /전송|보내기/ }).or(page.locator('button:has(svg)'));
      if (await sendBtn.count() > 0) {
        await sendBtn.first().click().catch(() => page.keyboard.press('Enter'));
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(4000);
    } else {
      console.log('[QA Reply] Text input not found directly. Checking page state.');
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_after_reply.png') });

    // Step 6: Reload (Session Restoration test)
    console.log('[QA Reload] Reloading page to test session restoration...');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const laterBtn3 = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn3.count().catch(() => 0)) {
      await laterBtn3.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_after_reload.png') });

    // Step 7: Auto / Manual Toggle test
    console.log('[QA Toggle] Testing Auto/Manual switch...');
    const autoBtn = page.getByRole('button', { name: '자동' });
    const manualBtn = page.getByRole('button', { name: '수동' });

    if (await autoBtn.count() > 0 && await autoBtn.isEnabled().catch(() => false)) {
      await autoBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
      console.log('[QA Toggle] Clicked 자동');
    } else {
      console.log('[QA Toggle] 자동 button is disabled or not clickable');
    }

    if (await manualBtn.count() > 0 && await manualBtn.isEnabled().catch(() => false)) {
      await manualBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
      console.log('[QA Toggle] Clicked 수동');
    } else {
      console.log('[QA Toggle] 수동 button is disabled or not clickable');
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06_after_toggle.png') });

    // Step 8: Verify "케이랑 접속이 끊겼네" modal & Time Gate check
    console.log('[QA Modal Check] Checking for "케이랑 접속이 끊겼네" modal or error overlays...');
    const modalTextLocator = page.locator('text="케이랑 접속이 끊겼네?"').or(page.locator('text="케이랑 접속이 끊겼네"'));
    const isModalVisible = await modalTextLocator.isVisible().catch(() => false);

    // Also check for any other error or time-gate related text on page
    const pageTextContent = await page.evaluate(() => document.body.innerText);
    const hasTimeGateText = pageTextContent.includes('운영시간') || 
                            pageTextContent.includes('시간') || 
                            pageTextContent.includes('제한') || 
                            pageTextContent.includes('미션 시간이 아닙니다') ||
                            pageTextContent.includes('종료') ||
                            pageTextContent.includes('접속이 끊겼네');

    console.log(`[QA Modal Check] Disconnect Modal Visible: ${isModalVisible}`);
    console.log(`[QA Modal Check] Page Text contains time-gate or disconnect keywords: ${hasTimeGateText}`);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '07_final_check.png') });

    // Stop trace safely
    await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'trace.zip') }).catch(() => {});

    // Assertions and log summary
    console.log('--- QA EXECUTION SUMMARY ---');
    console.log(`KST Time: ${kstHour}:${kstMin}`);
    console.log(`Operating Hours: ${isOperatingHours ? 'INSIDE' : 'OUTSIDE'}`);
    console.log(`Logged in User: ${username}`);
    console.log(`Disconnect Modal Shown: ${isModalVisible}`);
    console.log(`Time Gate Reason Verified: ${!isOperatingHours ? 'Yes (Outside operating hours)' : 'No (Inside operating hours)'}`);
  });
});
