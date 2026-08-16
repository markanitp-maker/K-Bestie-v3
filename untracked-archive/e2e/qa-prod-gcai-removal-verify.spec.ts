import { test, expect } from '@playwright/test';

test.describe('Production LLM Status Tab GCAI Removal & Read-Only Table Verification', () => {

  test('Production Environment: Verify GCAI Section Removed & Read-Only Table Intact', async ({ page }) => {
    const gcaiApiRequests: string[] = [];

    page.on('request', req => {
      const url = req.url();
      if (url.includes('/api/admin/gcai-profiles') || url.includes('/api/admin/gcai-health') || url.includes('/api/admin/gcai-switch')) {
        gcaiApiRequests.push(url);
        console.log('[PROD GCAI NETWORK REQUEST DETECTED]', url);
      }
    });

    await page.goto('https://k-bestie-v3-dev.vercel.app/admin?page=llm-status');
    await page.waitForTimeout(3000);

    // GCAI A/B 프로필 설정 요소가 100% 비노출인지 확인
    const gcaiTitle = page.locator('text="GCAI A/B 프로필 설정"');
    const profileACard = page.locator('text="프로필 A"');
    const profileBCard = page.locator('text="프로필 B"');
    const healthCheckBtn = page.locator('button:has-text("헬스체크 실행")');
    const switchBtn = page.locator('button:has-text("이 프로필로 전환")');

    expect(await gcaiTitle.isVisible()).toBe(false);
    expect(await profileACard.isVisible()).toBe(false);
    expect(await profileBCard.isVisible()).toBe(false);
    expect(await healthCheckBtn.isVisible()).toBe(false);
    expect(await switchBtn.isVisible()).toBe(false);

    // GCAI API mutation / fetch 요청 0건 확인
    expect(gcaiApiRequests.length).toBe(0);
    console.log('[PROD VERIFICATION PASS] GCAI Section Fully Removed on Production, GCAI Requests: 0');
  });

});
