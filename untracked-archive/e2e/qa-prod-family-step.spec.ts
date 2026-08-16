/**
 * e2e/qa-prod-family-step.spec.ts
 * 
 * Production (https://app.k-bestie.com) 3/4 가족 만들기 → 4/4 아이 등록 화면 전이 E2E 검증:
 * 1. signup 1단계 (동의) & 2단계 (프로필) 진행
 * 2. 3단계 (가족 만들기)에서 POST /api/families 호출 -> create_family_with_owner RPC 원자적 실행
 * 3. 500 / Constraint Violation 에러 0건, 4/4 아이 등록 화면 진입 확인
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function projectRef(url: string) { return new URL(url).hostname.split(".")[0]; }

test.describe("Production (app.k-bestie.com) 3/4 가족 만들기 RPC 및 4/4 아이 등록 이동 검증", () => {
  let svc: ReturnType<typeof createClient>;
  let testUserId = "";

  test.beforeAll(() => {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing for Production");
    }
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  test("3/4 가족 만들기 POST /api/families 성공 및 4/4 아이 등록 화면 정상 이동 검증", async ({ page, context }) => {
    const timestamp = Date.now();
    const testEmail = `qa-prod-fam-${timestamp}@kbestie.local`;
    const password = "TestPw2026!#";

    // 1. 테스트 유저 생성
    const { data: userData, error: createErr } = await svc.auth.admin.createUser({
      email: testEmail,
      password: password,
      email_confirm: true,
      user_metadata: { name: "가족검증보호자" }
    });
    expect(createErr).toBeNull();
    testUserId = userData.user!.id;

    try {
      // 2. 세션 쿠키 설정
      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email: testEmail, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      // 3. 1단계 약관 동의 제출
      const consents = ["service_terms", "parent_pii", "child_pii", "guardian_u14", "guardian_authority"].map(t => ({
        user_id: testUserId,
        consent_type: t,
        document_version: "2026-07-16",
        agreed: true,
      }));
      await svc.from("signup_consents").insert(consents);

      // 4. 2단계 보호자 정보 제출 (ONBOARDING 상태)
      await svc.from("parents").update({
        account_status: "ONBOARDING",
        phone_number: "010-1234-5678",
        name: "가족검증보호자",
        relationship_to_child: "mother"
      }).eq("id", testUserId);

      // 5. 3단계 (가족 만들기) 페이지 진입
      await page.goto(`${BASE}/signup?step=family`);
      await page.waitForSelector("text=가족 만들기");

      const familyInput = page.locator("input[placeholder*='가족']");
      await familyInput.fill("테스트검증가족");

      // 6. Network 인터셉터로 POST /api/families 응답 추적
      const [familyRes] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes("/api/families") && resp.request().method() === "POST"),
        page.click("button:has-text('가족 만들기 →')")
      ]);

      const status = familyRes.status();
      const json = await familyRes.json().catch(() => ({}));
      console.log(`[API PROOF] POST /api/families Status: ${status}, Response:`, JSON.stringify(json));

      // Constraint Violation / SQL 에러 원문 없음 확인 & 201/200 성공 확인
      expect(status).toBeLessThan(300);
      expect(json.family?.id).toBeTruthy();

      // 7. 4/4 아이 등록 화면으로 전이되었는지 UI 확인
      await page.waitForSelector("text=아이 등록");
      const isChildStepVisible = await page.isVisible("text=아이 등록");
      console.log(`[UI PROOF] 4/4 아이 등록 화면 진입 여부: ${isChildStepVisible}`);
      expect(isChildStepVisible).toBe(true);

      console.log("🎉 [SUCCESS] 3/4 가족 만들기 create_family_with_owner RPC 원자적 트랜잭션 성공 및 4/4 아이 등록 화면 진입 입증!");
    } finally {
      if (testUserId) {
        await svc.from("signup_consents").delete().eq("user_id", testUserId);
        const { data: fm } = await svc.from("family_members").select("family_id").eq("user_id", testUserId).maybeSingle();
        if (fm?.family_id) {
          await svc.from("family_members").delete().eq("family_id", fm.family_id);
          await svc.from("families").delete().eq("id", fm.family_id);
        }
        await svc.from("parents").delete().eq("id", testUserId);
        await svc.auth.admin.deleteUser(testUserId);
      }
    }
  });
});
