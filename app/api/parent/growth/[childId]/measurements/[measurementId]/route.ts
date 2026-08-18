// 요청서 012 — 측정 기록 수정·삭제 (§3-4).
//
// 수정·삭제 후에는 최신값과 상세 분석이 즉시 다시 계산돼야 하므로, 응답으로 갱신된 전체
// 상태(loadGrowthState)를 돌려준다. 계산값을 따로 저장하지 않으니 재계산만 하면 된다.

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { loadGrowthState, requireParentGrowthAccess } from "@/lib/growth/service";
import { validateMeasurementInput } from "@/lib/growth/validation";

export const runtime = "nodejs";

async function authorize(childId: string, measurementId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const access = await requireParentGrowthAccess(supabase, user.id, childId);
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) } as const;
  }

  // 다른 아이의 measurementId 를 주입해도 통하지 않도록 child_id 로 함께 조회한다.
  const { data: measurement } = await supabase
    .from("growth_measurements")
    .select("id, measured_at")
    .eq("id", measurementId)
    .eq("child_id", childId)
    .maybeSingle();

  if (!measurement) {
    return { error: NextResponse.json({ error: "기록을 찾을 수 없어요" }, { status: 404 }) } as const;
  }

  return { supabase, child: access.child, measurement } as const;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ childId: string; measurementId: string }> }
) {
  const { childId, measurementId } = await params;
  const authorized = await authorize(childId, measurementId);
  if ("error" in authorized) return authorized.error;
  const { supabase, child, measurement } = authorized;

  let body: { measuredAt?: unknown; heightCm?: unknown; weightKg?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("child_growth_profiles")
    .select("birth_date")
    .eq("child_id", childId)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "성장정보 설정이 먼저 필요해요" }, { status: 409 });
  }

  const validated = validateMeasurementInput(
    { ...body, measuredAt: body.measuredAt ?? measurement.measured_at },
    profile.birth_date as string
  );
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.failure.message, field: validated.failure.field },
      { status: 400 }
    );
  }
  const { measuredAt, heightCm, weightKg } = validated.value;

  try {
    // 측정일을 다른 기록과 같은 날짜로 바꾸려는 경우는 막는다(같은 날짜 = 한 행 규칙).
    if (measuredAt !== measurement.measured_at) {
      const { data: conflict } = await supabase
        .from("growth_measurements")
        .select("id")
        .eq("child_id", childId)
        .eq("measured_at", measuredAt)
        .neq("id", measurementId)
        .maybeSingle();
      if (conflict) {
        return NextResponse.json(
          { error: "그 날짜에는 이미 기록이 있어요. 기존 기록을 수정해 주세요.", field: "measuredAt" },
          { status: 409 }
        );
      }
    }

    const { error } = await supabase
      .from("growth_measurements")
      .update({ measured_at: measuredAt, height_cm: heightCm, weight_kg: weightKg })
      .eq("id", measurementId)
      .eq("child_id", childId);
    if (error) {
      console.error("[growth][measurement][PATCH] 수정 실패:", error);
      return NextResponse.json({ error: "기록을 수정하지 못했어요" }, { status: 500 });
    }

    const state = await loadGrowthState(supabase, child);
    return NextResponse.json(state);
  } catch (error) {
    console.error("[growth][measurement][PATCH] 예외:", error);
    return NextResponse.json({ error: "기록을 수정하지 못했어요" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ childId: string; measurementId: string }> }
) {
  const { childId, measurementId } = await params;
  const authorized = await authorize(childId, measurementId);
  if ("error" in authorized) return authorized.error;
  const { supabase, child } = authorized;

  try {
    const { error } = await supabase
      .from("growth_measurements")
      .delete()
      .eq("id", measurementId)
      .eq("child_id", childId);
    if (error) {
      console.error("[growth][measurement][DELETE] 삭제 실패:", error);
      return NextResponse.json({ error: "기록을 삭제하지 못했어요" }, { status: 500 });
    }

    const state = await loadGrowthState(supabase, child);
    return NextResponse.json(state);
  } catch (error) {
    console.error("[growth][measurement][DELETE] 예외:", error);
    return NextResponse.json({ error: "기록을 삭제하지 못했어요" }, { status: 500 });
  }
}
