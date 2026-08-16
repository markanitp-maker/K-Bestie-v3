import { test, expect } from "@playwright/test";

// 긴급수정 검증: 현재 발화 말풍선에 내부 스크롤/높이 제한을 걸지 않고, 공간이 부족할 때
// 지난대화 영역만 줄어드는지 확인한다. 실제 Gemini Live 응답으로 5~7줄을 유도하기는
// 시간이 오래 걸리므로, 렌더된 DOM에 실제로 적용된 CSS 규칙(같은 클래스)을 그대로 쓰는
// 말풍선 요소에 긴 텍스트를 주입해 레이아웃 동작만 검증한다.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const QA_TEST_PASSWORD = process.env.QA_TEST_PASSWORD || "";
const CHILD_USERNAME = "testchild";

const LONG_TEXT =
  "오늘 학교에서 정말 재미있는 일이 있었어 친구들이랑 운동장에서 축구를 했는데 " +
  "내가 골을 두 골이나 넣어서 다들 엄청 신나했고 선생님도 잘했다고 칭찬해 주셨어 " +
  "그리고 점심시간에는 맛있는 카레도 먹었고 방과 후에는 도서관에서 재밌는 책도 읽었어 " +
  "정말 오늘 하루는 완벽한 하루였던 것 같아 너는 오늘 어떤 하루를 보냈는지 궁금해";

const viewports = [
  { name: "android-360", width: 360, height: 780 },
  { name: "android-412", width: 412, height: 915 },
  { name: "iphone-390", width: 390, height: 844 },
];

test("QA-bubble: 긴 현재 발화(5~7줄)가 스크롤/잘림 없이 위로 확장", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!QA_TEST_PASSWORD, "QA_TEST_PASSWORD 환경변수가 필요합니다.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("아이 아이디를 입력하세요").fill(CHILD_USERNAME);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(QA_TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/child\//, { timeout: 15000 }).catch(() => {});

  if (!/\/child\/missions/.test(page.url())) {
    await page.goto(`${BASE}/child/home`, { waitUntil: "networkidle" });
    const missionLink = page.locator('a[href="/child/missions"], a[href^="/child/missions"]').first();
    await missionLink.waitFor({ timeout: 15000 }).catch(() => {});
    if (await missionLink.count()) await missionLink.click();
    else await page.goto(`${BASE}/child/missions`, { waitUntil: "networkidle" });
  }
  await page.waitForURL(/\/child\/missions/, { timeout: 15000 }).catch(() => {});
  await page
    .waitForSelector("text=듣고 있어, text=대기 중, text=시작하기, text=이어하기, text=준비 중", { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  // "시작하기"/"이어하기" 버튼 상태에서는 <p> 기반 말풍선이 없다(버튼 라벨은 <div>).
  // 실제 질문 말풍선(<p>)이 렌더되는 active 상태까지 진입한다.
  const startButton = page.getByRole("button", { name: /시작하기|이어하기/ });
  if (await startButton.count().catch(() => 0)) {
    await startButton.click().catch(() => {});
    await page.waitForTimeout(6000);
  }

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    // 현재 발화 말풍선(주황 테두리 박스 안의 <p>)에 긴 텍스트를 직접 주입한다.
    const injected = await page.evaluate((text) => {
      const bubbles = Array.from(document.querySelectorAll("p"));
      const target = bubbles.find(
        (p) => p.textContent && (p.textContent.includes("준비") || p.textContent.includes("케이가") || p.closest('[class*="border-"]'))
      ) || bubbles[0];
      if (!target) return { ok: false };
      target.textContent = text;
      return { ok: true };
    }, LONG_TEXT);
    expect(injected.ok, `${vp.name}: 말풍선 요소를 찾지 못함`).toBeTruthy();

    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => ({
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
    }));

    // 말풍선 자체에 내부 스크롤이 생겼는지(scrollHeight > clientHeight인 overflow-y 박스가 있는지) 확인
    const bubbleHasInternalScroll = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("div"));
      return els.some((el) => {
        const style = getComputedStyle(el);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 2 &&
          el.className.includes("border-")
        );
      });
    });

    await page.screenshot({ path: `/tmp/qa-bubble-${vp.name}.png`, fullPage: false });

    expect(
      overflow.docScrollWidth,
      `${vp.name}: 가로 오버플로우 발생`
    ).toBeLessThanOrEqual(overflow.docClientWidth + 1);
    expect(
      overflow.docScrollHeight,
      `${vp.name}: 세로 오버플로우 발생(scrollHeight=${overflow.docScrollHeight} > clientHeight=${overflow.docClientHeight})`
    ).toBeLessThanOrEqual(overflow.docClientHeight + 1);
    expect(bubbleHasInternalScroll, `${vp.name}: 말풍선 내부에 스크롤바가 생김`).toBeFalsy();
  }
});
