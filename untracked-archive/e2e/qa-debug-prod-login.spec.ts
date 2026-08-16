import { test, expect } from '@playwright/test';

test('Debug Prod Login Step-by-Step', async ({ page }) => {
  test.setTimeout(45000);
  console.log('[DEBUG] 1. Goto login page...');
  await page.goto('https://app.k-bestie.com/login', { waitUntil: 'commit' });
  console.log('[DEBUG] 2. Commit reached. Current URL:', page.url());
  
  await page.waitForTimeout(2000);
  console.log('[DEBUG] 3. Taking screenshot after 2s...');
  await page.screenshot({ path: '/tmp/agy-qa-prod-batch-0810/debug_login_step.png' });

  const inputs = await page.locator('input').all();
  console.log('[DEBUG] 4. Found inputs count:', inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const ph = await inputs[i].getAttribute('placeholder').catch(() => '');
    const type = await inputs[i].getAttribute('type').catch(() => '');
    console.log(`[DEBUG] Input #${i}: placeholder="${ph}", type="${type}"`);
  }
});
