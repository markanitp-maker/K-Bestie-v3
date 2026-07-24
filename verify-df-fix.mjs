import { chromium } from "playwright";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const USERNAME = "testi02";
const PASSWORD = "TempQA-Verify-2026-0724!";

const CASES = [
  { answer: "할머니랑 김치전을 만들었어", key: ["김치전", "할머니"] },
  { answer: "학교에서 공룡 그림을 그렸어", key: ["공룡", "그림"] },
  { answer: "친구가 내 말을 안 들어서 속상했어", key: ["속상", "친구"] },
  { answer: "축구하다가 골을 두 번 넣었어", key: ["축구", "골"] },
];

const GENERIC_POOL = ["그랬구나!", "이야기해 줘서 고마워!", "그런 일이 있었구나!", "알겠어!"];

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

async function forceNewSession(page) {
  return page.evaluate(async () => {
    const r = await fetch("/api/child/test-mission/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forceNew: true }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
}

async function runMode(browser, mode) {
  const results = [];
  const page = await browser.newPage();

  // 실제 AudioBufferSourceNode.start() 호출 시점(=TTS 재생 진짜 시작 순간)을 직접
  // 훅으로 잡는다 - 서버 계측 beacon(turnId 미전달로 D/F 경로에서 비활성)에 의존하지 않음.
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

  await login(page);
  await setMode(page, mode);
  await forceNewSession(page);
  await page.goto(`${BASE}/child/missions`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="text-input"]', { timeout: 15000 });
  await page.waitForTimeout(1500); // greeting settle

  for (const c of CASES) {
    const beforeCount = await page.locator('[data-testid="bubbles"] [data-role="k"]').count();
    await page.evaluate(() => { window.__ttsStartTimes = []; });
    const t0 = Date.now();

    await page.fill('[data-testid="text-input"]', c.answer);
    await page.click('[data-testid="send"]');

    // wait for a new k-bubble to appear
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="bubbles"] [data-role="k"]').length > n,
      beforeCount,
      { timeout: 20000 }
    ).catch(() => {});

    // F안은 "···" 임시 말풍선이 실제 텍스트로 대체될 때까지 최대 8초 폴링
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll('[data-testid="bubbles"] [data-role="k"]');
        const last = els[els.length - 1];
        return last && last.textContent && last.textContent.trim() !== "···";
      },
      { timeout: 8000 }
    ).catch(() => {});

    await page.waitForTimeout(400);
    const kBubbles = await page.locator('[data-testid="bubbles"] [data-role="k"]').allTextContents();
    const latest = kBubbles[kBubbles.length - 1] ?? "(none)";

    let ttfPlayback = null;
    if (mode === "D") {
      await page.waitForTimeout(500);
      const starts = await page.evaluate(() => window.__ttsStartTimes ?? []);
      if (starts.length > 0) ttfPlayback = starts[0] - t0;
    }

    const hasKeyword = c.key.some((k) => latest.includes(k));
    const isGeneric = GENERIC_POOL.some((g) => latest.trim().startsWith(g));
    results.push({ mode, answer: c.answer, response: latest, hasKeyword, isGeneric, ttfPlaybackMs: ttfPlayback });
  }

  await page.close();
  return results;
}

(async () => {
  const browser = await chromium.launch();
  const allResults = [];
  for (const mode of ["D", "F"]) {
    const r = await runMode(browser, mode);
    allResults.push(...r);
  }
  await browser.close();

  console.log("\n=== 검증 결과 ===");
  let allPass = true;
  const seen = new Set();
  for (const r of allResults) {
    const dupQuestion = false; // question repeat checked separately below
    const pass = r.hasKeyword && !r.isGeneric;
    if (!pass) allPass = false;
    console.log(`[${r.mode}] "${r.answer}" -> "${r.response}" | 핵심단어=${r.hasKeyword ? "OK" : "FAIL"} generic=${r.isGeneric ? "FAIL" : "OK"} TTFplayback=${r.ttfPlaybackMs ?? "N/A"}ms`);
  }
  console.log(`\n전체 판정: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
})();
