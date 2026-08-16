import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

// Load .env.local
dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { BY_FIRST_SYLLABLE, WORD_SET } from "../lib/k-conversation/wordChain/dictionaryIndex";
import { allowedNextInitials } from "../lib/k-conversation/wordChain/dueum";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_A_USERNAME = "qa-child-a-dev";
const CHILD_A_ID = "e2e00001-aaaa-4000-8000-000000000001";

const LOG_DIR = "/tmp/agy-qa-006b";

function runQuery(sql: string) {
  try {
    const stdout = execSync(`node scripts/run-query.js "${sql.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (err: any) {
    console.error("SQL Error:", err.message);
    return null;
  }
}

// Priority basic words (학교, 나무, 시간, 노래, 그림, 게임, 컴퓨터, 우유, 친구, 사과, 바다, 하늘)
const BASIC_WORDS_MAP: Record<string, string> = {
  "학": "학교",
  "나": "나무",
  "라": "나무", // dueum: 라 -> 나 -> 나무
  "시": "시간",
  "노": "노래",
  "로": "노래", // dueum: 로 -> 노 -> 노래
  "그": "그림",
  "게": "게임",
  "개": "게임",
  "컴": "컴퓨터",
  "우": "우유",
  "친": "친구",
  "사": "사과",
  "바": "바다",
  "하": "하늘",
  "교": "교실",
  "무": "무지개",
  "간": "간식",
  "래": "래퍼",
  "림": "임금", // dueum: 림 -> 임
  "임": "임금",
  "금": "금붕어",
  "어": "어린이",
  "이": "이불",
  "리": "이불", // dueum: 리 -> 이
  "유": "유치원",
  "류": "유치원",
  "원": "원숭이",
  "터": "터미널",
  "구": "구름",
  "늘": "늘보",
  "과": "과자",
  "자": "자전거",
  "거": "거미",
  "미": "미술",
  "술": "술래잡기",
  "다": "다람쥐",
  "조": "조개",
};

const BASIC_WORDS_SET = new Set([
  "학교", "나무", "시간", "노래", "그림", "게임", "컴퓨터", "우유", "친구", "사과", "바다", "하늘"
]);

function pickWordForEnding(lastChar: string, usedWords: string[] = []): string {
  const allowed = allowedNextInitials(lastChar);

  // 1. Try mapped basic words first
  for (const initial of allowed) {
    const mapped = BASIC_WORDS_MAP[initial];
    if (mapped && !usedWords.includes(mapped)) {
      return mapped;
    }
  }

  // 2. Try any basic words starting with allowed initials
  for (const initial of allowed) {
    for (const bw of BASIC_WORDS_SET) {
      if (bw.startsWith(initial) && !usedWords.includes(bw)) {
        return bw;
      }
    }
  }

  // 3. Try dictionary words with good continuations
  for (const initial of allowed) {
    const candidateList = BY_FIRST_SYLLABLE.get(initial);
    if (candidateList && candidateList.length > 0) {
      for (const entry of candidateList) {
        if (!usedWords.includes(entry.normalizedWord)) {
          const nextAllowed = allowedNextInitials(entry.lastSyllable);
          const hasContinuations = nextAllowed.some((s) => (BY_FIRST_SYLLABLE.get(s)?.length || 0) >= 2);
          if (hasContinuations) {
            return entry.word;
          }
        }
      }
    }
  }

  // 4. Fallback to any valid word
  for (const initial of allowed) {
    const candidateList = BY_FIRST_SYLLABLE.get(initial);
    if (candidateList && candidateList.length > 0) {
      for (const entry of candidateList) {
        if (!usedWords.includes(entry.normalizedWord)) {
          return entry.word;
        }
      }
    }
  }

  return `${lastChar}기`;
}

test.describe("006b Dev Smoke Verification: Word Chain Dictionary & Regression", () => {
  test.setTimeout(300_000); // 5 minutes

  test("Verify basic words in word chain and regression test", async ({ browser }) => {
    fs.mkdirSync(LOG_DIR, { recursive: true });

    if (!QA_TEST_PASSWORD) {
      throw new Error("QA_TEST_PASSWORD가 설정되지 않았습니다.");
    }

    // Clean up any lingering active sessions before starting test
    runQuery(`UPDATE word_chain_game_sessions SET state='ENDED', ended_at=now() WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;`);
    runQuery(`UPDATE chosung_game_sessions SET state='ENDED', ended_at=now() WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL;`);

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();

    // 1. Login
    console.log(`[1] Logging in as ${CHILD_A_USERNAME}...`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_A_USERNAME);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForURL(/\/child\/|\/chat|\/$/, { timeout: 15000 }).catch(() => {});

    await page.evaluate(({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    }, { cId: CHILD_A_ID });

    // 2. Go to Chat
    console.log(`[2] Navigating to ${BASE}/chat...`);
    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
    if (await laterBtn.count().catch(() => 0)) {
      await laterBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
    await keyboardBtn.waitFor({ state: "visible", timeout: 15000 });
    await keyboardBtn.click();
    await page.waitForTimeout(500);

    const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await expect(textInputEl).toBeVisible({ timeout: 10000 });

    const sendMsg = async (msg: string) => {
      console.log(`\n[User -> K]: "${msg}"`);
      await textInputEl.fill(msg);
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
          { timeout: 45000 }
        ),
        page.locator('button[aria-label="전송"]').click(),
      ]);
      const json = await res.json().catch(() => ({}));
      await page.waitForTimeout(2000);
      const bubble = page.locator("p.text-left").first();
      const bubbleText = ((await bubble.textContent().catch(() => "")) || json.text || "").trim();
      const kText = (json.text || bubbleText).trim();
      console.log(`[K -> User]: "${kText}"`);
      return { kText, bubbleText, json };
    };

    // S-1: Word Chain Game with 5 turns
    console.log("\n==========================================");
    console.log("S-1. 끝말잇기 시작 및 기본 단어 검증");
    console.log("==========================================");

    const turnsLog: { turn: number; user: string; k: string; hasNotInDict: boolean; currentWordInDb: string }[] = [];
    const usedWordsList: string[] = [];
    const basicWordsAppeared: string[] = [];

    // Start game
    let res = await sendMsg("끝말잇기 하자");
    await page.screenshot({ path: path.join(LOG_DIR, "01_start_game.png") });

    let turnCount = 0;
    const maxTurns = 5;

    while (turnCount < maxTurns) {
      turnCount++;

      // Check current active session word in DB
      const activeSession = runQuery(
        `SELECT current_word, used_words FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1;`
      );
      const currentWordInDb = activeSession && activeSession[0] ? activeSession[0].current_word : "";
      console.log(`[Turn ${turnCount}] DB active session current_word: "${currentWordInDb}"`);

      let lastChar = "";
      if (currentWordInDb) {
        lastChar = currentWordInDb.slice(-1);
      } else {
        lastChar = "사"; // fallback
      }

      const wordToSend = pickWordForEnding(lastChar, usedWordsList);
      console.log(`[Turn ${turnCount}] User sends: "${wordToSend}" (following '${lastChar}')`);
      usedWordsList.push(wordToSend);
      if (BASIC_WORDS_SET.has(wordToSend)) {
        basicWordsAppeared.push(wordToSend);
      }

      res = await sendMsg(wordToSend);
      const currentKText = res.kText;

      const hasNotInDict = currentKText.includes("사전에 없") || 
                           currentKText.includes("모르는 단어") || 
                           currentKText.includes("국어사전") ||
                           currentKText.includes("없는 단어야") ||
                           currentKText.includes("사전에 등록되지 않");

      for (const bw of BASIC_WORDS_SET) {
        if (currentKText.includes(bw) && !basicWordsAppeared.includes(bw)) {
          basicWordsAppeared.push(bw);
        }
      }

      turnsLog.push({
        turn: turnCount,
        user: wordToSend,
        k: currentKText,
        hasNotInDict,
        currentWordInDb,
      });

      await page.screenshot({ path: path.join(LOG_DIR, `02_turn_${turnCount}.png`) });

      if (currentKText.includes("내가 졌어") || currentKText.includes("네가 이겼어")) {
        console.log("[S-1] Game ended by victory/defeat condition.");
        break;
      }
    }

    // End the word chain game
    console.log("\n[Ending Word Chain Game...]");
    res = await sendMsg("끝말잇기 그만할래");
    await page.screenshot({ path: path.join(LOG_DIR, "03_end_game.png") });

    // S-2: Regression - General conversation
    console.log("\n==========================================");
    console.log("S-2. 회귀 검증: 일반 대화 1턴");
    console.log("==========================================");
    const regRes = await sendMsg("오늘 날씨 정말 맑다! 케이 너는 무슨 계절 좋아해?");
    await page.screenshot({ path: path.join(LOG_DIR, "04_regression.png") });

    // S-3: Session DB Record
    console.log("\n==========================================");
    console.log("S-3. 세션 기록 DB 쿼리");
    console.log("==========================================");
    const sql = `SELECT state, current_word, array_length(used_words,1) AS used_cnt, ended_at FROM word_chain_game_sessions WHERE child_id='${CHILD_A_ID}' ORDER BY started_at DESC LIMIT 2;`;
    const dbRows = runQuery(sql);
    console.log("[S-3 DB Result]:", JSON.stringify(dbRows, null, 2));

    // Save summary log to /tmp/agy-qa-006b/summary.json
    const summaryData = {
      turnsLog,
      basicWordsAppeared,
      regressionResponse: regRes.kText,
      dbRows,
    };
    fs.writeFileSync(
      path.join(LOG_DIR, "summary.json"),
      JSON.stringify(summaryData, null, 2),
      "utf8"
    );

    console.log("\n==========================================");
    console.log("QA Complete. Summary written to", path.join(LOG_DIR, "summary.json"));
    console.log("==========================================");
  });
});
