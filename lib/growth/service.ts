// 성장정보 서버 조회·검증 공통 로직 (요청서 012 §3-9, §3-11).
//
// RLS 만 믿지 않고 라우트에서도 "이 아이의 부모인가"를 반드시 확인한다.
// 아이 role 은 requireChildAccess 가 role='child' 로 통과시키므로, 성장정보는 role==='parent'
// 만 허용한다(아이 계정은 403).

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { buildGrowthSummary, type GrowthSex } from "./index";
import type { GrowthStateResponse } from "./types";

export interface GrowthAccessDenied {
  ok: false;
  status: 401 | 403 | 404;
  error: string;
}

export interface GrowthAccessGranted {
  ok: true;
  child: { id: string; name: string | null; gender: GrowthSex | null };
}

/** 부모 전용 접근 검증. 아이 계정·다른 가족 부모는 전부 거부한다. */
export async function requireParentGrowthAccess(
  supabase: SupabaseClient,
  userId: string,
  childId: string
): Promise<GrowthAccessGranted | GrowthAccessDenied> {
  const access = await requireChildAccess(supabase, userId, childId);
  if (!access.allowed || access.role !== "parent") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const { data, error } = await supabase
    .from("child_profiles")
    .select("id, name, gender")
    .eq("id", childId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, error: "아이 정보를 찾을 수 없어요" };
  }

  const gender = data.gender === "male" || data.gender === "female" ? data.gender : null;
  return { ok: true, child: { id: data.id, name: data.name ?? null, gender } };
}

export type { GrowthProfileView, GrowthStateResponse } from "./types";

/** 성장 프로필과 측정 기록을 읽어 부모 화면이 쓰는 형태로 만든다. */
export async function loadGrowthState(
  supabase: SupabaseClient,
  child: { id: string; name: string | null; gender: GrowthSex | null }
): Promise<GrowthStateResponse> {
  const { data: profile } = await supabase
    .from("child_growth_profiles")
    .select("birth_date, growth_consent_version, growth_consent_at")
    .eq("child_id", child.id)
    .maybeSingle();

  if (!profile) {
    return {
      configured: false,
      profile: null,
      gender: child.gender,
      childName: child.name,
      summary: null,
    };
  }

  const { data: measurements } = await supabase
    .from("growth_measurements")
    .select("id, measured_at, height_cm, weight_kg")
    .eq("child_id", child.id)
    .order("measured_at", { ascending: false });

  // 성별이 없으면 공식 기준 비교가 불가능하다. 이 경우 측정값만 보여주고 비교는 하지 않는다.
  const summary = child.gender
    ? buildGrowthSummary(
        profile.birth_date,
        child.gender,
        (measurements ?? []).map((row) => ({
          id: row.id as string,
          measuredAt: row.measured_at as string,
          heightCm: row.height_cm === null ? null : Number(row.height_cm),
          weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
        }))
      )
    : null;

  return {
    configured: true,
    profile: {
      birthDate: profile.birth_date as string,
      consentVersion: profile.growth_consent_version as string,
      consentAt: profile.growth_consent_at as string,
    },
    gender: child.gender,
    childName: child.name,
    summary,
  };
}
