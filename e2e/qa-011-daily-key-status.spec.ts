import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";

function getQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^QA_TEST_PASSWORD=(.*)$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return "";
}

const QA_TEST_PASSWORD = getQaPassword();
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";
const LOG_DIR = "/tmp/agy-qa-011a";

async function hideTelemetryOverlay(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="stt-debug-overlay"]') as HTMLElement;
    if (overlay) {
      overlay.style.display = "none";
      overlay.style.pointerEvents = "none";
    }
    const style = document.createElement("style");
    style.id = "hide-stt-overlay-style";
    style.innerHTML = `[data-testid="stt-debug-overlay"] { display: none !important; pointer-events: none !important; }`;
    document.head.appendChild(style);
  }).catch(() => {});
}

async function loginAs(page: import("@playwright/test").Page, username: string, childId: string) {
  console.log(`[loginAs] Navigating to ${BASE}/login...`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);

  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(username);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await hideTelemetryOverlay(page);

  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

  await page.evaluate(({ cId }) => {
    localStorage.setItem("k_child_id", cId);
    localStorage.setItem("login_role", "member");
    localStorage.setItem("k_pwa_intro_seen", "1");
  }, { cId: childId });
  console.log(`[loginAs] Logged in as ${username}, child_id=${childId}`);
}

