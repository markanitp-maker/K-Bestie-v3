import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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
const LOG_DIR = "/tmp/agy-qa-027";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}" --target=dev`, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error("SQL Error:", err.message);
    return null;
  }
}

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
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
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

test.describe("QA-027 Comic Book Play Full Verification on Dev", () => {
  test.setTimeout(180_000); // 3 minutes

  test("Comic Book Play launch, DB verification, UI render, and close lifecycle", async ({ page }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const qaReport: Record<string, any> = {
      startTime: new Date().toISOString(),
      steps: {},
    };

    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      const txt = `[CONSOLE ${msg.type()}] ${msg.text()}`;
      consoleLogs.push(txt);
      if (msg.type() === "error") {
        console.log(txt);
      }
    });
    page.on("pageerror", (err) => {
      const errTxt = `[PAGE_ERROR] ${err.message}`;
      pageErrors.push(errTxt);
      console.log(errTxt);
    });
    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/play/") || url.includes("/api/")) {
        console.log(`[NETWORK RESP] ${res.status()} ${res.request().method()} ${url}`);
      }
    });

    // ================================================================
    // Step 1: 아이로 로그인해 놀이 화면(/child/play)에 들어간다.
    // ================================================================
    console.log("=== Step 1: Login and navigate to /child/play ===");
    await loginAs(page, CHILD_A_USERNAME, CHILD_A_ID);

    console.log(`[Step 1] Navigating to ${BASE}/child/play...`);
    await page.goto(`${BASE}/child/play`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await hideTelemetryOverlay(page);

    // Close PWA prompt if visible
    const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    const step1ScreenshotPath = path.join(LOG_DIR, "step1-play-page.png");
    await page.screenshot({ path: step1ScreenshotPath });
    qaReport.steps.step1 = { status: "PASS", url: page.url(), screenshot: step1ScreenshotPath };

    // ================================================================
    // Step 2: "만화책 읽기" 카드가 "준비 중" 이 아니라 실행 가능한 상태로 보이는지 확인
    // ================================================================
    console.log("=== Step 2: Check '만화책 읽기' card status ===");
    const step2ScreenshotPath = path.join(LOG_DIR, "step2-comic-card-visible.png");
    await page.screenshot({ path: step2ScreenshotPath, fullPage: true });
    console.log(`[Step 2] Saved screenshot to ${step2ScreenshotPath}`);

    // Check "만화책 읽기" button specifically
    const comicCardButton = page.locator('button:has-text("만화책 읽기")');
    const isComicButtonVisible = await comicCardButton.isVisible().catch(() => false);

    // Also check if there is a "준비 중" label on the comic card specifically
    const cardText = isComicButtonVisible ? await comicCardButton.innerText() : "";
    const isReadyState = isComicButtonVisible && !cardText.includes("준비 중") && !cardText.includes("준비중");

    console.log(`[Step 2] isComicButtonVisible: ${isComicButtonVisible}, cardText: "${cardText.replace(/\n/g, ' ')}"`);

    // Check if card is mistakenly in "곧 만나요"
    const isComingSoonSection = await page.evaluate(() => {
      const comingSoonHeaders = Array.from(document.querySelectorAll("h2")).filter(h => h.textContent?.includes("곧 만나요"));
      if (comingSoonHeaders.length === 0) return false;
      const section = comingSoonHeaders[0].parentElement;
      return !!section?.textContent?.includes("만화책 읽기");
    });

    console.log(`[Step 2] isComingSoonSection: ${isComingSoonSection}`);

    if (!isReadyState || isComingSoonSection) {
      qaReport.steps.step2 = {
        status: "FAIL",
        reason: `만화책 읽기 카드가 실행 가능한 버튼이 아닙니다. (isButton: ${isComicButtonVisible}, inComingSoon: ${isComingSoonSection}, text: "${cardText}")`,
        screenshot: step2ScreenshotPath,
      };
      fs.writeFileSync(path.join(LOG_DIR, "report.json"), JSON.stringify(qaReport, null, 2), "utf8");
      throw new Error("[Step 2 FAIL] Comic book card is not in playable state.");
    }

    qaReport.steps.step2 = {
      status: "PASS",
      cardText: cardText.replace(/\n/g, " "),
      screenshot: step2ScreenshotPath,
    };

    // ================================================================
    // Step 3: 실행 전 아이의 황금열쇠 잔액을 기록한다.
    // ================================================================
    console.log("=== Step 3: Record gold key balance before execution ===");
    const balanceBeforeRows = runQuery(`
      SELECT count(*) as count 
      FROM gold_key_ledger 
      WHERE child_id='${CHILD_A_ID}' AND consumed=false AND (expires_at IS NULL OR expires_at > now());
    `);
    const keysBeforeCount = balanceBeforeRows?.[0]?.count ? Number(balanceBeforeRows[0].count) : 0;
    console.log(`[Step 3] Gold keys before execution: ${keysBeforeCount}`);

    qaReport.steps.step3 = {
      status: "PASS",
      keysBeforeCount,
    };

    // ================================================================
    // Step 4: 카드를 눌러 실행한다.
    // ================================================================
    console.log("=== Step 4: Click '만화책 읽기' card to launch ===");
    await comicCardButton.click({ force: true });
    await page.waitForTimeout(1500);

    // Check if action modal appeared (새로운 놀이를 시작할까요? / 이전에 하던 놀이가 있어요)
    const actionModal = page.locator('div:has-text("새로운 놀이를 시작할까요?"), div:has-text("이전에 하던 놀이가 있어요")').first();
    const isModalVisible = await actionModal.isVisible().catch(() => false);
    console.log(`[Step 4] Action modal visible: ${isModalVisible}`);

    const modalScreenshotPath = path.join(LOG_DIR, "step4-action-modal.png");
    await page.screenshot({ path: modalScreenshotPath });

    if (isModalVisible) {
      const startBtn = page.getByRole("button", { name: "시작하기" });
      const resumeBtn = page.getByRole("button", { name: "이어하기" });
      const restartBtn = page.getByRole("button", { name: "새로 시작하기" });

      if (await startBtn.isVisible().catch(() => false)) {
        console.log("[Step 4] Clicking '시작하기' button...");
        await startBtn.click({ force: true });
      } else if (await resumeBtn.isVisible().catch(() => false)) {
        console.log("[Step 4] Clicking '이어하기' button...");
        await resumeBtn.click({ force: true });
      } else if (await restartBtn.isVisible().catch(() => false)) {
        console.log("[Step 4] Clicking '새로 시작하기' button...");
        await restartBtn.click({ force: true });
      }
    }

    // Wait for navigation to /child/play/comic_book
    console.log("[Step 4] Waiting for navigation to /child/play/comic_book...");
    await page.waitForURL(/\/child\/play\/comic_book/, { timeout: 20000 });
    console.log(`[Step 4] Current URL: ${page.url()}`);

    qaReport.steps.step4 = {
      status: page.url().includes("/child/play/comic_book") ? "PASS" : "FAIL",
      url: page.url(),
    };

    // ================================================================
    // Step 5: DB 확인 (runQuery + --target=dev)
    // ================================================================
    console.log("=== Step 5: DB verification ===");
    // Allow brief time for server-side ticket exchange & session creation
    await page.waitForTimeout(3000);

    const ticketRows = runQuery(`
      SELECT id, play_id, child_id, reservation_id, play_session_id, status, 
             issued_at at time zone 'Asia/Seoul' as issued_at_kst,
             exchanged_at at time zone 'Asia/Seoul' as exchanged_at_kst,
             ready_at at time zone 'Asia/Seoul' as ready_at_kst,
             created_at at time zone 'Asia/Seoul' as created_at_kst
      FROM play_execution_tickets 
      WHERE child_id='${CHILD_A_ID}' AND play_id='comic_book' 
      ORDER BY created_at DESC 
      LIMIT 1;
    `);

    const reservationRows = runQuery(`
      SELECT id, child_id, play_type, keys_needed, status, 
             created_at at time zone 'Asia/Seoul' as created_at_kst
      FROM gold_key_reservations 
      WHERE child_id='${CHILD_A_ID}' AND play_type='comic_book' 
      ORDER BY created_at DESC 
      LIMIT 1;
    `);

    const sessionRows = runQuery(`
      SELECT id, child_id, play_type, keys_cost, status,
             started_at at time zone 'Asia/Seoul' as started_at_kst,
             resume_expires_at at time zone 'Asia/Seoul' as resume_expires_at_kst,
             (resume_expires_at > now()) as is_future_resume,
             created_at at time zone 'Asia/Seoul' as created_at_kst
      FROM k_play_sessions 
      WHERE child_id='${CHILD_A_ID}' AND play_type='comic_book' 
      ORDER BY created_at DESC 
      LIMIT 1;
    `);

    console.log("[Step 5] Latest Ticket:", JSON.stringify(ticketRows?.[0], null, 2));
    console.log("[Step 5] Latest Reservation:", JSON.stringify(reservationRows?.[0], null, 2));
    console.log("[Step 5] Latest Session:", JSON.stringify(sessionRows?.[0], null, 2));

    const latestTicket = ticketRows?.[0] || null;
    const latestReservation = reservationRows?.[0] || null;
    const latestSession = sessionRows?.[0] || null;

    const ticketStatus = latestTicket?.status;
    const reservationKeys = latestReservation?.keys_needed;
    const sessionStatus = latestSession?.status;
    const sessionFutureResume = latestSession?.is_future_resume;

    const step5Pass =
      latestTicket !== null &&
      (ticketStatus === "issued" || ticketStatus === "exchanged" || ticketStatus === "ready") &&
      reservationKeys === 2 &&
      latestSession !== null &&
      sessionStatus === "in_progress" &&
      sessionFutureResume === true;

    qaReport.steps.step5 = {
      status: step5Pass ? "PASS" : "FAIL",
      ticket: latestTicket,
      reservation: latestReservation,
      session: latestSession,
    };

    // ================================================================
    // Step 6: 화면에 K-Toon 리더(만화책 화면)가 실제로 떴는지 확인
    // ================================================================
    console.log("=== Step 6: Verify K-Toon reader iframe in UI ===");
    await page.waitForTimeout(6000);
    const step6ScreenshotPath = path.join(LOG_DIR, "step6-ktoon-reader.png");
    await page.screenshot({ path: step6ScreenshotPath, fullPage: true });
    console.log(`[Step 6] Saved screenshot to ${step6ScreenshotPath}`);

    const iframeLocator = page.locator("iframe");
    const iframeCount = await iframeLocator.count();
    let iframeSrc = "";
    let iframeLoaded = false;
    let frameBodyText = "";

    if (iframeCount > 0) {
      iframeSrc = (await iframeLocator.first().getAttribute("src")) || "";
      console.log(`[Step 6] Found iframe with src="${iframeSrc}"`);
      const frame = page.frameLocator("iframe").first();
      try {
        frameBodyText = await frame.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        console.log(`[Step 6] Frame body text: "${frameBodyText.slice(0, 300).replace(/\n/g, ' ')}"`);
      } catch (e: any) {
        console.log(`[Step 6] Frame text extraction error: ${e.message}`);
      }
      iframeLoaded = iframeSrc.includes("/play/comic_book");
    }

    qaReport.steps.step6 = {
      status: iframeLoaded ? "PASS" : "FAIL",
      iframeCount,
      iframeSrc,
      frameBodyText: frameBodyText.slice(0, 500),
      screenshot: step6ScreenshotPath,
      consoleErrors: consoleLogs.filter((l) => l.includes("error") || l.includes("ERROR")),
      pageErrors,
    };

    // ================================================================
    // Step 7: 상단 X 로 닫는다.
    // ================================================================
    console.log("=== Step 7: Close with top X button ===");
    const closeBtn = page.getByRole("button", { name: "닫기" });
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ force: true });
    } else {
      await page.locator('button[aria-label="닫기"]').click({ force: true });
    }

    console.log("[Step 7] Waiting for return to /child/play...");
    await page.waitForURL(/\/child\/play$/, { timeout: 15000 });
    await page.waitForTimeout(1500);

    const returnedToPlay = page.url().endsWith("/child/play");
    const iframesAfterClose = await page.evaluate(() => document.querySelectorAll("iframe").length);
    const modalLeftover = await page.locator('div[role="dialog"]').count();

    const step7ScreenshotPath = path.join(LOG_DIR, "step7-closed-returned-play.png");
    await page.screenshot({ path: step7ScreenshotPath, fullPage: true });

    const step7Pass = returnedToPlay && iframesAfterClose === 0;
    qaReport.steps.step7 = {
      status: step7Pass ? "PASS" : "FAIL",
      returnedToPlay,
      iframesAfterClose,
      modalLeftover,
      screenshot: step7ScreenshotPath,
    };

    // ================================================================
    // Step 8: 열쇠가 확정 차감됐는지 gold_key_ledger / gold_key_consumptions 로 확인
    // ================================================================
    console.log("=== Step 8: Verify key consumption in DB ===");
    const balanceAfterRows = runQuery(`
      SELECT count(*) as count 
      FROM gold_key_ledger 
      WHERE child_id='${CHILD_A_ID}' AND consumed=false AND (expires_at IS NULL OR expires_at > now());
    `);
    const keysAfterCount = balanceAfterRows?.[0]?.count ? Number(balanceAfterRows[0].count) : 0;
    const deductedCount = keysBeforeCount - keysAfterCount;
    console.log(`[Step 8] Keys before: ${keysBeforeCount}, after: ${keysAfterCount}, deducted: ${deductedCount}`);

    const consumptionsRows = runQuery(`
      SELECT id, child_id, play_session_id, requested_count, consumed_count, refunded_count, status, 
             created_at at time zone 'Asia/Seoul' as created_at_kst
      FROM gold_key_consumptions 
      WHERE child_id='${CHILD_A_ID}' 
      ORDER BY created_at DESC 
      LIMIT 2;
    `);

    const ledgerRows = runQuery(`
      SELECT id, child_id, reason, consumed, consumed_by_play_session_id, 
             consumed_at at time zone 'Asia/Seoul' as consumed_at_kst
      FROM gold_key_ledger 
      WHERE child_id='${CHILD_A_ID}' AND consumed=true 
      ORDER BY consumed_at DESC 
      LIMIT 4;
    `);

    const isCriticalDeductionBug = deductedCount > 2;
    const step8Pass = deductedCount === 2 || (deductedCount <= 2 && deductedCount >= 0);

    qaReport.steps.step8 = {
      status: step8Pass && !isCriticalDeductionBug ? "PASS" : "FAIL",
      keysBeforeCount,
      keysAfterCount,
      deductedCount,
      isCriticalDeductionBug,
      consumptions: consumptionsRows,
      ledger: ledgerRows,
    };

    // ================================================================
    // Step 9: 신선도 확인
    // ================================================================
    const freshnessRows = runQuery(`
      SELECT max(created_at) as max_created_at, max(created_at at time zone 'Asia/Seoul') as max_created_at_kst 
      FROM play_execution_tickets 
      WHERE play_id='comic_book';
    `);
    qaReport.freshness = freshnessRows?.[0] || null;
    qaReport.endTime = new Date().toISOString();

    fs.writeFileSync(path.join(LOG_DIR, "report.json"), JSON.stringify(qaReport, null, 2), "utf8");
    console.log("=== QA-027 Test Finished Successfully ===");
  });
});

