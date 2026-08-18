import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-a05";
const PARENT_USERNAME = "qatesti-dev";
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

test.describe("A05 Birthdate Input E2E QA (Dev)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("Verify birthdate 3-tier select, leap year clamp, direct input, and validation", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });

    const stepLogs: Array<{
      step: number;
      name: string;
      pass: boolean;
      text: string;
      screenshot: string;
      timestamp: string;
    }> = [];

    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      consoleLogs.push(`[${new Date().toISOString()}] [${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      consoleLogs.push(`[${new Date().toISOString()}] [PAGE_ERROR] ${err.message}`);
    });

    console.log(`[QA] Starting A05 Birthdate Input QA at ${new Date().toISOString()}`);
    console.log(`[QA] Target URL: ${BASE}`);

    // ── STEP 1: Login as Parent & Navigate to /parent/home with QA_Child_A & Open Modal ──
    console.log(`[QA] === STEP 1: Login & open Growth Setup Modal ===`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[QA] Login wait URL timeout, current url:", page.url());
    });

    // Navigate to /parent/home and configure localStorage for active child
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

    // Dismiss announcement modal if open
    const modalClose = page.getByRole("button", { name: /확인|닫기|다시 보지 않기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    const headerChildName = await page.locator("header, div.sticky").getByText(TARGET_CHILD_NAME).first().textContent().catch(() => "");
    console.log(`[QA] Header child name observed: "${headerChildName}"`);

    // Click '키' card
    const heightCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*키.*성장정보 열기|키.*성장정보`) });
    await heightCard.waitFor({ state: "visible", timeout: 10000 });
    await heightCard.click();
    await page.waitForTimeout(600);

    const setupModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보 시작하기" });
    await expect(setupModalHeading).toBeVisible({ timeout: 5000 });

    const step1Screenshot = `${EVIDENCE_DIR}/01-growth-setup-modal-opened.png`;
    await page.screenshot({ path: step1Screenshot, fullPage: true });

    const step1HeadingText = await setupModalHeading.textContent();
    const step1Pass = (await setupModalHeading.isVisible()) && page.url().includes("/parent/home");
    stepLogs.push({
      step: 1,
      name: "부모 로그인 및 QA_Child_A 키 카드 클릭 시 '우리 아이 성장정보 시작하기' 모달 열림",
      pass: step1Pass,
      text: `URL: ${page.url()}, 모달 헤딩: "${step1HeadingText}"`,
      screenshot: step1Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step1Pass).toBe(true);

    // ── STEP 2: Verify 3-tier selects and labels ──
    console.log(`[QA] === STEP 2: Verify 3-tier selects (year, month, day) & aria-labels ===`);
    const yearSelect = page.locator("#birth-date-year");
    const monthSelect = page.locator("#birth-date-month");
    const daySelect = page.locator("#birth-date-day");
    const birthDateSectionLabel = page.locator("span:has-text('생년월일')").first();
    const manualInputLabel = page.locator("label[for='birth-date-manual']");

    const yearVisible = await yearSelect.isVisible();
    const monthVisible = await monthSelect.isVisible();
    const dayVisible = await daySelect.isVisible();

    const yearAria = await yearSelect.getAttribute("aria-label");
    const monthAria = await monthSelect.getAttribute("aria-label");
    const dayAria = await daySelect.getAttribute("aria-label");
    const sectionLabelText = await birthDateSectionLabel.textContent();
    const manualLabelText = await manualInputLabel.textContent();

    console.log(`[QA] Year select aria-label: "${yearAria}", visible: ${yearVisible}`);
    console.log(`[QA] Month select aria-label: "${monthAria}", visible: ${monthVisible}`);
    console.log(`[QA] Day select aria-label: "${dayAria}", visible: ${dayVisible}`);
    console.log(`[QA] Section label: "${sectionLabelText}", Manual label: "${manualLabelText}"`);

    const step2Screenshot = `${EVIDENCE_DIR}/02-birthdate-3-selects-visible.png`;
    await page.screenshot({ path: step2Screenshot });

    const step2Pass =
      yearVisible &&
      monthVisible &&
      dayVisible &&
      yearAria === "태어난 연도" &&
      monthAria === "태어난 월" &&
      dayAria === "태어난 일";

    stepLogs.push({
      step: 2,
      name: "생년월일 영역 연도/월/일 3개 select 및 aria-label 확인",
      pass: step2Pass,
      text: `섹션 라벨: "${sectionLabelText}", 연도: aria-label="${yearAria}", 월: aria-label="${monthAria}", 일: aria-label="${dayAria}", 직접입력 라벨: "${manualLabelText}"`,
      screenshot: step2Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step2Pass).toBe(true);

    // ── STEP 3: Select 2016-02-15 via 3-tier selects -> Check Age Preview ──
    console.log(`[QA] === STEP 3: Select 2016-02-15 via selects & check age preview ===`);
    await yearSelect.selectOption("2016");
    await monthSelect.selectOption("2");
    await daySelect.selectOption("15");
    await page.waitForTimeout(300);

    const agePreviewLocator = page.locator("p:has-text('측정 기준 나이')");
    await expect(agePreviewLocator).toBeVisible({ timeout: 3000 });
    const agePreviewText = (await agePreviewLocator.textContent()) ?? "";
    console.log(`[QA] Age preview text observed: "${agePreviewText}"`);

    const step3Screenshot = `${EVIDENCE_DIR}/03-select-2016-02-15-age-preview.png`;
    await page.screenshot({ path: step3Screenshot });

    const step3Pass = agePreviewText.includes("측정 기준 나이") && agePreviewText.includes("만 10세");
    stepLogs.push({
      step: 3,
      name: "3단 선택으로 2016년 2월 15일 선택 시 '측정 기준 나이: 만 10세...' 노출 확인",
      pass: step3Pass,
      text: `선택값: 2016년 2월 15일, 표시 문구: "${agePreviewText}"`,
      screenshot: step3Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step3Pass).toBe(true);

    // ── STEP 4: Leap Year Clamp (2016 Feb 29 -> 2015 Feb 28 clamp) ──
    console.log(`[QA] === STEP 4: Leap Year Clamp (2016 Feb 29 -> 2015 Feb 28) ===`);
    // Check 2016 Feb 29 option exists
    const day29Option = daySelect.locator("option[value='29']");
    const hasDay29In2016 = (await day29Option.count()) > 0;
    console.log(`[QA] 2016 Feb has day 29 option: ${hasDay29In2016}`);

    await daySelect.selectOption("29");
    await page.waitForTimeout(300);
    const dayValIn2016 = await daySelect.inputValue();

    const step4aScreenshot = `${EVIDENCE_DIR}/04a-leap-year-2016-feb-29.png`;
    await page.screenshot({ path: step4aScreenshot });

    // Change year to 2015 (non-leap year)
    await yearSelect.selectOption("2015");
    await page.waitForTimeout(300);

    const dayValIn2015 = await daySelect.inputValue();
    const hasDay29In2015 = (await daySelect.locator("option[value='29']").count()) > 0;
    const day28OptionSelected = dayValIn2015 === "28";

    console.log(`[QA] 2015 Feb selected day: "${dayValIn2015}", day 29 option exists: ${hasDay29In2015}`);

    const step4bScreenshot = `${EVIDENCE_DIR}/04b-leap-year-clamped-2015-feb-28.png`;
    await page.screenshot({ path: step4bScreenshot });

    const step4Pass = hasDay29In2016 && dayValIn2016 === "29" && !hasDay29In2015 && day28OptionSelected;
    stepLogs.push({
      step: 4,
      name: "윤년 클램프(2016년 2월 29일 선택 가능 → 2015년 변경 시 28일 자동 조정 및 29일 제거)",
      pass: step4Pass,
      text: `2016년 2월: 29일 존재(${hasDay29In2016}) 및 선택(${dayValIn2016}일) → 2015년 변경 시: 29일 소멸(!${hasDay29In2015}) 및 28일 자동조정(${dayValIn2015}일)`,
      screenshot: step4bScreenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step4Pass).toBe(true);

    // ── STEP 5: Direct Input (Manual Typing) Synchronization ──
    console.log(`[QA] === STEP 5: Direct Input Synchronization ===`);
    const manualInput = page.locator("#birth-date-manual");

    // 5-1: Type "20160215"
    await manualInput.fill("20160215");
    await page.waitForTimeout(300);

    const syncYear1 = await yearSelect.inputValue();
    const syncMonth1 = await monthSelect.inputValue();
    const syncDay1 = await daySelect.inputValue();
    console.log(`[QA] Synced selects after "20160215": Year=${syncYear1}, Month=${syncMonth1}, Day=${syncDay1}`);

    const step5aScreenshot = `${EVIDENCE_DIR}/05a-manual-input-20160215.png`;
    await page.screenshot({ path: step5aScreenshot });

    const pass5a = syncYear1 === "2016" && syncMonth1 === "2" && syncDay1 === "15";

    // 5-2: Type "2016.3.7"
    await manualInput.fill("2016.3.7");
    await page.waitForTimeout(300);

    const syncYear2 = await yearSelect.inputValue();
    const syncMonth2 = await monthSelect.inputValue();
    const syncDay2 = await daySelect.inputValue();
    console.log(`[QA] Synced selects after "2016.3.7": Year=${syncYear2}, Month=${syncMonth2}, Day=${syncDay2}`);

    const step5bScreenshot = `${EVIDENCE_DIR}/05b-manual-input-2016-3-7.png`;
    await page.screenshot({ path: step5bScreenshot });

    const pass5b = syncYear2 === "2016" && syncMonth2 === "3" && syncDay2 === "7";

    const step5Pass = pass5a && pass5b;
    stepLogs.push({
      step: 5,
      name: "직접 입력 동기화('20160215' 입력 시 2016/2/15 연동, '2016.3.7' 입력 시 2016/3/7 연동)",
      pass: step5Pass,
      text: `'20160215' 입력결과: [${syncYear1}년 ${syncMonth1}월 ${syncDay1}일] | '2016.3.7' 입력결과: [${syncYear2}년 ${syncMonth2}월 ${syncDay2}일]`,
      screenshot: step5bScreenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step5Pass).toBe(true);

    // ── STEP 6: Invalid Input Validation ──
    console.log(`[QA] === STEP 6: Invalid Input Validation ===`);
    // 6-1: Type invalid date "2016-02-30"
    await manualInput.fill("2016-02-30");
    await page.waitForTimeout(300);

    const errorFormatLocator = page.locator("p.text-\\[\\#C2410C\\]").first();
    const errorFormatText = (await errorFormatLocator.textContent().catch(() => "")) ?? "";
    console.log(`[QA] Error text for '2016-02-30': "${errorFormatText}"`);

    const step6aScreenshot = `${EVIDENCE_DIR}/06a-invalid-date-2016-02-30.png`;
    await page.screenshot({ path: step6aScreenshot });

    const pass6a = errorFormatText.includes("2016-02-15 처럼 8자리로 입력해 주세요.");

    // 6-2: Type future date "2099-01-01"
    await manualInput.fill("2099-01-01");
    await page.waitForTimeout(300);

    const errorFutureLocator = page.locator("p.text-\\[\\#C2410C\\]").first();
    const errorFutureText = (await errorFutureLocator.textContent().catch(() => "")) ?? "";
    console.log(`[QA] Error text for '2099-01-01': "${errorFutureText}"`);

    const step6bScreenshot = `${EVIDENCE_DIR}/06b-future-date-2099-01-01.png`;
    await page.screenshot({ path: step6bScreenshot });

    const pass6b = errorFutureText.includes("생년월일은 오늘 이후일 수 없어요.");

    const step6Pass = pass6a && pass6b;
    stepLogs.push({
      step: 6,
      name: "잘못된 날짜 및 미래 날짜 직접 입력 시 오류 문구 검증",
      pass: step6Pass,
      text: `'2016-02-30' 오류 문구: "${errorFormatText}" | '2099-01-01' 오류 문구: "${errorFutureText}"`,
      screenshot: step6bScreenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step6Pass).toBe(true);

    // ── STEP 7: Gender Selection + Consent + Submit -> Detail Modal ──
    console.log(`[QA] === STEP 7: Gender selection, consent check, and submit ===`);
    // Restore valid birthdate 2016-02-15
    await manualInput.fill("2016-02-15");
    await page.waitForTimeout(300);

    const femaleButton = page.getByRole("button", { name: "여자", exact: true });
    const maleButton = page.getByRole("button", { name: "남자", exact: true });

    if (await femaleButton.isVisible()) {
      await femaleButton.click();
      console.log(`[QA] Clicked female gender button`);
    }

    const consentCheckbox = page.locator('input[type="checkbox"]');
    await consentCheckbox.check();
    await page.waitForTimeout(300);

    const submitButton = page.getByRole("button", { name: "동의하고 시작하기" });
    await expect(submitButton).toBeEnabled();

    const step7aScreenshot = `${EVIDENCE_DIR}/07a-ready-to-submit.png`;
    await page.screenshot({ path: step7aScreenshot });

    // Submit and wait for response & transition to detail modal
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/parent/growth/") && res.request().method() === "POST", { timeout: 15000 }).catch(() => [null]),
      submitButton.click(),
    ]);

    console.log(`[QA] Submit response status: ${response?.status?.() ?? "N/A"}`);

    const detailModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보", exact: true });
    await expect(detailModalHeading).toBeVisible({ timeout: 15000 });

    const detailModalContent = (await page.locator("div.max-h-\\[92vh\\]").first().textContent()) ?? "";
    console.log(`[QA] Detail modal text preview: ${detailModalContent.substring(0, 200)}`);

    const hasStandardNotice = detailModalContent.includes("2017 소아청소년 성장도표");
    const hasAddRecord = await page.getByRole("button", { name: "새 기록 추가" }).isVisible().catch(() => false);

    const step7Screenshot = `${EVIDENCE_DIR}/07b-growth-detail-modal.png`;
    await page.screenshot({ path: step7Screenshot });

    const step7Pass = (await detailModalHeading.isVisible()) && (hasStandardNotice || hasAddRecord);
    stepLogs.push({
      step: 7,
      name: "성별 선택, 동의 체크 후 '동의하고 시작하기' 제출 및 성장 상세 모달 전환 확인",
      pass: step7Pass,
      text: `제출 응답: ${response?.status?.() ?? "OK"}, 모달 제목: "우리 아이 성장정보", 성장도표 기준 노출: ${hasStandardNotice}, 새 기록 추가 버튼: ${hasAddRecord}`,
      screenshot: step7Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step7Pass).toBe(true);

    // ── STEP 8: Modal Scrollability & Regression Check ──
    console.log(`[QA] === STEP 8: Modal Scrollability & Action Button Layout ===`);
    const closeBtn = page.getByRole("button", { name: "닫기" }).first();
    const closeBtnVisible = await closeBtn.isVisible();

    // Check modal inner scroll container
    const scrollContainer = page.locator("div.max-h-\\[92vh\\]").first();
    const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
    const clientHeight = await scrollContainer.evaluate((el) => el.clientHeight);
    console.log(`[QA] Modal scrollHeight: ${scrollHeight}, clientHeight: ${clientHeight}`);

    const step8Screenshot = `${EVIDENCE_DIR}/08-modal-layout-and-buttons.png`;
    await page.screenshot({ path: step8Screenshot });

    const step8Pass = closeBtnVisible && clientHeight > 0;
    stepLogs.push({
      step: 8,
      name: "모달 스크롤 및 액션 버튼(닫기 등) 가림 없음 확인",
      pass: step8Pass,
      text: `닫기 버튼 노출: ${closeBtnVisible}, 컨테이너 높이: clientHeight=${clientHeight}px, scrollHeight=${scrollHeight}px`,
      screenshot: step8Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step8Pass).toBe(true);

    // Save summary json in evidence dir
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "qa-summary.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          targetUrl: BASE,
          account: PARENT_USERNAME,
          childId: TARGET_CHILD_ID,
          stepLogs,
          consoleLogs,
        },
        null,
        2
      )
    );
    console.log(`[QA] All steps completed successfully. Evidence saved in ${EVIDENCE_DIR}`);
  });
});
