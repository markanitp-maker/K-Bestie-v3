import { test } from '@playwright/test';

test.use({ permissions: ['microphone'] });

test('036 mission layout visual check', async ({ page }) => {
  test.setTimeout(60000);
  page.on('console', (msg) => console.log('[console]', msg.text()));

  await page.goto('http://localhost:3910/login', { waitUntil: 'networkidle' });

  const userInput = page.locator('input[type="text"]');
  const passInput = page.locator('input[type="password"]');
  await userInput.waitFor({ state: 'visible' });
  await userInput.fill('testi02');
  await passInput.fill(process.env.TESTI02_PASSWORD || '');

  console.log('[debug] username value:', await userInput.inputValue());
  console.log('[debug] password length:', (await passInput.inputValue()).length);

  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.waitFor({ state: 'visible' });
  const isDisabled = await submitBtn.isDisabled();
  console.log('[debug] submit disabled?', isDisabled);

  await submitBtn.click();
  await page.waitForTimeout(3000);
  console.log('[debug] after click, url:', page.url());

  if (!page.url().includes('/child/home')) {
    console.log('[debug] retrying direct navigation to /child/home');
    await page.goto('http://localhost:3910/child/home', { waitUntil: 'networkidle' });
  }

  if (!page.url().includes('/child/home')) {
    console.log('[debug] still not on /child/home, url:', page.url());
    await page.screenshot({ path: '/tmp/agy-qa-036/login-fail.png' });
    throw new Error('failed to reach /child/home');
  }

  await page.locator('a[href="/child/missions"]').click();
  await page.waitForURL('**/child/missions', { timeout: 10000 });
  await page.waitForTimeout(2000);

  // 이미 완료된 미션이면 "다시 할래요" 게이트 처리
  const restartBtn = page.getByText('다시 할래요');
  if (await restartBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('[debug] restart gate detected, clicking 다시 할래요');
    await restartBtn.click();
  }

  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/agy-qa-036/manual-check-4s.png' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/agy-qa-036/manual-check-8s.png' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/agy-qa-036/manual-check-12s.png' });
});
