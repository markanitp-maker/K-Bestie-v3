import { test, expect } from '@playwright/test';

test('Measure Dev Deployment Runtime Behavior for Mission Time Gate & Start API', async ({ page }) => {
  console.log('=== REAL DEV DEPLOYMENT E2E MEASUREMENT ===');

  const networkLogs: string[] = [];

  page.on('request', req => {
    if (req.url().includes('/api/')) {
      networkLogs.push(`[REQ ${req.method()}] ${req.url()}`);
    }
  });

  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      let bodyText = '';
      try { bodyText = await res.text(); } catch {}
      networkLogs.push(`[RES ${res.status()}] ${res.url()} => ${bodyText.slice(0, 300)}`);
    }
  });

  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  });

  // 1. Visit Dev login page
  console.log('Navigating to https://k-bestie-v3-dev.vercel.app/child/login');
  await page.goto('https://k-bestie-v3-dev.vercel.app/child/login');
  await page.waitForLoadState('networkidle');

  // Fill credentials if input fields exist
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.count() > 0) {
    await emailInput.fill('testa@kbestie.local');
    const passInput = page.locator('input[type="password"]');
    if (await passInput.count() > 0) {
      await passInput.fill('TestA12345!@#');
    }
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }
  }

  // 2. Visit Dev mission page
  console.log('Navigating to https://k-bestie-v3-dev.vercel.app/child/missions');
  await page.goto('https://k-bestie-v3-dev.vercel.app/child/missions');
  await page.waitForTimeout(5000);

  console.log('\n--- REAL NETWORK LOGS (/api/) ---');
  networkLogs.forEach(log => console.log(log));
});
