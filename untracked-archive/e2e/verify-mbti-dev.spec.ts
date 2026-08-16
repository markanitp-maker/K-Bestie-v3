import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const BASE = 'https://k-bestie-v3-dev.vercel.app';

test('DEV MBTI verify fix', async ({ page }) => {
  test.setTimeout(60000);

  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => networkErrors.push(`FAILED ${req.method()} ${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.status() >= 400) networkErrors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('load');

  let loggedIn = false;
  for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
    if (attempt > 0) {
      await page.goto(`${BASE}/login`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(1000);
    }
    const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
    await idInput.waitFor({ state: 'visible', timeout: 15000 });
    await idInput.click();
    await idInput.fill('');
    await idInput.type('qatesti-dev', { delay: 50 });
    const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
    await pwInput.click();
    await pwInput.fill('');
    await pwInput.type(QA_PASSWORD, { delay: 50 });
    await page.waitForTimeout(300);
    const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
    const enabled = await loginBtn.isEnabled();
    console.log(`[attempt ${attempt}] login button enabled:`, enabled);
    if (!enabled) continue;
    await loginBtn.click();
    try {
      await page.waitForURL('**/child**', { timeout: 10000 });
      loggedIn = true;
    } catch {
      console.log(`[attempt ${attempt}] failed, url:`, page.url());
    }
  }
  expect(loggedIn).toBe(true);

  await page.goto(`${BASE}/child/play`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/mbti-dev-1-playhome.png', fullPage: true });

  const mbtiCard = page.getByText('오늘의 나').or(page.getByText('MBTI'));
  await mbtiCard.first().click();
  await page.waitForTimeout(1000);

  const startBtn = page.getByRole('button', { name: /시작하기|이어하기/ });
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
  }

  await page.waitForURL('**/child/play/mbti**', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/mbti-dev-2-wrapper.png', fullPage: true });

  const frame = page.frameLocator('iframe').first();
  let bodyText = '';
  try {
    bodyText = await frame.locator('body').innerText({ timeout: 8000 });
  } catch (e) {
    console.log('[VERIFY] failed to read iframe body:', String(e));
  }
  console.log('[VERIFY] iframe body text (first 300 chars):', bodyText.slice(0, 300));
  console.log('[VERIFY] iframe body non-empty:', bodyText.trim().length > 0);

  console.log('[VERIFY] === console errors ===');
  consoleErrors.forEach((m) => console.log(m));
  console.log('[VERIFY] === network errors ===');
  networkErrors.forEach((m) => console.log(m));

  const hasCspBlock = consoleErrors.some((m) => m.includes('frame-ancestors')) ||
    networkErrors.some((m) => m.includes('ERR_BLOCKED_BY_RESPONSE'));
  console.log('[VERIFY] CSP frame block detected:', hasCspBlock);

  expect(hasCspBlock, 'CSP frame-ancestors block should NOT occur').toBe(false);
  expect(bodyText.trim().length, 'iframe body should not be empty').toBeGreaterThan(0);
});
