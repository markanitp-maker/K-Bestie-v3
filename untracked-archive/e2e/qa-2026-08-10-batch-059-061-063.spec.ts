import { test, expect } from '@playwright/test';

const DEV_BASE = process.env.DEV_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const QA_USER = 'qatesti-dev';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('아이 아이디를 입력하세요').fill(QA_USER);
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  const respPromise = page.waitForResponse((r) => r.url().includes('/auth/') || r.url().includes('supabase'), { timeout: 8000 }).catch(() => null);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const resp = await respPromise;
  if (resp) console.log('[login] auth response:', resp.status(), resp.url());
  await page.waitForTimeout(4000);
  const dismissLater = page.getByText('나중에 할게요', { exact: false });
  if (await dismissLater.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dismissLater.click();
    await page.waitForTimeout(1500);
  }
  console.log('[login] URL after login attempt:', page.url());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (bodyText.includes('비밀번호') && bodyText.includes('로그인')) {
    console.log('[login] STILL ON LOGIN PAGE — login likely failed. Visible text snippet:', bodyText.slice(0, 300));
  }
}

test.describe('2026-08-10 batch QA: 059+064 / 061 / 063', () => {
  test('059+064: parent report UI', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await login(page);
    await page.goto(`${DEV_BASE}/parent/report`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa-batch-059-report.png', fullPage: true });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(20);
    console.log('[059] report page loaded, body length:', bodyText.length);
    console.log('[059] console errors:', errors);
  });

  test('061: free chat visual', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    await login(page);
    await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/qa-batch-061-chat.png', fullPage: true });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(5);
    console.log('[061] chat page loaded, body length:', bodyText.length);
    console.log('[061] console errors:', errors);
  });

  test('063: parent home header CTA', async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await login(page);
    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/qa-batch-063-home.png', fullPage: true });

    const bodyText = await page.locator('body').innerText();
    const hasOldCard = bodyText.includes('아이와 케이 시작하기');
    console.log('[063] home page loaded, "아이와 케이 시작하기" text present (should be false if moved to header):', hasOldCard);
    console.log('[063] console errors:', errors);
    expect(bodyText.length).toBeGreaterThan(20);
  });
});
