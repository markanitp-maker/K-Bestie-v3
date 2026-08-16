import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEV_URL = "https://k-bestie-v3-dev.vercel.app";
const EVIDENCE_DIR = "/tmp/codex-qa-076-kbd-r2";
const QA_PASSWORD = process.env.QA_TEST_PASSWORD || "QaDev1c65f921aea7!";

type Evidence = {
  missionStartSessionIds: string[];
  missionTurnRequests: Array<{ url: string; body: unknown }>;
  webSockets: Array<{ url: string; openedAt: number; closedAt?: number }>;
  consoleErrors: string[];
  notes: string[];
};

test.use({
  launchOptions: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

test("QA-076: 미션 Live 세션은 키보드 모드 전환 중에도 유지된다", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const evidence: Evidence = {
    missionStartSessionIds: [],
    missionTurnRequests: [],
    webSockets: [],
    consoleErrors: [],
    notes: [],
  };
  const saveEvidence = () => writeFileSync(join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(evidence, null, 2));

  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/mission/start")) return;
    const body = await response.json().catch(() => null) as { sessionId?: unknown } | null;
    if (typeof body?.sessionId === "string") evidence.missionStartSessionIds.push(body.sessionId);
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/mission/turn")) {
      evidence.missionTurnRequests.push({ url: request.url(), body: request.postDataJSON() });
    }
  });
  page.on("websocket", (ws) => {
    const record = { url: ws.url(), openedAt: Date.now() };
    evidence.webSockets.push(record);
    ws.on("close", () => { record.closedAt = Date.now(); });
  });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${DEV_URL}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("아이 아이디를 입력하세요").fill("qatesti-dev");
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.waitForTimeout(1_500);

    const testChild = page.getByText("TestChild", { exact: true }).first();
    if (await testChild.count()) {
      await testChild.click();
      await page.waitForTimeout(1_000);
    }
    await page.goto(`${DEV_URL}/child/missions`, { waitUntil: "domcontentloaded" });

    const beginOrResume = page.getByRole("button", { name: /시작하기|이어하기|진행 중인 미션 이어하기/ }).first();
    if (await beginOrResume.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await beginOrResume.click({ force: true });
    }

    const keyboardButton = page.getByRole("button", { name: "텍스트로 답하기" });
    await expect(keyboardButton).toBeVisible({ timeout: 30_000 });
    await expect(keyboardButton).toBeEnabled();
    await page.waitForTimeout(8_000); // Live 자동 시작과 relay WebSocket 관찰 창

    const sessionIdsBefore = [...evidence.missionStartSessionIds];
    const socketsBefore = evidence.webSockets.map((socket) => ({ ...socket }));
    const overlayStatusCandidates = page.getByText(/대기 중|듣고 있어|생각 중|말하는 중|연결 중|다시 연결 중/);

    await keyboardButton.click({ force: true });
    const input = page.getByPlaceholder("케이에게 텍스트로 답하기...");
    await expect(input).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeFocused();

    // 오버레이 자체에서 현재 상태 문구가 보이는지 확인한다. Live 상태가 idle이면 '대기 중' 문구도 허용한다.
    await expect(overlayStatusCandidates.first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: join(EVIDENCE_DIR, "overlay-open.png"), fullPage: false });

    for (let count = 0; count < 5; count += 1) {
      await page.getByRole("button", { name: "텍스트 입력창 닫기" }).evaluate((element: HTMLElement) => element.click());
      await expect(keyboardButton).toBeVisible({ timeout: 5_000 });
      await keyboardButton.click({ force: true });
      await expect(input).toBeVisible({ timeout: 5_000 });
    }

    await input.fill("QA-076 키보드 전환 검증 답변");
    await expect(page.getByRole("button", { name: "전송" })).toBeEnabled();
    await page.getByRole("button", { name: "전송" }).click();
    await expect(input).toHaveValue("");

    await page.getByRole("button", { name: "텍스트 입력창 닫기" }).evaluate((element: HTMLElement) => element.click());
    await expect(keyboardButton).toBeVisible({ timeout: 10_000 });

    const openedBeforeUrls = new Set(socketsBefore.map((socket) => socket.url));
    const closedPreexistingSockets = evidence.webSockets.filter((socket) => openedBeforeUrls.has(socket.url) && socket.closedAt);
    expect(evidence.missionStartSessionIds).toEqual(sessionIdsBefore);
    expect(closedPreexistingSockets, "키보드 전환이 기존 WebSocket close를 일으키면 안 됩니다.").toHaveLength(0);
    expect(evidence.missionTurnRequests.length, "텍스트 전송은 미션 턴 요청을 발생시켜야 합니다.").toBeGreaterThan(0);
    expect(evidence.consoleErrors, "전환 중 새 콘솔 오류가 발생하면 안 됩니다.").toEqual([]);

    if (socketsBefore.length === 0) {
      evidence.notes.push("Live relay WebSocket은 headless 관찰 창에 열리지 않아 실제 Live 세션 연속성은 미검증입니다.");
    }
    saveEvidence();
  } catch (error) {
    await page.screenshot({ path: join(EVIDENCE_DIR, "failure.png"), fullPage: true }).catch(() => {});
    saveEvidence();
    throw error;
  }
});
