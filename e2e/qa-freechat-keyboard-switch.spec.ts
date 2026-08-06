import { test, expect } from "@playwright/test";

// request-free-chat-keyboard-input-switch.md: 자유대화에서 키보드 버튼을 누르면
// 자동 모드가 해제되고 수동으로 전환되며, 키보드를 닫아도 자동으로 마이크가
// 켜지지 않고 수동 모드로 복귀하는지 aria-pressed 상태로 직접 검증한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
// Dev와 Production은 QA 계정이 다르다(Dev: testchild, Production: testa) — BASE URL로 판정.
const CHILD_USERNAME = BASE.includes("app.k-bestie.com") ? "testa" : "testchild";

test("QA-freechat-keyboard-switch: 키보드 진입/복귀 시 자동→수동 전환 정확성", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!QA_TEST_PASSWORD, "QA_TEST_PASSWORD 환경변수가 필요합니다.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/child\//, { timeout: 15000 }).catch(() => {});

  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // PWA 홈 화면 추가 안내(이번 버그와 무관)가 뜨면 먼저 닫는다.
  const laterBtn = page.getByRole("button", { name: "나중에 할게요" });
  if (await laterBtn.count().catch(() => 0)) {
    await laterBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);

  // 자동 모드가 기본값이므로 "자동" 버튼이 aria-pressed=true여야 한다(연결 성공 여부와 무관하게
  // 모드 버튼 자체는 status와 별개로 렌더링됨 — voice 모드일 때만 보임).
  const autoBtn = page.getByRole("button", { name: "자동" });
  const manualBtn = page.getByRole("button", { name: "수동" });
  await autoBtn.waitFor({ timeout: 15000 }).catch(() => {});

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ timeout: 15000 });
  await keyboardBtn.click();
  await page.waitForTimeout(500);

  // 텍스트 모드 진입 확인 — 입력창이 보여야 한다.
  const textInputEl = page.locator('input[placeholder="케이에게 텍스트로 답하기..."]');
  await expect(textInputEl).toBeVisible({ timeout: 10000 });

  // 텍스트 모드를 닫고 음성 화면으로 복귀 — "닫기" 버튼(aria-label="텍스트 입력창 닫기").
  // 이 티켓과 무관한 056 FAQ 플로팅 버튼이 좌표상 겹쳐서 일반 클릭/force click 모두
  // 실제 마우스 좌표 히트테스트상 FAQ 버튼이 대신 눌리는 문제가 있어(레이아웃 겹침
  // 자체는 별도 이슈로 기록, 이번 수정과 무관), DOM 엘리먼트의 click()을 직접
  // 호출해 좌표 히트테스트를 우회한다.
  const closeBtn = page.getByRole("button", { name: "텍스트 입력창 닫기" });
  await closeBtn.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(1000);

  // 복귀 후에는 "자동"이 아니라 "수동"이 선택 상태여야 한다(핵심 회귀 검증 포인트).
  await expect(manualBtn).toBeVisible({ timeout: 10000 });
  await expect(manualBtn).toHaveAttribute("aria-pressed", "true");
  await expect(autoBtn).toHaveAttribute("aria-pressed", "false");

  // 마이크가 자동으로 켜져 녹음 중 상태(펄스 애니메이션 등)로 들어가면 안 된다 —
  // 마이크 버튼의 aria-label이 "마이크 켜기"(대기)여야 하고 "녹음 종료"(녹음 중)면 안 된다.
  const micBtn = page.getByRole("button", { name: /마이크 켜기|녹음 종료|권한 다시 시도하기|마이크 사용 불가|대화 시작하기/ });
  await expect(micBtn).toBeVisible({ timeout: 10000 });
  const micLabel = await micBtn.getAttribute("aria-label");
  console.log("mic button aria-label after keyboard close:", micLabel);
  expect(micLabel, "키보드 닫은 직후 마이크가 자동으로 녹음 중 상태가 됨(회귀)").not.toBe("녹음 종료");

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
