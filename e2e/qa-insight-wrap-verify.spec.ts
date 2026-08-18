import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_USERNAME = "qatesti-dev";
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-wrap";

const TARGET_TEXTS = [
  "친구와 보드게임하고 놀았음",
  "억울함과 답답함을 느꼈어요",
];

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

interface MobileMeasurement {
  viewportWidth: number;
  viewportHeight: number;
  gridCols: number;
  cardCount: number;
  gapX: number;
  gapY: number;
  paddingLeft: number;
  paddingRight: number;
  cardWidth: number;
  cardHeight: number;
  contentAvailableWidth: number;
  fontSize: string;
  lineHeight: string;
  texts: Array<{
    text: string;
    textWidth: number;
    elementHeight: number;
    lineHeightNum: number;
    calculatedLines: number;
    rangeLines: number;
    isSingleLine: boolean;
    isOverflowing: boolean;
  }>;
}

interface RegressionMeasurement {
  viewportWidth: number;
  viewportHeight: number;
  gridCols: number;
  cardCount: number;
  paddingLeft: number;
  paddingRight: number;
  gapX: number;
  gapY: number;
  fontSize: string;
  lineHeight: string;
}

async function measureMobileInsightCards(page: Page, texts: string[]): Promise<MobileMeasurement> {
  return await page.evaluate((targetTexts) => {
    const expectedTitles = [
      '학교·학원 생활', '친구 관계', '마음 흐름', '관심사·취향',
      '공부 고민', '디지털·콘텐츠', '선생님·어른', '반복 이야기'
    ];
    
    const titleElements = Array.from(document.querySelectorAll('span, p, div')).filter(
      el => expectedTitles.includes(el.textContent?.trim() || '')
    );
    
    if (titleElements.length === 0) {
      throw new Error("인사이트 카드 타이틀을 찾을 수 없습니다.");
    }

    const firstTitle = titleElements[0];
    let cardEl: HTMLElement | null = firstTitle as HTMLElement;
    while (cardEl && cardEl.parentElement) {
      const style = getComputedStyle(cardEl);
      if (style.borderRadius && parseFloat(style.borderRadius) >= 14) break;
      cardEl = cardEl.parentElement;
    }
    
    if (!cardEl) throw new Error("인사이트 카드 컨테이너를 찾을 수 없습니다.");
    const gridEl = cardEl.parentElement as HTMLElement;
    if (!gridEl) throw new Error("인사이트 그리드 컨테이너를 찾을 수 없습니다.");

    const gridStyle = getComputedStyle(gridEl);
    const gridCols = gridStyle.gridTemplateColumns.split(' ').length;
    const cardCount = gridEl.children.length;
    const gapX = parseFloat(gridStyle.columnGap || gridStyle.gap || "0");
    const gapY = parseFloat(gridStyle.rowGap || gridStyle.gap || "0");

    const cardStyle = getComputedStyle(cardEl);
    const paddingLeft = parseFloat(cardStyle.paddingLeft);
    const paddingRight = parseFloat(cardStyle.paddingRight);
    const cardRect = cardEl.getBoundingClientRect();
    const cardWidth = Math.round(cardRect.width * 100) / 100;
    const cardHeight = Math.round(cardRect.height * 100) / 100;
    const contentAvailableWidth = Math.round((cardWidth - paddingLeft - paddingRight) * 100) / 100;

    const summaryP = cardEl.querySelector('p') as HTMLElement;
    const pStyle = summaryP ? getComputedStyle(summaryP) : cardStyle;
    const fontSize = pStyle.fontSize;
    const lineHeightStr = pStyle.lineHeight;

    const containerForP = summaryP ? summaryP.parentElement || cardEl : cardEl;

    const textResults = targetTexts.map(text => {
      const tempP = document.createElement('p');
      tempP.className = summaryP ? summaryP.className : "text-[13px] font-semibold leading-[1.45] text-gray-700 sm:text-sm";
      tempP.style.margin = "0";
      tempP.style.padding = "0";
      tempP.textContent = text;

      const inlineSpan = document.createElement('span');
      inlineSpan.style.whiteSpace = 'nowrap';
      inlineSpan.style.display = 'inline';
      inlineSpan.style.font = pStyle.font;
      inlineSpan.style.fontSize = pStyle.fontSize;
      inlineSpan.style.fontWeight = pStyle.fontWeight;
      inlineSpan.style.letterSpacing = pStyle.letterSpacing;
      inlineSpan.style.fontFamily = pStyle.fontFamily;
      inlineSpan.textContent = text;

      containerForP.appendChild(tempP);
      document.body.appendChild(inlineSpan);

      const textWidth = Math.round(inlineSpan.getBoundingClientRect().width * 100) / 100;
      const tempRect = tempP.getBoundingClientRect();
      const elementHeight = Math.round(tempRect.height * 100) / 100;
      const tempLineHeight = parseFloat(getComputedStyle(tempP).lineHeight);
      
      const calculatedLines = Math.round((elementHeight / tempLineHeight) * 100) / 100;

      const range = document.createRange();
      range.selectNodeContents(tempP);
      const rangeLines = range.getClientRects().length;

      const isOverflowing = tempP.scrollWidth > tempP.clientWidth + 0.5 || tempP.scrollHeight > tempP.clientHeight + 0.5;

      containerForP.removeChild(tempP);
      document.body.removeChild(inlineSpan);

      return {
        text,
        textWidth,
        elementHeight,
        lineHeightNum: tempLineHeight,
        calculatedLines,
        rangeLines,
        isSingleLine: calculatedLines <= 1.05 && rangeLines === 1,
        isOverflowing
      };
    });

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gridCols,
      cardCount,
      gapX,
      gapY,
      paddingLeft,
      paddingRight,
      cardWidth,
      cardHeight,
      contentAvailableWidth,
      fontSize,
      lineHeight: lineHeightStr,
      texts: textResults
    };
  }, texts);
}

