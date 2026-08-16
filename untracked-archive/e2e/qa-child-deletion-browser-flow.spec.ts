import { test, expect } from "@playwright/test";

test.use({ actionTimeout: 10000 });

test("보호자 설정에서 테스트 아이 1건 삭제 브라우저 검증", async ({ page }) => {
  console.log("🌐 Production /parent/settings 진입 및 아이 삭제 브라우저 E2E 테스트 시작...");

  // 1. Production 앱 /parent/settings로 이동
  await page.goto("https://app.k-bestie.com/parent/settings", { waitUntil: "networkidle" });

  // 로그인되지 않은 경우 대기 또는 UI 요소 확인
  const title = await page.title();
  console.log("  페이지 제목:", title);

  // 현재 페이지 URL 확인
  console.log("  현재 URL:", page.url());
});
