import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "https://k-bestie-v3-dev.vercel.app";

test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 KAKAOTALK/10.8.2 (INAPP)",
  viewport: { width: 390, height: 844 },
});

test("QA-053: 카카오톡 인앱 브라우저에서 외부 브라우저 안내와 복사 수단을 제공한다", async ({
  page,
}) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  const notice = page.getByRole("complementary", {
    name: "카카오톡 브라우저 안내",
  });
  await expect(notice).toBeVisible();
  await expect(
    notice.getByText("카카오톡 브라우저에서는 앱 설치가 제한될 수 있어요", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    notice.getByText("오른쪽 아래 ···를 누른 뒤 ‘Safari로 열기’를 선택해 주세요.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    notice.getByRole("button", { name: "외부 브라우저로 열기", exact: true })
  ).toBeVisible();
  await expect(
    notice.getByRole("button", { name: "주소 복사", exact: true })
  ).toBeVisible();
});
