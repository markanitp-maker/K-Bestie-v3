import { test, expect } from '@playwright/test';
import fs from 'fs';

const PROD_BASE = 'https://app.k-bestie.com';
const USERNAME = 'testa';
const PASSWORD = 'TestA12345!@#';

test('Capture 061 Freechat Visual Screenshots on Production (390x844)', async ({ page }) => {
  test.setTimeout(90000);

  fs.mkdirSync('/tmp/agy-qa-061-visual', { recursive: true });

  await page.addInitScript(() => {
    window.localStorage.setItem('k_pwa_intro_seen', '1');
  });

  await page.setViewportSize({ width: 390, height: 844 });

  // 1. Go to Login page
  await page.goto(`${PROD_BASE}/login`, { waitUntil: 'networkidle' });

  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.click();
  await idInput.fill('');
  await idInput.type(USERNAME, { delay: 50 });

  const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
  await pwInput.click();
  await pwInput.fill('');
  await pwInput.type(PASSWORD, { delay: 50 });

  await page.waitForTimeout(500);

  const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
  await expect(loginBtn).toBeEnabled({ timeout: 5000 });
  await loginBtn.click();

  await page.waitForTimeout(3000);
  console.log('URL after login:', page.url());

  // Handle onboarding page if redirected there
  if (page.url().includes('/onboarding')) {
    await page.evaluate(() => localStorage.setItem('k_pwa_intro_seen', '1'));
    const skipBtn = page.getByRole('button', { name: /나중에|시작하기|건너뛰기|확인/ });
    if (await skipBtn.count().catch(() => 0)) {
      await skipBtn.first().click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // 2. Navigate to /chat
  await page.goto(`${PROD_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Close any popups
  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  console.log('Freechat page loaded URL:', page.url());

  // (1) 진입 직후 대기 상태 (마이크 누르기 전)
  await page.screenshot({ path: '/tmp/agy-qa-061-visual/01_idle.png', fullPage: false });
  console.log('Saved 01_idle.png');

  // (2) 마이크를 눌러 대화 연결 직후 (생각중 또는 듣는중 또는 연결중)
  const startMicBtn = page.getByRole('button', { name: /대화 시작하기|마이크 켜기/ });
  if (await startMicBtn.count()) {
    await startMicBtn.click().catch(() => {});
  } else {
    // Fallback: center mic button
    const centerBtn = page.locator('button').filter({ has: page.locator('svg') }).filter({ hasNotText: '자동' }).filter({ hasNotText: '수동' }).last();
    if (await centerBtn.count()) await centerBtn.click().catch(() => {});
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/agy-qa-061-visual/02_connecting_thinking.png', fullPage: false });
  console.log('Saved 02_connecting_thinking.png');

  // (3) 케이가 실제 응답 텍스트가 있는 상태
  // Click keyboard button to send text input
  const keyboardBtn = page.getByRole('button', { name: '텍스트로 답하기' });
  if (await keyboardBtn.count()) {
    await keyboardBtn.click().catch(() => {});
    await page.waitForTimeout(1000);

    const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    if (await textInput.count()) {
      await textInput.fill('안녕 케이야! 오늘 뭐 하고 놀았어?');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(6000);
    }
  }

  await page.screenshot({ path: '/tmp/agy-qa-061-visual/03_response.png', fullPage: false });
  console.log('Saved 03_response.png');
});
