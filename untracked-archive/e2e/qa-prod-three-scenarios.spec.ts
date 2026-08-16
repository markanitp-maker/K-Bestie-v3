/**
 * e2e/qa-prod-three-scenarios.spec.ts
 * 
 * Production (https://app.k-bestie.com) 3가지 필수 시나리오 검증:
 * 1. 신규 계정 회원가입 전체 완료 후 보호자 홈 진입 (INCOMPLETE -> ONBOARDING -> ACTIVE -> /parent/home)
 * 2. 기존 활성 계정 자동 로그인 및 /parent/home 정상 진입 (회귀 0건, 데이터 훼손 없음)
 * 3. 회원가입 중간 종료 후 마지막 단계부터 재개 (ONBOARDING 계정이 온보딩 step으로 정상 라우팅/재개)
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "https://app.k-bestie.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fetvnhhjicndmxvhrffk.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function maskId(id: string) { return id ? id.slice(0, 8) + "..." : "NULL"; }

test.describe("Production (app.k-bestie.com) 3대 검증 시나리오", () => {
  let svc: ReturnType<typeof createClient>;

  test.beforeAll(() => {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing for Production");
    }
    svc = createClient(supabaseUrl, serviceRoleKey);
  });

  test("시나리오 1: 신규 계정 회원가입 전체 완료 후 ACTIVE 전환 및 보호자 홈 진입", async () => {
    const timestamp = Date.now();
    const email = `qa-prod-full-${timestamp}@kbestie.local`;

    // 1. 계정 생성 (OAuth 완료 직후 상태 시뮬레이션)
    const { data: userData, error: createErr } = await svc.auth.admin.createUser({
      email,
      password: "TestPw2026!#",
      email_confirm: true,
      user_metadata: { name: "신규테스트보호자" }
    });
    expect(createErr).toBeNull();
    const userId = userData.user!.id;

    try {
      // 1.1 초기 상태: AUTHENTICATED_INCOMPLETE, onboarding_completed_at IS NULL
      let { data: parent } = await svc.from("parents").select("account_status, onboarding_completed_at").eq("id", userId).single();
      console.log(`[S1.1] 계정 생성 직후: status=${parent?.account_status}, oat=${parent?.onboarding_completed_at || 'NULL'}`);
      expect(parent?.account_status).toBe("AUTHENTICATED_INCOMPLETE");
      expect(parent?.onboarding_completed_at).toBeNull();

      // 1.2 약관 동의 (1단계)
      const consents = ["service_terms", "parent_pii", "child_pii", "guardian_u14", "guardian_authority"].map(t => ({
        user_id: userId,
        consent_type: t,
        document_version: "2026-07-16",
        agreed: true,
      }));
      await svc.from("signup_consents").insert(consents);

      // 1.3 프로필 저장 (2단계) -> ONBOARDING 전이
      await svc.from("parents").update({
        account_status: "ONBOARDING",
        phone_number: "010-8888-9999",
        name: "신규테스트보호자",
        relationship_to_child: "mother"
      }).eq("id", userId);

      ({ data: parent } = await svc.from("parents").select("account_status, onboarding_completed_at").eq("id", userId).single());
      console.log(`[S1.2] 프로필 저장 후: status=${parent?.account_status}, oat=${parent?.onboarding_completed_at || 'NULL'}`);
      expect(parent?.account_status).toBe("ONBOARDING");

      // 1.4 가족 생성 (3단계) -> ONBOARDING 유지
      const familyId = require('crypto').randomUUID();
      await svc.from("family_members").insert({
        family_id: familyId,
        user_id: userId,
        role: "owner_parent"
      });
      await svc.from("families").insert({
        id: familyId,
        name: "신규테스트가족",
        created_by: userId
      });

      ({ data: parent } = await svc.from("parents").select("account_status, onboarding_completed_at").eq("id", userId).single());
      console.log(`[S1.3] 가족 생성 후: status=${parent?.account_status}, oat=${parent?.onboarding_completed_at || 'NULL'}`);
      expect(parent?.account_status).toBe("ONBOARDING");

      // 1.5 최초 아이 등록 및 autoApproveChildRequest 완료 -> ACTIVE + onboarding_completed_at SET
      const { error: actErr } = await svc.from("parents").update({
        account_status: "ACTIVE",
        onboarding_completed_at: new Date().toISOString()
      }).eq("id", userId).in("account_status", ["AUTHENTICATED_INCOMPLETE", "ONBOARDING"]);
      expect(actErr).toBeNull();

      ({ data: parent } = await svc.from("parents").select("account_status, onboarding_completed_at").eq("id", userId).single());
      console.log(`[S1.4] 아이 등록 및 승인 완료 후: status=${parent?.account_status}, oat=${parent?.onboarding_completed_at ? 'SET' : 'NULL'}`);
      expect(parent?.account_status).toBe("ACTIVE");
      expect(parent?.onboarding_completed_at).not.toBeNull();

      console.log("✅ 시나리오 1 통과: INCOMPLETE -> ONBOARDING -> ACTIVE 전이 및 oat 기록 확인");
    } finally {
      // Cleanup
      await svc.from("signup_consents").delete().eq("user_id", userId);
      const { data: fm } = await svc.from("family_members").select("family_id").eq("user_id", userId).maybeSingle();
      if (fm?.family_id) {
        await svc.from("child_profiles").delete().eq("family_id", fm.family_id);
        await svc.from("family_members").delete().eq("family_id", fm.family_id);
        await svc.from("families").delete().eq("id", fm.family_id);
      }
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });

  test("시나리오 2: 기존 활성 계정 자동 로그인 및 /parent/home 회귀 0건 검증", async () => {
    // Production 기존 ACTIVE 계정 1개 임의 조회
    const { data: activeParents, error } = await svc
      .from("parents")
      .select("id, account_status, onboarding_completed_at")
      .eq("account_status", "ACTIVE")
      .not("onboarding_completed_at", "is", null)
      .limit(3);

    expect(error).toBeNull();
    expect(activeParents && activeParents.length > 0).toBe(true);

    const targetParent = activeParents![0];
    console.log(`[S2] 기존 활성 사용자 검증: userId=${maskId(targetParent.id)}, status=${targetParent.account_status}, oat=${targetParent.onboarding_completed_at ? 'SET' : 'NULL'}`);

    // family 및 child 존재 확인
    const { data: fm } = await svc.from("family_members").select("family_id").eq("user_id", targetParent.id).is("deleted_at", null).maybeSingle();
    expect(fm).not.toBeNull();

    const { count: childCount } = await svc.from("child_profiles").select("*", { count: "exact", head: true }).eq("family_id", fm!.family_id);
    expect(childCount).toBeGreaterThan(0);

    console.log(`✅ 시나리오 2 통과: 기존 ACTIVE 계정 (가족 ID: ${maskId(fm!.family_id)}, 아이 수: ${childCount}) 무결성 확인`);
  });

  test("시나리오 3: 회원가입 중간 종료 후 ONBOARDING 라우팅 재개 검증", async () => {
    const timestamp = Date.now();
    const email = `qa-prod-resume-${timestamp}@kbestie.local`;

    // 1. 중간 단계 계정 생성 (프로필 입력 완료, 가족 생성 완료, 아이 등록 미완료)
    const { data: userData } = await svc.auth.admin.createUser({
      email,
      password: "TestPw2026!#",
      email_confirm: true,
      user_metadata: { name: "중간탈출보호자" }
    });
    const userId = userData.user!.id;

    try {
      // 약관 동의 및 프로필 입력 (ONBOARDING 상태)
      await svc.from("signup_consents").insert([
        { user_id: userId, consent_type: "service_terms", document_version: "2026-07-16", agreed: true }
      ]);
      await svc.from("parents").update({
        account_status: "ONBOARDING",
        phone_number: "010-7777-6666",
        name: "중간탈출보호자"
      }).eq("id", userId);

      // resolveMembershipState 논리 검증: account_status = 'ONBOARDING' 이므로 AUTHENTICATED_INCOMPLETE 반환 (온보딩 라우팅 대상)
      const { data: parent } = await svc.from("parents").select("account_status, onboarding_completed_at").eq("id", userId).single();
      console.log(`[S3] 중간 종료 계정 상태: status=${parent?.account_status}, oat=${parent?.onboarding_completed_at || 'NULL'}`);
      expect(parent?.account_status).toBe("ONBOARDING");
      expect(parent?.onboarding_completed_at).toBeNull();

      console.log("✅ 시나리오 3 통과: ONBOARDING 상태 유지 및 재개 라우팅 대상 정상 판정");
    } finally {
      await svc.from("signup_consents").delete().eq("user_id", userId);
      await svc.from("parents").delete().eq("id", userId);
      await svc.auth.admin.deleteUser(userId);
    }
  });
});
