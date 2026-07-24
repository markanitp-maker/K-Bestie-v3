import { chromium } from "playwright";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const USERNAME = "qaclaude160202";
const PASSWORD = process.env.QA_TEST_PASSWORD;
if (!PASSWORD) {
  console.error("QA_TEST_PASSWORD env var not set — refusing to run (no plaintext password in script).");
  process.exit(1);
}

const TIER_LABEL = { 1: "케어 스타트(tier1)", 2: "케어 인사이트(tier2)" };
const tierArg = parseInt(process.argv[2], 10);
if (![1, 2].includes(tierArg)) {
  console.error("usage: QA_TEST_PASSWORD=*** node smoke-qa.mjs <1|2>");
  process.exit(1);
}

const CASES = [
  { answer: "할머니랑 김치전을 만들었어", key: ["김치전", "할머니"] },
  { answer: "친구가 내 말을 안 들어서 속상했어", key: ["속상", "친구"] },
  { answer: "공룡 그림을 그렸어", key: ["공룡", "그림"] },
  { answer: "축구에서 골을 두 번 넣었어", key: ["축구", "골"] },
];

const GENERIC_ONLY = ["그렇구나!", "그렇구나.", "알겠어!", "알겠어.", "그랬구나!", "그랬구나."];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="아이 아이디를 입력하세요"]', USERNAME);
  await page.fill('input[placeholder="비밀번호를 입력하세요"]', PASSWORD);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/(child|parent)/, { timeout: 15000 }).catch(() => {});
}

async function ensureTextMode(page) {
  const textInput = page.locator('input[placeholder="케이에게 답해봐..."]');
  if (await textInput.count() > 0) return;
  const switchBtn = page.locator('button[aria-label="텍스트로 대화하기"]');
  if (await switchBtn.count() > 0) await switchBtn.click();
  await page.waitForSelector('input[placeholder="케이에게 답해봐..."]', { timeout: 15000 });
}

const STATIC_UI_LINES = new Set([
  "태블릿", "스마트폰", "9:41", "← 뒤로가기", "내친구 케이", "🔊", "🔇", "자동", "수동",
  "대기 중...", "듣고 있어요", "💬", "✕", "🎤", "➤",
  "기기 설정으로 화면이 꺼질 수 있어요",
]);

function isStaticUiLine(line) {
  if (STATIC_UI_LINES.has(line)) return true;
  if (/^\d+\/\d+$/.test(line)) return true; // "3/10" 진행률
  return false;
}

async function rawLineCount(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).length;
  });
}

function filterDynamic(lines) {
  return lines.filter((l) => !isStaticUiLine(l));
}

async function bubbleTexts(page) {
  const lines = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  });
  return filterDynamic(lines);
}

async function sendAndCheck(page, c, rawBeforeCount) {
  await page.evaluate(() => { window.__ttsStartTimes = []; });
  await page.fill('input[placeholder="케이에게 답해봐..."]', c.answer);
  await page.click('button[aria-label="전송"]');

  await page.waitForFunction(
    (n) => {
      const text = document.body.innerText || "";
      return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).length > n;
    },
    rawBeforeCount,
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(3000);

  const afterDynamic = await bubbleTexts(page);
  const rawAfterCount = await rawLineCount(page);
  const childBubbleLeak = afterDynamic.some((t) => t === c.answer);
  const latestK = afterDynamic[afterDynamic.length - 1] ?? "(none)";
  const hasKeyword = c.key.some((k) => latestK.includes(k));
  const isGenericOnly = GENERIC_ONLY.some((g) => latestK.trim() === g);
  const ttsPlayed = (await page.evaluate(() => window.__ttsStartTimes.length)) > 0;

  return { answer: c.answer, response: latestK, hasKeyword, isGenericOnly, childBubbleLeak, ttsPlayed, rawAfterCount };
}

