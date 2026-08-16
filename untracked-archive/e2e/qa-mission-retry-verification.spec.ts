import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const CHILD_ID = 'fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9';
const OUT_DIR = '/tmp/agy-qa-mission-retry/scenario1';

test.describe('Mission Retry & Latency Verification on Dev', () => {
  test('Scenario 1 & 3: Normal completion regression & perceived latency measurement', async ({ page }) => {
    test.setTimeout(240_000); // 4 minutes
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const networkLogs: Array<{ url: string; status: number; method: string; time: string }> = [];
    const popupDetections: Array<{ time: string; text: string; step: string }> = [];
    const latencyRecords: Array<{
      step: string;
      answerSubmitted: string;
      latencyMs: number;
      latencySec: string;
      kResponse: string;
      popupObserved: boolean;
      status409Observed: boolean;
    }> = [];

    // Track network responses
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/mission') || url.includes('/api/turn') || url.includes('/api/voice') || url.includes('/api/questions')) {
        const logEntry = {
          url: url.replace(DEV_BASE, ''),
          status: response.status(),
          method: response.request().method(),
          time: new Date().toISOString(),
        };
        networkLogs.push(logEntry);
        console.log(`[API Response] ${logEntry.method} ${logEntry.url} -> ${logEntry.status}`);
      }
    });

    // Check for retry popups
    async function checkRetryPopupVisible(stepName: string): Promise<boolean> {
      const retryTexts = [
        '케이랑 접속이 끊겼네?',
        '대화를 저장하는 중 문제가 생겼어요',
        '다시 시도해 주세요',
        '연결을 확인하고 현재 대화만 다시 시도해 주세요',
      ];
      let detected = false;
      for (const t of retryTexts) {
        const locator = page.getByText(t);
        if (await locator.isVisible().catch(() => false)) {
          popupDetections.push({ time: new Date().toISOString(), text: `Visible: "${t}"`, step: stepName });
          console.warn(`[POPUP DETECTED] "${t}" at step ${stepName}`);
          detected = true;
        }
      }

      const retryBtn = page.getByRole('button', { name: '다시 시도' });
      if (await retryBtn.isVisible().catch(() => false)) {
        // Confirm if it's the error overlay
        const isErrorScreen = await page.getByText(/대화를 저장하는 중|접속이 끊겼|문제가 생겼/).isVisible().catch(() => false);
        if (isErrorScreen) {
          popupDetections.push({ time: new Date().toISOString(), text: `Retry button visible on error screen`, step: stepName });
          console.warn(`[RETRY BUTTON DETECTED] at step ${stepName}`);
          detected = true;
        }
      }
      return detected;
    }

    // Helper: Get Kay's latest speech bubble text
    async function getLatestKBubble(): Promise<string> {
      return await page.evaluate(() => {
        const bubble = document.querySelector('[data-ui="current-bubble"] p');
        if (bubble && bubble.textContent?.trim()) {
          return bubble.textContent.trim();
        }
        const pElements = Array.from(document.querySelectorAll('p, div[class*="bubble"]'));
        const kBubbles = pElements
          .filter(p => !p.className.includes('text-white') && !p.closest('button') && p.textContent?.trim())
          .map(p => p.textContent?.trim() || '');
        return kBubbles.length > 0 ? kBubbles[kBubbles.length - 1] : '';
      });
    }

    // 1. Mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });

    console.log('[Step 1] Logging in as parent (qatesti-dev) on Dev...');
    await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('아이 아이디를 입력하세요').fill('qatesti-dev');
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForTimeout(3000);

    // Set localStorage child ID and bypass pwa intro
    await page.evaluate((cid) => {
      localStorage.setItem('k_child_id', cid);
      localStorage.setItem('k_pwa_intro_seen', '1');
    }, CHILD_ID);

    // 2. Navigate to missions
    console.log('[Step 2] Navigating to /child/missions...');
    await page.goto(`${DEV_BASE}/child/missions?childId=${CHILD_ID}&roundType=round1_day`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check if "시작하기" / "이어하기" / "다시 할래요" button is present
    const restartBtn = page.getByText('다시 할래요');
    if (await restartBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Step 2] Found "다시 할래요" button, clicking to restart fresh mission...');
      await restartBtn.click();
      await page.waitForTimeout(2000);
    }

    const startBtn = page.getByRole('button', { name: /시작하기|이어하기/ });
    if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[Step 2] Clicking start/resume button...');
      await startBtn.click();
      await page.waitForTimeout(2500);
    }

    await page.screenshot({ path: path.join(OUT_DIR, '01_mission_entry.png') });

    // 3. Ensure text input mode (keyboard mode 💬)
    console.log('[Step 3] Switching to text input mode...');
    const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
    if (await keyboardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await keyboardBtn.click();
      await page.waitForTimeout(500);
    }
    const textModeBtn = page.getByRole('button', { name: '💬' });
    if (await textModeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textModeBtn.click();
      await page.waitForTimeout(500);
    }

    // Wait for greeting or initial bubble to load
    await page.waitForTimeout(2000);
    await checkRetryPopupVisible('Initial Greeting Load');
    const initialBubble = await getLatestKBubble();
    console.log('[Step 3] Initial Kay Bubble:', initialBubble);
    await page.screenshot({ path: path.join(OUT_DIR, '02_greeting_loaded.png') });

    // Function to submit an answer, check for popups, measure latency until Kay responds
    async function submitAnswerAndMeasure(
      turnLabel: string,
      answerText: string,
      screenshotPrefix: string
    ): Promise<boolean> {
      console.log(`\n========================================`);
      console.log(`[${turnLabel}] Answering: "${answerText}"`);
      console.log(`========================================`);

      // Ensure text input exists
      let input = page.locator('input[placeholder*="답하기"], input[placeholder*="메시지"], input[type="text"]').last();
      if (!await input.isVisible({ timeout: 5000 }).catch(() => false)) {
        const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
        if (await keyboardBtn.isVisible().catch(() => false)) {
          await keyboardBtn.click();
          await page.waitForTimeout(500);
        }
        const tBtn = page.getByRole('button', { name: '💬' });
        if (await tBtn.isVisible().catch(() => false)) {
          await tBtn.click();
          await page.waitForTimeout(500);
        }
        input = page.locator('input[placeholder*="답하기"], input[placeholder*="메시지"], input[type="text"]').last();
      }

      await input.waitFor({ state: 'visible', timeout: 10000 });
      await input.fill(answerText);
      await page.screenshot({ path: path.join(OUT_DIR, `${screenshotPrefix}_1_typed.png`) });

      const prevBubble = await getLatestKBubble();
      const prevNetworkCount = networkLogs.length;
      const startTime = Date.now();

      // Submit via Send button or Enter
      const sendBtn = page.getByRole('button', { name: '전송' });
      if (await sendBtn.isVisible().catch(() => false) && await sendBtn.isEnabled().catch(() => false)) {
        await sendBtn.click();
      } else {
        await input.press('Enter');
      }

      // If text remains in input after 1s (e.g. was waiting for audio to finish), press Enter again
      await page.waitForTimeout(1000);
      const remainingVal = await input.inputValue().catch(() => '');
      if (remainingVal.length > 0) {
        console.log(`[${turnLabel}] Text still in input after send, attempting Enter again...`);
        if (await sendBtn.isVisible().catch(() => false) && await sendBtn.isEnabled().catch(() => false)) {
          await sendBtn.click();
        } else {
          await input.press('Enter');
        }
      }

      console.log(`[${turnLabel}] Sent at ${new Date().toISOString()}. Waiting for response...`);

      let responded = false;
      let newBubble = '';
      let popupObserved = false;
      let status409Observed = false;

      // Poll every 400ms to measure exact arrival time of next bubble or modal
      for (let i = 0; i < 50; i++) { // wait up to 20s
        await page.waitForTimeout(400);
        const elapsed = Date.now() - startTime;

        const hasPopup = await checkRetryPopupVisible(`${turnLabel} (+${elapsed}ms)`);
        if (hasPopup) popupObserved = true;

        // Check if any 409 status occurred during this turn
        const currentNetwork = networkLogs.slice(prevNetworkCount);
        if (currentNetwork.some(n => n.status === 409)) {
          status409Observed = true;
        }

        const currentBubble = await getLatestKBubble();
        if (currentBubble && currentBubble !== prevBubble && currentBubble !== answerText) {
          responded = true;
          newBubble = currentBubble;
          break;
        }

        // Check if mission completed / reward modal appeared
        const isRewardModal = await page.getByText(/축하해|미션 완료|보상|황금열쇠/).isVisible().catch(() => false);
        if (isRewardModal) {
          responded = true;
          newBubble = '[미션 완료 / 보상 화면 표시]';
          break;
        }
      }

      const finalElapsedMs = Date.now() - startTime;
      const finalElapsedSec = (finalElapsedMs / 1000).toFixed(2) + 's';

      latencyRecords.push({
        step: turnLabel,
        answerSubmitted: answerText,
        latencyMs: finalElapsedMs,
        latencySec: finalElapsedSec,
        kResponse: newBubble || '(시간 내 응답 미감지)',
        popupObserved,
        status409Observed,
      });

      console.log(`[${turnLabel}] Result -> Latency: ${finalElapsedSec}, Responded: ${responded}, Popup: ${popupObserved}`);
      console.log(`[${turnLabel}] Kay's new bubble: "${newBubble}"`);

      await page.screenshot({ path: path.join(OUT_DIR, `${screenshotPrefix}_2_response.png`) });
      return responded;
    }

    // --- TURN 0: Greeting Turn Answer ---
    await submitAnswerAndMeasure(
      'Turn 0 (인사턴)',
      '안녕 케이야! 오늘 하루도 정말 재미있었어!',
      '03_greeting_turn'
    );
    await page.waitForTimeout(2000);

    // --- TURN 1: Question 1 Answer ---
    await submitAnswerAndMeasure(
      'Turn 1 (문항 1)',
      '오늘 학교에서 친구들이랑 피구를 했는데 우리 팀이 이겼어!',
      '04_question_1'
    );
    await page.waitForTimeout(2000);

    // --- TURN 2: Question 2 Answer ---
    await submitAnswerAndMeasure(
      'Turn 2 (문항 2)',
      '점심시간에는 맛있는 돈까스가 나와서 싹 다 먹었어.',
      '05_question_2'
    );
    await page.waitForTimeout(2000);

    // --- TURN 3: Question 3 Answer (if not completed) ---
    const isCompleted = await page.getByText(/축하해|미션 완료|보상|황금열쇠/).isVisible().catch(() => false);
    if (!isCompleted) {
      await submitAnswerAndMeasure(
        'Turn 3 (문항 3)',
        '수학 시간에 새로운 곱셈 문제를 열심히 풀었어.',
        '06_question_3'
      );
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: path.join(OUT_DIR, '07_final_completion_state.png') });

    // Write full summary to JSON
    const fullSummary = {
      testTarget: DEV_BASE,
      testTimestamp: new Date().toISOString(),
      scenario1: {
        description: '정상 완주 회귀 및 다시 시도/연결 끊김 팝업 오발생 여부',
        popupDetections,
        totalPopupsDetected: popupDetections.length,
        greetingSavedAndProgressed: latencyRecords[0]?.kResponse && !latencyRecords[0]?.popupObserved,
      },
      scenario3: {
        description: '체감 지연 시간 측정 (답변 제출 ~ 케이 응답 수신)',
        latencyRecords,
      },
      networkLogs: networkLogs.filter(n => n.url.includes('/api/mission')),
    };

    fs.writeFileSync(
      path.join(OUT_DIR, 'qa_report.json'),
      JSON.stringify(fullSummary, null, 2),
      'utf-8'
    );

    console.log('\n========================================');
    console.log('=== E2E QA TEST COMPLETE ===');
    console.log(`Total Popups Detected: ${popupDetections.length}`);
    console.log('Latency Records:', JSON.stringify(latencyRecords, null, 2));
    console.log('Network 409s:', networkLogs.filter(n => n.status === 409));
    console.log('========================================\n');

    // Assertions
    expect(popupDetections.length, `Popup detections found: ${JSON.stringify(popupDetections)}`).toBe(0);
    expect(latencyRecords.length).toBeGreaterThanOrEqual(3);
    for (const record of latencyRecords) {
      expect(record.popupObserved, `Popup observed at ${record.step}`).toBeFalsy();
    }
  });
});
