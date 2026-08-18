// 요청서 012 「우리 아이 성장정보 v1」 — 성장 프로필 조회/생성/수정/삭제.
//
// GET    : 성장정보 상태(설정 여부, 생년월일, 성별, 요약·히스토리)
// POST   : 최초 설정 (동의 + 생년월일 + gender NULL 인 아이의 성별)
// PATCH  : 생년월일 정정
// DELETE : 성장정보 사용 중지 — 측정 기록과 성장 전용 프로필을 함께 삭제(§3-10)
//
// 아이 role 은 전부 403 이다. RLS 와 별개로 서버에서 부모 역할을 확인한다(§3-9).

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GROWTH_CONSENT_VERSION } from "@/lib/growth/consent";
import { loadGrowthState, requireParentGrowthAccess } from "@/lib/growth/service";
import { validateBirthDate, validateGender } from "@/lib/growth/validation";

export const runtime = "nodejs";

async function authorize(childId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  const access = await requireParentGrowthAccess(supabase, user.id, childId);
  if (!access.ok) {
    return {
      error: NextResponse.json({ error: access.error }, { status: access.status }),
    } as const;
  }
  return { supabase, child: access.child } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const authorized = await authorize(childId);
  if ("error" in authorized) return authorized.error;

  try {
    const state = await loadGrowthState(authorized.supabase, authorized.child);
    return NextResponse.json(state);
  } catch (error) {
    console.error("[growth][GET] 조회 실패:", error);
    return NextResponse.json({ error: "성장정보를 불러오지 못했어요" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const authorized = await authorize(childId);
  if ("error" in authorized) return authorized.error;
  const { supabase, child } = authorized;

  let body: { birthDate?: unknown; gender?: unknown; consent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 동의 없이는 생년월일도 키·몸무게도 저장하지 않는다(§3-2, §7-5).
  if (body.consent !== true) {
    return NextResponse.json(
      { error: "성장정보 수집·이용에 동의해야 저장할 수 있어요.", field: "consent" },
      { status: 400 }
    );
  }

  const birthDateFailure = validateBirthDate(body.birthDate);
  if (birthDateFailure) {
    return NextResponse.json(
      { error: birthDateFailure.message, field: birthDateFailure.field },
      { status: 400 }
    );
  }
  const birthDate = body.birthDate as string;

  // 성별은 child_profiles.gender 가 Source of Truth 다. 이미 있으면 다시 묻지 않고 덮어쓰지 않는다.
  let genderToPersist: "male" | "female" | null = null;
  if (!child.gender) {
    const genderFailure = validateGender(body.gender);
    if (genderFailure) {
      return NextResponse.json(
        { error: genderFailure.message, field: genderFailure.field },
        { status: 400 }
      );
    }
    genderToPersist = body.gender as "male" | "female";
  }

  try {
    if (genderToPersist) {
      const { error: genderError } = await supabase
        .from("child_profiles")
        .update({ gender: genderToPersist })
        .eq("id", childId)
        .is("gender", null);
      if (genderError) {
        console.error("[growth][POST] 성별 저장 실패:", genderError);
        return NextResponse.json({ error: "성별을 저장하지 못했어요" }, { status: 500 });
      }
    }

    const { error } = await supabase.from("child_growth_profiles").upsert(
      {
        child_id: childId,
        birth_date: birthDate,
        growth_consent_version: GROWTH_CONSENT_VERSION,
        growth_consent_at: new Date().toISOString(),
      },
      { onConflict: "child_id" }
    );
    if (error) {
      console.error("[growth][POST] 프로필 저장 실패:", error);
      return NextResponse.json({ error: "성장정보를 저장하지 못했어요" }, { status: 500 });
    }

    const state = await loadGrowthState(supabase, {
      ...child,
      gender: child.gender ?? genderToPersist,
    });
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    console.error("[growth][POST] 예외:", error);
    return NextResponse.json({ error: "성장정보를 저장하지 못했어요" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const authorized = await authorize(childId);
  if ("error" in authorized) return authorized.error;
  const { supabase, child } = authorized;

  let body: { birthDate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const failure = validateBirthDate(body.birthDate);
  if (failure) {
    return NextResponse.json({ error: failure.message, field: failure.field }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("child_growth_profiles")
      .update({ birth_date: body.birthDate as string })
      .eq("child_id", childId)
      .select("child_id")
      .maybeSingle();

    if (error) {
      console.error("[growth][PATCH] 생년월일 수정 실패:", error);
      return NextResponse.json({ error: "생년월일을 수정하지 못했어요" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "성장정보 설정이 먼저 필요해요" }, { status: 404 });
    }

    const state = await loadGrowthState(supabase, child);
    return NextResponse.json(state);
  } catch (error) {
    console.error("[growth][PATCH] 예외:", error);
    return NextResponse.json({ error: "생년월일을 수정하지 못했어요" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ childId: string }> }
) {
  const { childId } = await params;
  const authorized = await authorize(childId);
  if ("error" in authorized) return authorized.error;
  const { supabase } = authorized;

  try {
    // 측정 기록을 먼저 지우고 성장 전용 프로필(생년월일·동의 이력)을 지운다.
    // 성별(child_profiles.gender)은 성장 기능 전용 정보가 아니므로 건드리지 않는다.
    const { error: measurementError } = await supabase
      .from("growth_measurements")
      .delete()
      .eq("child_id", childId);
    if (measurementError) {
      console.error("[growth][DELETE] 측정 기록 삭제 실패:", measurementError);
      return NextResponse.json({ error: "성장정보를 삭제하지 못했어요" }, { status: 500 });
    }

    const { error: profileError } = await supabase
      .from("child_growth_profiles")
      .delete()
      .eq("child_id", childId);
    if (profileError) {
      console.error("[growth][DELETE] 프로필 삭제 실패:", profileError);
      return NextResponse.json({ error: "성장정보를 삭제하지 못했어요" }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[growth][DELETE] 예외:", error);
    return NextResponse.json({ error: "성장정보를 삭제하지 못했어요" }, { status: 500 });
  }
}
