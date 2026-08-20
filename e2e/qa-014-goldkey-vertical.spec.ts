// 014 — 황금열쇠 카드 내부 배치를 세로(아이콘 위 + 문구 아래, 가운데 정렬)로 바꿨다.
//
// 011 이 고친 "문구가 잘게 쪼개져 카드가 길쭉해짐" 회귀가 되살아나지 않는지,
// 마이크·키보드·FAQ 와 겹치지 않는지, 화면 밖으로 잘리지 않는지를 좌표로 확인한다.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://k-bestie-v3-dev.vercel.app";
const CHILD_USERNAME = "qa-child-a-dev";
const CHILD_ID = "e2e00001-aaaa-4000-8000-000000000001";

function getQaPassword(): string {
  if (process.env.QA_TEST_PASSWORD) return process.env.QA_TEST_PASSWORD;
  for (const candidate of [".env.local", ".env.test.local", ".env"]) {
    const file = path.join(process.cwd(), candidate);
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, "utf8").match(/^QA_TEST_PASSWORD=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("QA_TEST_PASSWORD 를 찾을 수 없다");
}

type Page = import("@playwright/test").Page;
type Box = { x: number; y: number; width: number; height: number } | null;

function overlap(a: Box, b: Box): number {
  if (!a || !b) return 0;
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? Math.round(dx * dy) : 0;
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
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
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const later = page.getByRole("button", { name: "나중에 할게요" });
  if (await later.count().catch(() => 0)) await later.click({ force: true }).catch(() => {});
}

for (const vp of [
  { name: "iPhone 390", width: 390, height: 844, micCenter: 195 },
  { name: "Android 412", width: 412, height: 915, micCenter: 206 },
]) {
  test(`014: ${vp.name} — 아이콘이 문구 위, 가운데 정렬, 겹침 없음`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await login(page);

    const card = page.locator('[data-ui="freechat-daily-key-status"]');
    await expect(card).toBeVisible({ timeout: 20000 });

    const cardBox = await card.boundingBox();
    const layout = await card.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const children = [...el.children] as HTMLElement[];
      const icon = children[0];
      const textBlock = children[1];
      const ib = icon.getBoundingClientRect();
      const tb = textBlock.getBoundingClientRect();
      const lines = [...textBlock.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { text: (c.textContent ?? "").trim(), y: Math.round(r.y), h: Math.round(r.height) };
      });
      return {
        flexDirection: style.flexDirection,
        alignItems: style.alignItems,
        textAlign: window.getComputedStyle(textBlock).textAlign,
        iconBottom: Math.round(ib.bottom),
        textTop: Math.round(tb.top),
        iconCenterX: Math.round(ib.x + ib.width / 2),
        cardCenterX: Math.round(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2),
        lines,
      };
    });

    // 실측(2026-08-20) — 마이크 버튼의 aria-label 은 상태에 따라 바뀐다.
    // 대화 시작 전 "대화 시작하기", 자동 듣기 중 "자동으로 듣고 있어요", 수동 "마이크 켜기".
    // 하나라도 놓치면 boundingBox 가 null 이 되고 겹침 검사가 공허하게 통과한다.
    const micSelector = [
      'button[aria-label="대화 시작하기"]',
      'button[aria-label*="듣고 있어요"]',
      'button[aria-label*="마이크"]',
      'button[aria-label*="눌러서"]',
    ].join(", ");
    const mic = await page.locator(micSelector).first().boundingBox().catch(() => null);
    const keyboard = await page.locator('button[aria-label="텍스트로 답하기"]').first().boundingBox().catch(() => null);
    const faq = await page.locator('button[aria-label="FAQ 열기"]').first().boundingBox().catch(() => null);

    // 겹침 검사가 의미를 갖도록, 기준 요소를 못 찾았으면 그 자체를 실패로 본다.
    expect(mic, "마이크 버튼을 찾지 못했다 — 겹침 검사가 무의미해진다").not.toBeNull();
    expect(keyboard, "키보드 버튼을 찾지 못했다").not.toBeNull();
    expect(faq, "FAQ 버튼을 찾지 못했다").not.toBeNull();

    console.log(`[${vp.name}] 카드`, JSON.stringify(cardBox));
    console.log(`[${vp.name}] 배치`, JSON.stringify(layout));
    console.log(`[${vp.name}] 마이크`, JSON.stringify(mic), "키보드", JSON.stringify(keyboard), "FAQ", JSON.stringify(faq));

    // 014 §3-1 — 아이콘이 문구 위에 있고 세로 스택이다.
    expect(layout.flexDirection, "카드가 세로 스택이 아니다").toBe("column");
    expect(layout.iconBottom, "아이콘이 문구 위에 있지 않다").toBeLessThanOrEqual(layout.textTop + 1);
    // 014 §3-2 — 가운데 정렬.
    expect(layout.textAlign, "문구가 가운데 정렬이 아니다").toBe("center");
    expect(
      Math.abs(layout.iconCenterX - layout.cardCenterX),
      "아이콘이 카드 가로 중앙에 있지 않다"
    ).toBeLessThanOrEqual(2);

    // 011 회귀 — 문구는 2줄까지다.
    expect(layout.lines.length, `문구 줄 수가 2를 넘는다: ${JSON.stringify(layout.lines)}`).toBeLessThanOrEqual(2);
    const distinctY = new Set(layout.lines.map((l) => l.y));
    expect(distinctY.size, "문구 줄이 예상보다 잘게 쪼개졌다").toBeLessThanOrEqual(2);

    // 겹침 0.
    expect(overlap(cardBox, mic), "카드가 마이크와 겹친다").toBe(0);
    expect(overlap(cardBox, keyboard), "카드가 키보드 버튼과 겹친다").toBe(0);
    expect(overlap(cardBox, faq), "카드가 FAQ 버튼과 겹친다").toBe(0);

    // 화면 밖 잘림 없음.
    expect(cardBox!.x, "카드가 왼쪽으로 잘린다").toBeGreaterThanOrEqual(0);
    expect(cardBox!.x + cardBox!.width, "카드가 오른쪽으로 잘린다").toBeLessThanOrEqual(vp.width);

    // 마이크는 화면 정중앙 유지(위치 변경 금지).
    if (mic) {
      expect(
        Math.abs(mic.x + mic.width / 2 - vp.micCenter),
        `마이크가 정중앙에서 벗어났다: ${mic.x + mic.width / 2}`
      ).toBeLessThanOrEqual(1);
    }

    await page.screenshot({ path: `/tmp/qa-014-goldkey-${vp.width}.png` }).catch(() => {});
  });
}
