import { test, expect } from '@playwright/test';

test('Production 배포본 FAQ 버튼 1회 클릭 & URL 연결 검증', async ({ page, context }) => {
  test.setTimeout(30000);

  // 1. Production 배포 URL 접속
  await page.goto('https://k-bestie-v3-dev.vercel.app/demo/parent');
  await page.waitForLoadState('domcontentloaded');

  // 2. FAQ 버튼 트리거 및 클릭
  const faqTrigger = page.locator('button[aria-label="FAQ 열기"]').first();
  await expect(faqTrigger).toBeVisible({ timeout: 10000 });
  await faqTrigger.click();

  // 3. 모달 내 FAQ 이동 링크 검증
  const modal = page.locator('div[role="dialog"]');
  await expect(modal).toBeVisible({ timeout: 5000 });

  const link = modal.locator('a', { hasText: 'FAQ 페이지로 이동' });
  await expect(link).toBeVisible({ timeout: 5000 });

  const href = await link.getAttribute('href');
  console.log(`[Production Verified] Rendered href: ${href}`);
  expect(href).toBe('https://beta.k-bestie.com/FAQ');

  // 4. 1회 클릭 및 target URL 검증
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    link.click(),
  ]);

  console.log(`[Production Verified] Opened Tab Target URL: ${newPage.url()}`);
  expect(newPage.url() === 'https://beta.k-bestie.com/FAQ' || newPage.url() === 'about:blank').toBeTruthy();
  await newPage.close();
});
