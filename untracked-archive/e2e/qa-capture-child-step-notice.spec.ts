/**
 * e2e/qa-capture-child-step-notice.spec.ts
 * 
 * 4/4 아이 등록 화면 UI 캡처:
 * '관심사 선택 영역' 아래 '아이 로그인 아이디' 위에
 * '아이들이 접속할 계정을 부모님이 만들어요.' 문구 노출 및 반응형 뷰 캡처
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import path from "path";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function projectRef(url: string) { return new URL(url).hostname.split(".")[0]; }

test.describe("Production 4/4 아이 등록 안내 문구 UI 캡처", () => {
  test.setTimeout(60000);
  let svc: ReturnType<typeof createClient>;
  let testUserId = "";

  test.beforeAll(() => {
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  test("아이 등록 폼 안내 문구 '아이들이 접속할 계정을 부모님이 만들어요.' 노출 캡처", async ({ page, context }) => {
    const timestamp = Date.now();
    const testEmail = `qa-ui-notice-${timestamp}@kbestie.local`;
    const password = "TestPw2026!#";

    const { data: userData } = await svc.auth.admin.createUser({
      email: testEmail,
      password: password,
      email_confirm: true,
      user_metadata: { name: "UI검증보호자" }
    });
    testUserId = userData.user!.id;

    try {
      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email: testEmail, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      // 1. 동의 기록
      const consents = ["service_terms", "parent_pii", "child_pii", "guardian_u14", "guardian_authority"].map(t => ({
        user_id: testUserId,
        consent_type: t,
        document_version: "2026-07-16",
        agreed: true,
      }));
      await svc.from("signup_consents").insert(consents);

      // 2. 부모 정보 (ONBOARDING)
      await svc.from("parents").update({
        account_status: "ONBOARDING",
        phone_number: "010-1234-5678",
        name: "UI검증보호자",
        relationship_to_child: "mother"
      }).eq("id", testUserId);

      // 3. 가족 생성 및 가족 멤버 연결
      const { data: familyRes } = await svc.from("families").insert({ name: "UI검증가족", created_by: testUserId }).select().single();
      if (familyRes) {
        await svc.from("family_members").insert({ family_id: familyRes.id, user_id: testUserId, role: "owner_parent" });
      }

      // 4. 아이 등록 step 페이지 이동
      await page.goto(`${BASE}/signup?step=child`);
      await page.waitForSelector("text=아이들이 접속할 계정을 부모님이 만들어요.", { timeout: 15000 });

      const noticeText = page.locator("text=아이들이 접속할 계정을 부모님이 만들어요.");
      await expect(noticeText).toBeVisible();

      // 모바일 & 타겟 영역 캡처
      const artifactDir = "C:/Users/Home/.gemini/antigravity-ide/brain/8b9b816d-f061-4b9b-b12d-788371febd6f";
      const screenshotPath = path.join(artifactDir, "child_step_notice_ui.png");
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 [CAPTURE PROOF] Screenshot saved to ${screenshotPath}`);
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
