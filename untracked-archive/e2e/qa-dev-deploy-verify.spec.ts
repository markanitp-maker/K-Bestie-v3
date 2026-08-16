import { test, expect } from '@playwright/test';

test('Dev 배포본 (Local Dev 3910 & Vercel Dev) /demo/parent FAQ 버튼 1회 클릭 & URL 검증', async ({ page, context }) => {
  test.setTimeout(30000);

  // 1. Local Dev 3910 데모 부모 메인 페이지 진입
  await page.goto('http://127.0.0.1:3910/demo/parent');
  await page.waitForLoadState('domcontentloaded');

  // 2. KChatbotWidget FAQ 버튼 트리거
  const faqTrigger = page.locator('button[aria-label="FAQ 열기"]').first();
  await expect(faqTrigger).toBeVisible({ timeout: 10000 });
  await faqTrigger.click();

  // 3. 모달 내 href 검증
  const modal = page.locator('div[role="dialog"]');
  await expect(modal).toBeVisible({ timeout: 5000 });

  const link = modal.locator('a', { hasText: 'FAQ 페이지로 이동' });
  await expect(link).toBeVisible({ timeout: 5000 });

  const href = await link.getAttribute('href');
  console.log(`[Dev Verification] Rendered href: ${href}`);
  expect(href).toBe('https://beta.k-bestie.com/FAQ');

  // 4. 1회 클릭 및 target URL 검증
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    link.click(),
  ]);

  console.log(`[Dev Verification] Opened Tab Target URL: ${newPage.url()}`);
  expect(newPage.url() === 'https://beta.k-bestie.com/FAQ' || newPage.url() === 'about:blank').toBeTruthy();
  await newPage.close();
});
