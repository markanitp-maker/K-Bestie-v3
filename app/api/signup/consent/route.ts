import { NextRequest, NextResponse } from "next/server";
import { headers as nextHeaders, cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CONSENT_DOCUMENT_VERSION } from "@/lib/plan/consentDocument";

export const runtime = "nodejs";

const REQUIRED_TYPES = [
  "service_terms",
  "parent_pii",
  "child_pii",
  "guardian_u14",
  "guardian_authority",
] as const;
const OPTIONAL_TYPES = ["marketing", "event_notice"] as const;
const ALL_TYPES = [...REQUIRED_TYPES, ...OPTIONAL_TYPES] as const;
type ConsentType = (typeof ALL_TYPES)[number];

// POST /api/signup/consent — 회원가입 1단계(약관 및 개인정보 동의) 기록.
// Body: { agreements: { [type]: boolean } } — REQUIRED_TYPES는 전부 true여야 통과.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { agreements?: Record<string, boolean> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agreements = body.agreements ?? {};
  const missing = REQUIRED_TYPES.filter((t) => agreements[t] !== true);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "필수 동의 항목을 모두 확인해주세요.", missing },
      { status: 400 }
    );
  }

  const headersList = await nextHeaders();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    null;
  const userAgent = headersList.get("user-agent");

  const svc = createServiceClient();
  const now = new Date().toISOString();

  const rows = ALL_TYPES.filter((t) => t in agreements).map((t) => ({
    user_id: user.id,
    consent_type: t as ConsentType,
    document_version: CONSENT_DOCUMENT_VERSION,
    agreed: agreements[t] === true,
    agreed_at: now,
    ip_address: ip,
    user_agent: userAgent,
    auth_method: (user.app_metadata as { provider?: string } | undefined)?.provider ?? "unknown",
  }));

  // 이중 클릭/네트워크 재시도로 거의 동시에 두 번 POST돼도 동의 행이 중복 생성되지
  // 않도록 DB 레벨 부분 유니크 인덱스(signup_consents_active_unique, migration
  // 20260805200200)에 기대는 upsert로 처리한다 — 애플리케이션 레벨 SELECT 후 INSERT는
  // TOCTOU 경쟁 조건에 취약해 claude-review 정적 리뷰에서 지적됨.
  const { error } = await svc
    .from("signup_consents")
    .upsert(rows, {
      onConflict: "user_id,consent_type,document_version",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error("[signup/consent] upsert error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // 가족이 이미 만들어져 있으면(가입 재개 등) 이번에 기록한 동의에도 family_id를
  // 즉시 채운다 — 아래 family_id 백필은 /api/families POST가 "가족 생성 이전에 이미
  // 동의를 마친" 통상 케이스를 담당하고, 여기서는 반대로 "가족이 먼저 있고 동의를
  // 나중에(재동의 등) 하는" 드문 케이스를 보완한다.
  const { data: existingMember } = await svc
    .from("family_members")
    .select("family_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingMember?.family_id) {
    await svc
      .from("signup_consents")
      .update({ family_id: existingMember.family_id })
      .eq("user_id", user.id)
      .is("family_id", null);
  }

  // Handle Acquisition Attribution SIGNUP_STARTED
  const cookieStore = await cookies();
  const firstTouch = cookieStore.get("first_touch_link_id")?.value;
  const signupTouch = cookieStore.get("signup_touch_link_id")?.value;
  const visitorId = cookieStore.get("k_visitor_id")?.value || user.id;

  const activeLink = signupTouch || firstTouch;
  if (activeLink) {
    await svc.from("acquisition_events").insert({
      event_type: "SIGNUP_STARTED",
      attribution_id: visitorId,
      visitor_id: visitorId,
      link_id: activeLink,
      parent_user_id: user.id
    });
  }

  return NextResponse.json({ ok: true });
}
