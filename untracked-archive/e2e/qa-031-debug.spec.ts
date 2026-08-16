import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('QA-031: Check elements', async ({ page }) => {
  const screenshotDir = '/tmp/agy-qa-031/';
  
  await page.goto('https://k-bestie-v3-dev.vercel.app');
  await page.fill('input[type="text"]', 'testp02');
  await page.fill('input[type="password"]', process.env.QA_TEST_PASSWORD || '');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/parent/home**');
  await page.goto('https://k-bestie-v3-dev.vercel.app/parent/report/weekly');
  await page.waitForTimeout(3000);
  
  await page.screenshot({ path: path.join(screenshotDir, 'debug_weekly.png') });
  
  const html = await page.innerHTML('body');
  fs.writeFileSync(path.join(screenshotDir, 'body.html'), html);
  
  console.log("has 이번 주:", html.includes('이번 주'));
  console.log("has 지난 기록 보기:", html.includes('지난 기록 보기'));
  
  const historyBtn = page.locator('button', { hasText: '지난 기록 보기' }).first();
  if (await historyBtn.isVisible()) {
    await historyBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, 'debug_calendar.png') });
  }
});
