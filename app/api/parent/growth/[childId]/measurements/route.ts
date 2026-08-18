// 요청서 012 — 측정 기록 추가(같은 측정일이면 upsert).
//
// 같은 아이·같은 측정일에 새 행을 만들지 않는다(§3-3, §5). 키만 먼저 넣고 나중에 몸무게를
// 넣으면 기존 행을 갱신한다. 이때 이미 들어 있던 값을 null 로 지우지 않는다.

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GROWTH_STANDARD_VERSION } from "@/lib/growth";
import { loadGrowthState, requireParentGrowthAccess } from "@/lib/growth/service";
import { validateMeasurementInput } from "@/lib/growth/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireParentGrowthAccess(supabase, user.id, childId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

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

  // 동의·생년월일이 없으면 측정값도 저장하지 않는다(§7-5 "동의하지 않으면 growth profile 생성 0건").
  if (!profile) {
    return NextResponse.json({ error: "성장정보 설정이 먼저 필요해요" }, { status: 409 });
  }

  const validated = validateMeasurementInput(body, profile.birth_date as string);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.failure.message, field: validated.failure.field },
      { status: 400 }
    );
  }
  const { measuredAt, heightCm, weightKg } = validated.value;

  try {
    const { data: existing } = await supabase
      .from("growth_measurements")
      .select("id, height_cm, weight_kg")
      .eq("child_id", childId)
      .eq("measured_at", measuredAt)
      .maybeSingle();

    if (existing) {
      // 이번에 입력하지 않은 값은 기존 값을 유지한다.
      const nextHeight = heightCm ?? (existing.height_cm === null ? null : Number(existing.height_cm));
      const nextWeight = weightKg ?? (existing.weight_kg === null ? null : Number(existing.weight_kg));
      const { error } = await supabase
        .from("growth_measurements")
        .update({ height_cm: nextHeight, weight_kg: nextWeight })
        .eq("id", existing.id);
      if (error) {
        console.error("[growth][measurements][POST] 갱신 실패:", error);
        return NextResponse.json({ error: "측정값을 저장하지 못했어요" }, { status: 500 });
      }
    } else {
      const { error } = await supabase.from("growth_measurements").insert({
        child_id: childId,
        measured_at: measuredAt,
        height_cm: heightCm,
        weight_kg: weightKg,
        source: "parent_manual",
        standard_version: GROWTH_STANDARD_VERSION,
      });
      if (error) {
        console.error("[growth][measurements][POST] 저장 실패:", error);
        return NextResponse.json({ error: "측정값을 저장하지 못했어요" }, { status: 500 });
      }
    }

    const state = await loadGrowthState(supabase, access.child);
    return NextResponse.json(state, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error("[growth][measurements][POST] 예외:", error);
    return NextResponse.json({ error: "측정값을 저장하지 못했어요" }, { status: 500 });
  }
}
