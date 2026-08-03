import { test, expect } from '@playwright/test';

const QA_PASSWORD = process.env.QA_TEST_PASSWORD;
const BASE = 'https://k-bestie-v3-dev.vercel.app';

test('DEV DemoFrame regression spot-check across routes', async ({ page }) => {
  test.setTimeout(60000);
  if (!QA_PASSWORD) throw new Error('QA_TEST_PASSWORD env var required');
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
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
    if (!(await loginBtn.isEnabled())) continue;
    await loginBtn.click();
    try {
      await page.waitForURL('**/child**', { timeout: 10000 });
      loggedIn = true;
    } catch {
      /* retry */
    }
  }
  expect(loggedIn).toBe(true);

  const routes = ['/child/home', '/child/play', '/child/missions'];
  for (const route of routes) {
    await page.goto(`${BASE}${route}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log(`[${route}] body non-empty:`, bodyText.trim().length > 0, 'len:', bodyText.trim().length);
    await page.screenshot({ path: `/tmp/demoframe-check-${route.replace(/\//g, '_')}.png` });
    expect(bodyText.trim().length, `${route} should render content`).toBeGreaterThan(20);
  }

  console.log('[VERIFY] console errors across all routes:', consoleErrors.length);
  consoleErrors.forEach((m) => console.log(m));
});
