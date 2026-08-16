const { chromium, devices } = require('playwright');

const BASE = 'https://app.k-bestie.com';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const page = await context.newPage();
  page.on('response', async (res) => {
    if (res.url().includes('/auth/') || res.url().includes('token')) {
      console.log('AUTH RESPONSE', res.status(), res.url());
    }
  });
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));

  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('load');
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.fill('testa');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(QA_PASSWORD);
  await page.waitForTimeout(300);
  const btn = page.getByRole('button', { name: '로그인', exact: true });
  console.log('login button enabled:', await btn.isEnabled());
  await btn.click();
  await page.waitForTimeout(3000);
  console.log('final url:', page.url());
  const errorText = await page.locator('body').innerText().catch(() => '');
  console.log('page text snippet:', errorText.slice(0, 300));

  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(1); });
