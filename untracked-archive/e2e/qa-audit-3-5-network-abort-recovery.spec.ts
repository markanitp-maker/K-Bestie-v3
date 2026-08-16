import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_USER = 'qatesti-dev';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const QA_CHILD_ID = 'fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9';
const EVIDENCE_DIR = '/tmp/agy-qa-audit-3-5';

test.describe('V2->V3 마감 감사 3/5: Network Abort Recovery & Zombie Prevention', () => {
  test('Complete Turn 1 & 2 -> Abort Turn 3 -> Verify Path A (Retry) & Path B (Reload)', async ({ page }) => {
    test.setTimeout(300_000); // 5 minutes
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const requestLogs: Array<{ url: string; method: string; status?: number; time: string }> = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/mission')) {
        requestLogs.push({
          url: url.replace(DEV_BASE, ''),
          method: req.method(),
          time: new Date().toISOString(),
        });
        console.log(`[REQ] ${req.method()} ${url.replace(DEV_BASE, '')}`);
      }
    });

    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/mission')) {
        const last = requestLogs.filter((r) => r.url === url.replace(DEV_BASE, '')).pop();
        if (last) last.status = res.status();
        console.log(`[RES] ${res.status()} ${url.replace(DEV_BASE, '')}`);
      }
    });

    async function dismissModals() {
      const closeButtons = page.locator('button:has-text("닫기"), button:has-text("나중에"), button:has-text("확인"), [aria-label="닫기"]');
      const count = await closeButtons.count();
      for (let i = 0; i < count; i++) {
        if (await closeButtons.nth(i).isVisible().catch(() => false)) {
          await closeButtons.nth(i).click().catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    }

    async function ensureTextMode() {
      const textBtn = page.locator('button:has-text("텍스트"), button[aria-label="텍스트로 입력"], button[aria-label="키보드로 입력"]');
      if ((await textBtn.count()) > 0 && (await textBtn.first().isVisible().catch(() => false))) {
        await textBtn.first().click();
        await page.waitForTimeout(500);
      }
    }

    async function sendAnswer(text: string) {
      await ensureTextMode();
      const input = page.locator('input[placeholder*="텍스트로 답하기"], input[placeholder*="메시지"], textarea[placeholder*="메시지"]').first();
      await input.waitFor({ state: 'visible', timeout: 25000 });
      await input.fill(text);
      await page.waitForTimeout(300);
      const sendBtn = page.locator('button[aria-label="전송"]');
      if ((await sendBtn.count()) > 0 && (await sendBtn.first().isVisible().catch(() => false))) {
        await sendBtn.first().click();
      } else {
        await page.keyboard.press('Enter');
      }
    }

    // Step 1: Login
    console.log('--- STEP 1: Login on Dev ---');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill(QA_USER);
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(3000);

    await page.evaluate((cid) => {
      localStorage.setItem('k_child_id', cid);
      localStorage.setItem('login_role', 'member');
    }, QA_CHILD_ID);

    await dismissModals();

    // Step 2: Open Mission Page
    console.log('--- STEP 2: Navigate to /child/missions ---');
    await page.goto(`${DEV_BASE}/child/missions?childId=${QA_CHILD_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await dismissModals();

    // Start / Resume button
    const restartBtn = page.locator('button:has-text("다시 할래요"), button:has-text("다시 시작")');
    if ((await restartBtn.count()) > 0 && (await restartBtn.first().isVisible().catch(() => false))) {
      await restartBtn.first().click();
      await page.waitForTimeout(2000);
      await dismissModals();
    }

    const startBtn = page.locator('button:has-text("시작하기"), button:has-text("이어하기"), [data-ui="current-bubble"] button');
    if ((await startBtn.count()) > 0 && (await startBtn.first().isVisible().catch(() => false))) {
      await startBtn.first().click();
      await page.waitForTimeout(3000);
    }
    await dismissModals();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_mission_active.png') });

    // Step 3: Turn 1 (Greeting)
    console.log('--- STEP 3: Turn 1 (Greeting) ---');
    await sendAnswer('안녕 케이야! 오늘 하루도 반가워');
    await page.waitForResponse(
      (res) => res.url().includes('/api/mission/v3/turn') && res.status() === 200,
      { timeout: 45000 }
    );
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_turn1_completed.png') });

    // Step 4: Turn 2 (Q1)
    console.log('--- STEP 4: Turn 2 (Q1) ---');
    await sendAnswer('오늘 학교에서 친구들이랑 신나게 축구 게임을 했어');
    await page.waitForResponse(
      (res) => res.url().includes('/api/mission/v3/turn') && res.status() === 200,
      { timeout: 45000 }
    );
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_turn2_completed.png') });

    // =========================================================================
    // STEP 5: Ingress Network Abort on Turn 3 & Test PATH A (Retry)
    // =========================================================================
    console.log('--- STEP 5: Turn 3 Network Abort Ingress ---');

    // Route abort on next /api/mission/v3/turn call
    let turn3Aborted = false;
    await page.route('**/api/mission/v3/turn', (route) => {
      if (!turn3Aborted) {
        console.log('[FAULT INJECTED] Aborting /api/mission/v3/turn request in flight');
        turn3Aborted = true;
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await sendAnswer('점심에 돈까스랑 샐러드가 나와서 맛있게 다 먹었어');

    // Wait for error / retry popup
    console.log('Waiting for retry popup on UI...');
    const retryBtn = page.getByRole('button', { name: '다시 시도' });
    await retryBtn.waitFor({ state: 'visible', timeout: 30000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_turn3_aborted_popup.png') });
    console.log('[PATH A] Error overlay confirmed with "다시 시도" button.');

    // Unroute before clicking retry so retry request succeeds
    await page.unroute('**/api/mission/v3/turn');

    console.log('[PATH A] Clicking "다시 시도" button...');
    const [retryResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/mission/v3/turn') && res.status() === 200,
        { timeout: 45000 }
      ),
      retryBtn.click(),
    ]);

    console.log(`[PATH A] Retry succeeded with HTTP ${retryResponse.status()}`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_path_a_recovered.png') });

    // Verify UI is interactive
    await ensureTextMode();
    const inputAfterRetry = page.locator('input[placeholder*="텍스트로 답하기"], input[placeholder*="메시지"], textarea[placeholder*="메시지"]').first();
    expect(await inputAfterRetry.isVisible()).toBeTruthy();
    console.log('[PATH A SUCCESS] UI returned to interactive conversation state.');

    // =========================================================================
    // STEP 6: Ingress Network Abort on Turn 4 & Test PATH B (Reload / Reentry)
    // =========================================================================
    console.log('--- STEP 6: Turn 4 Network Abort & Test PATH B (Reload / Reentry) ---');

    let turn4Aborted = false;
    await page.route('**/api/mission/v3/turn', (route) => {
      if (!turn4Aborted) {
        console.log('[FAULT INJECTED] Aborting Turn 4 /api/mission/v3/turn request');
        turn4Aborted = true;
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await sendAnswer('방과후에 학원에 가서 수학 분수 문제를 열심히 풀었어');
    await retryBtn.waitFor({ state: 'visible', timeout: 30000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06_turn4_aborted_popup.png') });
    console.log('[PATH B] Error overlay confirmed. Now reloading / navigating to /child/missions...');

    await page.unroute('**/api/mission/v3/turn');

    // Reload page / Reenter
    await page.goto(`${DEV_BASE}/child/missions?childId=${QA_CHILD_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await dismissModals();

    // If resume button is present on ready screen, click it
    const resumeBtn = page.locator('button:has-text("이어하기"), button:has-text("시작하기"), [data-ui="current-bubble"] button');
    if ((await resumeBtn.count()) > 0 && (await resumeBtn.first().isVisible().catch(() => false))) {
      console.log('[PATH B] Clicking "이어하기" / start button...');
      await resumeBtn.first().click();
      await page.waitForTimeout(3000);
    }
    await dismissModals();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '07_path_b_reentered.png') });

    // Verify UI is interactive and send a turn to confirm full conversation flow
    console.log('[PATH B] Sending continuation turn to verify full interactive state...');
    await sendAnswer('케이야 다시 대화 이어가자!');
    const turnResFinal = await page.waitForResponse(
      (res) => res.url().includes('/api/mission/v3/turn') && res.status() === 200,
      { timeout: 45000 }
    );
    console.log(`[PATH B] Continuation turn responded with HTTP ${turnResFinal.status()}`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '08_path_b_fully_interactive.png') });

    console.log('\n=== AUDIT 3/5 PLAYWRIGHT E2E EXECUTION COMPLETED ===');
    console.log('Request logs recorded:');
    requestLogs.forEach((l) => console.log(`  - [${l.method}] ${l.url} -> ${l.status ?? 'aborted'}`));
  });
});
