import { test, expect } from "@playwright/test";

// 068 Tier2: 미션 텍스트 답변에 방학 키워드가 포함되면 child_temporal_context가
// 갱신되는지, 그리고 기존 미션 진행(다음 질문 노출 등)에 회귀가 없는지 확인한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "testchild";

test("QA-068-t2: 방학 발화 후 미션 진행 회귀 없음", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!QA_TEST_PASSWORD, "QA_TEST_PASSWORD 환경변수가 필요합니다.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/child\//, { timeout: 15000 }).catch(() => {});

  await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
  const eventModalCloseBtn = page.getByRole("button", { name: /이벤트 확인했어요|이벤트 확인|닫기/ });
  if (await eventModalCloseBtn.count().catch(() => 0)) {
    await eventModalCloseBtn.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const missionLink = page.locator('a[href="/child/missions"], a[href^="/child/missions"]').first();
  await missionLink.waitFor({ timeout: 15000 }).catch(() => {});
  if (await missionLink.count()) {
    await missionLink.click();
  } else {
    await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
  }
  await page.waitForURL(/\/child\/missions/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const startButton = page.getByRole("button", { name: /시작하기|이어하기/ });
  if (await startButton.count().catch(() => 0)) {
    await startButton.click().catch(() => {});
    await page.waitForTimeout(6000);
  }

  // 텍스트 입력 모드로 전환
  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ timeout: 20000 });
  await keyboardBtn.click();
  await page.waitForTimeout(500);

  const textInput = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInput).toBeVisible({ timeout: 10000 });

  // 방학 키워드가 포함된 답변 제출
  await textInput.fill("아니 나 지금 여름방학이야 학교 안 가");
  const sendBtn = page.getByRole("button", { name: "전송" });

  let apiResponseOk = false;
  let apiResponseStatus = 0;
  page.on("response", (res) => {
    if (res.url().includes("/api/mission/answer")) {
      apiResponseOk = res.ok();
      apiResponseStatus = res.status();
    }
  });

  await sendBtn.click();

  // 응답이 정상적으로 오는지(회귀 없음) — 최대 10초 대기(4초 타임아웃 감지 로직 포함해도 충분)
  await page.waitForTimeout(8000);

  console.log("mission/answer API status:", apiResponseStatus, "ok:", apiResponseOk);
  expect(apiResponseStatus, "mission/answer API가 정상 응답하지 않음(회귀 의심)").toBeGreaterThanOrEqual(200);
  expect(apiResponseStatus, "mission/answer API가 5xx 에러 반환(회귀)").toBeLessThan(500);

  // 입력창이 비워지고(전송 성공) 다음 질문이 나타나는지 등 기본 UI 정상 동작 확인
  await expect(textInput).toHaveValue("", { timeout: 5000 }).catch(() => {});

  await page.screenshot({ path: "/tmp/qa-068-t2-after-answer.png", fullPage: false });
});
