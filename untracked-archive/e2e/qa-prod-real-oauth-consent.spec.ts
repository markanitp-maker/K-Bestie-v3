/**
 * e2e/qa-prod-real-oauth-consent.spec.ts
 * 
 * Production (https://app.k-bestie.com) 정식 Supabase Client Auth 검증:
 * 1. Supabase Auth API(signInWithPassword)를 통해 정식 발급받은 실제 세션 쿠키 수집 및 브라우저 적용
 * 2. POST /api/signup/consent 호출 시 HTTP 200 OK 반환 증명 (401 Unauthorized 해소 입증)
 * 3. 약관 동의 1단계 완료 후 2단계(보호자 기본정보) 화면 UI 전이 증명
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

test.describe("Production (app.k-bestie.com) 정식 세션 쿠키 및 POST /api/signup/consent 200 OK 입증", () => {
  let svc: ReturnType<typeof createClient>;
  let testUserId = "";

  test.beforeAll(() => {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing for Production");
    }
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  test("정식 인증 세션 쿠키를 통한 POST /api/signup/consent 200 OK 및 2단계(보호자 정보) 이동 검증", async ({ page, context }) => {
    const timestamp = Date.now();
    const testEmail = `qa-prod-session-${timestamp}@kbestie.local`;
    const password = "TestPw2026!#";

    // 1. 테스트 유저 생성 (Auth API)
    const { data: userData, error: createErr } = await svc.auth.admin.createUser({
      email: testEmail,
      password: password,
      email_confirm: true,
      user_metadata: { name: "실증보호자" }
    });
    expect(createErr).toBeNull();
    testUserId = userData.user!.id;

    try {
      // 2. Client Supabase SDK로 정식 로그인하여 원격 Supabase Auth Server 세션 획득
      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData, error: loginErr } = await clientSupabase.auth.signInWithPassword({
        email: testEmail,
        password: password
      });
      expect(loginErr).toBeNull();
      expect(authData.session).toBeTruthy();

      const session = authData.session!;
      const ref = projectRef(supabaseUrl);

      // 3. Supabase Auth SSR 쿠키 청크 포맷 생성 (sb-<ref>-auth-token)
      const rawValue = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
      const cookieName = `sb-${ref}-auth-token`;
      const chunks = rawValue.length <= 3180
        ? [{ name: cookieName, value: rawValue }]
        : Array.from({ length: Math.ceil(rawValue.length / 3180) }, (_, i) => ({
            name: `${cookieName}.${i}`,
            value: rawValue.slice(i * 3180, (i + 1) * 3180)
          }));

      // 4. 브라우저 컨텍스트에 정식 발급된 세션 쿠키 적용
      await context.addCookies(chunks.map(c => ({
        ...c,
        url: BASE,
        secure: true,
        sameSite: "Lax" as const
      })));

      console.log(`[COOKIE PROOF] Cookie Name: ${cookieName}, Chunks: ${chunks.length}, Ref: ${ref}`);

      // 5. /signup 페이지 접근 및 체크박스 클릭
      await page.goto(`${BASE}/signup`);
      await page.waitForSelector("text=약관 및 개인정보 동의");
      await page.click("text=전체 동의하기");

      // 6. Network 인터셉터로 POST /api/signup/consent 요청/응답 추적
      const [consentResponse] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes("/api/signup/consent") && resp.request().method() === "POST"),
        page.click("button:has-text('다음 →')")
      ]);

      const status = consentResponse.status();
      const json = await consentResponse.json().catch(() => ({}));
      console.log(`[API PROOF] POST /api/signup/consent HTTP Status: ${status}, Body:`, JSON.stringify(json));

      // 7. 401 Unauthorized 해소 및 200 OK 증명
      expect(status).toBe(200);
      expect(json.ok).toBe(true);

      // 8. 2단계 UI (보호자 기본정보) 화면 전이 증명
      await page.waitForSelector("text=보호자 기본정보");
      const isProfileVisible = await page.isVisible("text=보호자 기본정보");
      console.log(`[UI PROOF] 2단계(보호자 기본정보) 화면 진입 여부: ${isProfileVisible}`);
      expect(isProfileVisible).toBe(true);

      console.log("🎉 [SUCCESS] Production app.k-bestie.com에서 POST /api/signup/consent 200 OK 및 2단계 이동 완벽 증명!");
    } finally {
      if (testUserId) {
        await svc.from("signup_consents").delete().eq("user_id", testUserId);
        await svc.from("parents").delete().eq("id", testUserId);
        await svc.auth.admin.deleteUser(testUserId);
      }
    }
  });
});
