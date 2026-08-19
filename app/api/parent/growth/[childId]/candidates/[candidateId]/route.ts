// 요청서 013 §3-9, §3-11, §3-16 — 아이 발화 후보에 대한 부모 결정.
//
// POST   : [반영] — 공식 growth_measurements 에 기록을 만든다
// DELETE : [무시] — 공식 기록 없이 dismissed 로 닫는다
//
// 공식 기록을 만드는 유일한 아이-발화 경로다. 아이 role 은 authorize 에서 전부 403 이다.

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  confirmGrowthCandidate,
  dismissGrowthCandidate,
} from "@/lib/growth/candidates";
import { loadGrowthState, requireParentGrowthAccess } from "@/lib/growth/service";
import { isFutureDate, parseDateOnly } from "@/lib/growth/age";
import { normalizeMeasurementValue } from "@/lib/growth/validation";

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
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) } as const;
  }
  return { supabase, child: access.child, userId: user.id } as const;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ childId: string; candidateId: string }> }
) {
  const { childId, candidateId } = await params;
  const authorized = await authorize(childId);
  if ("error" in authorized) return authorized.error;

  let body: { value?: unknown; measuredAt?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // 본문 없이 누른 [반영] 은 후보 원본 값과 오늘 날짜를 쓴다.
  }

  // 부모가 값을 고쳐 반영할 수 있다(§3-9, §6-5). 고친 값도 같은 범위 검증을 받는다.
  let overrideValue: number | null = null;
  if (body.value !== undefined && body.value !== null && body.value !== "") {
    const parsed = normalizeMeasurementValue(body.value);
    if (parsed === null || Number.isNaN(parsed)) {
      return NextResponse.json({ error: "값을 숫자로 입력해 주세요." }, { status: 400 });
    }
    overrideValue = parsed;
  }

  // 아이 발화 시점과 실제 측정일은 다를 수 있다(§3-10). 부모가 고른 날짜를 우선한다.
  let measuredAt: string | null = null;
  if (typeof body.measuredAt === "string" && body.measuredAt.trim()) {
    const value = body.measuredAt.trim();
    if (!parseDateOnly(value)) {
      return NextResponse.json({ error: "측정일을 정확히 입력해 주세요." }, { status: 400 });
    }
    if (isFutureDate(value)) {
      return NextResponse.json({ error: "측정일은 오늘 이후일 수 없어요." }, { status: 400 });
    }
    measuredAt = value;
  }

  const result = await confirmGrowthCandidate({
    db: authorized.supabase,
    childId,
    candidateId,
    reviewerUserId: authorized.userId,
    overrideValue,
    measuredAt,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // 측정 기록 API 와 같은 계약 — 갱신된 상태 전체를 돌려줘 카드·그래프·백분위가 함께
  // 다시 그려지게 한다(§3-9 8~10번).
  return NextResponse.json(await loadGrowthState(authorized.supabase, authorized.child));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ childId: string; candidateId: string }> }
) {
  const { childId, candidateId } = await params;
  const authorized = await authorize(childId);
  if ("error" in authorized) return authorized.error;

  const result = await dismissGrowthCandidate({
    db: authorized.supabase,
    childId,
    candidateId,
    reviewerUserId: authorized.userId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(await loadGrowthState(authorized.supabase, authorized.child));
}
