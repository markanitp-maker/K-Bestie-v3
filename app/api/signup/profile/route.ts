import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RELATIONSHIPS = ["mother", "father", "legal_guardian", "other_legal_guardian"] as const;
// 010-0000-0000 형태만 허용 — 국내 휴대폰 번호 형식 검증만 수행한다. 실제 OTP
// 발송/검증은 이번 변경에 포함되지 않는다(외부 SMS/OTP 벤더 미연동 — 최종 보고에
// 대표님 결정 필요 항목으로 명시).
const PHONE_REGEX = /^01[016789]-?\d{3,4}-?\d{4}$/;

// POST /api/signup/profile — 회원가입 2단계(보호자 기본정보) 저장.
// Body: { name, phone, relationship, legalGuardianConfirmed }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    phone?: string;
    relationship?: string;
    legalGuardianConfirmed?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const phone = body.phone?.trim();
  const relationship = body.relationship?.trim();

  if (!name) {
    return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  }
  if (!phone || !PHONE_REGEX.test(phone)) {
    return NextResponse.json({ error: "휴대전화 번호 형식을 확인해주세요." }, { status: 400 });
  }
  if (!relationship || !RELATIONSHIPS.includes(relationship as (typeof RELATIONSHIPS)[number])) {
    return NextResponse.json({ error: "아이와의 관계를 선택해주세요." }, { status: 400 });
  }
  if (body.legalGuardianConfirmed !== true) {
    return NextResponse.json({ error: "법정대리인 확인이 필요합니다." }, { status: 400 });
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from("parents")
    .upsert({
      id: user.id,
      email: user.email ?? "",
      name,
      phone_number: phone,
      relationship_to_child: relationship,
      legal_guardian_confirmed_at: new Date().toISOString(),
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