async function measureRegressionLayout(page: Page): Promise<RegressionMeasurement> {
  return await page.evaluate(() => {
    const expectedTitles = [
      '학교·학원 생활', '친구 관계', '마음 흐름', '관심사·취향',
      '공부 고민', '디지털·콘텐츠', '선생님·어른', '반복 이야기'
    ];
    const titleElements = Array.from(document.querySelectorAll('span, p, div')).filter(
      el => expectedTitles.includes(el.textContent?.trim() || '')
    );
    if (titleElements.length === 0) throw new Error("인사이트 카드 타이틀 미발견");

    let cardEl: HTMLElement | null = titleElements[0] as HTMLElement;
    while (cardEl && cardEl.parentElement) {
      const style = getComputedStyle(cardEl);
      if (style.borderRadius && parseFloat(style.borderRadius) >= 14) break;
      cardEl = cardEl.parentElement;
    }
    if (!cardEl) throw new Error("카드 컨테이너 미발견");
    const gridEl = cardEl.parentElement as HTMLElement;
    if (!gridEl) throw new Error("그리드 컨테이너 미발견");

    const gridStyle = getComputedStyle(gridEl);
    const cardStyle = getComputedStyle(cardEl);
    const summaryP = cardEl.querySelector('p') as HTMLElement;
    const pStyle = summaryP ? getComputedStyle(summaryP) : cardStyle;

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gridCols: gridStyle.gridTemplateColumns.split(' ').length,
      cardCount: gridEl.children.length,
      paddingLeft: parseFloat(cardStyle.paddingLeft),
      paddingRight: parseFloat(cardStyle.paddingRight),
      gapX: parseFloat(gridStyle.columnGap || gridStyle.gap || "0"),
      gapY: parseFloat(gridStyle.rowGap || gridStyle.gap || "0"),
      fontSize: pStyle.fontSize,
      lineHeight: pStyle.lineHeight,
    };
  });
}

