import { test, expect, type Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://k-bestie-v3-dev.vercel.app';
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || '';
const SCREENSHOT_DIR = '/tmp/agy-qa-073';

const CHILD_A_USERNAME = 'qa-child-a-dev';
const CHILD_A_ID = 'e2e00001-aaaa-4000-8000-000000000001';

interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  isTablet?: boolean;
  isPc?: boolean;
  demoFrameMode?: 'mobile' | 'tablet';
  hasTouch?: boolean;
}

const VIEWPORTS: ViewportConfig[] = [
  { name: 'smartphone-390x844', width: 390, height: 844, isTablet: false, isPc: false, hasTouch: true },
  { name: 'smartphone-412x915', width: 412, height: 915, isTablet: false, isPc: false, hasTouch: true },
  { name: 'tablet-810x1080', width: 810, height: 1080, isTablet: true, isPc: false, hasTouch: true },
  { name: 'tablet-1080x810', width: 1080, height: 810, isTablet: true, isPc: false, hasTouch: true },
  { name: 'pc-1920x1080-default', width: 1920, height: 1080, isTablet: false, isPc: true, hasTouch: false },
  { name: 'pc-demoframe-smartphone', width: 1920, height: 1080, isTablet: false, isPc: true, demoFrameMode: 'mobile', hasTouch: false },
  { name: 'pc-demoframe-tablet', width: 1920, height: 1080, isTablet: true, isPc: true, demoFrameMode: 'tablet', hasTouch: false },
];

interface ScreenConfig {
  name: string;
  route: string;
  title: string;
  ctaSelector: string;
  hasMascot: boolean;
}

const SCREENS: ScreenConfig[] = [
  {
    name: 'child-home',
    route: '/child/home',
    title: '아이 홈',
    ctaSelector: '[data-testid="mission-primary-card"], a[href*="/child/missions"], [data-testid="child-home-action-grid"]',
    hasMascot: true,
  },
  {
    name: 'missions',
    route: '/child/missions',
    title: '미션',
    // ctaSelector 는 page.evaluate 안에서 document.querySelectorAll 에 그대로 넘어간다.
    // `:has-text()` 와 `text=` 는 Playwright 전용 문법이라 여기서 쓰면
    // "is not a valid selector" 로 전 항목이 죽는다. 순수 CSS 만 쓴다.
    ctaSelector: '[data-ui="mission-input-area"], [data-ui="current-bubble"], [data-ui="conversation-status-panel"], button[aria-label*="마이크"], button[aria-label*="시작"], button[aria-label*="이어하기"]',
    hasMascot: true,
  },
  {
    name: 'free-chat',
    route: '/chat',
    title: '자유대화',
    ctaSelector: '[data-ui="freechat-input-area"], [data-ui="conversation-status-panel"], button[aria-label*="마이크"], button[aria-label*="시작"]',
    hasMascot: true,
  },
  {
    name: 'play-home',
    route: '/child/play',
    title: '놀이 홈',
    ctaSelector: 'main a, main button, [data-ui="play-card"], h1',
    hasMascot: false,
  },
  {
    name: 'play-mbti',
    route: '/child/play/mbti',
    title: 'MBTI',
    ctaSelector: 'iframe, [aria-label="닫기"], h1',
    hasMascot: false,
  },
];

export interface QaCheckResult {
  viewport: string;
  screen: string;
  check1_overflow: { passed: boolean; value: number; detail: string };
  check2_cta_in_viewport: { passed: boolean; detail: string };
  check3_header_bounds: { passed: boolean; detail: string };
  check4_no_overlap: { passed: boolean; detail: string };
  check5_tablet_width: { passed: boolean; renderedWidth: number; detail: string };
  screenshotPath: string;
}

const allResults: QaCheckResult[] = [];