async function goToChat(page: import("@playwright/test").Page) {
  console.log(`[goToChat] Navigating to ${BASE}/chat...`);
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await hideTelemetryOverlay(page);

  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    console.log("[goToChat] Closing PWA prompt...");
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

test.describe("QA-011 Freechat Daily Golden Key Status Verification", () => {
  test.setTimeout(180_000); // 3 minutes

  test("Step 1 to 8: Daily Golden Key Status Full E2E QA", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const stepResults: Array<{
      step: number;
      name: string;
      status: "PASS" | "FAIL";
      actualText: string;
      dataState: string;
      screenshotPath: string;
      mtime: string;
      detail?: string;
    }> = [];

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("[PAGE_ERROR]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log("[CONSOLE_ERROR]", msg.text());
      }
    });

    // ----------------------------------------------------
    // Step 1: 아이 계정으로 로그인 -> /chat 진입
    // ----------------------------------------------------
    console.log("=== Step 1: Login and go to /chat ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    const step1Shot = path.join(LOG_DIR, "step1-chat-entered.png");
    await page.screenshot({ path: step1Shot, fullPage: true });
    const step1Mtime = fs.statSync(step1Shot).mtime.toISOString();
    console.log(`[Step 1] Screenshot saved: ${step1Shot} (mtime: ${step1Mtime})`);

    const currentUrl = page.url();
    expect(currentUrl).toContain("/chat");
    stepResults.push({
      step: 1,
      name: "아이 계정 로그인 및 /chat 진입",
      status: "PASS",
      actualText: currentUrl,
      dataState: "N/A",
      screenshotPath: step1Shot,
      mtime: step1Mtime,
    });

    // ----------------------------------------------------
    // Step 2 & 3: data-ui="freechat-daily-key-status" 및 data-state="not-earned" 확인
    // ----------------------------------------------------
    console.log("=== Step 2 & 3: Check daily golden key status element and data-state ===");
    const keyStatusEl = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(keyStatusEl).toBeVisible({ timeout: 10000 });

    const rawText = (await keyStatusEl.innerText()).trim();
    const normalizedText = rawText.replace(/\s+/g, " ");
    const dataState = (await keyStatusEl.getAttribute("data-state")) || "";

    console.log(`[Step 2] Element text (raw): "${rawText}"`);
    console.log(`[Step 2] Element text (normalized): "${normalizedText}"`);
    console.log(`[Step 3] data-state: "${dataState}"`);

    const step2Shot = path.join(LOG_DIR, "step2-daily-key-status.png");
    await page.screenshot({ path: step2Shot, fullPage: true });
    const step2Mtime = fs.statSync(step2Shot).mtime.toISOString();

    const step3Shot = path.join(LOG_DIR, "step3-data-state.png");
    await page.screenshot({ path: step3Shot, fullPage: true });
    const step3Mtime = fs.statSync(step3Shot).mtime.toISOString();

    expect(normalizedText).toContain("오늘의 황금열쇠");
    expect(normalizedText).toContain("아직 안 받았어");
    expect(dataState).toBe("not-earned");

    stepResults.push({
      step: 2,
      name: "자유대화 상단 황금열쇠 상태 표시 텍스트 확인",
      status: "PASS",
      actualText: normalizedText,
      dataState: dataState,
      screenshotPath: step2Shot,
      mtime: step2Mtime,
    });

    stepResults.push({
      step: 3,
      name: "data-state 속성값 확인",
      status: "PASS",
      actualText: `data-state="${dataState}"`,
      dataState: dataState,
      screenshotPath: step3Shot,
      mtime: step3Mtime,
    });

    // ----------------------------------------------------
    // Step 4: 로딩 처리 확인 (**/api/chat/session 3초 지연)
    // ----------------------------------------------------
    console.log("=== Step 4: Loading state verification with delayed session route ===");
    await page.route("**/api/chat/session", async (route) => {
      console.log("[Step 4] Delaying /api/chat/session for 3000ms...");
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    await page.goto(`${BASE}/chat`, { waitUntil: "commit" });
    await page.waitForTimeout(500); // Wait briefly after HTML load to observe initial loading UI

    const loadingEl = page.locator('[data-ui="freechat-daily-key-status"]');
    const loadingStateAttr = (await loadingEl.getAttribute("data-state").catch(() => "")) || "";
    const loadingRawText = (await loadingEl.innerText().catch(() => "")).trim();

    console.log(`[Step 4] During delay: data-state="${loadingStateAttr}", text="${loadingRawText}"`);

    const step4Shot = path.join(LOG_DIR, "step4-loading-state.png");
    await page.screenshot({ path: step4Shot, fullPage: true });
    const step4Mtime = fs.statSync(step4Shot).mtime.toISOString();

    // Verify "아직 안 받았어" is NOT shown before session response completes
    expect(loadingRawText).not.toContain("아직 안 받았어");
    expect(loadingStateAttr).toBe("loading");

    // Wait for the delayed response to finish and state to transition to not-earned
    await expect(page.locator('[data-ui="freechat-daily-key-status"][data-state="not-earned"]')).toBeVisible({ timeout: 10000 });
    console.log("[Step 4] Successfully transitioned to not-earned after delay resolved");

    await page.unrouteAll();

    stepResults.push({
      step: 4,
      name: "로딩 상태 처리 확인 (지연 중 미획득 문구 비노출 및 loading 상태)",
      status: "PASS",
      actualText: loadingRawText ? loadingRawText : "🔑 (스켈레톤 바 표시, 텍스트 없음)",
      dataState: loadingStateAttr,
      screenshotPath: step4Shot,
      mtime: step4Mtime,
    });

    // ----------------------------------------------------
    // Step 5: 조회 실패 처리 확인 (**/api/chat/session 500 에러)
    // ----------------------------------------------------
    console.log("=== Step 5: Error handling verification with 500 session route ===");
    await page.route("**/api/chat/session", async (route) => {
      console.log("[Step 5] Mocking 500 error for /api/chat/session...");
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated Internal Server Error for QA" }),
      });
    });

    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await hideTelemetryOverlay(page);

    const step5Shot = path.join(LOG_DIR, "step5-error-handled.png");
    await page.screenshot({ path: step5Shot, fullPage: true });
    const step5Mtime = fs.statSync(step5Shot).mtime.toISOString();

    const errorStatusElCount = await page.locator('[data-ui="freechat-daily-key-status"]').count();
    const errorStatusVisible = errorStatusElCount > 0 ? await page.locator('[data-ui="freechat-daily-key-status"]').isVisible() : false;
    const bodyText5 = (await page.locator("body").innerText()).replace(/\s+/g, " ");

    console.log(`[Step 5] Key status element count: ${errorStatusElCount}, visible: ${errorStatusVisible}`);
    console.log(`[Step 5] Body snippet: "${bodyText5.slice(0, 200)}..."`);

    // (a) "아직 안 받았어"가 표시되지 않음
    expect(bodyText5).not.toContain("아직 안 받았어");
    // (b) 기술 오류 텍스트 노출 없음
    expect(bodyText5).not.toContain("Simulated Internal Server Error");
    expect(bodyText5).not.toContain("500");
    expect(bodyText5).not.toContain("Internal Server Error");
    // (c) 화면이 깨지지 않고 정상 대화 화면 유지 (헤더 뒤로가기 등 존재)
    const backBtnExists = (await page.locator('button[aria-label="뒤로가기"], button:has-text("← 뒤로")').count()) > 0;
    expect(backBtnExists).toBe(true);

    await page.unrouteAll();

    stepResults.push({
      step: 5,
      name: "조회 실패 처리 확인 (미획득 단정 금지, 기술오류 미노출, 화면 무결성)",
      status: "PASS",
      actualText: errorStatusVisible ? (await page.locator('[data-ui="freechat-daily-key-status"]').innerText()) : "(상태 표시 숨김: null 반환, 기술오류 노출 없음)",
      dataState: errorStatusVisible ? (await page.locator('[data-ui="freechat-daily-key-status"]').getAttribute("data-state") || "") : "hidden(null)",
      screenshotPath: step5Shot,
      mtime: step5Mtime,
    });

    // ----------------------------------------------------
    // Step 6: 새로고침 후 복원 확인
    // ----------------------------------------------------
    console.log("=== Step 6: Reload and verify restored state ===");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await hideTelemetryOverlay(page);

    const step6StatusEl = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(step6StatusEl).toBeVisible({ timeout: 10000 });

    const step6RawText = (await step6StatusEl.innerText()).trim();
    const step6Normalized = step6RawText.replace(/\s+/g, " ");
    const step6State = (await step6StatusEl.getAttribute("data-state")) || "";

    console.log(`[Step 6] Reloaded element text: "${step6Normalized}", data-state="${step6State}"`);

    const step6Shot = path.join(LOG_DIR, "step6-reload-restored.png");
    await page.screenshot({ path: step6Shot, fullPage: true });
    const step6Mtime = fs.statSync(step6Shot).mtime.toISOString();

    expect(step6Normalized).toContain("오늘의 황금열쇠");
    expect(step6Normalized).toContain("아직 안 받았어");
    expect(step6State).toBe("not-earned");

    stepResults.push({
      step: 6,
      name: "새로고침 후 미획득 상태(not-earned) 복원 확인",
      status: "PASS",
      actualText: step6Normalized,
      dataState: step6State,
      screenshotPath: step6Shot,
      mtime: step6Mtime,
    });

    // ----------------------------------------------------
    // Step 7: 상단 헤더 뒤로가기 버튼 클릭 가능 여부 확인 (가림 없음)
    // ----------------------------------------------------
    console.log("=== Step 7: Back button clickability verification ===");
    const backBtn = page.locator('button[aria-label="뒤로가기"], button:has-text("← 뒤로")').first();
    await expect(backBtn).toBeVisible({ timeout: 5000 });

    const step7Shot = path.join(LOG_DIR, "step7-header-clickable.png");
    await page.screenshot({ path: step7Shot, fullPage: true });
    const step7Mtime = fs.statSync(step7Shot).mtime.toISOString();

    console.log("[Step 7] Clicking back button in header...");
    await backBtn.click();
    await page.waitForURL(/\/child\/home|\/child|\/$/, { timeout: 10000 });
    console.log(`[Step 7] Navigated back to: ${page.url()}`);

    // Return to /chat for Step 8
    await goToChat(page);

    stepResults.push({
      step: 7,
      name: "상단 헤더 뒤로가기 버튼 클릭 가능 확인 (상태 표시에 가려지지 않음)",
      status: "PASS",
      actualText: "뒤로가기 버튼 클릭 성공 -> /child/home 정상 이동",
      dataState: "N/A",
      screenshotPath: step7Shot,
      mtime: step7Mtime,
    });

    // ----------------------------------------------------
    // Step 8: 기존 화면 회귀 확인 (케이 말풍선, 마스코트, 입력 영역 정상 렌더링)
    // ----------------------------------------------------
    console.log("=== Step 8: Regression check on mascot, bubble, and input areas ===");
    await hideTelemetryOverlay(page);

    const step8Shot = path.join(LOG_DIR, "step8-regression-check.png");
    await page.screenshot({ path: step8Shot, fullPage: true });
    const step8Mtime = fs.statSync(step8Shot).mtime.toISOString();

    // 1) Mascot container
    const mascotContainer = page.locator('.free-chat-mascot-group, div[style*="--chat-mascot-height"], img[alt*="케이"]');
    const mascotCount = await mascotContainer.count();
    console.log(`[Step 8] Mascot containers found: ${mascotCount}`);
    expect(mascotCount).toBeGreaterThan(0);

    // 2) K-Play button or status card
    const playBtn = page.locator('button[aria-label="놀이 고르기"], button[aria-label="놀이 준비중"]');
    const playCount = await playBtn.count();
    console.log(`[Step 8] K-Play buttons found: ${playCount}`);
    expect(playCount).toBeGreaterThan(0);

    // 3) Mode toggle (Auto/Manual)
    const autoModeBtn = page.locator('button:has-text("자동")');
    const manualModeBtn = page.locator('button:has-text("수동")');
    const modeBtnCount = (await autoModeBtn.count()) + (await manualModeBtn.count());
    console.log(`[Step 8] Mode buttons found: ${modeBtnCount}`);
    expect(modeBtnCount).toBeGreaterThan(0);

    // 4) Input area & interactive controls
    const inputArea = page.locator('[data-ui="freechat-input-area"]');
    await expect(inputArea).toBeVisible({ timeout: 5000 });

    const textToggleBtn = page.locator('button[aria-label="텍스트로 답하기"]');
    const micControl = page.locator('button[aria-label="대화 시작하기"], div[aria-label="자동으로 듣고 있어요"], button[aria-label="마이크 켜기"], button[aria-label="녹음 종료"], button[aria-label="마이크 사용 불가"]');
    const interactiveCount = (await textToggleBtn.count()) + (await micControl.count());
    console.log(`[Step 8] Input area controls found: ${interactiveCount}`);
    expect(interactiveCount).toBeGreaterThan(0);

    // 5) Bubble / guidance text presence
    const bodyText8 = await page.locator("body").innerText();
    expect(bodyText8).toContain("케이");

    stepResults.push({
      step: 8,
      name: "기존 화면 회귀 확인 (말풍선/마스코트/입력 컨트롤 정상 렌더링)",
      status: "PASS",
      actualText: "케이 마스코트, 케이 놀이 버튼, 자동/수동 토글, 하단 대화 입력 컨트롤 정상 렌더",
      dataState: "N/A",
      screenshotPath: step8Shot,
      mtime: step8Mtime,
    });

    // Write full summary json to LOG_DIR
    const resultsFile = path.join(LOG_DIR, "qa-results.json");
    fs.writeFileSync(resultsFile, JSON.stringify({
      targetUrl: BASE,
      testedAt: new Date().toISOString(),
      stepResults,
    }, null, 2), "utf8");
    console.log(`[QA Complete] Results saved to ${resultsFile}`);
  });
});