(async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--use-file-for-fake-audio-capture=/tmp/fake-speech.wav",
    ],
  });
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.__ttsStartTimes = [];
    const proto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
    if (proto) {
      const origStart = proto.start;
      proto.start = function (...args) {
        window.__ttsStartTimes.push(Date.now());
        return origStart.apply(this, args);
      };
    }
  });

  console.log(`\n=== QA테스트 스모크 - ${TIER_LABEL[tierArg]} ===`);

  await login(page);
  await page.waitForTimeout(1500);
  const missionCard = page.getByText("오늘의 미션을 시작해요");
  if (await missionCard.count() > 0) {
    await missionCard.click().catch(() => {});
  } else {
    await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(3000);

  const startBtn = page.locator('button[aria-label="미션 시작"]');
  if (await startBtn.count() > 0) await startBtn.click().catch(() => {});

  await ensureTextMode(page);
  await page.waitForTimeout(4000);

  let rawBefore = await rawLineCount(page);
  const results = [];
  const seenLatestBubbles = [];

  // Case 0: 음성 켜짐
  {
    const r = await sendAndCheck(page, CASES[0], rawBefore);
    results.push({ voice: "ON", ...r });
    seenLatestBubbles.push(r.response);
    rawBefore = r.rawAfterCount;
  }

  // Case 1: 음성 켜짐 상태로 전송 + TTS 시작 직후 즉시 음소거 → 즉시 중단 확인
  {
    await page.evaluate(() => { window.__ttsStartTimes = []; });
    await page.fill('input[placeholder="케이에게 답해봐..."]', CASES[1].answer);
    await page.click('button[aria-label="전송"]');
    await page.waitForFunction(() => window.__ttsStartTimes.length > 0, { timeout: 10000 }).catch(() => {});
    const ttsStartedBeforeMute = (await page.evaluate(() => window.__ttsStartTimes.length)) > 0;
    await page.locator('button[aria-label="케이 음성 끄기"]').click().catch(() => {});
    await page.waitForTimeout(200);
    const countRightAfterMute = await page.evaluate(() => window.__ttsStartTimes.length);
    await page.waitForTimeout(3000);
    const countAfterSettle = await page.evaluate(() => window.__ttsStartTimes.length);
    const afterDynamic = await bubbleTexts(page);
    const latestK = afterDynamic[afterDynamic.length - 1] ?? "(none)";
    results.push({
      voice: "ON(즉시중단 테스트)",
      answer: CASES[1].answer,
      response: latestK,
      hasKeyword: CASES[1].key.some((k) => latestK.includes(k)),
      isGenericOnly: GENERIC_ONLY.some((g) => latestK.trim() === g),
      childBubbleLeak: afterDynamic.some((t) => t === CASES[1].answer),
      ttsPlayed: ttsStartedBeforeMute,
      immediateStopOk: countRightAfterMute === countAfterSettle,
    });
    seenLatestBubbles.push(latestK);
    rawBefore = await rawLineCount(page);
  }

  // Case 2, 3: 음성 꺼진 상태 유지
  for (const c of CASES.slice(2)) {
    const r = await sendAndCheck(page, c, rawBefore);
    results.push({ voice: "OFF", ...r });
    seenLatestBubbles.push(r.response);
    rawBefore = r.rawAfterCount;
  }

  await context.close();
  await browser.close();

  const dupQuestions = seenLatestBubbles.length !== new Set(seenLatestBubbles).size;

  let allPass = true;
  for (const r of results) {
    const voiceExpectation = r.voice === "OFF" ? !r.ttsPlayed : r.ttsPlayed;
    const stopOk = r.immediateStopOk === undefined ? true : r.immediateStopOk;
    const pass = r.hasKeyword && !r.isGenericOnly && !r.childBubbleLeak && voiceExpectation && stopOk;
    if (!pass) allPass = false;
    console.log(
      `voice=${r.voice} "${r.answer}" -> "${r.response}" keyword=${r.hasKeyword ? "OK" : "FAIL"} ` +
      `generic=${r.isGenericOnly ? "FAIL" : "OK"} childBubble=${r.childBubbleLeak ? "FAIL" : "OK"} ` +
      `tts=${r.ttsPlayed ? "played" : "silent"}${r.immediateStopOk !== undefined ? ` immediateStop=${r.immediateStopOk ? "OK" : "FAIL"}` : ""}`
    );
  }
  console.log(`질문 중복(이번 실행 4턴 내): ${dupQuestions ? "FAIL" : "OK"}`);
  if (dupQuestions) allPass = false;
  console.log(`\n[${TIER_LABEL[tierArg]}] 전체 판정: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
})();
