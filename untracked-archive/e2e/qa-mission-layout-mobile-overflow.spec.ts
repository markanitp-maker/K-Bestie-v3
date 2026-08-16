import { test, expect } from "@playwright/test";

// 긴급 요청: Android 실기기에서 미션 화면 전체가 오른쪽으로 밀리며 진행률바·말풍선·
// 상태카드·하단 입력창이 잘리는 CSS Grid Blow-out 회귀 검증.
// components/MissionConversationLayout.tsx의 grid-cols-1/min-w-0/max-w-full 적용 +
// shrink-0 제거 + overflow-wrap:anywhere 수정이 실제로 가로 스크롤/잘림을 없애는지
// Android(360/375/412) + iPhone(390) 뷰포트에서 확인한다. 로그인을 한 번만 하고
// 같은 페이지에서 뷰포트만 바꿔가며 검사해 반복 로그인 비용을 없앤다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "testchild";

const viewports = [
  { name: "android-360", width: 360, height: 780 },
  { name: "android-375", width: 375, height: 812 },
  { name: "android-412", width: 412, height: 915 },
  { name: "iphone-390", width: 390, height: 844 },
];

test("QA-mission-layout: Android/iPhone 여러 뷰포트에서 가로 오버플로우 없음", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!QA_TEST_PASSWORD, "QA_TEST_PASSWORD 환경변수가 필요합니다.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/child\//, { timeout: 15000 }).catch(() => {});

  // /child/missions로 직접 goto하면 클라이언트 가드가 /child/home으로 되돌려보내는
  // 경우가 있어, 실제 사용자 흐름대로 홈에서 미션 카드를 클릭해 들어간다.
  if (!/\/child\/missions/.test(page.url())) {
    await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
    const missionLink = page.locator('a[href="/child/missions"], a[href^="/child/missions"]').first();
    await missionLink.waitFor({ timeout: 15000 }).catch(() => {});
    if (await missionLink.count()) {
      await missionLink.click();
    } else {
      await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
    }
  }

  await page.waitForURL(/\/child\/missions/, { timeout: 15000 }).catch(() => {});
  await page
    .waitForSelector("text=듣고 있어, text=대기 중, text=시작하기, text=이어하기", { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  // 원래 버그의 핵심 재현 지점(긴 한글 질문 말풍선)까지 확인하기 위해 실제로 미션을
  // 시작해 케이의 첫 질문이 렌더될 때까지 기다린다(가능한 경우에만, 실패해도 계속 진행).
  const startButton = page.getByRole("button", { name: /시작하기|이어하기/ });
  if (await startButton.count().catch(() => 0)) {
    await startButton.click().catch(() => {});
    await page.waitForTimeout(6000);
  }

  const results: Record<string, { scrollWidth: number; clientWidth: number }> = {};

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    results[vp.name] = overflow;

    await page.screenshot({ path: `/tmp/qa-mission-layout-${vp.name}.png`, fullPage: false });
  }

  for (const vp of viewports) {
    const r = results[vp.name];
    expect(
      r.scrollWidth,
      `가로 스크롤 발생(scrollWidth=${r.scrollWidth} > clientWidth=${r.clientWidth}) at ${vp.name}`
    ).toBeLessThanOrEqual(r.clientWidth + 1); // 1px 서브픽셀 허용
  }
});
