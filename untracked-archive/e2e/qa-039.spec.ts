import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('QA-039: Play Page Mobile Layout Revision', async ({ page }) => {
  const errors: string[] = [];
  const dialogs: string[] = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('401')) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', exception => {
    errors.push(exception.message);
  });
  page.on('dialog', dialog => {
    dialogs.push(dialog.message());
    dialog.accept();
  });

  // Login
  await page.goto('/login');
  await page.locator('input[type="text"], input[type="email"]').first().fill('testi02');
  await page.locator('input[type="password"]').first().fill(process.env.TESTI02_PASSWORD || process.env.QA_TEST_PASSWORD || '');
  
  // Click the child login submit button
  await page.locator('button[type="submit"]').first().click();
  
  // Wait for login to process
  await page.waitForTimeout(1000);
  
  // Extract error if present
  const errorText = await page.evaluate(() => {
    const errEl = document.querySelector('div[style*="background: rgb(254, 242, 242)"], div[style*="#FEF2F2"]');
    return errEl ? errEl.textContent : null;
  });
  console.log('Login error displayed:', errorText);

  // Wait for url to change (it redirects to / or /child/home on success)
  await page.waitForURL('**/child/home**', { timeout: 10000 }).catch(() => {});
  await page.waitForURL('**/**', { timeout: 5000 }).catch(() => {});

  console.log('URL after login:', page.url());
  const dir = '/tmp/agy-qa-039';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, 'login-after.png') });

  // Go to play page
  await page.goto('/child/play');
  await page.waitForSelector('text=놀이');
  await page.waitForTimeout(3000); 

  const childId = await page.evaluate(() => localStorage.getItem('k_child_id'));
  console.log('childId in localStorage:', childId);
  console.log('Dialogs so far:', dialogs);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 1) Take screenshot
  await page.screenshot({ path: path.join(dir, 'play-page-cards.png') });

  // 2) Quizmaster click check
  const quizMaster = page.locator('button', { hasText: '퀴즈마스터' }).first();
  if (await quizMaster.isVisible()) {
    await quizMaster.click();
    await page.waitForTimeout(1000);
    console.log('Dialogs after Quizmaster click:', dialogs);
    
    const modalVisible = await page.locator('.absolute.inset-0.bg-black\\/60').isVisible() || await page.locator('text=시작할까요').isVisible() || await page.locator('text=부족해요').isVisible() || await page.locator('text=이전에 하던').isVisible();
    
    console.log('Modal visible after Quizmaster click:', modalVisible);
    
    if (modalVisible) {
      const closeBtn = page.locator('button:has-text("취소"), button:has-text("닫기")').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else {
        await page.mouse.click(10, 10);
      }
      await page.waitForTimeout(500);
    } else {
      errors.push('Quizmaster modal did not open');
    }
  } else {
    errors.push('Quizmaster card not found');
  }

  // 3) "준비중" cards (comic/hairstyle) click check
  const comicBook = page.locator('text=만화책 읽기').first();
  if (await comicBook.isVisible()) {
    const dialogCountBefore = dialogs.length;
    const urlBefore = page.url();
    await comicBook.click({ force: true });
    await page.waitForTimeout(1000);
    
    const urlAfter = page.url();
    if (urlAfter !== urlBefore) errors.push('Navigated after clicking coming soon card');
    
    const dialogCountAfter = dialogs.length;
    if (dialogCountAfter !== dialogCountBefore) errors.push('Alert shown after clicking coming soon card');
    
    const modalVisible = await page.locator('.absolute.inset-0.bg-black\\/60').isVisible();
    if (modalVisible) errors.push('Modal shown after clicking coming soon card');
  }

  // 4) Console error check
  if (errors.length > 0) {
    console.log("Errors found:", errors);
  }
  expect(errors.length).toBe(0);
});
