import { test, expect } from '@playwright/test';

test('QA-031: Parent weekly report list redesign', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto('https://k-bestie-v3-dev.vercel.app/login');
  
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/agy-qa-031/0-login-page.png' });

  // Try finding email/id and password fields exactly
  await page.fill('input[type="text"], input[name="email"], input[name="id"]', 'testp02');
  await page.fill('input[type="password"]', process.env.QA_TEST_PASSWORD || '');
  
  // Click the submit button specifically
  await page.click('button[type="submit"]');

  await page.waitForURL('**/parent**', { timeout: 15000 });

  await page.goto('https://k-bestie-v3-dev.vercel.app/parent/report/weekly');
  
  await page.waitForLoadState('networkidle');

  await page.screenshot({ path: '/tmp/agy-qa-031/1-weekly-report-page.png', fullPage: true });

  const thisWeekText = page.locator('text=이번 주').first();
  await expect(thisWeekText).toBeVisible({ timeout: 10000 });

  const pastRecordsBtn = page.locator('button', { hasText: /지난 기록( 보기)?/ });
  if (await pastRecordsBtn.count() > 0) {
    await pastRecordsBtn.first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/agy-qa-031/2-calendar-bottom-sheet.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/agy-qa-031/3-sheet-closed.png' });
  } else {
     throw new Error("지난 기록 보기 버튼이 없습니다.");
  }

  expect(errors).toEqual([]);
});
