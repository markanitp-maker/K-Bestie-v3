import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_CHILD_ID = '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const EVIDENCE_DIR = '/tmp/agy-qa-mission-retry';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

interface TurnMetric {
  turnName: string;
  questionPrompt: string;
  childAnswer: string;
  submitTime: number;
  responseReceivedTime: number;
  elapsedMs: number;
  kResponseText: string;
}

test('QA-Mission-Retry-Fix: Complete E2E Verification Suite on Dev', async ({ page }) => {
  test.setTimeout(300000);

  const consoleLogs: Array<{ type: string; text: string; time: string }> = [];
  const networkLogs: Array<{ url: string; method: string; status: number; durationMs?: number; time: string }> = [];
  const metrics: TurnMetric[] = [];
  let retryPopupEncountered = false;
  let disconnectPopupEncountered = false;

  // 1. Setup console & network listeners
  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    consoleLogs.push({ type, text, time: new Date().toISOString() });
    if (
      text.includes('다시 시도') ||
      text.includes('turn_retry') ||
      text.includes('재시도') ||
      text.includes('TURN_IN_PROGRESS') ||
      text.includes('409') ||
      text.includes('error') ||
      text.includes('FAIL')
    ) {
      console.log(`[Browser Console (${type})]: ${text}`);
    }
  });

  page.on('pageerror', (err) => {
    consoleLogs.push({ type: 'pageerror', text: err.message, time: new Date().toISOString() });
    console.error(`[Page Error]: ${err.message}`);
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/mission')) {
      const status = res.status();
      const time = new Date().toISOString();
      networkLogs.push({
        url,
        method: res.request().method(),
        status,
        time,
      });
      console.log(`[API Response] ${res.request().method()} ${url} -> ${status}`);
    }
  });

  // Helper: dismiss any PWA modal or popup
  async function dismissModals() {
    for (let i = 0; i < 3; i++) {
      const pwaDismiss = page.locator('button:has-text("나중에 할게요"), button:has-text("나중에 할게요 →")');
      if ((await pwaDismiss.count()) > 0 && (await pwaDismiss.first().isVisible().catch(() => false))) {
        console.log('[Modal] Dismissing PWA prompt...');
        await pwaDismiss.first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  // Helper: check for retry/disconnect popups
  async function checkForRetryPopups(): Promise<{ hasRetry: boolean; hasDisconnect: boolean; details: string }> {
    const retryModal = page.locator('text="대화를 저장하는 중 문제가 생겼어요"');
    const disconnectModal = page.locator('text="케이랑 접속이 끊겼네"');
    const retryBtn = page.locator('button:has-text("다시 시도")');
    
    let hasRetry = false;
    let hasDisconnect = false;
    let details = '';

    if (await retryModal.isVisible().catch(() => false)) {
      hasRetry = true;
      details += ' [Found "대화를 저장하는 중 문제가 생겼어요"]';
    }
    if (await disconnectModal.isVisible().catch(() => false)) {
      hasDisconnect = true;
      details += ' [Found "케이랑 접속이 끊겼네"]';
    }
    if (await retryBtn.isVisible().catch(() => false)) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (bodyText.includes('대화를 저장하는 중') || bodyText.includes('문제가 생겼어요')) {
        hasRetry = true;
        details += ' [Found "다시 시도" button in retry screen]';
      }
    }

    if (hasRetry) retryPopupEncountered = true;
    if (hasDisconnect) disconnectPopupEncountered = true;

    return { hasRetry, hasDisconnect, details };
  }

  // Helper: get current K utterance text
  async function getLatestKBubble(): Promise<string> {
    const currentBubble = page.locator('[data-ui="current-bubble"] p');
    if ((await currentBubble.count()) > 0 && (await currentBubble.first().isVisible().catch(() => false))) {
      return (await currentBubble.first().innerText().catch(() => '')).trim();
    }
    return await page.evaluate(() => {
      const pElements = Array.from(document.querySelectorAll('p'));
      const kBubbles = pElements.filter(
        (p) => !p.className.includes('text-white') && p.textContent && p.textContent.trim().length > 0
      );
      return kBubbles.length > 0 ? kBubbles[kBubbles.length - 1].textContent?.trim() || '' : '';
    });
  }

  // Helper: ensure text mode is active
  async function ensureTextMode() {
    await dismissModals();
    
    // Switch to manual mode first to stop any voice recording lock
    const manualBtn = page.locator('button:has-text("수동")');
    if ((await manualBtn.count()) > 0 && (await manualBtn.first().isVisible().catch(() => false))) {
      const isPressed = await manualBtn.first().getAttribute('aria-pressed');
      if (isPressed !== 'true') {
        console.log('[Mode] Switching to manual mode...');
        await manualBtn.first().click().catch(() => {});
        await page.waitForTimeout(400);
      }
    }

    const input = page.locator('input[placeholder*="텍스트로 답하기"], input[placeholder*="메시지"], textarea[placeholder*="메시지"]');
    if ((await input.count()) === 0 || !(await input.first().isVisible().catch(() => false))) {
      const keyboardBtn = page.locator('button[aria-label="텍스트로 답하기"]');
      if ((await keyboardBtn.count()) > 0 && (await keyboardBtn.first().isVisible().catch(() => false))) {
        console.log('[Mode] Clicking keyboard button...');
        await keyboardBtn.first().click().catch(() => {});
        await page.waitForTimeout(600);
      }
    }
  }

  // Helper: send answer and measure round-trip time
  async function sendAnswerAndWait(answerText: string, turnLabel: string): Promise<TurnMetric> {
    await ensureTextMode();
    const input = page.locator('input[placeholder*="텍스트로 답하기"], input[placeholder*="메시지"], textarea[placeholder*="메시지"]').first();
    await input.waitFor({ state: 'visible', timeout: 20000 });
    
    const kTextBefore = await getLatestKBubble();
    console.log(`[${turnLabel}] K prompt before answering: "${kTextBefore}"`);

    await input.fill(answerText);
    const submitTime = Date.now();

    const sendBtn = page.locator('button[aria-label="전송"]');
    if ((await sendBtn.count()) > 0 && (await sendBtn.first().isVisible().catch(() => false))) {
      await sendBtn.first().click();
    } else {
      await page.keyboard.press('Enter');
    }

    console.log(`[${turnLabel}] Submitted answer: "${answerText}" at ${new Date(submitTime).toISOString()}`);

    // Wait for response or state transition
    let responseReceivedTime = 0;
    let kResponseText = '';

    const startTime = Date.now();
    while (Date.now() - startTime < 40000) {
      await page.waitForTimeout(500);

      // Check for retry popup during waiting period
      const popupCheck = await checkForRetryPopups();
      if (popupCheck.hasRetry || popupCheck.hasDisconnect) {
        console.error(`[${turnLabel}] Error/Retry popup detected during wait! ${popupCheck.details}`);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `popup-error-${turnLabel}.png`) });
      }

      const currentKText = await getLatestKBubble();
      if (currentKText && currentKText !== kTextBefore && !currentKText.includes('확인하고') && !currentKText.includes('준비')) {
        responseReceivedTime = Date.now();
        kResponseText = currentKText;
        break;
      }
    }

    if (responseReceivedTime === 0) {
      responseReceivedTime = Date.now();
      kResponseText = await getLatestKBubble();
      console.warn(`[${turnLabel}] Timed out waiting for distinct K bubble update. Last bubble: "${kResponseText}"`);
    }

    const elapsedMs = responseReceivedTime - submitTime;
    console.log(`[${turnLabel}] K response received in ${elapsedMs}ms: "${kResponseText}"`);

    const metric: TurnMetric = {
      turnName: turnLabel,
      questionPrompt: kTextBefore,
      childAnswer: answerText,
      submitTime,
      responseReceivedTime,
      elapsedMs,
      kResponseText,
    };
    metrics.push(metric);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, `turn-${turnLabel}.png`) });
    return metric;
  }

  // ==========================================
  // STEP 1: Login as child (qatesti-dev)
  // ==========================================
  console.log('--- STEP 1: Login ---');
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '01_login_page.png') });

  await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForTimeout(3000);

  // Set childId in localStorage
  await page.evaluate((cid) => {
    localStorage.setItem('k_child_id', cid);
    localStorage.setItem('login_role', 'member');
  }, QA_CHILD_ID);

  await dismissModals();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '02_after_login.png') });

  // ==========================================
  // STEP 2: Navigate to Missions
  // ==========================================
  console.log('--- STEP 2: Navigate to Missions ---');
  await page.goto(`${DEV_BASE}/child/missions?childId=${QA_CHILD_ID}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await dismissModals();

  // Handle "다시 할래요" (if already completed today) or "시작하기" / "이어하기"
  const restartBtn = page.locator('button:has-text("다시 할래요"), button:has-text("다시 시작")');
  if ((await restartBtn.count()) > 0 && (await restartBtn.first().isVisible().catch(() => false))) {
    console.log('[Mission Entry] Clicking "다시 할래요" button...');
    await restartBtn.first().click();
    await page.waitForTimeout(2000);
    await dismissModals();
  }

  // Check for start/resume button inside the bubble or bottom CTA
  const startBtn = page.locator('button:has-text("시작하기"), button:has-text("이어하기"), [data-ui="current-bubble"] button');
  if ((await startBtn.count()) > 0 && (await startBtn.first().isVisible().catch(() => false))) {
    console.log('[Mission Entry] Clicking Start/Resume button...');
    await startBtn.first().click();
    await page.waitForTimeout(3000);
  }

  await dismissModals();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '03_mission_started.png') });

  // ==========================================
  // SCENARIO 1: Greeting Turn & Normal Progress
  // ==========================================
  console.log('--- SCENARIO 1: Greeting turn and Question flow ---');
  
  // 1-1 Greeting Turn
  const greetingMetric = await sendAnswerAndWait('안녕 케이야! 오늘 하루도 정말 반가워', 'greeting_turn');
  expect(greetingMetric.elapsedMs).toBeLessThan(35000);

  // Check popups after greeting turn
  const popupAfterGreeting = await checkForRetryPopups();
  expect(popupAfterGreeting.hasRetry, `Retry popup should not appear after greeting: ${popupAfterGreeting.details}`).toBeFalsy();

  // 1-2 Question 1
  await page.waitForTimeout(1500);
  const q1Metric = await sendAnswerAndWait('오늘 학교에서 친구들이랑 신나게 축구랑 피구 놀이를 했어!', 'question_1');

  const popupAfterQ1 = await checkForRetryPopups();
  expect(popupAfterQ1.hasRetry, `Retry popup should not appear after Q1: ${popupAfterQ1.details}`).toBeFalsy();

  // 1-3 Question 2
  await page.waitForTimeout(1500);
  const q2Metric = await sendAnswerAndWait('점심식사로 맛있는 돈까스랑 샐러드가 나와서 다 깨끗하게 먹었어', 'question_2');

  const popupAfterQ2 = await checkForRetryPopups();
  expect(popupAfterQ2.hasRetry, `Retry popup should not appear after Q2: ${popupAfterQ2.details}`).toBeFalsy();

  // ==========================================
  // SCENARIO 2: Refresh Recovery
  // ==========================================
  console.log('--- SCENARIO 2: Refresh Recovery during mission ---');
  
  await ensureTextMode();
  const inputForQ3 = page.locator('input[placeholder*="텍스트로 답하기"], input[placeholder*="메시지"], textarea[placeholder*="메시지"]').first();
  await inputForQ3.waitFor({ state: 'visible', timeout: 20000 });
  await inputForQ3.fill('수학 시간에 분수와 소수를 배웠는데 조금 어려웠지만 집중해서 풀었어');
  
  const sendBtnQ3 = page.locator('button[aria-label="전송"]');
  if ((await sendBtnQ3.count()) > 0 && (await sendBtnQ3.first().isVisible().catch(() => false))) {
    await sendBtnQ3.first().click();
  } else {
    await page.keyboard.press('Enter');
  }
  console.log('[Scenario 2] Submitted Q3 answer, immediately triggering page reload in 1.2s...');

  // Wait 1.2 seconds while turn is in-flight/persisting, then reload
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await dismissModals();

  await page.screenshot({ path: path.join(EVIDENCE_DIR, '04_after_refresh.png') });

  // Verify page recovered cleanly without infinite retry popup
  const popupAfterReload = await checkForRetryPopups();
  console.log('[Scenario 2] Check after reload:', popupAfterReload);
  expect(popupAfterReload.hasRetry, `Should not be stuck in infinite retry screen after reload: ${popupAfterReload.details}`).toBeFalsy();

  // If "이어하기" button appears, click it to resume
  const resumeBtn = page.locator('button:has-text("이어하기"), button:has-text("시작하기"), [data-ui="current-bubble"] button');
  if ((await resumeBtn.count()) > 0 && (await resumeBtn.first().isVisible().catch(() => false))) {
    console.log('[Scenario 2] Clicking 이어하기 after reload...');
    await resumeBtn.first().click();
    await page.waitForTimeout(3000);
    await dismissModals();
  }

  // Continue with next question to ensure unbroken continuity
  console.log('--- Continuing mission after refresh ---');
  const postReloadMetric = await sendAnswerAndWait('내일은 과학 시간에 실험을 할 예정이라 정말 기대가 돼', 'post_reload_turn');

  const popupAfterPostReload = await checkForRetryPopups();
  expect(popupAfterPostReload.hasRetry, `Should not show retry popup after reload recovery: ${popupAfterPostReload.details}`).toBeFalsy();

  await page.screenshot({ path: path.join(EVIDENCE_DIR, '05_final_state.png') });

  // Save summary report
  const summaryReport = {
    testDate: new Date().toISOString(),
    metrics,
    retryPopupEncountered,
    disconnectPopupEncountered,
    networkSummary: networkLogs,
    consoleErrors: consoleLogs.filter((l) => l.type === 'error' || l.type === 'pageerror'),
  };

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'qa_summary_report.json'),
    JSON.stringify(summaryReport, null, 2),
    'utf-8'
  );
  console.log('[QA Complete] Summary report written to /tmp/agy-qa-mission-retry/qa_summary_report.json');
});
