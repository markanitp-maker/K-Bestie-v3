// 010 — 케이 발화에 마크다운 강조가 아이 화면으로 새어 나오지 않는다.
//
// 2026-08-20 Dev 실측: 케이가 `첫 번째 단어는 **허수아비**야.` 라고 말했다.
// 말풍선은 <p> 평문이라 아이가 별표까지 본다. TTS 도 별표를 읽는다.
// 끝말잇기 시작은 케이가 첫 낱말을 강조하려 드는 지점이라 재현이 잘 된다.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";
const MARKDOWN_PATTERN = /\*\*|__|^\s{0,3}#{1,6}\s/m;

function getQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  for (const candidate of [".env.local", ".env.test.local", ".env"]) {
    const file = path.join(process.cwd(), candidate);
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(/^QA_TEST_PASSWORD=(.*)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("QA_TEST_PASSWORD 를 찾을 수 없다");
}

type Page = import("@playwright/test").Page;

test("010: 케이 발화에 마크다운 강조가 남지 않는다", async ({ page }) => {
  test.setTimeout(300_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(getQaPassword());
  await page.getByRole("button", { name: "로그인", exact: true }).click({ force: true });
  await page.waitForURL(/\/child\/|\/chat|\/$|\/onboarding/, { timeout: 20000 }).catch(() => {});
  await page.evaluate(
    ({ cId }) => {
      localStorage.setItem("k_child_id", cId);
      localStorage.setItem("login_role", "member");
      localStorage.setItem("k_pwa_intro_seen", "1");
    },
    { cId: CHILD_ID }
  );
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click({ force: true }).catch(() => {});
  }

  const enableTextInput = async (p: Page) => {
    const input = p.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    if (await input.isVisible().catch(() => false)) return;
    const kb = p.getByRole("button", { name: "텍스트로 답하기" });
    if (await kb.count().catch(() => 0)) {
      await kb.click({ force: true });
      await p.waitForTimeout(600);
    }
    await expect(input).toBeVisible({ timeout: 10000 });
  };

  const kTexts: Array<{ sent: string; text: string }> = [];
  const send = async (message: string) => {
    await enableTextInput(page);
    const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await input.fill(message);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/voice/respond") && r.request().method() === "POST",
        { timeout: 60000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);
    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    const text = String(json.text ?? "");
    kTexts.push({ sent: message, text });
    console.log(`[send] "${message}" -> 케이: ${JSON.stringify(text)}`);
    await page.waitForTimeout(1500);
  };

  // 케이가 낱말을 강조하려 드는 지점들을 훑는다.
  await send("끝말잇기 하자");
  await send("그만");
  await send("초성게임 하자");
  await send("정답 알려줘");
  await send("그만");
  await send("넌센스 퀴즈 하자");
  await send("정답 알려줘");
  await send("그만");

  // 화면에 실제로 그려진 말풍선도 확인한다 — API 응답만 보면 렌더 단계 누출을 놓친다.
  const bubbleTexts = await page.locator("p.text-left").allTextContents();
  console.log("[말풍선]", JSON.stringify(bubbleTexts));

  const offenders = [
    ...kTexts.filter((t) => MARKDOWN_PATTERN.test(t.text)).map((t) => `API "${t.sent}": ${t.text}`),
    ...bubbleTexts.filter((t) => MARKDOWN_PATTERN.test(t)).map((t) => `말풍선: ${t}`),
  ];

  expect(
    offenders,
    `케이 발화에 마크다운 강조가 남아 있다:\n${offenders.join("\n")}`
  ).toEqual([]);
});
