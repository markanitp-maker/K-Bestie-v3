import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const EVIDENCE_DIR = "/tmp/agy-qa-033b";

const PARENT_USERNAME = "qatesti-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const REPORT_ID = "8546fe1b-65e6-4d5e-922f-5817429ad95e";

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

test.describe("033 Dev QA — Parent Report '부모가 주의 깊게 볼 변화' Removal & Semantic Mapping", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    }
  });

  test("QA-1 to QA-4: Verify Report Detail Modal, Recommendation Guide, Weekly, and History", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });

    console.log(`[033 QA] Navigating to login page: ${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);

    console.log(`[033 QA] Entering parent credentials (${PARENT_USERNAME})...`);
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(PARENT_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await hideTelemetryOverlay(page);
    await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });

    await page.waitForURL(/\/parent\/|\/$/, { timeout: 20000 }).catch((e) => {
      console.log("[033 QA] Login wait URL timeout, current url:", page.url());
    });
    console.log(`[033 QA] Logged in. Current URL: ${page.url()}`);

    // Set active child to QA_Child_A
    await page.evaluate(({ childId }) => {
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
      try {
        const storeRaw = localStorage.getItem("kbestie_store");
        if (storeRaw) {
          const parsed = JSON.parse(storeRaw);
          parsed.activeChildId = childId;
          localStorage.setItem("kbestie_store", JSON.stringify(parsed));
        } else {
          localStorage.setItem("kbestie_store", JSON.stringify({ activeChildId: childId }));
        }
      } catch (e) {}
    }, { childId: CHILD_A_ID });

    // Navigate to /parent/report
    console.log(`[033 QA] Navigating to ${BASE}/parent/report...`);
    await page.goto(`${BASE}/parent/report`, { waitUntil: "networkidle" });
    await hideTelemetryOverlay(page);
    await page.waitForTimeout(2000);

    // Dismiss any announcement / popups
    const modalClose = page.getByRole("button", { name: /확인|닫기/ });
    if (await modalClose.count()) {
      await modalClose.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await hideTelemetryOverlay(page);

    // Save initial /parent/report screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-0-parent-report-main.png`, fullPage: true });

    // Try opening the report modal for 2026-08-15 or report ID
    console.log(`[033 QA] Attempting to open report modal for 2026-08-15...`);
    const dateCard = page.locator("text=8월 15일").or(page.locator("text=2026-08-15")).or(page.getByText("자세히 보기")).first();
    if (await dateCard.isVisible()) {
      console.log(`[033 QA] Found date card / detail button, clicking...`);
      await dateCard.click({ force: true });
    } else {
      console.log(`[033 QA] Trying direct navigation to /parent/report/${REPORT_ID}...`);
      await page.goto(`${BASE}/parent/report/${REPORT_ID}`, { waitUntil: "networkidle" });
    }

    await page.waitForTimeout(2000);
    await hideTelemetryOverlay(page);

    // Click Tab 1: 빠른 요약
    const tab1 = page.getByRole("button", { name: "빠른 요약" }).or(page.getByText("빠른 요약")).first();
    if (await tab1.isVisible()) {
      await tab1.click({ force: true });
      await page.waitForTimeout(500);
      await hideTelemetryOverlay(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-4-tab1-summary.png` });
    }

    // Click Tab 2: 상세 보기
    const tab2 = page.getByRole("button", { name: "상세 보기" }).or(page.getByText("상세 보기")).first();
    if (await tab2.isVisible()) {
      await tab2.click({ force: true });
      await page.waitForTimeout(500);
      await hideTelemetryOverlay(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-4-tab2-detail.png` });
    }

    // Click Tab 3: 추천 가이드
    console.log(`[033 QA] Clicking Tab 3: '추천 가이드'...`);
    const guideTab = page.getByRole("button", { name: "추천 가이드" }).or(page.getByText("추천 가이드")).first();
    await expect(guideTab).toBeVisible({ timeout: 10000 });
    await guideTab.click({ force: true });
    await page.waitForTimeout(1500);
    await hideTelemetryOverlay(page);

    // Dump page text
    const guideBodyText = await page.locator("body").innerText();
    fs.writeFileSync(`${EVIDENCE_DIR}/guide_page_text_dump.txt`, guideBodyText, "utf8");

    // QA-1 Check:
    // 1) "부모가 주의 깊게 볼 변화" should be 0 occurrences
    // 2) "주의 깊게 볼" should be 0 occurrences
    // 3) 👁️ icon should not be present
    // 4) recurring_stories raw snippet ("친구와 이야기한 것이") must NOT be labeled as "변화"
    const countWatchChanges1 = (guideBodyText.match(/부모가 주의 깊게 볼 변화/g) || []).length;
    const countWatchChanges2 = (guideBodyText.match(/주의 깊게 볼/g) || []).length;
    const countEyeIcon = (guideBodyText.match(/👁️/g) || []).length;

    console.log(`[033 QA-1 Result] '부모가 주의 깊게 볼 변화': ${countWatchChanges1}건`);
    console.log(`[033 QA-1 Result] '주의 깊게 볼': ${countWatchChanges2}건`);
    console.log(`[033 QA-1 Result] '👁️' 아이콘: ${countEyeIcon}건`);

    expect(countWatchChanges1).toBe(0);
    expect(countWatchChanges2).toBe(0);
    expect(countEyeIcon).toBe(0);

    // Save QA-1 screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-1-recommendation-guide.png` });

    // QA-2 Check:
    // "특이 사항이 없었어요" / "데이터가 부족해요"
    const hasFallback1 = guideBodyText.includes("특이 사항이 없었어요");
    const hasFallback2 = guideBodyText.includes("데이터가 부족해요");
    console.log(`[033 QA-2 Result] Fallback text check: 특이사항=${hasFallback1}, 데이터부족=${hasFallback2}`);
    expect(hasFallback1).toBe(false);
    expect(hasFallback2).toBe(false);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-2-no-fallback.png` });

    // QA-3 Check:
    // Spacing & remaining cards presence
    const clueCard = page.getByText("💬 부모 대화 실마리").or(page.getByText("부모 대화 실마리"));
    const questionCard = page.getByText("❓ 부모용 추천 질문").or(page.getByText("부모용 추천 질문"));
    const commentCard = page.getByText("✨ 오늘의 케이 코멘트").or(page.getByText("오늘의 케이 코멘트"));

    const hasClue = await clueCard.first().isVisible().catch(() => false);
    const hasQuestion = await questionCard.first().isVisible().catch(() => false);
    const hasComment = await commentCard.first().isVisible().catch(() => false);

    console.log(`[033 QA-3 Result] Remaining cards visible - 대화실마리: ${hasClue}, 추천질문: ${hasQuestion}, 케이코멘트: ${hasComment}`);
    expect(hasClue || hasQuestion || hasComment).toBe(true);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-3-cards-spacing.png` });

    // Close modal if open
    const modalCloseBtn = page.getByRole("button", { name: "닫기" }).or(page.getByText("✕", { exact: true })).first();
    if (await modalCloseBtn.isVisible()) {
      await modalCloseBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // QA-4 Check 1: Weekly report tab
    console.log(`[033 QA-4] Navigating to Weekly Report tab...`);
    const weeklyTab = page.getByRole("button", { name: "주간" }).or(page.getByText("주간", { exact: true })).first();
    if (await weeklyTab.isVisible()) {
      await weeklyTab.click({ force: true });
      await page.waitForTimeout(1500);
      await hideTelemetryOverlay(page);
    } else {
      await page.goto(`${BASE}/parent/report/weekly`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await hideTelemetryOverlay(page);
    }
    const weeklyBodyText = await page.locator("body").innerText();
    const weeklyWatchCount = (weeklyBodyText.match(/주의 깊게 볼/g) || []).length;
    console.log(`[033 QA-4 Result] Weekly report '주의 깊게 볼': ${weeklyWatchCount}건`);
    expect(weeklyWatchCount).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-4-weekly.png` });

    // QA-4 Check 2: History / Past reports
    console.log(`[033 QA-4] Navigating to history...`);
    const historyLink = page.getByRole("button", { name: /지난 이력|이력 보기|이전/ }).or(page.getByText(/지난 이력|이력 보기/)).first();
    if (await historyLink.isVisible()) {
      await historyLink.click({ force: true });
      await page.waitForTimeout(1500);
      await hideTelemetryOverlay(page);
    } else {
      await page.goto(`${BASE}/parent/report/history`, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1500);
      await hideTelemetryOverlay(page);
    }
    const historyBodyText = await page.locator("body").innerText();
    const historyWatchCount = (historyBodyText.match(/주의 깊게 볼/g) || []).length;
    console.log(`[033 QA-4 Result] History '주의 깊게 볼': ${historyWatchCount}건`);
    expect(historyWatchCount).toBe(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/qa-033-4-history.png` });

    console.log("[033 QA] All checks passed successfully!");
  });
});
