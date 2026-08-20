// 016 §4 — 넌센스 힌트가 정답 조립법을 알려주지 않는다.
//
// 실제 대화로 1차·2차 힌트를 받아 본다. 힌트는 DB 원문이므로 배포 없이 즉시 반영된다.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const RECIPE = /(영단어|한자로|합치면|거꾸로\s*읽|줄인\s*말|글자\s*수|\d+\s*글자|첫\s*글자)/;
const HONORIFIC = /(예요|이에요|해요|세요)/;

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

test("018: 넌센스 힌트가 조립법·첫글자·글자수를 알려주지 않는다", async ({ page }) => {
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
    console.log(`[${message}] ${text.replace(/\n/g, " ").slice(0, 130)}`);
    await page.waitForTimeout(1500);
    return text;
  };

  const hints: string[] = [];
  await send("넌센스 퀴즈 하자");

  // 문제 3개에 대해 1차·2차 힌트를 받아 본다.
  for (let round = 0; round < 3; round += 1) {
    hints.push(await send("힌트 줘"));   // 1차
    hints.push(await send("힌트 하나 더")); // 2차
    await send("정답 알려줘");            // 다음 문제로 넘어간다
  }

  const bad = hints.filter((h) => RECIPE.test(h) || HONORIFIC.test(h));
  expect(
    bad,
    `힌트에 조립법·첫글자·글자수·존댓말이 남아 있다:\n${bad.join("\n")}`
  ).toEqual([]);

  // 1차와 2차가 같은 말이면 두 번째 기회가 없는 것과 같다.
  for (let i = 0; i + 1 < hints.length; i += 2) {
    expect(hints[i].trim(), `1차와 2차 힌트가 같다: ${hints[i]}`).not.toBe(hints[i + 1].trim());
  }

  console.log("[받은 힌트 전체]", JSON.stringify(hints, null, 1));
});
