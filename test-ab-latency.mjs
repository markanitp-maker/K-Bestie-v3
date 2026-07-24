import { chromium } from "playwright";

const BASE = process.argv[2] || "https://k-bestie-v3-dw9tcyrxs-markanitp.vercel.app";
const MODE = process.argv[3] || "A";
const USERNAME = "testi02";
const PASSWORD = process.argv[4];

const events = [];

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

(async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${process.argv[5] || "/tmp/fake-speech.wav"}`,
    ],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const t = msg.text();
    const wallTs = Date.now();
    events.push({ wallTs, text: t.slice(0, 400) });
    console.log(`[${wallTs}]`, t.slice(0, 300));
  });
  page.on("pageerror", (err) => {
    events.push({ wallTs: Date.now(), text: "PAGEERROR: " + err.message.slice(0, 300) });
  });

  await login(page);
  console.log("logged in");

  await setMode(page, MODE);
  // 페이지가 Live 세션을 열기 전에 순수 네트워크 호출로 미리 진행률을 초기화한다 — 이미
  // 열려 있는 연결에 대고 "새 테스트" 버튼을 누르는 것과 달리, 이 시점엔 아직 아무 Live
  // 세션도 없으므로 방어적 stopSession() 호출이 아무것도 끊지 않는다(안전).
  await page.evaluate(async () => {
    await fetch("/api/child/test-mission/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceNew: true }),
    }).catch(() => {});
  });
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);

  // 의도적으로 "새 테스트" 버튼을 클릭하지 않는다 — 이 버튼은 loadSession(true)를 호출하고
  // loadSession은 시작하자마자 방어적으로 stopSession()을 호출한다. 앞선 진단에서 바로 이
  // 버튼 클릭이 방금 연 Live 세션을 스스로 끊어버리는 것으로 확인됐다(실제 앱 버그가
  // 아니라 이 테스트 스크립트 자체의 인위적 간섭이었음). 자연스러운 대화 흐름만 관찰한다.

  // 순수 자동(VAD) 모드로 관찰 — sendText()는 processAnswer와 별개로 Vertex에 직접
  // 자유발화 응답을 요청하는 병렬 경로라 실제 음성 입력(activityStart/PCM/activityEnd →
  // flushChildTurn → processAnswer 단일 경로)과 다르다. 실제 버그 재현을 위해 텍스트
  // composer를 전혀 쓰지 않고 fake-device의 VAD 트리거만으로 관찰한다.
  const totalWaitMs = 120000; // 2분 검증 런
  const pollStart = Date.now();
  let lastProgress = null;
  let turnCount = 0;
  while (Date.now() - pollStart < totalWaitMs) {
    await page.waitForTimeout(2000);
    const progress = await page.locator('[data-testid="progress"]').first().textContent().catch(() => null);
    if (progress !== lastProgress) {
      turnCount++;
      console.log(`\n=== PROGRESS CHANGE #${turnCount} at ${Date.now()} (+${Date.now() - pollStart}ms): ${lastProgress} -> ${progress} ===`);
      lastProgress = progress;
    }
    const notice = await page.locator("text=불안정").count().catch(() => 0);
    if (notice > 0) {
      console.log(`>>> NOTICE(불안정) visible at ${Date.now()} (+${Date.now() - pollStart}ms)`);
    }
    if (progress === "완료 · 100%") break;
  }
  console.log(`\n=== TOTAL PROGRESS CHANGES OBSERVED: ${turnCount} ===`);

  console.log("\nFINAL_EVENT_LOG", JSON.stringify(events, null, 2));
  await browser.close();
})();