test.describe("Insight Card Text Wrapping & Responsive Layout QA Verification", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("1. Mobile Viewport 375x812: Single-line text wrap, card padding & dimensions", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 375, height: 812 });

    const m = await measureMobileInsightCards(page, TARGET_TEXTS);
    console.log("[QA] Mobile 375x812 Result:\n", JSON.stringify(m, null, 2));

    const shotPath = `${EVIDENCE_DIR}/01-mobile-375x812.png`;
    await page.screenshot({ path: shotPath, fullPage: true });

    // Assertions
    expect(m.gridCols).toBe(2);
    expect(m.cardCount).toBe(8);
    expect(m.paddingLeft).toBe(12); // px-3 = 12px
    expect(m.paddingRight).toBe(12);
    expect(m.gapX).toBe(8); // gap-x-2 = 8px
    expect(m.fontSize).toBe("13px");

    // Text wrap checks
    for (const t of m.texts) {
      expect(t.calculatedLines).toBeLessThanOrEqual(1.05);
      expect(t.rangeLines).toBe(1);
      expect(t.isSingleLine).toBe(true);
      expect(t.isOverflowing).toBe(false);
    }

    fs.writeFileSync(`${EVIDENCE_DIR}/result-375.json`, JSON.stringify(m, null, 2), "utf-8");
  });

  test("2. Mobile Viewport 390x844: Single-line text wrap, card padding & dimensions", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 390, height: 844 });

    const m = await measureMobileInsightCards(page, TARGET_TEXTS);
    console.log("[QA] Mobile 390x844 Result:\n", JSON.stringify(m, null, 2));

    const shotPath = `${EVIDENCE_DIR}/02-mobile-390x844.png`;
    await page.screenshot({ path: shotPath, fullPage: true });

    // Assertions
    expect(m.gridCols).toBe(2);
    expect(m.cardCount).toBe(8);
    expect(m.paddingLeft).toBe(12); // px-3 = 12px
    expect(m.paddingRight).toBe(12);
    expect(m.gapX).toBe(8); // gap-x-2 = 8px
    expect(m.fontSize).toBe("13px");

    for (const t of m.texts) {
      expect(t.calculatedLines).toBeLessThanOrEqual(1.05);
      expect(t.rangeLines).toBe(1);
      expect(t.isSingleLine).toBe(true);
      expect(t.isOverflowing).toBe(false);
    }

    fs.writeFileSync(`${EVIDENCE_DIR}/result-390.json`, JSON.stringify(m, null, 2), "utf-8");
  });

  test("3. Mobile Viewport 430x932: Single-line text wrap, card padding & dimensions", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 430, height: 932 });

    const m = await measureMobileInsightCards(page, TARGET_TEXTS);
    console.log("[QA] Mobile 430x932 Result:\n", JSON.stringify(m, null, 2));

    const shotPath = `${EVIDENCE_DIR}/03-mobile-430x932.png`;
    await page.screenshot({ path: shotPath, fullPage: true });

    // Assertions
    expect(m.gridCols).toBe(2);
    expect(m.cardCount).toBe(8);
    expect(m.paddingLeft).toBe(12); // px-3 = 12px
    expect(m.paddingRight).toBe(12);
    expect(m.gapX).toBe(8); // gap-x-2 = 8px
    expect(m.fontSize).toBe("13px");

    for (const t of m.texts) {
      expect(t.calculatedLines).toBeLessThanOrEqual(1.05);
      expect(t.rangeLines).toBe(1);
      expect(t.isSingleLine).toBe(true);
      expect(t.isOverflowing).toBe(false);
    }

    fs.writeFileSync(`${EVIDENCE_DIR}/result-430.json`, JSON.stringify(m, null, 2), "utf-8");
  });

  test("4. Tablet Regression 820x1180: sm:p-5 (20px), sm:gap-4 (16px), 4 cols", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 820, height: 1180 });

    const reg = await measureRegressionLayout(page);
    console.log("[QA] Tablet 820x1180 Regression Result:\n", JSON.stringify(reg, null, 2));

    const shotPath = `${EVIDENCE_DIR}/04-tablet-820x1180.png`;
    await page.screenshot({ path: shotPath, fullPage: true });

    // Assertions
    expect(reg.paddingLeft).toBe(20); // sm:p-5 = 20px
    expect(reg.paddingRight).toBe(20);
    expect(reg.gapX).toBe(16); // sm:gap-4 = 16px
    expect(reg.gapY).toBe(16);
    expect(reg.gridCols).toBe(4);
    expect(reg.cardCount).toBe(8);

    fs.writeFileSync(`${EVIDENCE_DIR}/result-tablet.json`, JSON.stringify(reg, null, 2), "utf-8");
  });

  test("5. PC Regression 1440x900: sm:p-5 (20px), sm:gap-4 (16px), 4 cols", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAndNavigate(page, { width: 1440, height: 900 });

    const reg = await measureRegressionLayout(page);
    console.log("[QA] PC 1440x900 Regression Result:\n", JSON.stringify(reg, null, 2));

    const shotPath = `${EVIDENCE_DIR}/05-pc-1440x900.png`;
    await page.screenshot({ path: shotPath, fullPage: true });

    // Assertions
    expect(reg.paddingLeft).toBe(20); // sm:p-5 = 20px
    expect(reg.paddingRight).toBe(20);
    expect(reg.gapX).toBe(16); // sm:gap-4 = 16px
    expect(reg.gapY).toBe(16);
    expect(reg.gridCols).toBe(4);
    expect(reg.cardCount).toBe(8);

    fs.writeFileSync(`${EVIDENCE_DIR}/result-pc.json`, JSON.stringify(reg, null, 2), "utf-8");
  });
});
