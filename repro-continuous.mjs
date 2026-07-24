import { chromium } from "playwright";

const BASE = process.argv[2] || "https://k-bestie-v3-dev.vercel.app";
const USERNAME = process.argv[3] || "testi01";
const PASSWORD = process.argv[4];
const FAKE_AUDIO = process.argv[5] || "/tmp/fake-speech.wav";
const MODE = process.argv[6] || "A";
const DURATION_MS = Number(process.argv[7] || 90000);

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="아이 아이디를 입력하세요"]', USERNAME);
  await page.fill('input[placeholder="비밀번호를 입력하세요"]', PASSWORD);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/(child|parent)/, { timeout: 15000 }).catch(() => {});
}
async function setMode(page, mode) {
  return page.evaluate(async (m) => {
    const r = await fetch("/api/child/test-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: m }) });
    return { status: r.status };
  }, mode);
}

(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  page.on("console", (msg) => console.log(`[${Date.now()}]`, msg.text().slice(0, 300)));
  page.on("pageerror", (err) => console.log(`[PAGEERROR][${Date.now()}]`, err.message));

  await login(page);
  console.log(`[STEP] logged in`);
  await setMode(page, MODE);
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  console.log(`[STEP] entered /child/missions, mode=${MODE}, observing ${DURATION_MS}ms with NO navigation`);
  await page.waitForTimeout(DURATION_MS);
  console.log(`[STEP] done observing`);
  await browser.close();
})();
