import { test, expect } from '@playwright/test';

test('production quiz proxy E2E via app.k-bestie.com', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto('https://app.k-bestie.com/login');
  await page.locator('input[type="text"]').fill('qatest-child-prod');
  await page.locator('input[type="password"]').fill(process.env.QATEST_CHILD_PROD_PASSWORD || '');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/child/home', { timeout: 15000 });

  await page.goto('https://app.k-bestie.com/child/play');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/agy-qa-035-lite/prod-play-page.png' });

  await page.locator('text=퀴즈마스터').first().click();
  await page.waitForTimeout(1000);
  const startButton = page.locator('button:has-text("시작하기")');
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
  }
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/agy-qa-035-lite/prod-quiz-proxy-subject.png' });

  console.log('final URL:', page.url());
  console.log('page title:', await page.title());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('body text (first 300 chars):', bodyText.slice(0, 300));
});
