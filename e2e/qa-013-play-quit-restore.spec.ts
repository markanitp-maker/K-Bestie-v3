// 013 §3-14 — 놀이를 그만두면 입력 모드가 놀이 시작 전 상태로 돌아와야 한다.
//
// 2026-08-20 통합 QA 에서 "그만" 3초 후에도 마이크·자동/수동 토글이 렌더되지 않았다.
// 원인이 서버(activePlaySkillId 가 null 로 안 내려옴)인지 클라이언트(복귀가 안 됨)인지
// 가리기 위해, 매 턴의 /api/voice/respond 응답 payload 와 UI 상태를 함께 기록한다.
// 복귀를 최대 20초까지 기다려 "3초 컷이 이른 것"과 "아예 복귀 안 됨"도 구분한다.

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
    const match = fs.readFileSync(file, "utf8").match(/^QA_TEST_PASSWORD=(.*)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("QA_TEST_PASSWORD 를 찾을 수 없다");
}

type Page = import("@playwright/test").Page;

async function hideTelemetryOverlay(page: Page) {
  await page
    .evaluate(() => {
      const style = document.createElement("style");
      style.innerHTML =
        '[data-testid="stt-debug-overlay"] { display: none !important; pointer-events: none !important; }';
      document.head.appendChild(style);
    })
    .catch(() => {});
}

async function login(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await hideTelemetryOverlay(page);
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
  await hideTelemetryOverlay(page);
  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

type UiState = {
  autoPressed: string;
  manualPressed: string;
  micAriaLabel: string;
  inputVisible: boolean;
  /** 013 §3-6: 놀이 중에는 X(닫기) 버튼이 없어야 한다. */
  closeBtnCount: number;
  /** 013 후속: 놀이 중에도 케이 마스코트가 보여야 한다. */
  mascotVisible: boolean;
};

async function readUiState(page: Page): Promise<UiState> {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const text = (b: Element) => (b.textContent ?? "").trim();
    const label = (b: Element) => b.getAttribute("aria-label") ?? "";
    const auto = buttons.find((b) => text(b) === "자동" || label(b).includes("자동으로"));
    const manual = buttons.find((b) => text(b) === "수동" || label(b).includes("수동"));
    const mic = buttons.find(
      (b) =>
        label(b).includes("듣고 있어요") ||
        label(b).includes("눌러서") ||
        label(b).includes("마이크")
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="케이에게 텍스트로 답하기..."]'
    );
    const mascot = document.querySelector(".free-chat-mascot-group");
    const mascotVisible = !!mascot && (mascot as HTMLElement).getBoundingClientRect().height > 40;
    const closeBtns = buttons.filter((b) => {
      const l = label(b);
      return l === "채팅창 닫기" || l === "텍스트 입력창 닫기";
    });
    return {
      autoPressed: auto ? auto.getAttribute("aria-pressed") ?? "no-attr" : "not_rendered",
      manualPressed: manual ? manual.getAttribute("aria-pressed") ?? "no-attr" : "not_rendered",
      micAriaLabel: mic ? label(mic) : "not_rendered",
      inputVisible: !!input && window.getComputedStyle(input).display !== "none",
      closeBtnCount: closeBtns.length,
      mascotVisible,
    };
  });
}

async function enableTextInput(page: Page) {
  await hideTelemetryOverlay(page);
  const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  if (await input.isVisible().catch(() => false)) return;
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click({ force: true });
    await page.waitForTimeout(600);
  }
  await expect(input).toBeVisible({ timeout: 10000 });
}

