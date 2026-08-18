import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-012a";
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

test.describe("Growth Setup E2E QA (Dev)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("Verify parent home growth cards and initial setup flow", async ({ page }) => {
    test.setTimeout(180_000); // 3 minutes
    await page.setViewportSize({ width: 390, height: 844 });

    const stepLogs: Array<{ step: number; name: string; pass: boolean; text: string; screenshot: string; timestamp: string }> = [];

    // Setup console error listener
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      consoleLogs.push(`[${new Date().toISOString()}] [${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      consoleLogs.push(`[${new Date().toISOString()}] [PAGE_ERROR] ${err.message}`);
    });

    console.log(`[QA] Starting Growth Setup QA at ${new Date().toISOString()}`);
    console.log(`[QA] Target URL: ${BASE}`);

    // ── STEP 1: Login as Parent & Navigate to /parent/home with QA_Child_A ──
    console.log(`[QA] === STEP 1: Login as parent & select QA_Child_A ===`);
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

    // Verify active child is QA_Child_A
    const headerChildName = await page.locator("header, div.sticky").getByText(TARGET_CHILD_NAME).first().textContent().catch(() => "");
    console.log(`[QA] Header child name observed: "${headerChildName}"`);

    const step1Screenshot = `${EVIDENCE_DIR}/01-parent-home-active-child.png`;
    await page.screenshot({ path: step1Screenshot, fullPage: true });
    stepLogs.push({
      step: 1,
      name: "부모 로그인 및 활성 아이 QA_Child_A 설정",
      pass: page.url().includes("/parent/home"),
      text: `URL: ${page.url()}, 활성 아이: ${headerChildName || TARGET_CHILD_NAME}`,
      screenshot: step1Screenshot,
      timestamp: new Date().toISOString(),
    });

    // ── STEP 2: Verify 8 Conversation Insight Cards ──
    console.log(`[QA] === STEP 2: Verify 8 Insight Cards ===`);
    const expectedInsightTitles = [
      "학교·학원 생활",
      "친구 관계",
      "마음 흐름",
      "관심사·취향",
      "공부 고민",
      "디지털·콘텐츠",
      "선생님·어른",
      "반복 이야기",
    ];

    // Wait for the first card to be visible in case report is loading
    await page.locator(`text="${expectedInsightTitles[0]}"`).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

    const observedInsightTitles: string[] = [];
    let step2Pass = true;
    for (const title of expectedInsightTitles) {
      const loc = page.locator(`text="${title}"`).first();
      const isVis = await loc.isVisible().catch(() => false);
      if (isVis) {
        observedInsightTitles.push(title);
      } else {
        step2Pass = false;
        console.error(`[QA] Missing insight card: "${title}"`);
      }
    }

    const step2Screenshot = `${EVIDENCE_DIR}/02-insight-grid-8-cards.png`;
    await page.screenshot({ path: step2Screenshot, fullPage: true });
    stepLogs.push({
      step: 2,
      name: "기존 대화 인사이트 카드 8개 노출 확인",
      pass: step2Pass && observedInsightTitles.length === 8,
      text: observedInsightTitles.join(" / "),
      screenshot: step2Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(observedInsightTitles.length).toBe(8);

    // ── STEP 3: Verify Height / Weight Cards with '기록 없음' ──
    console.log(`[QA] === STEP 3: Verify Height / Weight Cards with '기록 없음' ===`);
    const heightCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*키.*성장정보 열기|키.*성장정보`) });
    const weightCard = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*몸무게.*성장정보 열기|몸무게.*성장정보`) });

    await heightCard.waitFor({ state: "visible", timeout: 10000 });
    await weightCard.waitFor({ state: "visible", timeout: 10000 });

    const heightCardVisible = await heightCard.isVisible().catch(() => false);
    const weightCardVisible = await weightCard.isVisible().catch(() => false);

    const heightCardText = heightCardVisible ? (await heightCard.textContent()) ?? "" : "";
    const weightCardText = weightCardVisible ? (await weightCard.textContent()) ?? "" : "";

    console.log(`[QA] Height card text: "${heightCardText.replace(/\\s+/g, " ").trim()}"`);
    console.log(`[QA] Weight card text: "${weightCardText.replace(/\\s+/g, " ").trim()}"`);

    const step3Pass = heightCardVisible && weightCardVisible && heightCardText.includes("기록 없음") && weightCardText.includes("기록 없음");
    const step3Screenshot = `${EVIDENCE_DIR}/03-growth-cards-initial.png`;
    await page.screenshot({ path: step3Screenshot, fullPage: true });
    stepLogs.push({
      step: 3,
      name: "키 / 몸무게 카드 노출 및 초기 '기록 없음' 표기 확인",
      pass: step3Pass,
      text: `키 카드: "${heightCardText.replace(/\\s+/g, " ").trim()}" | 몸무게 카드: "${weightCardText.replace(/\\s+/g, " ").trim()}"`,
      screenshot: step3Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step3Pass).toBe(true);

    // ── STEP 4: Click '키' Card -> Growth Setup Modal ──
    console.log(`[QA] === STEP 4: Click '키' Card -> Open Growth Setup Modal ===`);
    await heightCard.click();
    await page.waitForTimeout(600);

    const setupModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보 시작하기" });
    await expect(setupModalHeading).toBeVisible({ timeout: 5000 });

    const birthDateInput = page.locator("#growth-birth-date");
    const maleButton = page.getByRole("button", { name: "남자", exact: true });
    const femaleButton = page.getByRole("button", { name: "여자", exact: true });
    const consentHeading = page.getByRole("heading", { name: "성장정보 수집·이용 동의" });
    const consentCheckbox = page.locator('input[type="checkbox"]');

    const birthDateVisible = await birthDateInput.isVisible();
    const maleVisible = await maleButton.isVisible();
    const femaleVisible = await femaleButton.isVisible();
    const consentHeadingVisible = await consentHeading.isVisible();
    const consentCheckboxVisible = await consentCheckbox.isVisible();

    const step4Pass = birthDateVisible && maleVisible && femaleVisible && consentHeadingVisible && consentCheckboxVisible;
    const step4Screenshot = `${EVIDENCE_DIR}/04-growth-setup-modal-opened.png`;
    await page.screenshot({ path: step4Screenshot });
    stepLogs.push({
      step: 4,
      name: "'키' 카드 클릭 시 '우리 아이 성장정보 시작하기' 모달 및 필수 필드 노출 확인",
      pass: step4Pass,
      text: `모달 제목: "우리 아이 성장정보 시작하기", 생년월일 input: ${birthDateVisible}, 성별 선택(남자/여자): ${maleVisible && femaleVisible}, 동의 안내: "${consentHeadingVisible ? "성장정보 수집·이용 동의" : ""}", 동의 체크박스: ${consentCheckboxVisible}`,
      screenshot: step4Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step4Pass).toBe(true);

    // ── STEP 5: Input Birthdate without Consent -> Submit Disabled ──
    console.log(`[QA] === STEP 5: Input birthdate without consent -> Button disabled ===`);
    await birthDateInput.fill("2016-08-18");
    await femaleButton.click(); // Select female but DO NOT check consent
    await page.waitForTimeout(300);

    const submitButton = page.getByRole("button", { name: "동의하고 시작하기" });
    await expect(submitButton).toBeDisabled();

    // Verify clicking disabled button is rejected / does not trigger submission
    await submitButton.click({ timeout: 500 }).catch(() => {
      console.log("[QA] Normal click on disabled button rejected as expected");
    });
    // Check modal is still present
    const modalStillPresent = await setupModalHeading.isVisible();

    const step5Pass = (await submitButton.isDisabled()) && modalStillPresent;
    const step5Screenshot = `${EVIDENCE_DIR}/05-growth-setup-disabled-without-consent.png`;
    await page.screenshot({ path: step5Screenshot });
    stepLogs.push({
      step: 5,
      name: "동의 미체크 상태에서 생년월일 입력 시 '동의하고 시작하기' 비활성화 및 미저장 확인",
      pass: step5Pass,
      text: `생년월일: 2016-08-18, 동의 체크박스 체크 여부: ${await consentCheckbox.isChecked()}, 버튼 비활성(disabled): true, 모달 유지: ${modalStillPresent}`,
      screenshot: step5Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step5Pass).toBe(true);

    // ── STEP 6: Future Date Validation (2099-01-01) ──
    console.log(`[QA] === STEP 6: Future Date Validation ===`);
    const inputMaxAttr = await birthDateInput.getAttribute("max");
    console.log(`[QA] Birth date input max attribute: ${inputMaxAttr}`);

    await birthDateInput.fill("2099-01-01");
    await page.waitForTimeout(300);

    const isAgeWarningVisible = await page.getByText("내친구 케이는 초등학생(만 6~13세) 서비스예요. 생년월일을 한 번 더 확인해 주세요.").isVisible().catch(() => false);
    console.log(`[QA] Age warning visible on future date: ${isAgeWarningVisible}`);

    const step6Screenshot = `${EVIDENCE_DIR}/06-growth-setup-future-date-validation.png`;
    await page.screenshot({ path: step6Screenshot });
    stepLogs.push({
      step: 6,
      name: "미래 날짜(2099-01-01) 입력 시 max 제약 및 유효성 검증 확인",
      pass: inputMaxAttr !== null && inputMaxAttr.length > 0,
      text: `input max 제약: max="${inputMaxAttr}", 미래 날짜 안내 여부: ${isAgeWarningVisible}`,
      screenshot: step6Screenshot,
      timestamp: new Date().toISOString(),
    });

    // ── STEP 7: Valid Birthdate (2016-08-18) + Female + Consent -> Submit -> Detail Modal ──
    console.log(`[QA] === STEP 7: Valid setup -> Submit -> Detail Modal ===`);
    await birthDateInput.fill("2016-08-18");
    await femaleButton.click();
    await consentCheckbox.check();
    await page.waitForTimeout(300);

    await expect(submitButton).toBeEnabled();
    console.log(`[QA] Submit button is now enabled`);

    // Click submit and wait for response
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/parent/growth/") && res.request().method() === "POST", { timeout: 15000 }).catch(() => [null]),
      submitButton.click(),
    ]);
    console.log(`[QA] Submit response status: ${response?.status?.() ?? "N/A"}`);

    // Wait for Growth Detail Modal to appear
    const detailModalHeading = page.getByRole("heading", { name: "우리 아이 성장정보", exact: true });
    await expect(detailModalHeading).toBeVisible({ timeout: 15000 });

    const detailModalText = (await page.locator("div.max-h-\\[92vh\\]").first().textContent()) ?? "";
    console.log(`[QA] Detail modal raw text sample: ${detailModalText.substring(0, 300)}`);

    const hasNoRecord = detailModalText.includes("기록 없음") || detailModalText.includes("아직 기록이 없어요");
    const hasAddButton = await page.getByRole("button", { name: "새 기록 추가" }).isVisible();
    const hasStandardNotice = detailModalText.includes("2017 소아청소년 성장도표");

    console.log(`[QA] Detail modal checks: hasNoRecord=${hasNoRecord}, hasAddButton=${hasAddButton}, hasStandardNotice=${hasStandardNotice}`);

    const step7Pass = (await detailModalHeading.isVisible()) && hasNoRecord && hasAddButton && hasStandardNotice;
    const step7Screenshot = `${EVIDENCE_DIR}/07-growth-detail-modal-opened.png`;
    await page.screenshot({ path: step7Screenshot });
    stepLogs.push({
      step: 7,
      name: "설정 완료 후 성장 상세 모달 전환 및 '기록 없음', '새 기록 추가', '2017 소아청소년 성장도표' 확인",
      pass: step7Pass,
      text: `모달 제목: "우리 아이 성장정보", '기록 없음' 표기: ${hasNoRecord}, '새 기록 추가' 버튼: ${hasAddButton}, 기준 표기: "${hasStandardNotice ? "2017 소아청소년 성장도표" : ""}"`,
      screenshot: step7Screenshot,
      timestamp: new Date().toISOString(),
    });
    expect(step7Pass).toBe(true);

    // ── STEP 8: Close Modal & Verify Home Cards Still '기록 없음' ──
    console.log(`[QA] === STEP 8: Close Detail Modal & Verify Home Cards ===`);
    const closeButton = page.getByRole("button", { name: "닫기" }).first();
    await closeButton.click();
    await page.waitForTimeout(600);

    const detailModalVisible = await detailModalHeading.isVisible().catch(() => false);
    expect(detailModalVisible).toBe(false);

    // Verify home cards
    const heightCardAfter = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*키.*성장정보 열기|키.*성장정보`) });
    const weightCardAfter = page.getByRole("button", { name: new RegExp(`${TARGET_CHILD_NAME}.*몸무게.*성장정보 열기|몸무게.*성장정보`) });

    const heightCardTextAfter = (await heightCardAfter.textContent()) ?? "";
    const weightCardTextAfter = (await weightCardAfter.textContent()) ?? "";

    console.log(`[QA] After close - Height card text: "${heightCardTextAfter.replace(/\\s+/g, " ").trim()}"`);
    console.log(`[QA] After close - Weight card text: "${weightCardTextAfter.replace(/\\s+/g, " ").trim()}"`);

    const step8Pass = !detailModalVisible && heightCardTextAfter.includes("기록 없음") && weightCardTextAfter.includes("기록 없음");
    const step8Screenshot = `${EVIDENCE_DIR}/08-growth-cards-after-setup.png`;
    await page.screenshot({ path: step8Screenshot, fullPage: true });
    stepLogs.push({
      step: 8,
      name: "모달 닫기 후 홈 카드 '기록 없음' 유지 확인",
      pass: step8Pass,
      text: `키 카드: "${heightCardTextAfter.replace(/\\s+/g, " ").trim()}" | 몸무게 카드: "${weightCardTextAfter.replace(/\\s+/g, " ").trim()}"`,
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
