const { chromium, devices } = require('playwright');

const BASE = 'https://app.k-bestie.com';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', (res) => { if (res.status() >= 500) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`); });

  console.log('=== login as testa ===');
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('load');
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.fill('testa');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('after login url:', page.url());
  const skipBtn = page.getByText('나중에 할게요');
  if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(1500);
    console.log('after skipping PWA install prompt, url:', page.url());
  }

  console.log('=== child home (058+026 layout+notification bell) ===');
  await page.goto(`${BASE}/child/home`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/e4f156d0-1105-45e0-bdff-b0d79efa331d/scratchpad/smoke-child-home.png', fullPage: true });
  const bellLink = page.locator('a[href="/child/notifications"]');
  console.log('notification bell link present:', await bellLink.count() > 0);

  console.log('=== child notifications page ===');
  await page.goto(`${BASE}/child/notifications`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/claude-1000/-mnt-e-VibeCoding-K-Bestie-v3/e4f156d0-1105-45e0-bdff-b0d79efa331d/scratchpad/smoke-notifications.png', fullPage: true });

  console.log('=== event card layout check (058) ===');
  await page.goto(`${BASE}/child/home`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  const eventCardBox = await page.locator('text=케이와 친해지는 30일').first().locator('xpath=..').boundingBox().catch(() => null);
  console.log('event card box:', JSON.stringify(eventCardBox));

  console.log('=== console errors ===');
  consoleErrors.forEach((e) => console.log(e));
  console.log('total console/http errors:', consoleErrors.length);

  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(1); });
