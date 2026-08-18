import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-033-072";

const PARENT_USERNAME = "qatesti-dev";
const CHILD_B_USERNAME = "qa-child-b-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const CHILD_B_ID = "e2e00002-bbbb-4000-8000-000000000002";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error("SQL Error:", err.message);
    return null;
  }
}

async function hideTelemetryOverlay(page: Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
  }).catch(() => {});
}

function resetMissionForChild(childId: string) {
  const sql = `
    UPDATE mission_progress
    SET status='FORCE_ENDED', business_date=to_char(to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, 'YYYY-MM-DD')
    WHERE child_id='${childId}';
    UPDATE chat_sessions
    SET ended_at=now(), business_date=to_date('2020-01-01', 'YYYY-MM-DD') + floor(random()*2000)::int, started_at=started_at - interval '300 days'
    WHERE child_id='${childId}' AND session_type='mission';
  `;
  runQuery(sql);
}

test.describe("Dev QA — 033 and 072 Verification", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("033: Parent Report '부모가 주의 깊게 볼 변화' Card Removal Verification", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });

    // Step 1: Login as Parent
    console.log("[033] Logging in as parent...");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
    await page.waitForURL(/\/parent\/|\/$/, { timeout: 15000 }).catch(() => {});

    // Ensure store has active child QA_Child_A
    await page.evaluate(({ childId }) => {
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
      try {
        const storeRaw = localStorage.getItem("kbestie_store");
        if (storeRaw) {
          const parsed = JSON.parse(storeRaw);
          parsed.activeChildId = childId;
          localStorage.setItem("kbestie_store", JSON.stringify(parsed));
        }
      } catch (e) {}
    }, { childId: CHILD_A_ID });

    // Navigate to Parent Home to check QA-033-4 (Home "반복 이야기" card must exist)
    console.log("[033] Navigating to /parent/home...");
    await page.goto(`${BASE}/parent/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    // Dismiss any modals
    const modalClose = page.getByRole("button", { name: /확인|닫기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await hideTelemetryOverlay(page);

    // Wait for content to load
    const recurringCardHeader = page.locator("text=반복 이야기").first();
    await expect(recurringCardHeader).toBeVisible({ timeout: 20000 });

    // QA-033-4 part 1: Check "🔁 반복 이야기" card in InsightGrid on Parent Home
    const recurringCard = page.locator("div").filter({ hasText: /^🔁\s*반복 이야기/ }).first();
    const isRecurringCardVisible = await recurringCard.isVisible().catch(() => false);
    console.log("[033] Parent Home '🔁 반복 이야기' card visible:", isRecurringCardVisible);
    expect(isRecurringCardVisible).toBe(true);

    const recurringCardText = await recurringCard.innerText().catch(() => "");
    console.log("[033] Parent Home '🔁 반복 이야기' text:", recurringCardText);
    expect(recurringCardText).toContain("반복 이야기");

    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-4-parent-home-recurring.png`, fullPage: true });

    // Step 2: Navigate to /parent/report
    console.log("[033] Navigating to /parent/report...");
    await page.goto(`${BASE}/parent/report`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    // Open detail modal for the report
    console.log("[033] Clicking '자세히 보기'...");
    const detailBtn = page.getByRole("button", { name: /자세히 보기|상세보기|리포트 보기/ }).first();
    if (await detailBtn.isVisible()) {
      await detailBtn.click({ force: true });
    } else {
      await page.locator(".cursor-pointer").first().click({ force: true });
    }
    await page.waitForTimeout(1500);
    await hideTelemetryOverlay(page);

    // Click Tab 3: "추천 가이드"
    console.log("[033] Clicking '추천 가이드' tab...");
    const guideTab = page.getByText("추천 가이드", { exact: false }).first();
    await guideTab.click({ force: true });
    await page.waitForTimeout(1000);
    await hideTelemetryOverlay(page);

    // QA-033-1: Check that "부모가 주의 깊게 볼 변화" / "주의 깊게 볼 변화" / 👁️ is NOT displayed
    const fullBodyText = await page.locator("body").innerText();

    console.log("[033] Checking for '변화' or '주의 깊게 볼 변화'...");
    expect(fullBodyText).not.toContain("부모가 주의 깊게 볼 변화");
    expect(fullBodyText).not.toContain("주의 깊게 볼 변화");
    expect(fullBodyText).not.toContain("👁️");

    // QA-033-2: Check that no fallback placeholder like "특이 사항이 없었어요" exists
    expect(fullBodyText).not.toContain("특이 사항이 없었어요");
    expect(fullBodyText).not.toContain("데이터가 부족해요");

    // QA-033-3: Verify spacing and visible cards (💬 부모 대화 실마리, ❓ 부모용 추천 질문, ✨ 오늘의 케이 코멘트)
    const clueCard = page.getByText("💬 부모 대화 실마리");
    const questionCard = page.getByText("❓ 부모용 추천 질문");
    const commentCard = page.getByText("✨ 오늘의 케이 코멘트");

    const hasClue = await clueCard.isVisible().catch(() => false);
    const hasQuestion = await questionCard.isVisible().catch(() => false);
    const hasComment = await commentCard.isVisible().catch(() => false);

    console.log("[033] Cards presence:", { hasClue, hasQuestion, hasComment });
    expect(hasClue || hasQuestion || hasComment).toBe(true);

    // Save screenshots
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-1-recommendation-guide.png` });
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-3-cards-spacing.png` });

    // Close modal
    const modalCloseBtn = page.getByRole("button", { name: "닫기" }).or(page.getByText("✕", { exact: true })).first();
    if (await modalCloseBtn.isVisible()) {
      await modalCloseBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // QA-033-4 part 2: Check Weekly report tab / page
    console.log("[033] Checking weekly report...");
    await page.goto(`${BASE}/parent/report/weekly`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);
    const weeklyText = await page.locator("body").innerText();
    expect(weeklyText).not.toContain("부모가 주의 깊게 볼 변화");
    expect(weeklyText).not.toContain("주의 깊게 볼 변화");
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-4-weekly-report.png` });

    // QA-033-5: Test empty report guide rendering
    console.log("[033] Testing empty report recommendation guide...");
    // Set active child to QA_Child_B who has empty guide
    await page.evaluate(({ childId }) => {
      try {
        const storeRaw = localStorage.getItem("kbestie_store");
        if (storeRaw) {
          const parsed = JSON.parse(storeRaw);
          parsed.activeChildId = childId;
          localStorage.setItem("kbestie_store", JSON.stringify(parsed));
        }
      } catch (e) {}
    }, { childId: CHILD_B_ID });

    await page.goto(`${BASE}/parent/report`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);

    const detailBtnB = page.getByRole("button", { name: /자세히 보기|상세보기|리포트 보기/ }).first();
    if (await detailBtnB.isVisible()) {
      await detailBtnB.click({ force: true });
      await page.waitForTimeout(1000);
      await hideTelemetryOverlay(page);
      const guideTabB = page.getByText("추천 가이드", { exact: false }).first();
      await guideTabB.click({ force: true });
      await page.waitForTimeout(1000);
      await hideTelemetryOverlay(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-5-empty-guide.png` });
    }
  });

  test("072: Mission and Freechat CTA Button Redesign Verification", async ({ page }) => {
    test.setTimeout(180_000);

    // Reset mission for QA_Child_B before starting
    console.log("[072] Resetting mission for QA_Child_B...");
    resetMissionForChild(CHILD_B_ID);

    // Step 1: Login as Child B
    await page.setViewportSize({ width: 390, height: 844 });
    console.log("[072] Logging in as child QA_Child_B...");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_B_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
    await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

    await page.evaluate(({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    }, { cId: CHILD_B_ID });

    // Navigate to /child/home to dismiss onboarding / intro modals if any
    await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);
    const eventModalClose = page.getByRole("button", { name: /이벤트 확인했어요|이벤트 확인|닫기/ });
    if (await eventModalClose.count()) {
      await eventModalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await hideTelemetryOverlay(page);

    // QA-072-1: Mission "시작하기" CTA Button
    console.log("[072] Navigating to /child/missions...");
    await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    const startBtn = page.getByRole("button", { name: /시작하기/ }).first();
    await expect(startBtn).toBeVisible({ timeout: 10000 });

    // Inspect CTA Button styling:
    const btnBox = await startBtn.boundingBox();
    console.log("[072] Mission Start Button Bounding Box:", btnBox);
    expect(btnBox).not.toBeNull();

    // Check Button styling: background, color, icon, tail
    const btnEvaluation = await startBtn.evaluate((btn) => {
      const styles = window.getComputedStyle(btn);
      const svg = btn.querySelector("svg");
      const text = btn.innerText;

      // Check for pseudo-elements or child tail triangles
      const hasTailChild = btn.querySelectorAll(".border-t-\\[var\\(--color-k-orange\\)\\]").length > 0;
      
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        text: text,
        hasSvg: !!svg,
        svgFill: svg ? window.getComputedStyle(svg).fill : null,
        hasTail: hasTailChild,
      };
    });

    console.log("[072] Mission Start Button Evaluation:", btnEvaluation);

    // Verify properties:
    expect(btnEvaluation.text).toContain("시작하기");
    expect(btnEvaluation.hasSvg).toBe(true);
    expect(btnEvaluation.hasTail).toBe(false);

    // Check tail inside button container:
    const parentContainerTails = await page.locator("button[aria-label*='시작하기'] div.border-t-transparent").count();
    expect(parentContainerTails).toBe(0);

    // Save screenshot for QA-072-1
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-1-mission-start-desktop.png` });

    // QA-072-5: Check 320px and 390px viewports
    console.log("[072] Testing 320px viewport for Mission Start...");
    await page.setViewportSize({ width: 320, height: 600 });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(500);
    const btnBox320 = await startBtn.boundingBox();
    console.log("[072] 320px Button Bounding Box:", btnBox320);
    expect(btnBox320!.width).toBeLessThanOrEqual(320);
    expect(btnBox320!.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-5-mission-320px.png` });

    console.log("[072] Testing 390px viewport for Mission Start...");
    await page.setViewportSize({ width: 390, height: 844 });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-5-mission-390px.png` });

    // QA-072-2: Test clicking "시작하기" and then "이어하기"
    console.log("[072] Clicking '시작하기' button...");
    await startBtn.click({ force: true });
    await page.waitForTimeout(3000);
    await hideTelemetryOverlay(page);

    // Verify mission started: question bubble appears
    const questionBubble = page.locator("[data-ui='current-bubble']");
    await expect(questionBubble).toBeVisible({ timeout: 15000 });
    console.log("[072] Mission successfully started! Question bubble visible.");

    // QA-072-4: Check that K question speech bubble HAS a triangle tail!
    const questionBubbleTails = await questionBubble.locator(".border-t-\\[var\\(--color-k-orange\\)\\], .border-t-white, div[class*='border-t']").count();
    console.log("[072] Active question bubble tail element count:", questionBubbleTails);
    expect(questionBubbleTails).toBeGreaterThan(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-4-mission-active-bubble.png` });

    // Now exit mission and test "이어하기"
    console.log("[072] Exiting mission to test resume...");
    await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(1500);

    // Re-enter /child/missions
    console.log("[072] Re-entering /child/missions for '이어하기'...");
    await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    const resumeBtn = page.getByRole("button", { name: /이어하기/ }).first();
    await expect(resumeBtn).toBeVisible({ timeout: 10000 });
    const resumeText = await resumeBtn.innerText();
    console.log("[072] Resume button text:", resumeText);
    expect(resumeText).toContain("이어하기");

    // Save screenshot for QA-072-2
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-2-mission-resume.png` });

    // Click resume button and verify it resumes
    console.log("[072] Clicking '이어하기' button...");
    await resumeBtn.click({ force: true });
    await page.waitForTimeout(3000);
    await hideTelemetryOverlay(page);
    await expect(questionBubble).toBeVisible({ timeout: 15000 });
    console.log("[072] Mission resumed successfully!");

    // QA-072-3: Freechat "시작하기" CTA Button
    console.log("[072] Navigating to /chat (freechat)...");
    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    const freechatStartBtn = page.locator("button[aria-label='케이와 대화 시작하기']").first();
    await expect(freechatStartBtn).toBeVisible({ timeout: 10000 });

    const freechatBtnEvaluation = await freechatStartBtn.evaluate((btn) => {
      const styles = window.getComputedStyle(btn);
      const svg = btn.querySelector("svg");
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        borderRadius: styles.borderRadius,
        text: btn.innerText,
        hasSvg: !!svg,
      };
    });

    console.log("[072] Freechat Start Button Evaluation:", freechatBtnEvaluation);
    expect(freechatBtnEvaluation.text).toContain("시작하기");
    expect(freechatBtnEvaluation.hasSvg).toBe(true);

    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-3-freechat-start.png` });

    // Test 320px and 390px on freechat
    console.log("[072] Testing 320px viewport for Freechat...");
    await page.setViewportSize({ width: 320, height: 600 });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-5-freechat-320px.png` });

    console.log("[072] Testing 390px viewport for Freechat...");
    await page.setViewportSize({ width: 390, height: 844 });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-072-5-freechat-390px.png` });

    // Click "시작하기" in freechat and verify conversation starts
    console.log("[072] Clicking Freechat '시작하기'...");
    await freechatStartBtn.click({ force: true });
    await page.waitForTimeout(3000);
    await hideTelemetryOverlay(page);

    // Freechat question bubble or mascot ready
    const freechatQuestion = page.locator("p.text-\\[\\#3a2f2a\\], .border-\\[var\\(--color-k-orange\\)\\]");
    await expect(freechatQuestion.first()).toBeVisible({ timeout: 15000 });
    console.log("[072] Freechat started successfully!");
  });
});
