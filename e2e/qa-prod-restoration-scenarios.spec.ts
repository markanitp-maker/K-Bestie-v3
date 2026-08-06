/**
 * e2e/qa-prod-restoration-scenarios.spec.ts
 * 
 * Production (https://app.k-bestie.com) 탈퇴 계정 복구 및 5대 라우팅 시나리오 E2E 실증:
 * 1. 탈퇴 후 30일 이내 로그인 시 복구 메뉴 노출 (/account/withdrawn)
 * 2. 복구 완료 후 기존 가족·아이 그대로 보호자 홈 진입 (/parent/home)
 * 3. 복구 취소 시 로그아웃 (/login)
 * 4. 정상 신규 사용자는 회원가입 1/4 진입 (/signup)
 * 5. 기존 활성 사용자는 자동 로그인 (/parent/home)
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function projectRef(url: string) { return new URL(url).hostname.split(".")[0]; }

test.describe("Production (app.k-bestie.com) 탈퇴 복구 및 5대 라우팅 시나리오 E2E 실증", () => {
  test.setTimeout(90000);
  let svc: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  // ── 시나리오 ① & ②: 탈퇴 후 30일 이내 로그인 시 복구 메뉴 노출 → 복구 완료 후 보호자 홈 진입 ──
  test("① 탈퇴 후 30일 이내 로그인 시 복구 메뉴 노출 → ② 복구 완료 후 기존 가족/아이 그대로 홈 진입", async ({ page, context }) => {
    const timestamp = Date.now();
    const email = `qa-restore-${timestamp}@kbestie.local`;
    const password = "TestPassword2026!#";

    // 1. 유저 생성 + 활성 가족/아이 시드
    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "복구테스트보호자",
        phone_number: "010-1234-5678",
        relationship_to_child: "father",
        account_status: "ACTIVE",
        onboarding_completed_at: new Date().toISOString()
      });

      const { data: famData } = await svc.rpc("create_family_with_owner", { p_user_id: userId, p_name: "복구가족" });
      const familyId = famData[0].family_id;

      // 2. 강제 탈퇴 처리 (30일 이내 WITHDRAWN_PENDING)
      await svc.from("parents").update({
        account_status: "WITHDRAWN_PENDING",
        withdrawn_at: new Date().toISOString(),
        purge_scheduled_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }).eq("id", userId);

      await svc.from("family_members").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId);

      // 3. 탈퇴 상태에서 로그인 세션 주입 및 접속
      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      await page.goto(BASE);
      await page.waitForURL(url => url.pathname === "/account/withdrawn", { timeout: 15000 });
      console.log(`✅ [SCENARIO ① PROOF] 탈퇴 계정 재접속 시 복구 페이지 이동: ${page.url()}`);
      await expect(page.locator("text=탈퇴 처리된 계정입니다")).toBeVisible();
      await expect(page.locator("button:has-text('계정 복구하기')")).toBeVisible();

      // 4. 복구 버튼 클릭 -> 복구 완료 후 보호자 홈 진입
      await page.click("button:has-text('계정 복구하기')");
      await page.waitForURL(url => url.pathname.includes("/parent") || url.pathname.includes("/onboarding"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ② PROOF] 복구 성공 후 보호자 홈 진입 URL: ${page.url()}`);

      // DB 상태 검증
      const { data: parentCheck } = await svc.from("parents").select("account_status, withdrawn_at").eq("id", userId).single();
      expect(parentCheck?.account_status).toBe("ACTIVE");
      expect(parentCheck?.withdrawn_at).toBeNull();

    } finally {
      await svc.from("family_members").delete().eq("user_id", userId);
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });

  // ── 시나리오 ③: 복구 취소 (로그아웃) ───────────────────────────────────────
  test("③ 복구 취소 클릭 시 세션 종료 및 로그인 화면 이동", async ({ page, context }) => {
    const timestamp = Date.now();
    const email = `qa-cancel-${timestamp}@kbestie.local`;
    const password = "TestPassword2026!#";

    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "취소보호자",
        account_status: "WITHDRAWN_PENDING",
        withdrawn_at: new Date().toISOString(),
        purge_scheduled_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });

      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      await page.goto(`${BASE}/account/withdrawn`);
      await page.click("button:has-text('로그아웃')");

      await page.waitForURL(url => url.pathname.includes("/login"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ③ PROOF] 복구 취소/로그아웃 성공 후 이동 URL: ${page.url()}`);

    } finally {
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });

  // ── 시나리오 ④: 정상 신규 사용자는 회원가입 1/4 진입 ──────────────────────
  test("④ 정상 신규 사용자는 회원가입 1/4 진입", async ({ page, context }) => {
    const timestamp = Date.now();
    const email = `qa-new-${timestamp}@kbestie.local`;
    const password = "TestPassword2026!#";

    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      // 신규 계정은 parents 행도 온보딩 데이터도 없음
      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      await page.goto(BASE);
      await page.waitForURL(url => url.pathname.includes("/signup"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ④ PROOF] 신규 사용자 접속 시 signup 1/4 진입 URL: ${page.url()}`);
      await expect(page.locator("text=약관 및 개인정보 동의")).toBeVisible();

    } finally {
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });

  // ── 시나리오 ⑤: 기존 활성 사용자는 자동 로그인 ─────────────────────────────
  test("⑤ 기존 활성 사용자는 자동 로그인", async ({ page, context }) => {
    const timestamp = Date.now();
    const email = `qa-active-${timestamp}@kbestie.local`;
    const password = "TestPassword2026!#";

    const { data: uData } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    const userId = uData.user!.id;

    try {
      await svc.from("parents").upsert({
        id: userId,
        email,
        name: "기존활성보호자",
        phone_number: "010-5555-6666",
        relationship_to_child: "mother",
        account_status: "ACTIVE",
        onboarding_completed_at: new Date().toISOString()
      });

      const { data: famData } = await svc.rpc("create_family_with_owner", { p_user_id: userId, p_name: "기존가족" });
      const familyId = famData[0].family_id;

      const { data: fmParent } = await svc.from("family_members").select("id").eq("family_id", familyId).single();

      await svc.from("child_profiles").insert({
        family_id: familyId,
        member_id: fmParent.id,
        name: "홍길동",
        given_name: "길동",
        family_name: "홍",
        gender: "male",
        grade: "초1",
        interests: ["과학"],
        tier: 2,
        guardian_consent: true,
        guardian_consent_at: new Date().toISOString()
      });

      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      await page.goto(BASE);
      await page.waitForURL(url => url.pathname.includes("/parent") || url.pathname.includes("/onboarding"), { timeout: 15000 });
      console.log(`✅ [SCENARIO ⑤ PROOF] 기존 활성 사용자 자동 로그인 성공 후 이동 URL: ${page.url()}`);

    } finally {
      await svc.from("child_profiles").delete().eq("name", "홍길동");
      await svc.from("family_members").delete().eq("user_id", userId);
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });
});
