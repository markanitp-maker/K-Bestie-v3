// 017 — 놀이가 아이 뜻과 무관하게 끊기지 않는다.
//
// 대표님 Dev 실사용(2026-08-20 10:45~10:52)에서 나온 5건을 실제 대화로 확인한다.
// 판정은 케이 말이 아니라 **응답 payload 와 문구 내용**으로 한다.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";

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

test("017: 놀이가 아이 뜻과 무관하게 끊기지 않는다", async ({ page }) => {
  test.setTimeout(420_000);

  const turns: Array<{ sent: string; text: string; skill: unknown }> = [];

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
    turns.push({ sent: message, text, skill: json.activePlaySkillId ?? null });
    console.log(`[${message}] skill=${JSON.stringify(json.activePlaySkillId ?? null)} :: ${text.replace(/\n/g, " ").slice(0, 110)}`);
    await page.waitForTimeout(1500);
    return { text, json };
  };

  // 1) 초성게임 — 오타 힌트 요청에 정답이 나오면 FAIL
  await send("초성게임 하자");
  const hint1 = await send("흰트줘");
  expect(hint1.json.activePlaySkillId, "오타 힌트 요청에 놀이가 꺼졌다").toBe("CHOSUNG");

  // 2) 끝말잇기 — "계속" 을 낱말로 채점하면 FAIL
  await send("끝말잇기 하자");
  const cont = await send("계속");
  expect(
    /모르는 단어|사전에 없는/.test(cont.text),
    `"계속" 을 낱말로 채점했다: ${cont.text}`
  ).toBeFalsy();
  expect(cont.json.activePlaySkillId, '"계속" 에 놀이가 꺼졌다').toBe("WORD_CHAIN");

  // 3) 지적에 "기억이 안 나" 로 회피하면 FAIL
  const dispute = await send("또 이러네… 왜 이로 시작하는 단어여야 한다고, 아이를 화나게 만드니?");
  expect(
    /기억이 안 나|기억이 잘/.test(dispute.text),
    `지적에 기억 회피 문구가 나왔다: ${dispute.text}`
  ).toBeFalsy();
  expect(dispute.json.activePlaySkillId, "지적에 놀이가 꺼졌다").toBe("WORD_CHAIN");

  // 4) 넌센스 — 오타 힌트 요청에 세션이 끊기면 FAIL
  await send("넌센스 퀴즈 하자");
  const nHint = await send("모루겠어");
  expect(nHint.json.activePlaySkillId, "오타 힌트 요청에 넌센스가 꺼졌다").toBe("NONSENSE_QUIZ");

  // 5) 퀴즈 평에 세션이 끊기면 FAIL
  const meta = await send("이게 무슨 넌센스야?");
  expect(meta.json.activePlaySkillId, "퀴즈 평에 세션이 꺼졌다").toBe("NONSENSE_QUIZ");

  // 6) "그만" 은 그때 비로소 끝난다
  const stop = await send("그만");
  expect(stop.json.activePlaySkillId, '"그만" 인데도 놀이가 남았다').toBeNull();

  console.log("[전체 턴]", JSON.stringify(turns, null, 1));
});
