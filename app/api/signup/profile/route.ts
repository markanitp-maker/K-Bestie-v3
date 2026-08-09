import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RELATIONSHIPS = ["mother", "father", "legal_guardian", "other_legal_guardian"] as const;
// POST /api/signup/profile — 회원가입 2단계(보호자 기본정보) 저장.
// Body: { name, relationship }. 법정대리인 권한은 1단계의 서버 동의 원장을 재사용한다.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    relationship?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const relationship = body.relationship?.trim();

  if (!name) {
    return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  }
  if (!relationship || !RELATIONSHIPS.includes(relationship as (typeof RELATIONSHIPS)[number])) {
    return NextResponse.json({ error: "아이와의 관계를 선택해주세요." }, { status: 400 });
  }
  const svc = createServiceClient();
  const { data: guardianConsents, error: consentError } = await svc
    .from("signup_consents")
    .select("consent_type, agreed_at")
    .eq("user_id", user.id)
    .eq("agreed", true)
    .is("withdrawn_at", null)
    .in("consent_type", ["guardian_u14", "guardian_authority"]);

  if (consentError) {
    console.error("[signup/profile] guardian consent query error:", consentError);
    return NextResponse.json({ error: "동의 기록을 확인하지 못했습니다." }, { status: 500 });
  }
  const consentByType = new Map((guardianConsents ?? []).map((row) => [row.consent_type, row.agreed_at]));
  if (!consentByType.has("guardian_u14") || !consentByType.has("guardian_authority")) {
    return NextResponse.json(
      { error: "1단계 법정대리인 동의를 먼저 완료해 주세요." },
      { status: 409 },
    );
  }
  const guardianConfirmedAt = consentByType.get("guardian_authority") ?? new Date().toISOString();

  // upsert only allowed profile input fields — administrative/membership fields are not touched.
  // account_status transitions to ONBOARDING (from AUTHENTICATED_INCOMPLETE) to signal active onboarding.
  // It will only transition to ACTIVE once family + child are fully created.
  const { error } = await svc
    .from("parents")
    .upsert({
      id: user.id,
      email: user.email ?? "",
      name,
      relationship_to_child: relationship,
      legal_guardian_confirmed_at: guardianConfirmedAt,
      account_status: "ONBOARDING",
    }, { onConflict: "id" });

  if (error) {
    console.error("[signup/profile] upsert error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Handle Acquisition Attribution
  const cookieStore = await cookies();
  const firstTouch = cookieStore.get("first_touch_link_id")?.value;
  const signupTouch = cookieStore.get("signup_touch_link_id")?.value;
  const visitorId = cookieStore.get("k_visitor_id")?.value || user.id;

  if (firstTouch || signupTouch) {
    const now = new Date().toISOString();
    const activeLink = signupTouch || firstTouch;
    
    if (activeLink) {
      await svc.from("parent_attributions").upsert({
        parent_user_id: user.id,
        first_touch_link_id: firstTouch,
        first_touch_at: now,
        signup_link_id: signupTouch,
        signup_touch_at: now,
        attribution_window_days: 30
      }, { onConflict: "parent_user_id", ignoreDuplicates: true });

      await svc.from("acquisition_events").insert({
        event_type: "PARENT_SIGNUP_COMPLETED",
        attribution_id: visitorId,
        visitor_id: visitorId,
        link_id: activeLink,
        parent_user_id: user.id
      });
    }
  }

  return NextResponse.json({ ok: true });
}
