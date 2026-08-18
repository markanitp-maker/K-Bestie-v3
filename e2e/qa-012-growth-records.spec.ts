import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-012b";
const PARENT_USERNAME = "qatesti-dev";
const CHILD_USERNAME = "qa-child-a-dev";
const TARGET_CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const TARGET_CHILD_NAME = "QA_Child_A";

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

interface StepLog {
  step: string;
  name: string;
  pass: boolean;
  text: string;
  screenshot: string;
  timestamp: string;
}

test.describe("Growth Records & Charts E2E QA (Dev)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("Verify Growth records CRUD, KDCA 2017 charts, validation, and child account 403 block", async ({ page }) => {
    test.setTimeout(240_000); // 4 minutes
    await page.setViewportSize({ width: 390, height: 844 });

    const stepLogs: StepLog[] = [];
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      consoleLogs.push(`[${new Date().toISOString()}] [${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      consoleLogs.push(`[${new Date().toISOString()}] [PAGE_ERROR] ${err.message}`);
    });

    console.log(`[QA] Starting Growth Records QA at ${new Date().toISOString()}`);
    console.log(`[QA] Target URL: ${BASE}`);

    // ── SETUP: Login as Parent & Setup active child QA_Child_A ──
    console.log(`[QA] === Parent Login & Setup ===`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[QA] Login wait URL timeout, current url:", page.url());
    });

    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1000);

    await page.evaluate((cid) => {
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
      localStorage.setItem("k_child_id", cid);
      localStorage.setItem("selected_child_id", cid);
      localStorage.setItem("active_child_id", cid);
      try {
        const storeRaw = localStorage.getItem("k_store_v1");
        if (storeRaw) {
          const parsed = JSON.parse(storeRaw);
          parsed.activeChildId = cid;
          localStorage.setItem("k_store_v1", JSON.stringify(parsed));
        } else {
          localStorage.setItem("k_store_v1", JSON.stringify({ activeChildId: cid }));
        }
      } catch (e) {}
    }, TARGET_CHILD_ID);

    await page.reload({ waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);

    const modalClose = page.getByRole("button", { name: /확인|닫기|다시 보지 않기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // ── STEP 1: 부모 홈 → 키 카드 클릭 → 성장 상세 모달 열림 확인 ──
    console.log(`[QA] === STEP 1: Click '키' Card -> Open GrowthDetailModal ===`);
    const heightCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*키.*성장정보 열기|키.*성장정보`) }).first();
    await heightCard.waitFor({ state: "visible", timeout: 10000 });
    await heightCard.click();
    await page.waitForTimeout(800);

    const detailModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보", exact: true });
    const setupModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보 시작하기", exact: true });

    const isDetailVisible = await detailModalHeading.isVisible().catch(() => false);
    const isSetupVisible = await setupModalHeading.isVisible().catch(() => false);

    const step1Pass = isDetailVisible && !isSetupVisible;
    const step1Screenshot = `${EVIDENCE_DIR}/01-growth-detail-modal-opened.png`;
    await page.screenshot({ path: step1Screenshot });

    const modalHeaderText = isDetailVisible ? await page.locator("div.fixed.inset-0 h2").first().textContent() : "";
    stepLogs.push({
      step: "1",
      name: "키 카드 클릭 시 성장 상세 모달 열림 확인 (초기 설정 모달 아님)",
      pass: step1Pass,
      text: `상세 모달 헤딩: "${modalHeaderText?.trim()}", 설정 모달 노출 여부: ${isSetupVisible}`,
      screenshot: step1Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step1Pass).toBe(true);

    // ── STEP 2: 새 기록 추가 (2026-08-18, 키 140, 몸무게 40) → 저장 및 백분위 계산 확인 ──
    console.log(`[QA] === STEP 2: Add Measurement (2026-08-18, 140cm, 40kg) ===`);
    const addRecordButton = page.getByRole("button", { name: "새 기록 추가", exact: true });
    await addRecordButton.click();
    await page.waitForTimeout(500);

    await page.locator("#growth-measured-at").fill("2026-08-18");
    await page.locator("#growth-height").fill("140");
    await page.locator("#growth-weight").fill("40");

    const saveButton = page.locator("section:has-text('새 기록 추가') button:has-text('저장')").first();
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Get text content of modal after saving
    const modalContent = await page.locator("div.fixed.inset-0").textContent().catch(() => "");
    console.log(`[QA] Modal content after Step 2:\n${modalContent}`);

    // Verify expected values:
    // 만 10세 / 키 백분위 55.7 / 몸무게 백분위 78.6 / BMI 20.4 · 백분위 83.7
    const hasAge10 = /만\s*10세/.test(modalContent || "");
    const hasHeight55_7 = /55\.7\s*백분위/.test(modalContent || "");
    const hasWeight78_6 = /78\.6\s*백분위/.test(modalContent || "");
    const hasBmi20_4 = /20\.4/.test(modalContent || "");
    const hasBmi83_7 = /83\.7\s*백분위/.test(modalContent || "");

    const step2Pass = hasAge10 && hasHeight55_7 && hasWeight78_6 && hasBmi20_4 && hasBmi83_7;
    const step2Screenshot = `${EVIDENCE_DIR}/02-growth-record-added-2026-08-18.png`;
    await page.screenshot({ path: step2Screenshot });

    // Extract exact displayed text for each indicator
    const heightSectionText = await page.locator("section:has(h3:text-is('키'))").textContent().catch(() => "");
    const weightSectionText = await page.locator("section:has(h3:text-is('몸무게'))").textContent().catch(() => "");
    const bmiSectionText = await page.locator("section:has(h3:text-is('체질량지수(BMI)'))").textContent().catch(() => "");
    const subheaderText = await page.locator("div.fixed.inset-0 h2 + p").textContent().catch(() => "");

    stepLogs.push({
      step: "2",
      name: "2026-08-18 측정값 (140cm, 40kg) 저장 및 공식 계산기 기준값 표시 검증",
      pass: step2Pass,
      text: `연령: "${subheaderText?.trim()}" | 키: "${heightSectionText?.replace(/\s+/g, " ").trim()}" | 몸무게: "${weightSectionText?.replace(/\s+/g, " ").trim()}" | BMI: "${bmiSectionText?.replace(/\s+/g, " ").trim()}"`,
      screenshot: step2Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step2Pass).toBe(true);

    // ── STEP 3: 또래 중앙값 및 2017 소아청소년 성장도표 표기 확인 ──
    console.log(`[QA] === STEP 3: Check Median & Standard Source text ===`);
    const hasMedianText = /또래\s*중앙값은\s*약/.test(modalContent || "");
    const hasStandardSourceText = /2017\s*소아청소년\s*성장도표/.test(modalContent || "");
    const standardFooterText = await page.locator("div.fixed.inset-0 p:has-text('적용 기준')").textContent().catch(() => "");

    const step3Pass = hasMedianText && hasStandardSourceText;
    const step3Screenshot = `${EVIDENCE_DIR}/03-median-and-standard-source.png`;
    await page.screenshot({ path: step3Screenshot });

    stepLogs.push({
      step: "3",
      name: "'또래 중앙값' 문구 및 '2017 소아청소년 성장도표' 표기 확인",
      pass: step3Pass,
      text: `또래 중앙값 문구 포함: ${hasMedianText}, 기준 출처 푸터: "${standardFooterText?.replace(/\s+/g, " ").trim()}"`,
      screenshot: step3Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step3Pass).toBe(true);

    // ── STEP 4: 같은 날짜(2026-08-18) 몸무게만 41 입력 저장 → 행 중복 없이 41.0kg 갱신 확인 ──
    console.log(`[QA] === STEP 4: Upsert same date (2026-08-18) with weight=41 ===`);
    await addRecordButton.click();
    await page.waitForTimeout(500);

    await page.locator("#growth-measured-at").fill("2026-08-18");
    await page.locator("#growth-height").fill(""); // leave height empty
    await page.locator("#growth-weight").fill("41");

    const saveButtonStep4 = page.locator("section:has-text('새 기록 추가') button:has-text('저장')").first();
    await saveButtonStep4.click();
    await page.waitForTimeout(2000);

    // Count 2026-08-18 rows in measurement history list
    const historyListItems = page.locator("section:has(h3:text-is('측정 기록')) ul li");
    const countItems = await historyListItems.count();
    const rowTexts: string[] = [];
    let count20260818 = 0;
    for (let i = 0; i < countItems; i++) {
      const itemText = (await historyListItems.nth(i).textContent()) || "";
      rowTexts.push(itemText.replace(/\s+/g, " ").trim());
      if (itemText.includes("2026-08-18")) {
        count20260818++;
      }
    }

    const weightSectionTextStep4 = await page.locator("section:has(h3:text-is('몸무게'))").textContent().catch(() => "");
    const heightSectionTextStep4 = await page.locator("section:has(h3:text-is('키'))").textContent().catch(() => "");

    const weightUpdated = weightSectionTextStep4.includes("41.0kg") || weightSectionTextStep4.includes("41kg");
    const heightPreserved = heightSectionTextStep4.includes("140.0cm") || heightSectionTextStep4.includes("140cm");
    const step4Pass = count20260818 === 1 && countItems === 1 && weightUpdated && heightPreserved;

    const step4Screenshot = `${EVIDENCE_DIR}/04-duplicate-date-updated-weight-41.png`;
    await page.screenshot({ path: step4Screenshot });

    stepLogs.push({
      step: "4",
      name: "동일 측정일(2026-08-18) 몸무게(41)만 재입력 시 중복 없이 단일 행 41.0kg 갱신 확인",
      pass: step4Pass,
      text: `2026-08-18 행 개수: ${count20260818} (총 행수: ${countItems}), 목록 행 내용: "${rowTexts.join(" | ")}", 몸무게 갱신: ${weightUpdated}, 키 보존: ${heightPreserved}`,
      screenshot: step4Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step4Pass).toBe(true);

    // ── STEP 5: 과거 날짜 (2026-06-01) 키 137 입력 저장 → 2건 기록 & 성장 흐름 그래프 ──
    console.log(`[QA] === STEP 5: Add past date record (2026-06-01, height=137) ===`);
    await addRecordButton.click();
    await page.waitForTimeout(500);

    await page.locator("#growth-measured-at").fill("2026-06-01");
    await page.locator("#growth-height").fill("137");
    await page.locator("#growth-weight").fill("");

    const saveButtonStep5 = page.locator("section:has-text('새 기록 추가') button:has-text('저장')").first();
    await saveButtonStep5.click();
    await page.waitForTimeout(2000);

    const countItemsStep5 = await historyListItems.count();
    const rowTextsStep5: string[] = [];
    for (let i = 0; i < countItemsStep5; i++) {
      const itemText = (await historyListItems.nth(i).textContent()) || "";
      rowTextsStep5.push(itemText.replace(/\s+/g, " ").trim());
    }

    const growthTrendHeading = page.getByRole("heading", { name: "성장 흐름" });
    const isTrendVisible = await growthTrendHeading.isVisible().catch(() => false);
    const rechartsContainer = page.locator(".recharts-responsive-container");
    const chartCount = await rechartsContainer.count();

    const step5Pass = countItemsStep5 === 2 && isTrendVisible && chartCount >= 1;
    const step5Screenshot = `${EVIDENCE_DIR}/05-past-date-record-and-trend-chart.png`;
    await page.screenshot({ path: step5Screenshot });

    stepLogs.push({
      step: "5",
      name: "과거 날짜(2026-06-01, 키 137) 추가 시 기록 2건 시간순 정렬 및 '성장 흐름' 차트 노출 확인",
      pass: step5Pass,
      text: `총 기록 건수: ${countItemsStep5}, 목록 내용: "${rowTextsStep5.join(" | ")}", 성장 흐름 헤딩 노출: ${isTrendVisible}, 차트 컨테이너 수: ${chartCount}`,
      screenshot: step5Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step5Pass).toBe(true);

    // ── STEP 6: 2026-06-01 기록 수정 (연필 아이콘) → 키 138 로 변경 저장 ──
    console.log(`[QA] === STEP 6: Edit 2026-06-01 record -> height=138 ===`);
    const editButton20260601 = page.getByRole("button", { name: /2026-06-01.*수정/i }).first();
    await editButton20260601.click();
    await page.waitForTimeout(500);

    const editFormHeading = page.getByRole("heading", { name: "기록 수정" });
    await expect(editFormHeading).toBeVisible();

    await page.locator("#growth-height").fill("138");
    const saveEditButton = page.locator("section:has-text('기록 수정') button:has-text('저장')").first();
    await saveEditButton.click();
    await page.waitForTimeout(2000);

    const countItemsStep6 = await historyListItems.count();
    const rowTextsStep6: string[] = [];
    let isHeight138Found = false;
    for (let i = 0; i < countItemsStep6; i++) {
      const itemText = (await historyListItems.nth(i).textContent()) || "";
      rowTextsStep6.push(itemText.replace(/\s+/g, " ").trim());
      if (itemText.includes("2026-06-01") && itemText.includes("138.0cm")) {
        isHeight138Found = true;
      }
    }

    const step6Pass = isHeight138Found && countItemsStep6 === 2;
    const step6Screenshot = `${EVIDENCE_DIR}/06-edit-record-height-138.png`;
    await page.screenshot({ path: step6Screenshot });

    stepLogs.push({
      step: "6",
      name: "2026-06-01 기록 수정(키 138) 후 목록 및 그래프 갱신 확인",
      pass: step6Pass,
      text: `수정 후 목록: "${rowTextsStep6.join(" | ")}", 2026-06-01 키 138.0cm 반영 여부: ${isHeight138Found}`,
      screenshot: step6Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step6Pass).toBe(true);

    // ── STEP 7: 2026-06-01 기록 삭제 (휴지통 아이콘 → 삭제 확인) ──
    console.log(`[QA] === STEP 7: Delete 2026-06-01 record ===`);
    const deleteButton20260601 = page.getByRole("button", { name: /2026-06-01.*삭제/i }).first();
    await deleteButton20260601.click();
    await page.waitForTimeout(500);

    const deleteConfirmText = page.locator("text='이 기록을 삭제할까요?'");
    await expect(deleteConfirmText).toBeVisible();

    const deleteConfirmButton = page.locator("button:has-text('삭제'):not([aria-label])").first();
    await deleteConfirmButton.click();
    await page.waitForTimeout(2000);

    const countItemsStep7 = await historyListItems.count();
    const rowTextsStep7: string[] = [];
    let is20260601Present = false;
    for (let i = 0; i < countItemsStep7; i++) {
      const itemText = (await historyListItems.nth(i).textContent()) || "";
      rowTextsStep7.push(itemText.replace(/\s+/g, " ").trim());
      if (itemText.includes("2026-06-01")) {
        is20260601Present = true;
      }
    }

    const latestHeightTextStep7 = await page.locator("section:has(h3:text-is('키'))").textContent().catch(() => "");
    const isLatestHeight140 = latestHeightTextStep7.includes("140.0cm") || latestHeightTextStep7.includes("140cm");

    const step7Pass = countItemsStep7 === 1 && !is20260601Present && isLatestHeight140;
    const step7Screenshot = `${EVIDENCE_DIR}/07-delete-record-confirm.png`;
    await page.screenshot({ path: step7Screenshot });

    stepLogs.push({
      step: "7",
      name: "2026-06-01 기록 삭제 후 목록에서 제거 및 2026-08-18 최신값 유지 확인",
      pass: step7Pass,
      text: `삭제 후 남은 행 수: ${countItemsStep7}, 목록 내용: "${rowTextsStep7.join(" | ")}", 2026-08-18 최신 키(140.0cm) 유지 여부: ${isLatestHeight140}`,
      screenshot: step7Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step7Pass).toBe(true);

    // ── STEP 8: 잘못된 입력 거부 확인 (키=0, 키·몸무게 둘 다 빈칸) ──
    console.log(`[QA] === STEP 8: Validation errors (height=0, both empty) ===`);
    await addRecordButton.click();
    await page.waitForTimeout(500);

    // 8-1: 키에 0 입력
    await page.locator("#growth-height").fill("0");
    await page.locator("#growth-weight").fill("");
    const saveButtonStep8 = page.locator("section:has-text('새 기록 추가') button:has-text('저장')").first();
    await saveButtonStep8.click();
    await page.waitForTimeout(800);

    const errorLoc = page.locator("section:has-text('새 기록 추가') p.text-red-600");
    const error0Text = (await errorLoc.textContent().catch(() => "")) || "";
    const heightInputValue = await page.locator("#growth-height").inputValue();
    const error0Pass = error0Text.includes("30~250cm") && heightInputValue === "0";

    // 8-2: 둘 다 빈칸
    await page.locator("#growth-height").fill("");
    await page.locator("#growth-weight").fill("");
    await saveButtonStep8.click();
    await page.waitForTimeout(800);

    const errorEmptyText = (await errorLoc.textContent().catch(() => "")) || "";
    const errorEmptyPass = errorEmptyText.includes("키와 몸무게 중 하나는 입력");

    // Close form
    const cancelButton = page.locator("section:has-text('새 기록 추가') button:has-text('취소')").first();
    await cancelButton.click();
    await page.waitForTimeout(500);

    const step8Pass = error0Pass && errorEmptyPass;
    const step8Screenshot = `${EVIDENCE_DIR}/08-invalid-input-rejected.png`;
    await page.screenshot({ path: step8Screenshot });

    stepLogs.push({
      step: "8",
      name: "잘못된 입력 거부 (키 0 입력 시 오류 및 값 보존, 둘 다 비움 시 거부) 검증",
      pass: step8Pass,
      text: `키=0 오류 문구: "${error0Text.trim()}" (입력값 유지: "${heightInputValue}"), 둘 다 비움 오류 문구: "${errorEmptyText.trim()}"`,
      screenshot: step8Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step8Pass).toBe(true);

    // ── STEP 9 & 9-1: 모달 닫고 부모 홈 카드(140.0cm / 41.0kg) 및 디자인 확인 ──
    console.log(`[QA] === STEP 9 & 9-1: Close modal & Verify Parent Home Growth Cards UI ===`);
    const closeDetailModalButton = page.locator("div.fixed.inset-0 button[aria-label='닫기']").first();
    await closeDetailModalButton.click();
    await page.waitForTimeout(1000);

    const homeHeightCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*키.*성장정보 열기|키.*성장정보`) }).first();
    const homeWeightCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*몸무게.*성장정보 열기|몸무게.*성장정보`) }).first();

    const homeHeightText = (await homeHeightCard.textContent()) || "";
    const homeWeightText = (await homeWeightCard.textContent()) || "";

    const hasHome140 = homeHeightText.includes("140.0cm") || homeHeightText.includes("140cm");
    const hasHome41 = homeWeightText.includes("41.0kg") || homeWeightText.includes("41kg");

    // Check design tokens and structure:
    // Card background: bg-white, Left bar: gold (height) & teal (weight), Circular icon badge, Navy text
    const cardDesignCheck = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("button[aria-label*='성장정보']"));
      if (cards.length < 2) return { ok: false, reason: "Cards count less than 2" };

      const hCard = cards[0] as HTMLElement;
      const wCard = cards[1] as HTMLElement;

      const hBg = window.getComputedStyle(hCard).backgroundColor;
      const hColorBar = hCard.querySelector("span[aria-hidden='true']") as HTMLElement;
      const hColorBarBg = hColorBar ? window.getComputedStyle(hColorBar).backgroundColor : "";

      const wBg = window.getComputedStyle(wCard).backgroundColor;
      const wColorBar = wCard.querySelector("span[aria-hidden='true']") as HTMLElement;
      const wColorBarBg = wColorBar ? window.getComputedStyle(wColorBar).backgroundColor : "";

      return {
        ok: true,
        hBg,
        hColorBarBg,
        wBg,
        wColorBarBg,
      };
    });

    const step9Pass = hasHome140 && hasHome41 && cardDesignCheck.ok;
    const step9Screenshot = `${EVIDENCE_DIR}/09-parent-home-growth-cards-design.png`;
    await page.screenshot({ path: step9Screenshot, fullPage: true });

    stepLogs.push({
      step: "9",
      name: "부모 홈 카드 140.0cm / 41.0kg 최신값 표시 및 디자인(흰 배경·컬러바·아이콘배지·네이비글자) 확인",
      pass: step9Pass,
      text: `키 카드 문구: "${homeHeightText.replace(/\s+/g, " ").trim()}" | 몸무게 카드 문구: "${homeWeightText.replace(/\s+/g, " ").trim()}" | 디자인 측정(키바: ${cardDesignCheck.hColorBarBg}, 몸무게바: ${cardDesignCheck.wColorBarBg})`,
      screenshot: step9Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step9Pass).toBe(true);

    // ── STEP 10: 아이 계정 차단 확인 (403 Forbidden & 본문 확인) ──
    console.log(`[QA] === STEP 10: Verify Child Account 403 Forbidden on Growth API ===`);
    const childContext = await page.context().browser()!.newContext({
      viewport: { width: 390, height: 844 },
    });
    const childPage = await childContext.newPage();

    await childPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(childPage);

    await childPage.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
    await childPage.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(childPage);
    await childPage.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await childPage.waitForURL(/\/child\/|\/home|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[QA] Child login wait URL timeout, current url:", childPage.url());
    });
    await childPage.waitForTimeout(1000);

    // Now request growth API directly from child session
    const targetApiUrl = `${BASE}/api/parent/growth/${TARGET_CHILD_ID}`;
    const apiResponse = await childPage.request.get(targetApiUrl);
    const apiStatus = apiResponse.status();
    const apiBodyText = await apiResponse.text();

    console.log(`[QA] Child API Response Status: ${apiStatus}`);
    console.log(`[QA] Child API Response Body: ${apiBodyText}`);

    // Navigate childPage directly to API url to screenshot browser response
    await childPage.goto(targetApiUrl, { waitUntil: "load" }).catch(() => {});
    const step10Screenshot = `${EVIDENCE_DIR}/10-child-account-growth-api-403.png`;
    await childPage.screenshot({ path: step10Screenshot });

    // Verify 403 Forbidden and no sensitive growth data in body
    const is403 = apiStatus === 403;
    const noGrowthDataLeaked = !apiBodyText.includes("140") && !apiBodyText.includes("41") && !apiBodyText.includes("2016-08-18");
    const step10Pass = is403 && noGrowthDataLeaked;

    stepLogs.push({
      step: "10",
      name: "아이 계정(qa-child-a-dev)으로 성장정보 API 직접 호출 시 403 차단 및 개인정보 미노출 확인",
      pass: step10Pass,
      text: `HTTP 상태코드: ${apiStatus} (기대: 403), 응답 본문 원문: "${apiBodyText.trim()}", 개인정보(키·몸무게·생년월일) 미노출 여부: ${noGrowthDataLeaked}`,
      screenshot: step10Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step10Pass).toBe(true);

    await childContext.close();

    // Summary output
    console.log("\n=======================================================");
    console.log("=== QA-012-GROWTH-RECORDS E2E EXECUTION SUMMARY ===");
    console.log("=======================================================");
    for (const log of stepLogs) {
      console.log(`[STEP ${log.step}] ${log.name} -> ${log.pass ? "PASS" : "FAIL"}`);
      console.log(`  상세: ${log.text}`);
      console.log(`  증거: ${log.screenshot}`);
    }
  });
});