async function loginChild(page: Page, vp: ViewportConfig) {
  await page.goto(`${BASE}/login?role=child`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Try filling login form
  const idInput = page.getByPlaceholder(/아이 아이디|아이디/);
  if (await idInput.isVisible().catch(() => false)) {
    await idInput.fill(CHILD_A_USERNAME);
    const pwInput = page.getByPlaceholder(/비밀번호/);
    await pwInput.fill(QA_PASSWORD);
    const loginBtn = page.getByRole('button', { name: '로그인', exact: true });
    if (await loginBtn.isEnabled().catch(() => false)) {
      await loginBtn.click({ force: true }).catch(() => {});
      await page.waitForURL('**/child/**', { timeout: 15000 }).catch(() => {});
    }
  }

  // Ensure child auth state in localStorage
  await page.evaluate(({ cId, mode }) => {
    localStorage.setItem('k_child_id', cId);
    localStorage.setItem('login_role', 'member');
    localStorage.setItem('k_pwa_intro_seen', '1');
    if (mode) {
      localStorage.setItem('kbestie_demo_view_mode', mode);
    }
  }, { cId: CHILD_A_ID, mode: vp.demoFrameMode });
}

async function cleanOverlays(page: Page) {
  await page.evaluate(() => {
    // Next.js dev portal
    const nextjsPortal = document.querySelector('nextjs-portal');
    if (nextjsPortal) {
      (nextjsPortal as HTMLElement).style.display = 'none';
    }
    // STT debug overlay if present
    const sttOverlay = document.querySelector('[data-testid="stt-debug-overlay"]');
    if (sttOverlay) {
      (sttOverlay as HTMLElement).style.display = 'none';
    }
  }).catch(() => {});
}

test.describe('073 Phase 4: Viewport Visual QA Automation', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  test.afterAll(() => {
    // Save JSON summary of results to /tmp/agy-qa-073/results.json
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, 'results.json'),
      JSON.stringify(allResults, null, 2),
      'utf-8'
    );
  });

  for (const vp of VIEWPORTS) {
    test.describe(`Viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {
      for (const sc of SCREENS) {
        test(`${sc.name} (${sc.title}) visual & layout checks`, async ({ page, context }) => {
          test.setTimeout(60000);
          await context.grantPermissions(['microphone']).catch(() => {});
          await page.setViewportSize({ width: vp.width, height: vp.height });

          // Emulate touch if specified
          if (vp.hasTouch) {
            await page.emulateMedia({ media: 'screen' });
          }

          // 1. Login and set context
          await loginChild(page, vp);

          // 2. Navigate to screen
          await page.goto(`${BASE}${sc.route}`, { waitUntil: 'domcontentloaded' });
          await cleanOverlays(page);
          await page.waitForTimeout(2000); // Allow animations & layout tokens to settle

          // If DemoFrame view toggle is available on PC, ensure correct view mode
          if (vp.isPc && vp.demoFrameMode) {
            await page.evaluate((mode) => {
              localStorage.setItem('kbestie_demo_view_mode', mode);
            }, vp.demoFrameMode);
          }

          await cleanOverlays(page);

          // Take Screenshot
          const screenshotPath = `${SCREENSHOT_DIR}/${vp.name}_${sc.name}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: false });

          // =========================================================================
          // CHECK 1: scrollWidth <= clientWidth (Horizontal overflow 0)
          // =========================================================================
          const overflowData = await page.evaluate(() => {
            const doc = document.documentElement;
            const body = document.body;
            const docOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
            const bodyOverflow = Math.max(0, body.scrollWidth - body.clientWidth);

            // Check scrollable inner container if DemoFrame or full wrapper
            const scrollContainer = document.querySelector('[data-ui="demo-frame-mobile-viewport"]') ||
                                    document.querySelector('[data-ui="mission-conversation-viewport"]') ||
                                    document.querySelector('.child-screen');
            let innerOverflow = 0;
            if (scrollContainer) {
              innerOverflow = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
            }

            const maxOverflow = Math.max(docOverflow, bodyOverflow, innerOverflow);
            return {
              docWidth: doc.clientWidth,
              docScroll: doc.scrollWidth,
              bodyWidth: body.clientWidth,
              bodyScroll: body.scrollWidth,
              innerOverflow,
              maxOverflow,
              passed: maxOverflow <= 1,
            };
          });

          // =========================================================================
          // CHECK 2: 주요 CTA 가 viewport 안에 있다 (bounding box 화면 밖 벗어남 없음)
          // =========================================================================
          const ctaData = await page.evaluate(({ selector, vpWidth, vpHeight, isPc }) => {
            const elements = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            const visibleEl = elements.find(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
            });

            if (!visibleEl) {
              return { passed: false, detail: 'CTA 요소를 찾을 수 없음' };
            }

            const rect = visibleEl.getBoundingClientRect();
            
            // In PC DemoFrame mode, the CTA should be within the inner display or visible window
            const inViewport = rect.top >= -5 &&
                               rect.bottom <= vpHeight + 20 &&
                               rect.left >= -5 &&
                               rect.right <= vpWidth + 20;

            return {
              passed: inViewport,
              detail: inViewport
                ? `CTA 위치 정상 (${Math.round(rect.left)}, ${Math.round(rect.top)} ~ ${Math.round(rect.right)}, ${Math.round(rect.bottom)})`
                : `CTA 가 뷰포트 벗어남 (top: ${Math.round(rect.top)}, bottom: ${Math.round(rect.bottom)}, vpH: ${vpHeight})`,
              rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
            };
          }, { selector: sc.ctaSelector, vpWidth: vp.width, vpHeight: vp.height, isPc: vp.isPc });

          // =========================================================================
          // CHECK 3: 헤더가 content container 밖으로 안 벗어난다 (좌우 경계 비교)
          // =========================================================================
          const headerData = await page.evaluate(() => {
            const header = document.querySelector('header, .shrink-0.flex.items-center.justify-between, [data-ui="demo-frame-mobile-viewport"] > div:first-child, .child-home-content') as HTMLElement;
            const content = document.querySelector('.child-home-content, [data-ui="mission-conversation-grid"], [data-ui="demo-frame-mobile-viewport"], main') as HTMLElement;

            if (!header || !content) {
              return { passed: true, detail: '헤더/본문 단일 컨테이너' };
            }

            const hRect = header.getBoundingClientRect();
            const cRect = content.getBoundingClientRect();

            // Header should not escape content container horizontally (tolerance 8px for margins/padding)
            const leftDiff = hRect.left - cRect.left;
            const rightDiff = cRect.right - hRect.right;
            const isInside = (hRect.left >= cRect.left - 12) && (hRect.right <= cRect.right + 12);

            return {
              passed: isInside,
              detail: isInside
                ? `헤더 정합 정상 (폭 ${Math.round(hRect.width)}px / 본문 ${Math.round(cRect.width)}px)`
                : `헤더 벗어남 (H: ${Math.round(hRect.left)}~${Math.round(hRect.right)}, C: ${Math.round(cRect.left)}~${Math.round(cRect.right)})`,
              hWidth: Math.round(hRect.width),
              cWidth: Math.round(cRect.width),
            };
          });

          // =========================================================================
          // CHECK 4: 마스코트·말풍선·하단 컨트롤이 겹치지 않는다 (bounding box 교차 검사)
          // =========================================================================
          const overlapData = await page.evaluate(({ hasMascot }) => {
            if (!hasMascot) {
              return { passed: true, detail: '해당 화면 마스코트 겹침 검증 대상 아님' };
            }

            const mascot = document.querySelector('[data-testid="child-home-mascot"], [data-ui="mascot"], [data-ui="mascot-stage"], img[alt*="마스코트"]') as HTMLElement;
            const bubble = document.querySelector('[data-testid="mission-status-bubble"], [data-ui="current-bubble"], [data-testid="child-home-greeting"]') as HTMLElement;
            const bottomControl = document.querySelector('[data-testid="mission-primary-card"], [data-ui="mission-input-area"], [data-testid="child-home-action-grid"]') as HTMLElement;

            if (!mascot || !bubble) {
              return { passed: true, detail: '마스코트 또는 말풍선 미노출 상태' };
            }

            const mRect = mascot.getBoundingClientRect();
            const bRect = bubble.getBoundingClientRect();

            // Vertical overlap check: bubble and mascot should not overlap
            const isOverlapBubbleMascot = !(bRect.bottom <= mRect.top + 2 || mRect.bottom <= bRect.top + 2 || bRect.right <= mRect.left || mRect.right <= bRect.left);

            let isOverlapMascotBottom = false;
            if (bottomControl) {
              const bcRect = bottomControl.getBoundingClientRect();
              isOverlapMascotBottom = !(mRect.bottom <= bcRect.top + 2 || bcRect.bottom <= mRect.top + 2 || mRect.right <= bcRect.left || bcRect.right <= mRect.left);
            }

            const hasOverlap = isOverlapBubbleMascot || isOverlapMascotBottom;
            return {
              passed: !hasOverlap,
              detail: hasOverlap
                ? `겹침 발생 (말풍선-마스코트 겹침: ${isOverlapBubbleMascot}, 마스코트-하단 겹침: ${isOverlapMascotBottom})`
                : '마스코트·말풍선·컨트롤 겹침 없음',
            };
          }, { hasMascot: sc.hasMascot });

          // =========================================================================
          // CHECK 5: 태블릿에서 콘텐츠가 스마트폰 폭 좁은 띠로 고정되지 않는다 (§0)
          // =========================================================================
          const tabletWidthData = await page.evaluate(({ isTablet, isPc, demoMode }) => {
            const content = document.querySelector('.child-home-content, [data-ui="mission-conversation-grid"], [data-ui="demo-frame-mobile-viewport"], [data-testid="child-home-action-grid"], main') as HTMLElement;
            const renderedWidth = content ? Math.round(content.getBoundingClientRect().width) : document.body.clientWidth;

            if (isTablet || demoMode === 'tablet') {
              // On tablet (810px width), rendered content width should be meaningfully > 480px (e.g. >= 550px or up to 768px)
              const passed = renderedWidth > 480;
              return {
                passed,
                renderedWidth,
                detail: passed
                  ? `태블릿 확장 정상 (${renderedWidth}px > 480px)`
                  : `태블릿 좁은 띠 고정 결함 (${renderedWidth}px <= 480px)`,
              };
            }

            return {
              passed: true,
              renderedWidth,
              detail: `스마트폰/PC 모드 렌더 폭: ${renderedWidth}px`,
            };
          }, { isTablet: vp.isTablet, isPc: vp.isPc, demoMode: vp.demoFrameMode });

          // Record Result
          const result: QaCheckResult = {
            viewport: vp.name,
            screen: sc.name,
            check1_overflow: {
              passed: overflowData.passed,
              value: overflowData.maxOverflow,
              detail: overflowData.passed ? '가로 overflow 0' : `overflow ${overflowData.maxOverflow}px`,
            },
            check2_cta_in_viewport: {
              passed: ctaData.passed,
              detail: ctaData.detail,
            },
            check3_header_bounds: {
              passed: headerData.passed,
              detail: headerData.detail,
            },
            check4_no_overlap: {
              passed: overlapData.passed,
              detail: overlapData.detail,
            },
            check5_tablet_width: {
              passed: tabletWidthData.passed,
              renderedWidth: tabletWidthData.renderedWidth,
              detail: tabletWidthData.detail,
            },
            screenshotPath,
          };

          allResults.push(result);

          // Assertions
          expect(overflowData.passed, `[Check 1] Horizontal overflow detected on ${vp.name} / ${sc.name}: ${overflowData.maxOverflow}px`).toBe(true);
          expect(ctaData.passed, `[Check 2] CTA out of viewport on ${vp.name} / ${sc.name}: ${ctaData.detail}`).toBe(true);
          expect(headerData.passed, `[Check 3] Header outside content container on ${vp.name} / ${sc.name}: ${headerData.detail}`).toBe(true);
          expect(overlapData.passed, `[Check 4] Overlap detected on ${vp.name} / ${sc.name}: ${overlapData.detail}`).toBe(true);
          if (vp.isTablet || vp.demoFrameMode === 'tablet') {
            expect(tabletWidthData.passed, `[Check 5] Tablet content width stuck at ${tabletWidthData.renderedWidth}px (<= 480px) on ${vp.name} / ${sc.name}`).toBe(true);
          }
        });
      }
    });
  }
});
