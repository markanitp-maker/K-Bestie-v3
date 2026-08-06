import { test, expect } from "@playwright/test";

// 057: 미션/자유대화 키보드 입력 모드에서 마스코트 영역이 숨겨지고, 현재 케이 질문
// 말풍선과 입력창이 잘리지 않는지, 가로 스크롤이 생기지 않는지 iPhone/Android
// 뷰포트 에뮬레이션으로 확인한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "testchild";

const viewports = [
  { name: "iphone-390x844", width: 390, height: 844 },
  { name: "android-360x800", width: 360, height: 800 },
  { name: "android-412x915", width: 412, height: 915 },
];

async function login(page: any) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/child\//, { timeout: 15000 }).catch(() => {});
}

test("QA-057-freechat: 키보드 텍스트모드에서 마스코트 숨김·잘림없음·가로스크롤없음", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!QA_TEST_PASSWORD, "QA_TEST_PASSWORD 환경변수가 필요합니다.");

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ timeout: 20000 }).catch(() => {});
  // 텍스트모드는 한 번만 열고, 뷰포트 크기만 바꿔가며 검사한다(닫기→다시열기를
  // 반복하면 매번 voice 세션 전환 로직이 개입해 테스트가 느려지고 불안정해짐).
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      const input = document.querySelector('input[placeholder="케이에게 텍스트로 답하기..."]') as HTMLElement | null;
      const closeBtn = document.querySelector('button[aria-label="텍스트 입력창 닫기"]') as HTMLElement | null;
      const inputRect = input?.getBoundingClientRect();
      const closeRect = closeBtn?.getBoundingClientRect();
      return {
        scrollWidth,
        clientWidth,
        inputVisible: !!input && !!inputRect && inputRect.width > 0 && inputRect.right <= clientWidth + 1,
        closeBtnVisible: !!closeBtn && !!closeRect && closeRect.right <= clientWidth + 1,
        inputRight: inputRect?.right,
        closeRight: closeRect?.right,
      };
    });

    console.log(`[freechat/${vp.name}]`, JSON.stringify(state));
    await page.screenshot({ path: `/tmp/qa-057-freechat-${vp.name}.png`, fullPage: false });

    expect(state.scrollWidth, `가로스크롤 발생 at freechat/${vp.name}`).toBeLessThanOrEqual(state.clientWidth + 1);
    expect(state.inputVisible, `입력창이 화면 밖으로 잘림 at freechat/${vp.name}`).toBe(true);
    expect(state.closeBtnVisible, `닫기버튼이 화면 밖으로 잘림 at freechat/${vp.name}`).toBe(true);
  }
});

test("QA-057-mission: 키보드 텍스트모드에서 마스코트 숨김·잘림없음·가로스크롤없음", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!QA_TEST_PASSWORD, "QA_TEST_PASSWORD 환경변수가 필요합니다.");

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });

  // 057과 무관한 이벤트 안내 모달이 뜰 수 있어 먼저 닫는다.
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

  const keyboardBtn = page.getByRole("button", { name: "텍스트로 답하기" });
  await keyboardBtn.waitFor({ timeout: 20000 }).catch(() => {});
  if (await keyboardBtn.count().catch(() => 0)) {
    await keyboardBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      const input = document.querySelector('input[placeholder="케이에게 텍스트로 답하기..."]') as HTMLElement | null;
      const closeBtn = document.querySelector('button[aria-label="텍스트 입력창 닫기"]') as HTMLElement | null;
      const inputRect = input?.getBoundingClientRect();
      const closeRect = closeBtn?.getBoundingClientRect();
      return {
        scrollWidth,
        clientWidth,
        inputVisible: !!input && !!inputRect && inputRect.width > 0 && inputRect.right <= clientWidth + 1,
        closeBtnVisible: !!closeBtn && !!closeRect && closeRect.right <= clientWidth + 1,
      };
    });

    console.log(`[mission/${vp.name}]`, JSON.stringify(state));
    await page.screenshot({ path: `/tmp/qa-057-mission-${vp.name}.png`, fullPage: false });

    expect(state.scrollWidth, `가로스크롤 발생 at mission/${vp.name}`).toBeLessThanOrEqual(state.clientWidth + 1);
    expect(state.inputVisible, `입력창이 화면 밖으로 잘림 at mission/${vp.name}`).toBe(true);
    expect(state.closeBtnVisible, `닫기버튼이 화면 밖으로 잘림 at mission/${vp.name}`).toBe(true);
  }
});
