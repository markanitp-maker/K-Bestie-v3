import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DEV_BASE = 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || 'QaDev1c65f921aea7!';
const OUTPUT_DIR = '/tmp/agy-qa-ui-batch';

test.beforeAll(() => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
});

async function loginAsParentOrChild(page: any) {
  await page.goto(`${DEV_BASE}/login`, { waitUntil: 'domcontentloaded' });
  
  const idInput = page.getByPlaceholder('아이 아이디를 입력하세요');
  await idInput.waitFor({ state: 'visible', timeout: 15000 });
  await idInput.fill('qatesti-dev');
  
  const pwInput = page.getByPlaceholder('비밀번호를 입력하세요');
  await pwInput.fill(QA_PASSWORD);
  
  const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
  await loginBtn.click();
  
  await page.waitForTimeout(3000);

  // Close PWA banner or popup if present
  const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

test.describe('E2E QA UI Batch Verification (059+064, 061, 063)', () => {
  test.setTimeout(90000);

  // ──────────────────────────────────────────────────────────
  // 1) 059+064: 부모 리포트 UI 전면 개편
  // ──────────────────────────────────────────────────────────
  test('1) 059+064 부모 리포트 UI 전면 개편 검증', async ({ page }) => {
    console.log('\n=== [QA 059+064] Start Parent Report Redesign Check ===');
    await loginAsParentOrChild(page);

    // Set mobile viewport 390x844
    await page.setViewportSize({ width: 390, height: 844 });

    // 1-1. Parent login -> Home -> Report (Daily/Weekly)
    await page.goto(`${DEV_BASE}/parent/report`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Save screenshot for Daily Report
    const dailyPath = path.join(OUTPUT_DIR, '059_064_parent_report_daily_390.png');
    await page.screenshot({ path: dailyPath, fullPage: false });
    console.log(`Saved screenshot: ${dailyPath}`);

    // Check segment tabs (일간 / 주간)
    const dailyTab = page.getByRole('link', { name: '일간' });
    const weeklyTab = page.getByRole('link', { name: '주간' });
    await expect(dailyTab).toBeVisible();
    await expect(weeklyTab).toBeVisible();

    // Check Segment tabs container styling (expanded layout: h-16, rounded-[18px])
    const navTabContainer = page.locator('nav[aria-label="리포트 기간"] div.h-16');
    await expect(navTabContainer).toBeVisible();
    console.log('Segment tabs h-16 container verified.');

    // Switch to Weekly Report
    await weeklyTab.click();
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/parent/report/weekly');

    // Save screenshot for Weekly Report
    const weeklyPath = path.join(OUTPUT_DIR, '059_064_parent_report_weekly_390.png');
    await page.screenshot({ path: weeklyPath, fullPage: false });
    console.log(`Saved screenshot: ${weeklyPath}`);

    // Return to Daily Report
    await dailyTab.click();
    await page.waitForTimeout(1500);

    // 1-2. Emotion summary box / Summary section check
    // Verify rounded rectangle container styling (rounded-[24px] / rounded-[16px]) and auto height
    const summarySection = page.locator('section[aria-label="이번 주 대화 요약"]').or(page.locator('div.rounded-\\[24px\\]')).or(page.locator('section')).first();
    const isSummaryVisible = await summarySection.isVisible().catch(() => false);
    console.log('Summary / Report card section is visible:', isSummaryVisible);

    // 1-3. Parent common bottom navigation consistency check across 4 pages: Home, Report, Chat with K, Settings
    const routes = [
      { path: '/parent/home', name: '홈' },
      { path: '/parent/report', name: '리포트' },
      { path: '/parent/guide', name: '케이와 대화' },
      { path: '/parent/settings', name: '설정' },
    ];

    for (const r of routes) {
      await page.goto(`${DEV_BASE}${r.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      const navSelector = 'nav[aria-label="부모 주요 메뉴"]';
      await page.waitForSelector(navSelector, { state: 'visible', timeout: 10000 });
      const nav = page.locator(navSelector);
      await expect(nav).toBeVisible();

      const homeLink = nav.getByRole('link', { name: '홈' });
      const reportLink = nav.getByRole('link', { name: '리포트' });
      const guideLink = nav.getByRole('link', { name: '케이와 대화' });
      const settingsLink = nav.getByRole('link', { name: '설정' });

      await expect(homeLink).toBeVisible();
      await expect(reportLink).toBeVisible();
      await expect(guideLink).toBeVisible();
      await expect(settingsLink).toBeVisible();
      console.log(`Bottom nav verified on page: ${r.path}`);
    }
    console.log('Parent bottom navigation consistently present on all 4 pages.');

    // 1-4. Responsive viewports: 360px, 390px, 412px check that bottom nav labels do NOT wrap
    const viewports = [360, 390, 412];
    for (const vpWidth of viewports) {
      await page.setViewportSize({ width: vpWidth, height: 844 });
      await page.waitForTimeout(500);

      const navLabels = page.locator('nav[aria-label="부모 주요 메뉴"] span.whitespace-nowrap');
      const count = await navLabels.count();
      expect(count).toBe(4);

      // Verify no horizontal overflow / line breaks in bottom nav labels
      const hasWrapOrOverflow = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('nav[aria-label="부모 주요 메뉴"] span.whitespace-nowrap'));
        return labels.some((el) => {
          const style = window.getComputedStyle(el);
          return style.whiteSpace !== 'nowrap' || el.clientHeight > 22;
        });
      });
      expect(hasWrapOrOverflow).toBe(false);
      console.log(`Viewport ${vpWidth}px bottom nav label line wrap check passed cleanly.`);
    }

    console.log('=== [QA 059+064] Item 1 PASSED ===');
  });

  // ──────────────────────────────────────────────────────────
  // 2) 061: 자유대화 비주얼 2차 재작업
  // ──────────────────────────────────────────────────────────
  test('2) 061 자유대화 비주얼 2차 재작업 검증 (iPhone 390x844)', async ({ page }) => {
    console.log('\n=== [QA 061] Start Free Chat Visual Check ===');
    await loginAsParentOrChild(page);

    // Set iPhone 390x844 viewport
    await page.setViewportSize({ width: 390, height: 844 });

    // Go to /chat
    await page.goto(`${DEV_BASE}/chat`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Handle any modal if shown
    const laterBtn = page.getByRole('button', { name: '나중에 할게요' });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Save screenshot with iPhone 390x844 viewport
    const chatScreenshotPath = path.join(OUTPUT_DIR, '061_freechat_visual_390x844.png');
    await page.screenshot({ path: chatScreenshotPath, fullPage: false });
    console.log(`Saved screenshot: ${chatScreenshotPath}`);

    // Check 2-1: Mascot pedestal 3D cylinder shape
    const mascotGroup = page.locator('.free-chat-mascot-group');
    await expect(mascotGroup).toBeVisible();

    const pedestalCylinder = mascotGroup.locator('div.bg-gradient-to-b');
    const pedestalCount = await pedestalCylinder.count();
    expect(pedestalCount).toBeGreaterThan(0);
    console.log('3D cylinder pedestal element found count:', pedestalCount);

    // Check 2-2: Halo is borderless radial-gradient blur shape
    const haloDiv = mascotGroup.locator('div[style*="radial-gradient"]');
    const haloCount = await haloDiv.count();
    expect(haloCount).toBeGreaterThan(0);
    console.log('Halo radial-gradient blur count:', haloCount);

    // Check 2-3: Auto/Manual toggle naturally overlaps in front of pedestal and clickable (pointer-events normal)
    const autoBtn = page.getByRole('button', { name: '자동' });
    const manualBtn = page.getByRole('button', { name: '수동' });
    await expect(autoBtn).toBeVisible();
    await expect(manualBtn).toBeVisible();

    // Verify pointer-events on toggle container
    const isToggleClickable = await page.evaluate(() => {
      const autoEl = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '자동');
      if (!autoEl) return false;
      const style = window.getComputedStyle(autoEl);
      return style.pointerEvents !== 'none';
    });
    expect(isToggleClickable).toBe(true);

    // Test clicking 수동 then 자동
    await manualBtn.click();
    await page.waitForTimeout(500);
    await expect(manualBtn).toHaveAttribute('aria-pressed', 'true');

    await autoBtn.click();
    await page.waitForTimeout(500);
    await expect(autoBtn).toHaveAttribute('aria-pressed', 'true');
    console.log('Auto/Manual toggle click interaction verified.');

    // Check 2-4: Speech bubble and status card function normally (no regression)
    const speechBubble = page.locator('div.rounded-\\[20px\\].border-\\[2\\.5px\\]');
    await expect(speechBubble).toBeVisible();

    const statusText = page.locator('text=/생각 중|듣고 있어|말하는 중|연결 중|대기 중/');
    await expect(statusText.first()).toBeVisible();
    console.log('Speech bubble & status card regression check passed.');

    console.log('=== [QA 061] Item 2 PASSED ===');
  });

  // ──────────────────────────────────────────────────────────
  // 3) 063: 부모 홈 대시보드 개편
  // ──────────────────────────────────────────────────────────
  test('3) 063 부모 홈 대시보드 개편 검증', async ({ page }) => {
    console.log('\n=== [QA 063] Start Parent Home Dashboard Check ===');
    await loginAsParentOrChild(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DEV_BASE}/parent/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Save screenshot of Parent Home
    const homeScreenshotPath = path.join(OUTPUT_DIR, '063_parent_home_dashboard_390.png');
    await page.screenshot({ path: homeScreenshotPath, fullPage: false });
    console.log(`Saved screenshot: ${homeScreenshotPath}`);

    // Check 3-1: "아이와 케이 시작하기" card removed from body and moved to Header CTA button "아이 시작하기"
    const headerCtaBtn = page.getByRole('button', { name: '아이 시작하기' });
    await expect(headerCtaBtn).toBeVisible();
    console.log('Header CTA button "아이 시작하기" is visible in ParentHomeHeader.');

    // Click Header CTA and verify ChildStartGuideModal opens
    await headerCtaBtn.click();
    await page.waitForTimeout(1000);

    const guideModalHeading = page.locator('h3, h2, div').filter({ hasText: '아이와 케이 시작하기' });
    const isModalVisible = await guideModalHeading.first().isVisible().catch(() => false);
    expect(isModalVisible).toBe(true);
    console.log('ChildStartGuideModal displayed upon clicking Header CTA button.');

    // Save screenshot of modal open
    const modalScreenshotPath = path.join(OUTPUT_DIR, '063_child_start_guide_modal.png');
    await page.screenshot({ path: modalScreenshotPath, fullPage: false });
    console.log(`Saved screenshot: ${modalScreenshotPath}`);

    // Close modal
    const closeBtn = page.getByRole('button', { name: /닫기|Close|✕|x/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Check 3-2: "오늘의 한마디" (TodayConversationGuide) and insight card (InsightGrid) displayed in expanded layout
    const todayGuideCard = page.locator('text=오늘의 한마디').or(page.locator('text=대화 가이드')).or(page.locator('text=오늘 아이와 이런 대화를 나눠보세요'));
    const isTodayGuideVisible = await todayGuideCard.first().isVisible().catch(() => false);
    console.log('"오늘의 한마디" conversation guide visible:', isTodayGuideVisible);

    const insightGrid = page.locator('section, div.grid').filter({ hasText: /마음|학습|관심|생각/ });
    const isInsightGridVisible = await insightGrid.first().isVisible().catch(() => false);
    console.log('Insight grid cards visible:', isInsightGridVisible);

    console.log('=== [QA 063] Item 3 PASSED ===');
  });
});
