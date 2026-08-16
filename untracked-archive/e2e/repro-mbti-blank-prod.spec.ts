import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

test('PROD MBTI blank screen repro', async ({ page }) => {
  test.setTimeout(60000);

  const consoleMsgs: string[] = [];
  const networkErrors: string[] = [];
  page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('requestfailed', (req) => networkErrors.push(`FAILED ${req.method()} ${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.status() >= 400) networkErrors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  await page.goto('https://app.k-bestie.com/login');
  await page.waitForLoadState('networkidle');

  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.click();
  await idInput.fill('');
  await idInput.type('testa', { delay: 50 });
  const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
  await pwInput.click();
  await pwInput.fill('');
  await pwInput.type(QA_PASSWORD, { delay: 50 });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/child**', { timeout: 15000 });

  await page.goto('https://app.k-bestie.com/child/play');
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/mbti-repro-1-playhome.png', fullPage: true });

  const mbtiCard = page.getByText('오늘의 나');
  await mbtiCard.click();
  await page.waitForTimeout(1000);

  // there might be a confirm modal for gold key spend
  const startBtn = page.getByRole('button', { name: /시작|확인/ });
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
  }

  await page.waitForURL('**/child/play/mbti**', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);

  await page.screenshot({ path: '/tmp/mbti-repro-2-wrapper.png', fullPage: true });

  const iframeEl = page.locator('iframe');
  const iframeCount = await iframeEl.count();
  console.log('[REPRO] iframe count:', iframeCount);

  if (iframeCount > 0) {
    const frame = page.frameLocator('iframe').first();
    try {
      const bodyText = await frame.locator('body').innerText({ timeout: 5000 });
      console.log('[REPRO] iframe body text (first 500 chars):', bodyText.slice(0, 500));
    } catch (e) {
      console.log('[REPRO] failed to read iframe body:', String(e));
    }
  }

  console.log('[REPRO] === console messages ===');
  consoleMsgs.forEach((m) => console.log(m));
  console.log('[REPRO] === network errors ===');
  networkErrors.forEach((m) => console.log(m));
});
