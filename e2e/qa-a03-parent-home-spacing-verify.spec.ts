import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_USERNAME = "qatesti-dev";
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-a03-verify";

async function hideTelemetryOverlay(page: Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
    const nextjsPortal = document.querySelector("nextjs-portal");
    if (nextjsPortal) {
      (nextjsPortal as HTMLElement).style.display = "none";
    }
  }).catch(() => {});
}

async function dismissModals(page: Page) {
  try {
    const modalClose = page.getByRole("button", { name: /확인|닫기/ });
    const count = await modalClose.count();
    for (let i = 0; i < count; i++) {
      if (await modalClose.nth(i).isVisible()) {
        await modalClose.nth(i).click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  } catch {}
}

async function loginAndNavigate(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  console.log(`[QA] Logging in at ${BASE}/login with viewport ${viewport.width}x${viewport.height}...`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);

  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(QA_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_PASSWORD);
  await hideTelemetryOverlay(page);

  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/parent\/|\/$/, { timeout: 25000 }).catch(() => {});
  console.log(`[QA] Current URL after login: ${page.url()}`);

  if (!page.url().includes("/parent/home")) {
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
  } else {
    await page.waitForLoadState("networkidle");
  }

  await hideTelemetryOverlay(page);
  await dismissModals(page);
  await page.waitForTimeout(1500);
}

export interface SpacingMeasurement {
  viewport: string;
  // 구간①
  section1_containerPaddingTop: number; // 스크롤 컨테이너 pt-2.5 (10px)
  section1_containerToQuoteTop: number; // 컨테이너 상단 ~ 오늘의 한마디 카드 상단 (10px)
  section1_headerToQuoteTop: number;    // 헤더 하단 ~ 오늘의 한마디 카드 상단 (알림 배너 유무에 따라 10px 또는 113~129px)
  // 구간②
  section2_quoteToFirstInsight: number; // 오늘의 한마디 하단 ~ 첫 인사이트 카드 상단 (10px)
  // 구간③
  section3_lastInsightToGrowth: number; // 마지막 인사이트 행 하단 ~ 키 카드 상단 (10px)
  // 카드 및 레이아웃
  insightCardsCount: number;
  insightCardsColumns: number;
  allCardsTextVisible: boolean;
  notificationBannerPresent: boolean;
  navPresent: boolean;
  faqButtonPresent: boolean;
}

async function measureHomeSpacing(page: Page, viewportName: string): Promise<SpacingMeasurement> {
  return await page.evaluate((vpName) => {
    const cardOf = (text: string): HTMLElement | null => {
      const nodes = Array.from(document.querySelectorAll("h3, span, p, div"));
      const hit = nodes.find((n) => (n.textContent ?? "").trim() === text) as HTMLElement | undefined;
      if (!hit) return null;
      let node: HTMLElement | null = hit;
      while (node && node.parentElement) {
        const style = getComputedStyle(node);
        if (style.borderRadius && parseFloat(style.borderRadius) >= 14) return node;
        node = node.parentElement;
      }
      return hit;
    };

    // 1. Cards
    const quoteCard = cardOf("오늘의 한마디");
    const firstInsightCard = cardOf("학교·학원 생활");
    const lastInsightCard = cardOf("반복 이야기");
    const growthCard = cardOf("키");

    if (!quoteCard) throw new Error("오늘의 한마디 카드 미발견");
    if (!firstInsightCard) throw new Error("첫 인사이트 카드(학교·학원 생활) 미발견");
    if (!lastInsightCard) throw new Error("마지막 인사이트 카드(반복 이야기) 미발견");
    if (!growthCard) throw new Error("키 카드 미발견");

    // 2. Scroll container (direct parent of cards)
    const scrollContainer = quoteCard.parentElement as HTMLElement;
    const scrollContainerRect = scrollContainer.getBoundingClientRect();
    const scrollContainerPaddingTop = parseFloat(getComputedStyle(scrollContainer).paddingTop) || 0;

    // 3. Header
    const logoImg = document.querySelector('img[alt="내친구 케이"]');
    const headerEl = (logoImg?.closest('.sticky') || logoImg?.closest('div.flex') || document.querySelector('header')) as HTMLElement;
    const headerRect = headerEl ? headerEl.getBoundingClientRect() : null;

    // 4. Rectangles
    const quoteRect = quoteCard.getBoundingClientRect();
    const firstInsightRect = firstInsightCard.getBoundingClientRect();
    const lastInsightRect = lastInsightCard.getBoundingClientRect();
    const growthRect = growthCard.getBoundingClientRect();

    // 5. Grid info
    const insightGrid = firstInsightCard.parentElement as HTMLElement;
    const insightCardsCount = insightGrid ? insightGrid.children.length : 0;
    const gridCols = insightGrid ? getComputedStyle(insightGrid).gridTemplateColumns.split(' ').length : 0;

    // 6. Text visibility
    const expectedTitles = [
      '학교·학원 생활', '친구 관계', '마음 흐름', '관심사·취향',
      '공부 고민', '디지털·콘텐츠', '선생님·어른', '반복 이야기'
    ];
    let allCardsTextVisible = true;
    for (const title of expectedTitles) {
      const found = Array.from(document.querySelectorAll('span, div, p')).some(el => el.textContent?.trim() === title);
      if (!found) {
        allCardsTextVisible = false;
        break;
      }
    }

    // 7. Notification banner
    const notifBanner = Array.from(document.querySelectorAll('div')).find(
      el => el.textContent?.includes('알림이 차단되어 있어요') || el.textContent?.includes('아침 리포트 알림')
    );

    // 8. Nav & FAQ
    const navHome = Array.from(document.querySelectorAll('span, div, a, button')).find(el => el.textContent?.trim() === '홈' && el.closest('nav, .border-t'));
    const navEl = (navHome?.closest('nav') || navHome?.closest('.border-t')) as HTMLElement | null;
    const faqBtn = document.querySelector('button[aria-label*="케이"], button[aria-label*="챗봇"], [data-testid="k-chatbot-widget"]') as HTMLElement | null;

    return {
      viewport: vpName,
      section1_containerPaddingTop: scrollContainerPaddingTop,
      section1_containerToQuoteTop: Math.round((quoteRect.top - scrollContainerRect.top) * 10) / 10,
      section1_headerToQuoteTop: headerRect ? Math.round((quoteRect.top - headerRect.bottom) * 10) / 10 : 0,
      section2_quoteToFirstInsight: Math.round((firstInsightRect.top - quoteRect.bottom) * 10) / 10,
      section3_lastInsightToGrowth: Math.round((growthRect.top - lastInsightRect.bottom) * 10) / 10,
      insightCardsCount,
      insightCardsColumns: gridCols,
      allCardsTextVisible,
      notificationBannerPresent: Boolean(notifBanner),
      navPresent: Boolean(navEl),
      faqButtonPresent: Boolean(faqBtn),
    };
  }, viewportName);
}

test.describe("A03 Parent Home Spacing Verification (Independent QA)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("1. Mobile Viewport (390x844) Spacing & Layout Verification", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 390, height: 844 });

    const measurement = await measureHomeSpacing(page, "Mobile (390x844)");
    console.log("[QA] Mobile 390x844 Measurement:", JSON.stringify(measurement, null, 2));

    const screenshotPath = `${EVIDENCE_DIR}/01-mobile-390x844.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Section 1 Verification (pt-2.5 = 10px)
    expect(measurement.section1_containerPaddingTop).toBe(10);
    expect(measurement.section1_containerToQuoteTop).toBe(10);

    // Section 2 Verification (mb-2.5 = 10px)
    expect(measurement.section2_quoteToFirstInsight).toBe(10);

    // Section 3 Verification (mb-2.5 = 10px)
    expect(measurement.section3_lastInsightToGrowth).toBe(10);

    // Non-overlap check
    expect(measurement.section1_containerToQuoteTop).toBeGreaterThanOrEqual(0);
    expect(measurement.section2_quoteToFirstInsight).toBeGreaterThanOrEqual(0);
    expect(measurement.section3_lastInsightToGrowth).toBeGreaterThanOrEqual(0);

    // Insight cards check (8 cards, 2 columns on mobile)
    expect(measurement.insightCardsCount).toBe(8);
    expect(measurement.insightCardsColumns).toBe(2);
    expect(measurement.allCardsTextVisible).toBe(true);

    // Nav check
    expect(measurement.navPresent).toBe(true);

    fs.writeFileSync(`${EVIDENCE_DIR}/mobile-result.json`, JSON.stringify(measurement, null, 2), "utf-8");
  });

  test("2. Tablet Viewport (820x1180) Spacing & Layout Verification", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 820, height: 1180 });

    const measurement = await measureHomeSpacing(page, "Tablet (820x1180)");
    console.log("[QA] Tablet 820x1180 Measurement:", JSON.stringify(measurement, null, 2));

    const screenshotPath = `${EVIDENCE_DIR}/02-tablet-820x1180.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Section 1 Verification (pt-2.5 = 10px)
    expect(measurement.section1_containerPaddingTop).toBe(10);
    expect(measurement.section1_containerToQuoteTop).toBe(10);

    // Section 2 Verification (mb-2.5 = 10px)
    expect(measurement.section2_quoteToFirstInsight).toBe(10);

    // Section 3 Verification (mb-2.5 = 10px)
    expect(measurement.section3_lastInsightToGrowth).toBe(10);

    // Non-overlap check
    expect(measurement.section1_containerToQuoteTop).toBeGreaterThanOrEqual(0);
    expect(measurement.section2_quoteToFirstInsight).toBeGreaterThanOrEqual(0);
    expect(measurement.section3_lastInsightToGrowth).toBeGreaterThanOrEqual(0);

    // Insight cards check (8 cards, 4 columns on tablet)
    expect(measurement.insightCardsCount).toBe(8);
    expect(measurement.insightCardsColumns).toBe(4);
    expect(measurement.allCardsTextVisible).toBe(true);

    // Nav check
    expect(measurement.navPresent).toBe(true);

    fs.writeFileSync(`${EVIDENCE_DIR}/tablet-result.json`, JSON.stringify(measurement, null, 2), "utf-8");
  });

  test("3. PC Viewport (1440x900) Spacing & Layout Verification", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 1440, height: 900 });

    const measurement = await measureHomeSpacing(page, "PC (1440x900)");
    console.log("[QA] PC 1440x900 Measurement:", JSON.stringify(measurement, null, 2));

    const screenshotPath = `${EVIDENCE_DIR}/03-pc-1440x900.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Section 1 Verification (pt-2.5 = 10px)
    expect(measurement.section1_containerPaddingTop).toBe(10);
    expect(measurement.section1_containerToQuoteTop).toBe(10);

    // Section 2 Verification (mb-2.5 = 10px)
    expect(measurement.section2_quoteToFirstInsight).toBe(10);

    // Section 3 Verification (mb-2.5 = 10px)
    expect(measurement.section3_lastInsightToGrowth).toBe(10);

    // Non-overlap check
    expect(measurement.section1_containerToQuoteTop).toBeGreaterThanOrEqual(0);
    expect(measurement.section2_quoteToFirstInsight).toBeGreaterThanOrEqual(0);
    expect(measurement.section3_lastInsightToGrowth).toBeGreaterThanOrEqual(0);

    // Insight cards check (8 cards, 4 columns on desktop)
    expect(measurement.insightCardsCount).toBe(8);
    expect(measurement.insightCardsColumns).toBe(4);
    expect(measurement.allCardsTextVisible).toBe(true);

    // Nav check
    expect(measurement.navPresent).toBe(true);

    fs.writeFileSync(`${EVIDENCE_DIR}/pc-result.json`, JSON.stringify(measurement, null, 2), "utf-8");
  });
});
