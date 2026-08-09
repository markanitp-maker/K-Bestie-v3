import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";
const IPHONE_KAKAO_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 KAKAOTALK/10.8.2 (INAPP)";
const ANDROID_KAKAO_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; SM-S908N) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36 KAKAOTALK/10.8.3 (INAPP)";

async function expectKakaoInAppNotice(page: Page, platform: "iPhone" | "Android") {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const targetUrl = `${BASE}/login?returnUrl=%2Fparent%2Fhome&link_id=qa053test`;
  await page.goto(targetUrl, { waitUntil: "networkidle" });

  const notice = page.getByRole("complementary", {
    name: "카카오톡 브라우저 안내",
  });
  await expect(notice).toBeVisible();
  await expect(
    notice.getByText("Safari 또는 Chrome에서 계속해 주세요", {
      exact: true,
    })
  ).toBeVisible();
  if (platform === "iPhone") {
    await expect(notice.getByText("카카오 브라우저의 주소/메뉴 영역을 눌러 주세요.", { exact: true })).toBeVisible();
    await expect(notice.getByText("‘다른 브라우저로 열기’ 또는 ‘Safari에서 열기’를 선택해 주세요.", { exact: true })).toBeVisible();
  } else {
    await expect(notice.getByText("오른쪽 아래 메뉴(⋮)를 눌러 주세요.", { exact: true })).toBeVisible();
    await expect(notice.getByText("‘다른 브라우저로 열기’를 선택해 주세요.", { exact: true })).toBeVisible();
  }
  const copyButton = notice.getByRole("button", { name: "주소 복사하기", exact: true });
  await expect(copyButton).toBeVisible();
  await expect(notice.getByRole("button", { name: "브라우저에서 계속하기" })).toHaveCount(0);

  await copyButton.click();
  await expect(
    notice.getByText("주소를 복사했어요. Safari 또는 Chrome 주소창에 붙여 넣어 주세요.", { exact: true })
  ).toBeVisible();
  const clipboardValue = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardValue).toBe(targetUrl);
}

test.describe("QA-053: 카카오톡 인앱 브라우저", () => {
  test.describe("iPhone", () => {
    test.use({ userAgent: IPHONE_KAKAO_USER_AGENT, viewport: { width: 390, height: 844 } });

    test("외부 Safari 이동 안내와 주소 복사 fallback을 제공한다", async ({ page }) => {
      await expectKakaoInAppNotice(page, "iPhone");
    });
  });

  test.describe("Android", () => {
    test.use({ userAgent: ANDROID_KAKAO_USER_AGENT, viewport: { width: 412, height: 915 } });

    test("다른 브라우저 이동 안내와 주소 복사 fallback을 제공한다", async ({ page }) => {
      await expectKakaoInAppNotice(page, "Android");
    });
  });
});
