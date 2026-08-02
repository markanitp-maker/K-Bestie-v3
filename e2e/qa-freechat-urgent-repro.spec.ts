// 긴급: Dev 자유대화 수동/자동 모드 무응답 재현 및 단계별 추적.
// 실제 브라우저(fake mic device)로 로그인 → /chat 진입 → 각 모드에서 실제 파이프라인을
// 추적한다. 콘솔 로그(코드에 이미 있는 [STT]/[MISSION-DEBUG]/[freechat] prefix)와
// 네트워크 요청을 모두 캡처해 최초 실패 지점을 확정한다.
import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

function attachLogging(page: import('@playwright/test').Page, label: string) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (/\[STT\]|\[MISSION-DEBUG\]|\[freechat\]|error|Error/i.test(text)) {
      console.log(`[${label}][console:${msg.type()}]`, text);
    }
  });
  page.on('pageerror', (err) => console.log(`[${label}][pageerror]`, err.message));
  page.on('requestfailed', (req) => console.log(`[${label}][requestfailed]`, req.url(), req.failure()?.errorText));
  page.on('response', (res) => {
    const url = res.url();
    if (/\/api\/(mission\/stt|voice\/respond|voice\/tts|chat\/messages|chat\/session|chat\/freechat-usage)/.test(url)) {
      console.log(`[${label}][response]`, res.status(), url);
    }
  });
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.click();
  await idInput.fill('qatesti-dev');
  const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
  await pwInput.click();
  await pwInput.fill(QA_PASSWORD);
  console.log('[login] id value:', await idInput.inputValue(), 'pw length:', (await pwInput.inputValue()).length);
  const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
  await expect(loginBtn).toBeEnabled({ timeout: 5000 });
  await loginBtn.click();
  await page.waitForURL('**/child**', { timeout: 15000 }).catch((e) => console.log('[login] waitForURL failed:', e.message));
  console.log('[login] current URL after login attempt:', page.url());
  await page.waitForTimeout(1000);
}

test('URGENT: 수동 모드 마이크 버튼 재현', async ({ page, context }) => {
  test.setTimeout(90000);
  await context.grantPermissions(['microphone']);
  attachLogging(page, 'MANUAL');
  await login(page);

  await page.goto('/chat');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // 수동 모드로 전환
  const manualBtn = page.getByRole('button', { name: '수동' });
  await manualBtn.waitFor({ state: 'visible', timeout: 10000 });
  await manualBtn.click();
  await page.waitForTimeout(500);

  // 세션이 idle이면 대화 시작 버튼을 눌러 live로 전환
  const startBtn = page.getByRole('button', { name: '대화 시작하기' });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[MANUAL] clicking 대화 시작하기');
    await startBtn.click();
    await page.waitForTimeout(2000);
  }

  // 상태 카드 텍스트 확인
  const stateText = await page.locator('[aria-live="polite"]').textContent().catch(() => null);
  console.log('[MANUAL] state card after start:', stateText);

  // 마이크 켜기(녹음 시작)
  const micBtn = page.getByRole('button', { name: /마이크 켜기|녹음 종료/ });
  const micVisible = await micBtn.isVisible({ timeout: 8000 }).catch(() => false);
  console.log('[MANUAL] mic button visible:', micVisible);
  if (micVisible) {
    const labelBefore = await micBtn.getAttribute('aria-label');
    console.log('[MANUAL] mic button aria-label before click:', labelBefore);
    await micBtn.click();
    await page.waitForTimeout(500);
    const labelAfterStart = await page.getByRole('button', { name: /마이크 켜기|녹음 종료/ }).getAttribute('aria-label').catch(() => 'NOT_FOUND');
    console.log('[MANUAL] mic button aria-label after 1st click (should be 녹음 종료):', labelAfterStart);

    // 2초간 "말하는" 시간 확보(fake device가 오디오 프레임을 흘려보내는 동안 대기)
    await page.waitForTimeout(2500);

    // 다시 클릭 → finalize
    const micBtn2 = page.getByRole('button', { name: /녹음 종료|마이크 켜기/ });
    await micBtn2.click();
    console.log('[MANUAL] clicked to finalize recording');
    await page.waitForTimeout(8000);

    const finalStateText = await page.locator('[aria-live="polite"]').textContent().catch(() => null);
    console.log('[MANUAL] state card after finalize + wait:', finalStateText);

    const bubbleText = await page.locator('p.text-left').first().textContent().catch(() => null);
    console.log('[MANUAL] current bubble text:', bubbleText);
  } else {
    console.log('[MANUAL] FAILURE: mic button never appeared — session likely stuck before live/manual mic-ready state');
  }

  await page.screenshot({ path: '/tmp/qa-freechat-urgent-manual.png', fullPage: true });
});

test('URGENT: 자동 모드 발화 후 무응답 재현', async ({ page, context }) => {
  test.setTimeout(90000);
  await context.grantPermissions(['microphone']);
  attachLogging(page, 'AUTO');
  await login(page);

  await page.goto('/chat');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // 기본값이 자동 모드인지 확인, 아니면 전환
  const autoBtn = page.getByRole('button', { name: '자동' });
  await autoBtn.waitFor({ state: 'visible', timeout: 10000 });
  const isPressed = await autoBtn.getAttribute('aria-pressed');
  console.log('[AUTO] auto button aria-pressed:', isPressed);
  if (isPressed !== 'true') {
    await autoBtn.click();
    await page.waitForTimeout(500);
  }

  const startBtn = page.getByRole('button', { name: '대화 시작하기' });
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[AUTO] clicking 대화 시작하기');
    await startBtn.click();
  }

  await page.waitForTimeout(3000);
  const stateText = await page.locator('[aria-live="polite"]').textContent().catch(() => null);
  console.log('[AUTO] state card after start:', stateText);

  // fake device 오디오가 흐르는 동안 자동 VAD가 발화를 감지·확정할 시간을 준다
  // (RMS 임계값을 실제로 넘을지는 fake device 특성에 달려있음 — 콘솔 로그로 확인)
  console.log('[AUTO] waiting 15s for VAD-driven finalize (silence_detected / max_utterance_forced_finalize 로그 확인)');
  await page.waitForTimeout(15000);

  const finalStateText = await page.locator('[aria-live="polite"]').textContent().catch(() => null);
  console.log('[AUTO] state card after 15s wait:', finalStateText);
  const bubbleText = await page.locator('p.text-left').first().textContent().catch(() => null);
  console.log('[AUTO] current bubble text:', bubbleText);

  await page.screenshot({ path: '/tmp/qa-freechat-urgent-auto.png', fullPage: true });
});
