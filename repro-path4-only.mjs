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
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: m }),
    });
    return { status: r.status };
  }, mode);
}

async function waitAndReport(page, label, waitMs) {
  let sawSpeakAsK = false, kBubbleCount = 0;
  const handler = (msg) => {
    const t = msg.text();
    if (t.includes("speakAsK 호출")) sawSpeakAsK = true;
    if (t.includes("[K] 💬 k:")) kBubbleCount++;
  };
  page.on("console", handler);
  await page.waitForTimeout(waitMs);
  page.off("console", handler);
  log("REPORT", `${label}: speakAsK_called=${sawSpeakAsK} kBubbleCount=${kBubbleCount}`);
}

(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  page.on("console", (msg) => log("console", msg.text()));
  page.on("pageerror", (err) => log("PAGEERROR", err.message));

  await login(page);
  log("STEP", "logged in (session already marked COMPLETED in DB before this run)");
  await setMode(page, MODE);

  await context.clearCookies();
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }).catch(() => {});
  await login(page);
  log("STEP", "PATH4: logged out and back in (after completed session)");
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  await waitAndReport(page, "PATH4_logout_relogin_after_completed", 15000);

  console.log("\nFINAL_EVENT_LOG", JSON.stringify(events, null, 2));
  await browser.close();
})();
