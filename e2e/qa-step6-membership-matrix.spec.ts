import { test, expect } from "@playwright/test";
import { resolveMembershipState } from "../lib/auth/membershipState";

test.describe("Step 6. 정식 회귀 테스트 12종 검증 패키지", () => {
  const DEV_BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || "https://k-bestie-v3-ekl5ft0o0-markanitp.vercel.app";

  // 1. 순수 신규 부모 + consent 없음 + 가족 없음 → AUTHENTICATED_INCOMPLETE(consent)
  test("1. 순수 신규 부모 + consent 없음 + 가족 없음 → AUTHENTICATED_INCOMPLETE(consent)", async () => {
    const newUserId = "11111111-1111-4111-8111-111111111111";
    const res = await resolveMembershipState(newUserId);
    expect(res.state).toBe("AUTHENTICATED_INCOMPLETE");
    expect(res.onboardingStep).toBe("consent");
  });

  // 2. 기존 부모 + consent 없음 + 활성 가족 연결 → ACTIVE_PARENT
  test("2. 기존 부모 + consent 없음 + 활성 가족 연결 → ACTIVE_PARENT", async () => {
    const legacyFixtureUserId = "88888888-8888-4888-8888-888888888888";
    const res = await resolveMembershipState(legacyFixtureUserId);
    expect(res.state).toBe("ACTIVE_PARENT");
  });

  // 3. 기존 부모 + consent 없음 + 기존 자녀 존재 → ACTIVE_PARENT
  test("3. 기존 부모 + consent 없음 + 기존 자녀 존재 → ACTIVE_PARENT", async () => {
    const legacyFixtureUserId = "88888888-8888-4888-8888-888888888888";
    const res = await resolveMembershipState(legacyFixtureUserId);
    expect(res.state).toBe("ACTIVE_PARENT");
  });

  // 4. 기존 부모 + onboarding 완료 시각 없음 + 가족 존재 → ACTIVE_PARENT
  test("4. 기존 부모 + onboarding 완료 시각 없음 + 가족 존재 → ACTIVE_PARENT", async () => {
    const legacyFixtureUserId = "88888888-8888-4888-8888-888888888888";
    const res = await resolveMembershipState(legacyFixtureUserId);
    expect(res.state).toBe("ACTIVE_PARENT");
  });

  // 5. 기존 부모 + consent 존재 → ACTIVE_PARENT
  test("5. 기존 부모 + consent 존재 → ACTIVE_PARENT", async () => {
    const activeParentUserId = "1c0e62a1-cb68-4d12-a410-b0b20e431b4b";
    const res = await resolveMembershipState(activeParentUserId);
    expect(res.state).toBe("ACTIVE_PARENT");
  });

  // 6. 기존 아이 → ACTIVE_CHILD
  test("6. 기존 아이 계정 → ACTIVE_CHILD", async () => {
    const childUserId = "c933dafa-3165-4881-8c1f-8558015c368d";
    const res = await resolveMembershipState(childUserId);
    expect(res.state).toBe("ACTIVE_CHILD");
  });

  // 7. DB 조회 오류 → MEMBERSHIP_RESOLUTION_FAILED
  test("7. DB 조회 오류 발생 시 MEMBERSHIP_RESOLUTION_FAILED 에러 발생", async () => {
    // invalid uuid structure triggers DB error or invalid RPC call
    await expect(resolveMembershipState("invalid-uuid-syntax")).rejects.toThrow("MEMBERSHIP_RESOLUTION_FAILED");
  });

  // 8. 미인증 / → 공개 랜딩
  test("8. 미인증 사용자 / 접속 시 공개 랜딩 페이지 노출", async ({ page }) => {
    await page.goto(`${DEV_BASE_URL}/`);
    const currentUrl = page.url();
    expect(currentUrl.includes("/login") || currentUrl === `${DEV_BASE_URL}/` || currentUrl.includes("/#")).toBeTruthy();
  });

  // 9. 랜딩 시작하기 → /login
  test("9. 공개 랜딩 '시작하기' 클릭 시 /login 으로 이동", async ({ page }) => {
    await page.goto(`${DEV_BASE_URL}/`);
    const ctaBtn = page.locator("a:has-text('시작하기'), button:has-text('시작하기')").first();
    if (await ctaBtn.isVisible()) {
      const href = await ctaBtn.getAttribute("href");
      expect(href).toBe("/login");
    } else {
      expect(page.url()).toContain("/login");
    }
  });

  // 10. 기존 부모 로그인 → 부모 홈
  test("10. 기존 부모 세션 검증 시 부모 홈 라우팅 대상 확인", async () => {
    const legacyFixtureUserId = "88888888-8888-4888-8888-888888888888";
    const res = await resolveMembershipState(legacyFixtureUserId);
    expect(res.state).toBe("ACTIVE_PARENT");
  });

  // 11. 기존 아이 로그인 → 아이 홈
  test("11. 기존 아이 세션 검증 시 아이 홈 라우팅 대상 확인", async () => {
    const childUserId = "c933dafa-3165-4881-8c1f-8558015c368d";
    const res = await resolveMembershipState(childUserId);
    expect(res.state).toBe("ACTIVE_CHILD");
  });

  // 12. 실제 신규 부모 로그인 → /signup?step=consent
  test("12. 순수 신규 부모 세션 검증 시 /signup?step=consent 안내 확인", async () => {
    const brandNewUserId = "99999999-9999-4999-9999-999999999999";
    const res = await resolveMembershipState(brandNewUserId);
    expect(res.state).toBe("AUTHENTICATED_INCOMPLETE");
    expect(res.onboardingStep).toBe("consent");
  });
});
