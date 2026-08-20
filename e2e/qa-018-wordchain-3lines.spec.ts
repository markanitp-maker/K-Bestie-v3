// 018(requests/a06.png) — 끝말잇기 진행 턴 말풍선이 정확히 3줄인지 실제 대화로 본다.
//
// 판정은 케이 말의 "느낌" 이 아니라 응답 텍스트의 줄 구조로 한다.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const BANNED = ["멋지게", "이어줬어", "받을게", "대단", "잘했", "규칙"];

function getQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  for (const c of [".env.local", ".env.test.local", ".env"]) {
    const f = path.join(process.cwd(), c);
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, "utf8").match(/^QA_TEST_PASSWORD=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("QA_TEST_PASSWORD 를 찾을 수 없다");
}

type Page = import("@playwright/test").Page;

test("018: 끝말잇기 진행 턴이 정확히 3줄이다", async ({ page }) => {
  test.setTimeout(420_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(getQaPassword());
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$|\/onboarding/, { timeout: 20000 }).catch(() => {});
  await page.evaluate(({ cId }) => {
    localStorage.setItem("k_child_id", cId);
    localStorage.setItem("login_role", "member");
    localStorage.setItem("k_pwa_intro_seen", "1");
  }, { cId: CHILD_ID });
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const later = page.getByRole("button", { name: "나중에 할게요" });
  if (await later.count().catch(() => 0)) await later.click({ force: true }).catch(() => {});

  const enableText = async (p: Page) => {
    const input = p.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    if (await input.isVisible().catch(() => false)) return;
    const kb = p.getByRole("button", { name: "텍스트로 답하기" });
    if (await kb.count().catch(() => 0)) { await kb.click({ force: true }); await p.waitForTimeout(700); }
    await expect(input).toBeVisible({ timeout: 15000 });
  };

  const send = async (message: string) => {
    await enableText(page);
    const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await input.fill(message);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
        { timeout: 90000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);
    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    const text = String(json.text ?? "");
    console.log(`[${message}] ${JSON.stringify(text)}`);
    await page.waitForTimeout(1500);
    return text;
  };

  const open = await send("끝말잇기 하자");
  // 케이 첫 낱말에서 이어야 할 글자를 뽑는다.
  const m = open.match(/"(.)"(?:로|으로)\s*시작/);
  let next = m ? m[1] : null;

  const progressTexts: string[] = [];

  // 아이 낱말은 **실제 사전**에서 가져온다. 손으로 적은 표를 쓰면 케이 첫 낱말이
  // 표에 없는 글자로 시작할 때 없는 낱말을 보내게 되고(실측: "가랑비" → "비구"),
  // 거절 턴만 나와 진행 턴을 한 번도 못 만든다.
  const { WORD_CHAIN_DICTIONARY } = await import(
    "../lib/k-conversation/wordChain/dictionaryIndex"
  );
  const { allowedNextInitials } = await import("../lib/k-conversation/wordChain/dueum");
  const used = new Set<string>();
  const pickWord = (syllable: string): string | null => {
    const initials = allowedNextInitials(syllable);
    const found = WORD_CHAIN_DICTIONARY.find(
      (e: { word: string; normalizedWord: string }) =>
        initials.includes(e.word[0]) && !used.has(e.normalizedWord)
    );
    if (found) used.add(found.normalizedWord);
    return found?.word ?? null;
  };

  for (let turn = 0; turn < 3 && next; turn += 1) {
    const candidate = pickWord(next);
    if (!candidate) break;
    const text = await send(candidate);
    // 진행 턴만 검사한다(거절·안내 턴은 형식이 다르다).
    if (text.includes("모르는 단어") || text.includes("이어지지 않아")) break;
    progressTexts.push(text);
    const nm = text.match(/"(.)"(?:로|으로)\s*시작/);
    next = nm ? nm[1] : null;
  }

  expect(progressTexts.length, "진행 턴을 한 번도 못 만들었다").toBeGreaterThan(0);

  for (const text of progressTexts) {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length, `3줄이 아니다: ${JSON.stringify(text)}`).toBe(3);
    expect(lines[0].endsWith("..."), `1줄 형식이 아니다: ${lines[0]}`).toBeTruthy();
    expect(lines[1].startsWith("나는 "), `2줄 형식이 아니다: ${lines[1]}`).toBeTruthy();
    expect(/^이제 "..?"(?:로|으로) 시작하는 단어는\?$/.test(lines[2]), `3줄 형식이 아니다: ${lines[2]}`).toBeTruthy();
    for (const banned of BANNED) {
      expect(text.includes(banned), `금지 문구 "${banned}" 가 있다: ${text}`).toBeFalsy();
    }
  }

  console.log("[진행 턴 전체]", JSON.stringify(progressTexts, null, 1));
});
