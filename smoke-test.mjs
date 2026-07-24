import { chromium } from "playwright";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const USERNAME = "testi02";
const PASSWORD = process.argv[2];
const FAKE_AUDIO = "/tmp/fake-speech.wav";

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

async function smokeOne(mode) {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  let sawSpeakAsK1 = false, sawSpeakAsK2 = false, kBubble = false;
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("speakAsK 호출")) { if (!sawSpeakAsK1) sawSpeakAsK1 = true; else sawSpeakAsK2 = true; }
    if (t.includes("[K] 💬 k:")) kBubble = true;
  });
  await login(page);
  await setMode(page, mode);
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const r1 = { entry_speakAsK: sawSpeakAsK1, entry_kBubble: kBubble };
  sawSpeakAsK1 = false; kBubble = false;
  await page.click('[data-testid="new-test"]').catch(() => {});
  await page.waitForTimeout(9000);
  const r2 = { newtest_speakAsK: sawSpeakAsK1, newtest_kBubble: kBubble };
  console.log(`MODE ${mode}: entry(speakAsK=${r1.entry_speakAsK}, kBubble=${r1.entry_kBubble}) newTest(speakAsK=${r2.newtest_speakAsK}, kBubble=${r2.newtest_kBubble})`);
  await browser.close();
}

(async () => {
  await smokeOne("A");
  await smokeOne("B");
})();
