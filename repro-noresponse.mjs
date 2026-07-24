import { chromium } from "playwright";

const BASE = process.argv[2] || "https://k-bestie-v3-dev.vercel.app";
const USERNAME = process.argv[3] || "testi01";
const PASSWORD = process.argv[4];
const FAKE_AUDIO = process.argv[5] || "/tmp/fake-speech.wav";
const MODE = process.argv[6] || "B";

const events = [];
function log(tag, text) {
  const wallTs = Date.now();
  events.push({ tag, wallTs, text: String(text).slice(0, 400) });
  console.log(`[${tag}][${wallTs}]`, String(text).slice(0, 300));
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="아이 아이디를 입력하세요"]', USERNAME);
  await page.fill('input[placeholder="비밀번호를 입력하세요"]', PASSWORD);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/(child|parent)/, { timeout: 15000 }).catch(() => {});
}

async function setMode(page, mode) {
  return page.evaluate(async (m) => {
    const r = await fetch("/api/child/test-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: m }),
    });
    return { status: r.status };
  }, mode);
}

async function waitAndReport(page, label, waitMs) {
  const start = Date.now();
  let sawSpeakAsK = false;
  let sawFirstKBubble = false;
  const handler = (msg) => {
    const t = msg.text();
    if (t.includes("speakAsK 호출")) sawSpeakAsK = true;
    if (t.includes("[K] 💬 k:")) sawFirstKBubble = true;
  };
  page.on("console", handler);
  await page.waitForTimeout(waitMs);
  page.off("console", handler);
  log("REPORT", `${label}: speakAsK_called=${sawSpeakAsK} kBubbleSeen=${sawFirstKBubble} elapsed=${Date.now() - start}ms`);
  return { sawSpeakAsK, sawFirstKBubble };
}

(async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`,
    ],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  page.on("console", (msg) => log("console", msg.text()));
  page.on("pageerror", (err) => log("PAGEERROR", err.message));

  await login(page);
  log("STEP", "logged in");
  await setMode(page, MODE);
  log("STEP", `mode set to ${MODE}`);

  // ── PATH 1: 최초 진입(콜드) ──────────────────────────────────
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  log("STEP", "PATH1: cold entry navigated");
  const r1 = await waitAndReport(page, "PATH1_cold_entry", 15000);

  // ── PATH 2: "새 테스트" 버튼(같은 페이지, 마이크 권한 이미 부여됨) ──
  await page.click('[data-testid="new-test"]').catch((e) => log("ERROR", "new-test click failed: " + e.message));
  log("STEP", "PATH2: clicked 새 테스트");
  const r2 = await waitAndReport(page, "PATH2_new_test_button", 15000);

  // ── PATH 3: 화면 이탈 후 재진입(다른 화면 갔다가 /child/missions 재방문) ──
  await page.goto(`${BASE}/child/home`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  log("STEP", "PATH3: left and re-entered /child/missions");
  const r3 = await waitAndReport(page, "PATH3_leave_reenter", 15000);

  // ── PATH 4: 로그아웃 후 재로그인 ──────────────────────────────
  await context.clearCookies();
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
  log("STEP", "cleared cookies/localStorage (logout simulation)");
  await login(page);
  log("STEP", "PATH4: logged out and back in");
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  const r4 = await waitAndReport(page, "PATH4_logout_relogin", 15000);

  console.log("\nFINAL_EVENT_LOG", JSON.stringify(events, null, 2));
  await browser.close();
})();