test("013: 놀이 '그만' 이후 마이크·토글이 복귀한다", async ({ page }) => {
  test.setTimeout(300_000);

  const payloads: Array<{ sent: string; activePlaySkillId: unknown }> = [];

  await login(page);

  const before = await readUiState(page);
  console.log("[1] 놀이 시작 전:", JSON.stringify(before));

  const send = async (message: string) => {
    await enableTextInput(page);
    const input = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
    await input.fill(message);
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/voice/respond") && res.request().method() === "POST",
        { timeout: 60000 }
      ),
      page.locator('button[aria-label="전송"]').click({ force: true }),
    ]);
    const json: Record<string, unknown> = await response.json().catch(() => ({}));
    payloads.push({
      sent: message,
      activePlaySkillId:
        "activePlaySkillId" in json ? json.activePlaySkillId : "<필드 없음>",
    });
    console.log(
      `[send] "${message}" -> activePlaySkillId=${JSON.stringify(
        payloads[payloads.length - 1].activePlaySkillId
      )} / 케이="${String(json.text ?? "").slice(0, 60)}"`
    );
    await page.waitForTimeout(2000);
  };

  // 발화로 놀이를 시작하려면 먼저 텍스트 입력을 켜야 한다(Playwright 는 말을 못 한다).
  // 그래서 이 시나리오의 "놀이 전 모드" 는 text 다 — 그만둔 뒤 text 로 돌아와야 한다.
  await enableTextInput(page);
  const prePlay = await readUiState(page);
  console.log("[1-b] 놀이 직전(텍스트 모드):", JSON.stringify(prePlay));

  await send("끝말잇기 하자");
  const during = await readUiState(page);
  console.log("[2] 놀이 중:", JSON.stringify(during));
  expect(during.inputVisible, "놀이 중에 텍스트 입력창이 없다(키보드 강제 실패)").toBeTruthy();
  // 013 §3-6 — 놀이 중에는 아이가 음성으로 빠져나갈 문이 없어야 한다.
  // 시작 턴의 activePlaySkillId 가 null 이면 isPlayActive 가 켜지지 않아 X 버튼이 남는다.
  expect(
    during.closeBtnCount,
    `놀이 중인데 X(닫기) 버튼이 ${during.closeBtnCount}개 남아 있다 — 놀이 활성 상태가 클라이언트에 전달되지 않았다. payload=${JSON.stringify(payloads)}`
  ).toBe(0);
  // 시작 턴 payload 가 스킬 id 를 담고 있어야 한다.
  expect(
    payloads[0]?.activePlaySkillId,
    `놀이를 시작한 턴의 activePlaySkillId 가 스킬 id 가 아니다: ${JSON.stringify(payloads[0])}`
  ).toBeTruthy();
  // 013 후속(2026-08-20 대표님 실사용) — "놀이 중에 케이가 계속 안 보인다".
  // 상태 패널이 텍스트 모드에서 마스코트를 상태 알약으로 갈아치우는 바람에, 키보드가
  // 강제되는 놀이 내내 케이가 사라져 있었다. 놀이 중에도 케이는 보여야 한다.
  expect(
    during.mascotVisible,
    `놀이 중에 케이 마스코트가 보이지 않는다. 상태=${JSON.stringify(during)}`
  ).toBeTruthy();

  await send("그만");

  let after = await readUiState(page);
  let restoredAtMs: number | null = null;
  for (let elapsed = 0; elapsed <= 20_000; elapsed += 1000) {
    after = await readUiState(page);
    // 놀이 전이 text 였으므로 복귀 신호는 "X 버튼이 다시 생긴 텍스트 입력줄" 이다.
    const closeBtnBack = (await page.getByRole("button", { name: "텍스트 입력창 닫기" }).count()) > 0;
    if (closeBtnBack || after.micAriaLabel !== "not_rendered" || after.autoPressed !== "not_rendered") {
      restoredAtMs = elapsed;
      break;
    }
    await page.waitForTimeout(1000);
  }
  console.log("[3] '그만' 이후:", JSON.stringify(after));
  console.log(
    `[3] 복귀까지: ${restoredAtMs === null ? "복귀 안 됨(20초 초과)" : restoredAtMs + "ms"}`
  );
  console.log("[4] payloads:", JSON.stringify(payloads));

  await page.screenshot({ path: "/tmp/qa-013-after-quit.png" });

  // 013 §3-14 — 놀이 전 모드로 돌아와야 한다. 여기서는 text 였으므로 text 여야 한다.
  // 예전에는 저장값이 없어 switchToVoice() 로 떨어져 voice+manual 이 됐다.
  expect(
    after.inputVisible,
    `놀이 전이 text 였는데 text 로 복귀하지 않았다. 상태=${JSON.stringify(
      after
    )} payload=${JSON.stringify(payloads)}`
  ).toBeTruthy();
  const closeBtn = await page.getByRole("button", { name: "텍스트 입력창 닫기" }).count();
  expect(closeBtn, "복귀한 텍스트 모드에 X 버튼이 없다(놀이가 아직 활성으로 잡혀 있다)").toBeGreaterThan(0);
});
