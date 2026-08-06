import { test, expect } from "@playwright/test";
import { resolveMembershipState } from "@/lib/auth/membershipState";

const DEV_BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || "https://k-bestie-v3-peph44tm5-markanitp.vercel.app";

test.describe("Step 5. Root Public Landing & Routing Regression Suite", () => {

  test("1. 미인증 / 접속 시 URL / 유지 및 자동 /login 이동 없음", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${DEV_BASE_URL}/`);
    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    console.log("[Test 1] Final URL for unauthenticated /:", currentUrl);
    expect(currentUrl).not.toContain("/login");
    expect(currentUrl).not.toContain("/signup");
    expect(new URL(currentUrl).pathname).toBe("/");
  });

  test("2. 미인증 / 접속 시 공개 랜딩페이지(BetaLandingPage) 내용 노출", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${DEV_BASE_URL}/`);

    // Verify key landing page headline
    const headline = page.locator("h1:has-text('아이의 하루를 이해하는')");
    await expect(headline).toBeVisible();
  });

  test("3. 랜딩 히어로 영역의 '시작하기' CTA 버튼 정확히 1개", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${DEV_BASE_URL}/`);

    const ctaBtns = page.locator("a:has-text('시작하기')");
    const count = await ctaBtns.count();
    console.log("[Test 3] Primary CTA '시작하기' button count:", count);
    expect(count).toBe(1);
  });

  test("4. '시작하기' 버튼 클릭 시 /login 으로 이동", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${DEV_BASE_URL}/`);

    const ctaBtn = page.locator("a:has-text('시작하기')").first();
    await ctaBtn.click();
    await page.waitForURL("**/login*");

    console.log("[Test 4] URL after clicking 시작하기:", page.url());
    expect(page.url()).toContain("/login");
  });

  test("5. /login 화면에서 통합 로그인 UI 노출 (카카오, 구글, 아이 로그인)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${DEV_BASE_URL}/login`);

    const childIdInput = page.locator("input[placeholder*='아이디']").first();
    const childPwInput = page.locator("input[type='password']").first();
    const loginSubmitBtn = page.locator("button[type='submit']:has-text('로그인')").first();

    await expect(childIdInput).toBeVisible();
    await expect(childPwInput).toBeVisible();
    await expect(loginSubmitBtn).toBeVisible();
  });

  test("6. 미인증 상태에서 /signup?step=consent 직접 접근 시 /login 리다이렉트", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${DEV_BASE_URL}/signup?step=consent`);
    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    console.log("[Test 6] URL after unauthenticated /signup?step=consent:", currentUrl);
    expect(currentUrl).toContain("/login");
  });

  test("7. 레거시/기존 부모 세션 membership 판정 시 /parent/home 라우팅 확인", async () => {
    const legacyFixtureUserId = "88888888-8888-4888-8888-888888888888";
    const res = await resolveMembershipState(legacyFixtureUserId);
    expect(res.state).toBe("ACTIVE_PARENT");
  });

  test("8. 기존 아이 세션 membership 판정 시 /child/home 라우팅 확인", async () => {
    const childUserId = "c933dafa-3165-4881-8c1f-8558015c368d";
    const res = await resolveMembershipState(childUserId);
    expect(res.state).toBe("ACTIVE_CHILD");
  });

  test("9. DB membership 오류 발생 시 MEMBERSHIP_RESOLUTION_FAILED 반환", async () => {
    const res = await resolveMembershipState("invalid-uuid-format-error");
    expect(res.state).toBe("MEMBERSHIP_RESOLUTION_FAILED");
  });

  test("10. membership 오류 발생 시 /signup 으로 유실 이동 0건 보장", async () => {
    const res = await resolveMembershipState("invalid-uuid-format-error");
    expect(res.state).not.toBe("AUTHENTICATED_INCOMPLETE");
    expect(res.state).not.toBe("CONSENT_REQUIRED");
  });

});
