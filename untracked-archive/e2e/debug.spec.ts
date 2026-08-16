import { test, expect } from '@playwright/test';

test('debug login', async ({ page }) => {
  const password = process.env.QA_TEST_PASSWORD;
  await page.goto('https://k-bestie-v3-dev.vercel.app/login');
  
  await page.fill('input[type="text"]', 'testp02');
  await page.fill('input[type="password"]', password || '');
  
  // Wait to see if button is disabled
  const button = page.locator('button:has-text("로그인")');
  console.log('Button disabled?', await button.isDisabled());
  
  if (await button.isDisabled()) {
    console.log('Password length:', password ? password.length : 0);
  }
  
  await Promise.all([
    page.waitForNavigation().catch(() => {}), // catch timeout
    button.click({ force: true })
  ]);
  
  console.log('After click, URL:', page.url());
  
  // check for errors
  const errorText = await page.locator('div[style*="background: #FEF2F2"]').textContent().catch(() => null);
  if (errorText) {
    console.log('Login error:', errorText);
  }
  
  await page.waitForTimeout(2000);
  console.log('After wait, URL:', page.url());
  
  await page.evaluate(() => {
    localStorage.setItem('login_role', 'owner');
  });
  
  await page.goto('https://k-bestie-v3-dev.vercel.app/parent/home');
  console.log('After goto parent/home, URL:', page.url());
  
  await page.screenshot({ path: '/tmp/agy-qa-041/debug.png' });
});
