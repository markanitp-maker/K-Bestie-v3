import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PROD_BASE = 'https://app.k-bestie.com';
const USERNAME = 'testa';
const PASSWORD = 'TestA12345!@#';
const OUT_DIR = '/tmp/agy-qa-prod-batch-0810-r2';

test('Debug Production Login & Nav', async ({ page }) => {
  test.setTimeout(30000);
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  console.log('[DEBUG] Navigating to /login...');
  await page.goto(`${PROD_BASE}/login`, { waitUntil: 'networkidle' });

  await page.screenshot({ path: path.join(OUT_DIR, 'debug_01_login_page.png') });

  const inputs = await page.locator('input').all();
  console.log('[DEBUG] Input elements count:', inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const ph = await inputs[i].getAttribute('placeholder').catch(() => '');
    const name = await inputs[i].getAttribute('name').catch(() => '');
    const type = await inputs[i].getAttribute('type').catch(() => '');
    console.log(`[DEBUG] Input #${i}: placeholder="${ph}", name="${name}", type="${type}"`);
  }

  const buttons = await page.locator('button').allInnerTexts().catch(() => []);
  console.log('[DEBUG] Buttons on page:', buttons);

  if (inputs.length >= 2) {
    await inputs[0].fill(USERNAME);
    await inputs[1].fill(PASSWORD);
    await page.screenshot({ path: path.join(OUT_DIR, 'debug_02_filled.png') });

    const submitBtn = page.getByRole('button', { name: /로그인|시작/i }).first();
    console.log('[DEBUG] Clicking submit button...');
    await Promise.all([
      page.waitForNavigation({ timeout: 10000 }).catch(e => console.log('[DEBUG] Nav wait caught:', e.message)),
      submitBtn.click()
    ]);
  }

  await page.waitForTimeout(3000);
  console.log('[DEBUG] Final URL after login click:', page.url());
  await page.screenshot({ path: path.join(OUT_DIR, 'debug_03_after_login.png'), fullPage: true });

  const bodyText = await page.locator('body').innerText();
  console.log('[DEBUG] Body text after login snippet:', bodyText.slice(0, 300));
});
