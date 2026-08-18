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
const LOG_DIR = "/tmp/agy-qa-011b";

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

test.describe("QA-011 Daily Golden Key Earned State Verification", () => {
  test.setTimeout(180_000); // 3 minutes

  test("Step 1 to 7: Earned Daily Golden Key Full Verification on Dev", async ({ browser }) => {
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
    console.log("\n=== Step 1: 아이 계정 로그인 및 /chat 진입 ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    const step1Shot = path.join(LOG_DIR, "step1-login-and-enter-chat.png");
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
    // Step 2: 상단 data-ui="freechat-daily-key-status" 텍스트 & data-state="earned" 확인
    // ----------------------------------------------------
    console.log("\n=== Step 2: 상단 data-ui='freechat-daily-key-status' 텍스트 및 data-state 확인 ===");
    const keyStatusEl = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(keyStatusEl).toBeVisible({ timeout: 10000 });

    const rawText = (await keyStatusEl.innerText()).trim();
    const normalizedText = rawText.replace(/\s+/g, " ");
    const dataState = (await keyStatusEl.getAttribute("data-state")) || "";

    console.log(`[Step 2] Element text (raw): "${rawText}"`);
    console.log(`[Step 2] Element text (normalized): "${normalizedText}"`);
    console.log(`[Step 2] data-state: "${dataState}"`);

    const step2Shot = path.join(LOG_DIR, "step2-daily-key-earned-status.png");
    await page.screenshot({ path: step2Shot, fullPage: true });
    const step2Mtime = fs.statSync(step2Shot).mtime.toISOString();

    expect(normalizedText).toContain("오늘의 황금열쇠");
    expect(normalizedText).toContain("오늘 받았어! ✓");
    expect(dataState).toBe("earned");

    stepResults.push({
      step: 2,
      name: "상단 황금열쇠 획득 상태 문구 및 data-state=earned 확인",
      status: "PASS",
      actualText: normalizedText,
      dataState: dataState,
      screenshotPath: step2Shot,
      mtime: step2Mtime,
    });

    // ----------------------------------------------------
    // Step 3: 새로고침(reload) 후에도 같은 획득 상태 복원 확인
    // ----------------------------------------------------
    console.log("\n=== Step 3: 새로고침(reload) 후 획득 상태 복원 확인 ===");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await hideTelemetryOverlay(page);

    const step3StatusEl = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(step3StatusEl).toBeVisible({ timeout: 10000 });

    const step3RawText = (await step3StatusEl.innerText()).trim();
    const step3Normalized = step3RawText.replace(/\s+/g, " ");
    const step3DataState = (await step3StatusEl.getAttribute("data-state")) || "";

    console.log(`[Step 3] Reloaded text: "${step3Normalized}", data-state: "${step3DataState}"`);

    const step3Shot = path.join(LOG_DIR, "step3-reload-restored.png");
    await page.screenshot({ path: step3Shot, fullPage: true });
    const step3Mtime = fs.statSync(step3Shot).mtime.toISOString();

    expect(step3Normalized).toContain("오늘의 황금열쇠");
    expect(step3Normalized).toContain("오늘 받았어! ✓");
    expect(step3DataState).toBe("earned");

    stepResults.push({
      step: 3,
      name: "새로고침(reload) 후 획득 상태 복원 확인",
      status: "PASS",
      actualText: step3Normalized,
      dataState: step3DataState,
      screenshotPath: step3Shot,
      mtime: step3Mtime,
    });

    // ----------------------------------------------------
    // Step 4: 다른 화면 이동(/child/home) 후 /chat 재진입 시 획득 상태 유지 확인
    // ----------------------------------------------------
    console.log("\n=== Step 4: /child/home 이동 후 /chat 재진입 시 획득 상태 유지 확인 ===");
    const backBtn = page.locator('button[aria-label="뒤로가기"], button:has-text("← 뒤로")').first();
    if (await backBtn.count()) {
      await backBtn.click();
      await page.waitForURL(/\/child\/home|\/child|\/$/, { timeout: 10000 });
    } else {
      await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
    }

    const step4aShot = path.join(LOG_DIR, "step4a-navigated-home.png");
    await page.screenshot({ path: step4aShot, fullPage: true });
    const step4aMtime = fs.statSync(step4aShot).mtime.toISOString();
    console.log(`[Step 4] Navigated to home: ${page.url()}`);

    // Re-enter /chat
    await goToChat(page);

    const step4StatusEl = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(step4StatusEl).toBeVisible({ timeout: 10000 });

    const step4RawText = (await step4StatusEl.innerText()).trim();
    const step4Normalized = step4RawText.replace(/\s+/g, " ");
    const step4DataState = (await step4StatusEl.getAttribute("data-state")) || "";

    console.log(`[Step 4] Re-entered chat text: "${step4Normalized}", data-state: "${step4DataState}"`);

    const step4bShot = path.join(LOG_DIR, "step4b-reentered-chat-persisted.png");
    await page.screenshot({ path: step4bShot, fullPage: true });
    const step4bMtime = fs.statSync(step4bShot).mtime.toISOString();

    expect(step4Normalized).toContain("오늘의 황금열쇠");
    expect(step4Normalized).toContain("오늘 받았어! ✓");
    expect(step4DataState).toBe("earned");

    stepResults.push({
      step: 4,
      name: "타 화면(/child/home) 이동 후 /chat 재진입 시 획득 상태 유지 확인",
      status: "PASS",
      actualText: step4Normalized,
      dataState: step4DataState,
      screenshotPath: step4bShot,
      mtime: step4bMtime,
    });

    // ----------------------------------------------------
    // Step 5: localStorage 클리어 후 다시 로그인·진입해도 획득 상태 복원 확인 (서버 기준 증명)
    // ----------------------------------------------------
    console.log("\n=== Step 5: localStorage.clear() 후 재로그인 및 진입 시 획득 상태 복원 확인 ===");
    await page.evaluate(() => localStorage.clear());
    console.log("[Step 5] localStorage cleared.");

    // Re-login after clearing storage
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);
    await goToChat(page);

    const step5StatusEl = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(step5StatusEl).toBeVisible({ timeout: 10000 });

    const step5RawText = (await step5StatusEl.innerText()).trim();
    const step5Normalized = step5RawText.replace(/\s+/g, " ");
    const step5DataState = (await step5StatusEl.getAttribute("data-state")) || "";

    console.log(`[Step 5] After localStorage.clear() text: "${step5Normalized}", data-state: "${step5DataState}"`);

    const step5Shot = path.join(LOG_DIR, "step5-localstorage-cleared-restored.png");
    await page.screenshot({ path: step5Shot, fullPage: true });
    const step5Mtime = fs.statSync(step5Shot).mtime.toISOString();

    expect(step5Normalized).toContain("오늘의 황금열쇠");
    expect(step5Normalized).toContain("오늘 받았어! ✓");
    expect(step5DataState).toBe("earned");

    stepResults.push({
      step: 5,
      name: "localStorage.clear() 후 재로그인 및 진입 시 획득 상태 복원 확인 (서버 기준)",
      status: "PASS",
      actualText: step5Normalized,
      dataState: step5DataState,
      screenshotPath: step5Shot,
      mtime: step5Mtime,
    });

    // ----------------------------------------------------
    // Step 6: /api/chat/session 응답 가로채 dailyKeyStatus 필드 검증
    // ----------------------------------------------------
    console.log("\n=== Step 6: /api/chat/session 응답 인터셉트 및 dailyKeyStatus 필드 검증 ===");
    let sessionResponseJson: any = null;

    await page.route("**/api/chat/session", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      sessionResponseJson = json;
      console.log("[Step 6] Intercepted /api/chat/session response JSON:\n", JSON.stringify(json, null, 2));
      await route.fulfill({ response, json });
    });

    // Navigate to trigger /api/chat/session
    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const step6Shot = path.join(LOG_DIR, "step6-session-api-intercepted.png");
    await page.screenshot({ path: step6Shot, fullPage: true });
    const step6Mtime = fs.statSync(step6Shot).mtime.toISOString();

    await page.unrouteAll();

    expect(sessionResponseJson).not.toBeNull();
    const dailyKeyStatus = sessionResponseJson?.dailyKeyStatus;
    console.log("[Step 6] dailyKeyStatus object:", dailyKeyStatus);

    expect(dailyKeyStatus).toBeDefined();
    expect(dailyKeyStatus.earnedToday).toBe(true);
    expect(dailyKeyStatus.rewardAmount).toBe(1);
    expect(typeof dailyKeyStatus.earnedAt).toBe("string");
    expect(dailyKeyStatus.earnedAt.length).toBeGreaterThan(0);
    expect(dailyKeyStatus.businessDate).toBe("2026-08-19");

    // Check that unnecessary ledger history is not leaked in dailyKeyStatus
    const dailyKeyKeys = Object.keys(dailyKeyStatus);
    console.log("[Step 6] dailyKeyStatus keys:", dailyKeyKeys);
    expect(dailyKeyKeys).toEqual(expect.arrayContaining(["earnedToday", "earnedAt", "businessDate", "rewardAmount"]));
    expect(dailyKeyKeys).not.toContain("ledger");
    expect(dailyKeyKeys).not.toContain("history");
    expect(dailyKeyKeys).not.toContain("ledger_rows");

    const dailyKeyStatusSummary = JSON.stringify(dailyKeyStatus);

    stepResults.push({
      step: 6,
      name: "/api/chat/session 응답 가로채 dailyKeyStatus 필드 검증",
      status: "PASS",
      actualText: dailyKeyStatusSummary,
      dataState: "N/A",
      screenshotPath: step6Shot,
      mtime: step6Mtime,
      detail: JSON.stringify(dailyKeyStatus, null, 2),
    });

    // ----------------------------------------------------
    // Step 7: 기존 화면 회귀 확인 (말풍선, 마스코트, 입력 영역, 헤더 버튼)
    // ----------------------------------------------------
    console.log("\n=== Step 7: 기존 화면 회귀 확인 ===");
    await hideTelemetryOverlay(page);

    const step7Shot = path.join(LOG_DIR, "step7-ui-regression-check.png");
    await page.screenshot({ path: step7Shot, fullPage: true });
    const step7Mtime = fs.statSync(step7Shot).mtime.toISOString();

    // 1) Mascot container
    const mascotContainer = page.locator('.free-chat-mascot-group, div[style*="--chat-mascot-height"], img[alt*="케이"]');
    const mascotCount = await mascotContainer.count();
    console.log(`[Step 7] Mascot containers found: ${mascotCount}`);
    expect(mascotCount).toBeGreaterThan(0);

    // 2) K-Play button
    const playBtn = page.locator('button[aria-label="놀이 고르기"], button[aria-label="놀이 준비중"]');
    const playCount = await playBtn.count();
    console.log(`[Step 7] K-Play buttons found: ${playCount}`);
    expect(playCount).toBeGreaterThan(0);

    // 3) Mode toggle
    const autoModeBtn = page.locator('button:has-text("자동")');
    const manualModeBtn = page.locator('button:has-text("수동")');
    const modeBtnCount = (await autoModeBtn.count()) + (await manualModeBtn.count());
    console.log(`[Step 7] Mode buttons found: ${modeBtnCount}`);
    expect(modeBtnCount).toBeGreaterThan(0);

    // 4) Input area
    const inputArea = page.locator('[data-ui="freechat-input-area"]');
    await expect(inputArea).toBeVisible({ timeout: 5000 });

    const textToggleBtn = page.locator('button[aria-label="텍스트로 답하기"]');
    const micControl = page.locator('button[aria-label="대화 시작하기"], div[aria-label="자동으로 듣고 있어요"], button[aria-label="마이크 켜기"], button[aria-label="녹음 종료"], button[aria-label="마이크 사용 불가"]');
    const interactiveCount = (await textToggleBtn.count()) + (await micControl.count());
    console.log(`[Step 7] Input area controls found: ${interactiveCount}`);
    expect(interactiveCount).toBeGreaterThan(0);

    // 5) Header button (Back button)
    const headerBackBtn = page.locator('button[aria-label="뒤로가기"], button:has-text("← 뒤로")');
    const headerBackCount = await headerBackBtn.count();
    console.log(`[Step 7] Header back buttons found: ${headerBackCount}`);
    expect(headerBackCount).toBeGreaterThan(0);

    stepResults.push({
      step: 7,
      name: "기존 화면 회귀 확인 (말풍선/마스코트/입력 영역/헤더 버튼)",
      status: "PASS",
      actualText: "케이 마스코트, 케이 놀이 버튼, 모드 토글, 입력 영역, 헤더 뒤로가기 버튼 정상 렌더",
      dataState: "N/A",
      screenshotPath: step7Shot,
      mtime: step7Mtime,
    });

    // Write full summary json to LOG_DIR
    const resultsFile = path.join(LOG_DIR, "qa-results.json");
    fs.writeFileSync(resultsFile, JSON.stringify({
      targetUrl: BASE,
      testedAt: new Date().toISOString(),
      stepResults,
    }, null, 2), "utf8");
    console.log(`\n[QA Complete] All results saved to ${resultsFile}`);

    await context.close();
  });
});
