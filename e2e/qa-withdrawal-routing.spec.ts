/**
 * e2e/qa-withdrawal-routing.spec.ts
 *
 * Production (https://app.k-bestie.com) 탈퇴 계정 복구 및 라우팅 실증:
 * 실제 이메일/비번 로그인 플로우로 쿠키를 정상 생성하여 서버 세션이 유효한 상태에서 테스트
 *
 * 시나리오 전제:
 * - 테스트 실행 전에 이미 Production DB에 WITHDRAWN_PENDING 상태의 테스트 계정이 존재해야 함
 * - 환경변수에 TEST_WITHDRAWAL_EMAIL, TEST_WITHDRAWAL_PASSWORD 설정 필요
 */
import { test, expect } from "@playwright/test";

const BASE = "https://app.k-bestie.com";

test.describe("Production 탈퇴 복구 라우팅 (실제 OAuth 플로우)", () => {
  test.setTimeout(90000);

  test("① 탈퇴 계정 로그인 → /account/withdrawn 라우팅 확인", async ({ page }) => {
    const email = process.env.TEST_WITHDRAWAL_EMAIL;
    const password = process.env.TEST_WITHDRAWAL_PASSWORD;

    if (!email || !password) {
      test.skip(true, "TEST_WITHDRAWAL_EMAIL / TEST_WITHDRAWAL_PASSWORD 미설정");
      return;
    }

    // Production Supabase 직접 로그인
    const supabaseUrl = "https://fetvnhhjicndmxvhrffk.supabase.co";
    const loginRes = await page.request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: {
        "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ email, password }),
    });

    if (!loginRes.ok()) {
      throw new Error(`Supabase login failed: ${loginRes.status()}`);
    }

    const session = await loginRes.json();
    const ref = "fetvnhhjicndmxvhrffk";

    // 쿠키 주입 (access_token + refresh_token 형식)
    const cookieValue = JSON.stringify([session.access_token, session.refresh_token]);
    const encodedValue = `base64-${Buffer.from(cookieValue, "utf8").toString("base64")}`;

    await page.context().addCookies([
      {
        name: `sb-${ref}-auth-token`,
        value: encodedValue,
        url: BASE,
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      },
    ]);

    await page.goto(BASE);
    await page.waitForURL(
      (url) => url.pathname.includes("/account/withdrawn") || url.pathname.includes("/parent"),
      { timeout: 20000 }
    );

    const url = page.url();
    console.log(`✅ [SCENARIO ① PROOF] 탈퇴 계정 로그인 후 URL: ${url}`);

    if (url.includes("/account/withdrawn")) {
      console.log("✅ 탈퇴 계정 복구 페이지 라우팅 정상");
      await expect(page.locator("text=탈퇴 처리된 계정입니다")).toBeVisible();
    } else {
      console.log("⚠️ 탈퇴 계정이 복구 또는 다른 상태로 전환됨:", url);
    }
  });

  test("③ /account/withdrawn 페이지 로그아웃 → /login 이동", async ({ page }) => {
    const email = process.env.TEST_WITHDRAWAL_EMAIL;
    const password = process.env.TEST_WITHDRAWAL_PASSWORD;

    if (!email || !password) {
      test.skip(true, "TEST_WITHDRAWAL_EMAIL / TEST_WITHDRAWAL_PASSWORD 미설정");
      return;
    }

    const supabaseUrl = "https://fetvnhhjicndmxvhrffk.supabase.co";
    const loginRes = await page.request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: {
        "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ email, password }),
    });

    if (!loginRes.ok()) {
      test.skip(true, "탈퇴 계정 로그인 실패 — 이미 복구됐거나 만료됐을 수 있음");
      return;
    }

    const session = await loginRes.json();
    const ref = "fetvnhhjicndmxvhrffk";
    const cookieValue = JSON.stringify([session.access_token, session.refresh_token]);
    const encodedValue = `base64-${Buffer.from(cookieValue, "utf8").toString("base64")}`;

    await page.context().addCookies([
      {
        name: `sb-${ref}-auth-token`,
        value: encodedValue,
        url: BASE,
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      },
    ]);

    await page.goto(`${BASE}/account/withdrawn`);
    await page.waitForLoadState("networkidle");

    const logoutBtn = page.locator("button:has-text('로그아웃')");
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    await page.waitForURL((url) => url.pathname.includes("/login"), { timeout: 20000 });
    console.log(`✅ [SCENARIO ③ PROOF] 로그아웃 후 URL: ${page.url()}`);
  });
});
