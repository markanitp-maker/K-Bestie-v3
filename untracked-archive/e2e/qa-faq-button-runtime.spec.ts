import { test, expect } from '@playwright/test';

/**
 * FAQ 버튼 런타임 QA — const FAQ_URL = "https://beta.k-bestie.com/FAQ"; 단일 상수 검증
 */

const deviceConfigs = [
  {
    name: 'Desktop Chrome',
    viewport: { width: 1280, height: 720 },
    isMobile: false,
    userAgent: undefined,
  },
  {
    name: 'iPhone Safari (iOS PWA) — Playwright emulation',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  },
  {
    name: 'Android Chrome (Android PWA) — Playwright emulation',
    viewport: { width: 412, height: 915 },
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  },
];

test.describe('KChatbotWidget Single Constant FAQ_URL Runtime Verification', () => {
  for (const dev of deviceConfigs) {
    test(`FAQ Link Verification — ${dev.name}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: dev.viewport,
        isMobile: dev.isMobile,
        ...(dev.userAgent ? { userAgent: dev.userAgent } : {}),
      });
      const page = await ctx.newPage();

      // ── 1. 기존 데모 가이드 라우트 진입 ──────────────────────────────
      await page.goto('/demo/parent/guide');
      await page.waitForLoadState('domcontentloaded');

      // ── 2. FAQ 트리거 버튼 클릭 ────────────────────────────────────
      const faqTrigger = page.locator('button[aria-label="FAQ 열기"]').first();
      await expect(faqTrigger).toBeVisible({ timeout: 10000 });
      await faqTrigger.click();

      // ── 3. 모달 열림 확인 ──────────────────────────────────────────
      const modal = page.locator('div[role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 5000 });
      await expect(modal.locator('text=케이에게 알려주세요')).toBeVisible();

      // ── 4. FAQ 링크 렌더링 href 속성 검증 ─────────────────────────
      const link = modal.locator('a', { hasText: 'FAQ 페이지로 이동' });
      await expect(link).toBeVisible({ timeout: 5000 });
      
      const href = await link.getAttribute('href');
      expect(href).toBe('https://beta.k-bestie.com/FAQ');
      
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

      // ── 5. 클릭 시 새 탭/새 창 이벤트 포착 target URL 검증 ─────────
      const [newPage] = await Promise.all([
        ctx.waitForEvent('page'),
        link.click(),
      ]);

      const targetUrl = newPage.url();
      expect(targetUrl === 'https://beta.k-bestie.com/FAQ' || targetUrl === 'about:blank').toBeTruthy();
      await newPage.close();

      // ── 6. 기존 기능 회귀 확인 (문의/건의/버그/제출) ───────────────
      await expect(modal.locator('button', { hasText: '문의하기' })).toBeVisible();
      await expect(modal.locator('button', { hasText: '건의하기' })).toBeVisible();
      await expect(modal.locator('button', { hasText: '버그 신고하기' })).toBeVisible();
      await expect(modal.locator('button', { hasText: '제출하기' })).toBeVisible();

      await ctx.close();
    });
  }
});
