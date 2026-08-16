import { test, expect } from '@playwright/test';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_USER = 'qatesti-dev';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const QA_CHILD_ID = '4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c';

async function handlePwaPopups(page: any) {
  const laterBtn = page.getByRole('button', { name: /나중에 할게요/i });
  if (await laterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[PWA Modal] Clicking "나중에 할게요"...');
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
}

async function loginAndGoToMission(page: any, request: any) {
  console.log('[LOGIN] 1. Navigating to login page...');
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill(QA_USER);
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  
  await page.waitForTimeout(3000);
  console.log('[LOGIN] 2. After login submit URL:', page.url());

  // Handle PWA / Onboarding overlay
  await handlePwaPopups(page);

  // Set childId in localStorage
  console.log('[LOGIN] Setting k_child_id in localStorage...');
  await page.evaluate((childId: string) => {
    localStorage.setItem('k_child_id', childId);
  }, QA_CHILD_ID);

  // Calculate current KST roundType
  const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
  const roundType = kstHour >= 18 ? "round2_night" : "round1_day";

  // Ensure active mission session via /api/mission/start if needed
  console.log(`[LOGIN] Ensuring mission session via API /api/mission/start for ${roundType}...`);
  try {
    const res = await request.post(`${DEV_BASE}/api/mission/start`, {
      data: {
        childId: QA_CHILD_ID,
        roundType: roundType,
        confirmRestart: true
      }
    });
    console.log('[API mission/start] Response status:', res.status());
  } catch (err) {
    console.log('[API mission/start] Error:', err);
  }

  // Navigate directly to missions with childId and roundType
  console.log(`[LOGIN] 3. Direct navigation to /child/missions with childId and roundType (${roundType})...`);
  await page.goto(`${DEV_BASE}/child/missions?childId=${QA_CHILD_ID}&roundType=${roundType}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await handlePwaPopups(page);

  console.log('[LOGIN] 4. Landed on Missions URL:', page.url());

  // If "시작하기" or "이어하기" button appears in mission layout, click it
  const startBtn = page.getByRole('button', { name: /시작하기|이어하기/i });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[MISSION] Clicking start/resume button...');
    await startBtn.click();
    await page.waitForTimeout(4000);
  }
}

test('QA-076: Mission keyboard mode live status and session continuity', async ({ page, request }) => {
  test.setTimeout(120000);

  const consoleErrors: string[] = [];
  const wsEvents: string[] = [];
  let wsDisconnectCount = 0;

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      console.error('[Browser Console Error]', text);
      consoleErrors.push(text);
    }
  });

  page.on('websocket', (ws) => {
    wsEvents.push(`WS Created: ${ws.url()}`);
    console.log('[WebSocket Created]', ws.url());

    ws.on('close', () => {
      wsDisconnectCount++;
      wsEvents.push('WS Closed');
      console.log('[WebSocket Closed]');
    });

    ws.on('socketerror', (err) => {
      console.error('[WebSocket Error]', err);
    });
  });

  // 1. Mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });

  // 2. Perform Login & Navigation
  await loginAndGoToMission(page, request);
  await page.screenshot({ path: '/tmp/agy-qa-076-kbd/01_active_mission.png' });

  const bodyText = await page.innerText('body');
  console.log('Active Mission Screen text sample:', bodyText.substring(0, 300));

  const initialWsCount = wsDisconnectCount;

  // 3. Verify keyboard button (locator: aria-label="텍스트로 답하기")
  const keyboardButton = page.locator('button[aria-label="텍스트로 답하기"]');
  const isKbdBtnVisible = await keyboardButton.isVisible().catch(() => false);
  console.log('Keyboard button visible:', isKbdBtnVisible);

  expect(isKbdBtnVisible).toBe(true);

  // 4. Step 3: Open Keyboard / Text Mode
  console.log('Step 3: Clicking keyboard button to enter text mode...');
  await keyboardButton.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/agy-qa-076-kbd/02_text_mode_open.png' });

  // Verify Input is present
  const textInput = page.getByPlaceholder('케이에게 텍스트로 답하기...');
  expect(await textInput.isVisible()).toBe(true);

  // Verify WebSocket disconnect count did NOT increase
  console.log('WS disconnect count before kbd:', initialWsCount, 'after kbd:', wsDisconnectCount);
  expect(wsDisconnectCount).toBe(initialWsCount);

  // Check K status badge is still visible in text mode (aria-live="polite")
  const stateBadge = page.locator('div[aria-live="polite"]');
  const stateBadgeText = await stateBadge.innerText().catch(() => '');
  console.log('K status badge text in text mode:', stateBadgeText);
  expect(stateBadgeText.length).toBeGreaterThan(0);

  // 5. Step 4: Submit Text
  console.log('Step 4: Submitting text input...');
  await textInput.fill('안녕 케이야! 오늘 무슨 미션이야?');
  await page.screenshot({ path: '/tmp/agy-qa-076-kbd/03_text_filled.png' });

  const sendBtn = page.locator('button[aria-label="전송"]');
  await sendBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/agy-qa-076-kbd/04_after_text_send.png' });

  // Input should be cleared
  const currentInputValue = await textInput.inputValue();
  console.log('Input value after send:', currentInputValue);
  expect(currentInputValue).toBe('');

  // 6. Step 5: Close text overlay
  console.log('Step 5: Closing text overlay...');
  const closeTextBtn = page.locator('button[aria-label="채팅창 닫기"]').or(page.locator('button[aria-label="텍스트 입력창 닫기"]'));
  await closeTextBtn.first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/agy-qa-076-kbd/05_after_text_mode_close.png' });

  // Verify returned to voice layout (keyboard button visible again, text input gone)
  expect(await textInput.isVisible()).toBe(false);
  expect(await keyboardButton.isVisible()).toBe(true);

  // 7. Step 6: Repeat keyboard open/close 5 times
  console.log('Step 6: Repeat open/close 5 times...');
  for (let i = 1; i <= 5; i++) {
    console.log(`Iteration ${i}: Opening keyboard...`);
    await keyboardButton.click();
    await page.waitForTimeout(500);
    expect(await textInput.isVisible()).toBe(true);

    console.log(`Iteration ${i}: Closing keyboard...`);
    await closeTextBtn.first().click();
    await page.waitForTimeout(500);
    expect(await textInput.isVisible()).toBe(false);
  }
  await page.screenshot({ path: '/tmp/agy-qa-076-kbd/06_after_5x_repeat.png' });

  // 8. Step 7: Check disconnect modal / resume modal / error modal count (should be 0)
  const disconnectModal = page.getByText(/케이랑 접속이 끊겼네|다시 연결/i);
  const isModalVisible = await disconnectModal.isVisible().catch(() => false);
  console.log('Disconnect / Resume / Retry Modal unexpected visibility:', isModalVisible);
  expect(isModalVisible).toBe(false);

  // Check WS disconnect count remained 0 during mode switches
  console.log('Final WS disconnect count:', wsDisconnectCount);
  expect(wsDisconnectCount).toBe(0);

  console.log('E2E Test Execution Completed Successfully!');
});
