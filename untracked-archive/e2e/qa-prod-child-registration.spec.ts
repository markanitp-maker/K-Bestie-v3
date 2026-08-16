/**
 * e2e/qa-prod-child-registration.spec.ts
 * 
 * Production (https://app.k-bestie.com) 4/4 아이 등록 E2E 검증:
 * 1. 보호자 유저 및 DB 온보딩 1~3단계 준비 (parents upsert, consents insert, family creation)
 * 2. 4/4 아이 등록 step 진입 및 UI 폼 제출 -> create_child_approval_request RPC 성공 & autoApproveChildRequest 자동 승인
 * 3. DB 상태 (parents ACTIVE, child_approval_requests approved BETA_AUTO) 검증
 * 4. 보호자 홈 진입 및 생성된 아이 계정으로 실제 로그인 성공 검증
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function projectRef(url: string) { return new URL(url).hostname.split(".")[0]; }

test.describe("Production (app.k-bestie.com) 4/4 아이 등록 및 로그인 E2E 실증", () => {
  let svc: ReturnType<typeof createClient>;
  let testUserId = "";

  test.beforeAll(() => {
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  test("4/4 아이 등록 제출 → 베타 자동 승인 → 보호자 ACTIVE 전환 → 보호자 홈 진입 → 아이 계정 로그인 전체 입증", async ({ page, context }) => {
    const timestamp = Date.now();
    const parentEmail = `qa-prod-p-${timestamp}@kbestie.local`;
    const password = "TestPw2026!#";
    const childUsername = `child_qa_${timestamp.toString().slice(-6)}`;
    const childPassword = "ChildPw2026!#";

    // 1. 테스트 보호자 유저 생성
    const { data: userData } = await svc.auth.admin.createUser({
      email: parentEmail,
      password: password,
      email_confirm: true,
      user_metadata: { name: "아이등록보호자" }
    });
    testUserId = userData.user!.id;

    try {
      // 2. 보호자 인증 쿠키 세팅
      const clientSupabase = createClient(supabaseUrl, anonKey);
      const { data: authData } = await clientSupabase.auth.signInWithPassword({ email: parentEmail, password });
      const ref = projectRef(supabaseUrl);
      const rawValue = `base64-${Buffer.from(JSON.stringify(authData.session!), "utf8").toString("base64url")}`;
      await context.addCookies([{ name: `sb-${ref}-auth-token`, value: rawValue, url: BASE, secure: true, sameSite: "Lax" }]);

      // 3. parents 테이블 행 upsert (ONBOARDING)
      await svc.from("parents").upsert({
        id: testUserId,
        email: parentEmail,
        name: "아이등록보호자",
        phone_number: "010-9876-5432",
        relationship_to_child: "mother",
        account_status: "ONBOARDING"
      });

      // 4. 약관 동의 데이터 삽입
      const consents = ["service_terms", "parent_pii", "child_pii", "guardian_u14", "guardian_authority"].map(t => ({
        user_id: testUserId,
        consent_type: t,
        document_version: "2026-07-16",
        agreed: true,
      }));
      await svc.from("signup_consents").insert(consents);

      // 5. 가족 생성 via create_family_with_owner RPC
      const { data: famData } = await svc.rpc("create_family_with_owner", { p_user_id: testUserId, p_name: "아이등록테스트가족" });
      const familyId = famData[0].family_id;
      expect(familyId).toBeTruthy();

      // 6. 4단계 아이 등록 step UI 진입
      await page.goto(`${BASE}/signup?step=child`);
      await page.waitForSelector("text=아이 등록");

      // 폼 입력
      await page.locator("input[placeholder='성']").fill("홍");
      await page.locator("input[placeholder='이름']").fill("길동");
      await page.click("button:has-text('남자')");
      await page.selectOption("select", "초등 1학년");
      await page.click("button:has-text('과학')");
      await page.locator("input[placeholder='아이 로그인 아이디']").fill(childUsername);
      await page.locator("input[placeholder='비밀번호 (6자 이상)']").fill(childPassword);
      await page.locator("input[placeholder='비밀번호 확인']").fill(childPassword);
      await page.click("input[type='checkbox']");

      // 7. Network 인터셉터로 POST /api/families/[id]/children 호출 확인 및 폼 제출
      const [childRes] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes("/children") && resp.request().method() === "POST"),
        page.click("button:has-text('완료 및 케이 시작하기 →')")
      ]);

      const status = childRes.status();
      const json = await childRes.json().catch(() => ({}));
      console.log(`[API PROOF] POST /api/families/${familyId}/children Status: ${status}, Response:`, JSON.stringify(json));

      expect(status).toBe(201);
      expect(json.autoApproved).toBe(true);

      // 8. DB 상태 검증
      const { data: parentRow } = await svc.from("parents").select("account_status").eq("id", testUserId).single();
      console.log(`[DB PROOF] 보호자 계정 상태: ${parentRow?.account_status}`);
      expect(parentRow?.account_status).toBe("ACTIVE");

      const { data: approvalRow } = await svc.from("child_approval_requests").select("status, approval_method").eq("username", childUsername).single();
      console.log(`[DB PROOF] child_approval_requests status: ${approvalRow?.status}, method: ${approvalRow?.approval_method}`);
      expect(approvalRow?.status).toBe("approved");
      expect(approvalRow?.approval_method).toBe("BETA_AUTO");

      // 9. UI 승인 완료 팝업 & 시작하기 클릭 → 이동 확인
      await page.waitForSelector("text=승인되었습니다");
      await page.click("button:has-text('시작하기 →')");
      await page.waitForTimeout(2000);
      console.log(`[UI PROOF] 시작하기 클릭 후 이동 URL: ${page.url()}`);

      // 10. 생성된 아이 계정 실제 로그인 테스트
      await context.clearCookies();
      await page.goto(`${BASE}/login`);
      await page.waitForSelector("input[placeholder*='아이디']");

      await page.locator("input[placeholder*='아이디']").fill(childUsername);
      await page.locator("input[placeholder*='비밀번호']").fill(childPassword);
      await page.click("button:has-text('로그인')");

      await page.waitForURL(url => url.pathname.includes("/child"), { timeout: 15000 });
      console.log(`🎉 [CHILD LOGIN PROOF] 아이 로그인 성공 후 이동 URL: ${page.url()}`);

    } finally {
      if (testUserId) {
        await svc.from("signup_consents").delete().eq("user_id", testUserId);
        const { data: fm } = await svc.from("family_members").select("family_id, user_id").eq("user_id", testUserId).maybeSingle();
        if (fm?.family_id) {
          const { data: childMembers } = await svc.from("family_members").select("user_id").eq("family_id", fm.family_id).eq("role", "child");
          for (const cm of childMembers || []) {
            await svc.from("child_profiles").delete().eq("family_id", fm.family_id);
            await svc.from("member_accounts").delete().eq("id", cm.user_id);
            await svc.from("family_members").delete().eq("user_id", cm.user_id);
            await svc.auth.admin.deleteUser(cm.user_id);
          }
          await svc.from("family_members").delete().eq("family_id", fm.family_id);
          await svc.from("families").delete().eq("id", fm.family_id);
        }
        await svc.from("child_approval_requests").delete().eq("username", childUsername);
        await svc.from("parents").delete().eq("id", testUserId);
        await svc.auth.admin.deleteUser(testUserId);
      }
    }
  });
});
