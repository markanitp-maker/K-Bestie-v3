// app/api/mission/stt/route.ts에서 자유대화(session_type=free_chat) 세션이 미션 전용
// assertMissionSessionActive 게이트에 막혀 매 STT 호출이 423으로 거부되던 회귀 버그의
// Dev 배포(dpl_C4q2w3sV86Us7V5BYdLwHDYt2Pie) 검증용 1회성 스크립트.
// QA테스트 계정(testi02)으로 로그인 후 실제 free_chat 세션을 만들고 /api/mission/stt를
// 더미 오디오로 직접 호출해 423(INVALID_SESSION_TYPE)이 더 이상 나오지 않는지 확인한다.
import { test, expect } from "@playwright/test";

const DEV_URL = "https://k-bestie-v3-dev.vercel.app";
const QA_PASSWORD = process.env.QA_TEST_PASSWORD;
if (!QA_PASSWORD) throw new Error("QA_TEST_PASSWORD env var required");

test("free chat STT no longer 423s after session_type gate fix", async ({ page }) => {
  test.setTimeout(60000);

  await page.goto(`${DEV_URL}/login`);
  await page.waitForLoadState("networkidle");
  const idField = page.getByPlaceholder("아이 아이디를 입력하세요");
  const pwField = page.getByPlaceholder("비밀번호를 입력하세요");
  await idField.waitFor({ state: "visible" });
  await idField.fill("qatesti-dev");
  await pwField.fill(QA_PASSWORD!);
  await expect(idField).toHaveValue("qatesti-dev");
  const loginBtn = page.getByRole("button", { name: "로그인", exact: true });
  await expect(loginBtn).toBeEnabled({ timeout: 5000 });
  await page.screenshot({ path: "/tmp/qa-gate-fix-before-click.png" });
  const [loginResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/auth/") || r.url().includes("supabase"), { timeout: 15000 }).catch(() => null),
    loginBtn.click(),
  ]);
  console.log("[login response]", loginResponse ? loginResponse.url() + " " + loginResponse.status() : "none captured");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/qa-gate-fix-after-login.png" });
  console.log("[url after login]", page.url());
  await page.goto(`${DEV_URL}/chat`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  console.log("[url after /chat nav]", page.url());
  await page.screenshot({ path: "/tmp/qa-gate-fix-chat-page.png" });

  const sessionRes = await page.evaluate(async () => {
    const res = await fetch("/api/chat/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId: "4e7c1a6f-a953-4ebc-a181-e9c054a8ee3c" }),
    });
    return { status: res.status, body: await res.json() };
  });
  console.log("[session]", JSON.stringify(sessionRes));
  expect(sessionRes.status).toBe(200);
  const sessionId = sessionRes.body.sessionId;

  // 실제 마이크 없이도 게이트 통과 여부만 검증하면 되므로 무음(0) PCM16 더미 오디오 사용.
  const dummyAudioBase64 = Buffer.alloc(3200, 0).toString("base64");
  const sttRes = await page.evaluate(
    async ({ sessionId, dummyAudioBase64 }) => {
      const res = await fetch("/api/mission/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: dummyAudioBase64, sessionId, childTurnId: "qa-gate-fix-t1" }),
      });
      return { status: res.status, body: await res.text() };
    },
    { sessionId, dummyAudioBase64 }
  );
  console.log("[stt]", JSON.stringify(sttRes));
  // 핵심 검증: 더 이상 423(mission-only INVALID_SESSION_TYPE 게이트)이 아니어야 한다.
  expect(sttRes.status).not.toBe(423);
});
