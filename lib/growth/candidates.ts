// 요청서 013 §3-6, §3-9, §3-11, §3-12, §3-17 — 아이 발화 후보값 저장·승인·무시.
//
// 공식 Source of Truth 는 계속 growth_measurements 다(§3-15). 이 모듈은 그 앞단의
// 대기열만 다룬다. 공식 기록을 만드는 곳은 confirmGrowthCandidate() 하나뿐이고,
// 그것도 부모 요청으로만 호출된다(§5-1).

import type { SupabaseClient } from "@supabase/supabase-js";

import { todayInKst } from "./age";
import type { GrowthCandidateConfidence, GrowthMeasurementType, GrowthUtteranceCandidate } from "./utteranceExtraction";

export type GrowthCandidateSourceType = "child_utterance_mission" | "child_utterance_free_chat";
export type GrowthCandidateStatus = "pending" | "confirmed" | "dismissed" | "expired";

export interface PendingGrowthCandidate {
  id: string;
  measurementType: GrowthMeasurementType;
  value: number;
  unit: "cm" | "kg";
  confidence: GrowthCandidateConfidence;
  rawValueText: string | null;
  spokenAt: string;
}

/** 후보를 몇 개까지 부모 화면에 올릴지. 밀린 후보가 화면을 덮지 않게 한다. */
export const MAX_PENDING_CANDIDATES_SHOWN = 6;

/**
 * 아이 발화에서 뽑은 후보를 pending 으로 저장한다.
 *
 * 중복(§3-12)은 DB 의 부분 유니크 인덱스(child_id, measurement_type, value WHERE pending)가
 * 막는다. 여기서 조회 후 분기하면 같은 턴이 동시에 두 번 처리될 때 새는데, 유니크 위반은
 * 새지 않는다. 그래서 위반(23505)을 정상 흐름으로 보고 조용히 넘긴다.
 *
 * 실패해도 예외를 던지지 않는다 — 성장정보 후보 저장 때문에 아이 대화가 끊기면 안 된다.
 */
export async function recordGrowthCandidates(input: {
  db: SupabaseClient;
  childId: string;
  candidates: readonly GrowthUtteranceCandidate[];
  sourceType: GrowthCandidateSourceType;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
}): Promise<{ inserted: number; duplicates: number; skippedNoConsent?: true }> {
  if (input.candidates.length === 0) return { inserted: 0, duplicates: 0 };

  // 부모가 성장정보를 설정하지 않았으면 아무것도 저장하지 않는다.
  //
  // child_growth_profiles 행이 곧 성장정보 수집·이용 동의 기록이다
  // (growth_consent_version / growth_consent_at, lib/growth/consent.ts). 동의 없는 가정에서
  // 아이 신체정보를 쌓으면 부모가 볼 화면도 없고 지울 방법도 없다. RLS 는 "누가 읽는가"만
  // 막지 "애초에 모아도 되는가"를 막지 않으므로 여기서 따로 닫는다(§3-16).
  const { data: profile, error: profileError } = await input.db
    .from("child_growth_profiles")
    .select("child_id")
    .eq("child_id", input.childId)
    .maybeSingle();
  if (profileError) {
    console.error("[growth/candidates] 성장정보 동의 확인 실패 — 저장하지 않는다", profileError.message);
    return { inserted: 0, duplicates: 0, skippedNoConsent: true };
  }
  if (!profile) return { inserted: 0, duplicates: 0, skippedNoConsent: true };

  // §6-6 — 공식 최신값과 같은 값은 후보로 올리지 않는다.
  //
  // 아이는 같은 값을 여러 번 말한다("142cm야" → 다음 날 또 "142cm야"). 이미 부모가 그 값을
  // 공식 기록으로 갖고 있으면 새 정보가 아니고, 그대로 올리면 부모 화면에 같은 안내가
  // 반복해서 뜬다. 부분 유니크 인덱스는 pending 끼리만 막으므로 여기서 따로 본다.
  const latestOfficial = await loadLatestOfficialValues(input.db, input.childId);

  let inserted = 0;
  let duplicates = 0;
  for (const candidate of input.candidates) {
    if (latestOfficial[candidate.measurementType] === candidate.value) {
      duplicates += 1;
      continue;
    }
    const { error } = await input.db.from("growth_measurement_candidates").insert({
      child_id: input.childId,
      measurement_type: candidate.measurementType,
      value: candidate.value,
      unit: candidate.unit,
      confidence: candidate.confidence,
      status: "pending",
      source_type: input.sourceType,
      source_session_id: input.sourceSessionId ?? null,
      source_message_id: input.sourceMessageId ?? null,
      raw_value_text: candidate.rawValueText,
    });
    if (!error) {
      inserted += 1;
      continue;
    }
    if (error.code === "23505") {
      duplicates += 1;
      continue;
    }
    console.error("[growth/candidates] 후보 저장 실패", error.message);
  }
  return { inserted, duplicates };
}

/**
 * 종류별 공식 최신값. measured_at 이 가장 최근인 non-null 값이다.
 * loadGrowthState 의 최신값 규칙(measured_at DESC)과 같은 기준을 쓴다.
 */
async function loadLatestOfficialValues(
  db: SupabaseClient,
  childId: string
): Promise<Partial<Record<GrowthMeasurementType, number>>> {
  const { data, error } = await db
    .from("growth_measurements")
    .select("measured_at, height_cm, weight_kg")
    .eq("child_id", childId)
    .order("measured_at", { ascending: false })
    .limit(30);
  if (error || !data) return {};

  const latest: Partial<Record<GrowthMeasurementType, number>> = {};
  for (const row of data) {
    if (latest.height === undefined && row.height_cm !== null) latest.height = Number(row.height_cm);
    if (latest.weight === undefined && row.weight_kg !== null) latest.weight = Number(row.weight_kg);
    if (latest.height !== undefined && latest.weight !== undefined) break;
  }
  return latest;
}

/** 부모 화면에 올릴 pending 후보. 최신 발화 순이다. */
export async function listPendingGrowthCandidates(
  db: SupabaseClient,
  childId: string
): Promise<PendingGrowthCandidate[]> {
  const { data, error } = await db
    .from("growth_measurement_candidates")
    .select("id, measurement_type, value, unit, confidence, raw_value_text, spoken_at")
    .eq("child_id", childId)
    .eq("status", "pending")
    .order("spoken_at", { ascending: false })
    .limit(MAX_PENDING_CANDIDATES_SHOWN);

  if (error) {
    console.error("[growth/candidates] pending 조회 실패", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    measurementType: row.measurement_type as GrowthMeasurementType,
    value: Number(row.value),
    unit: row.unit as "cm" | "kg",
    confidence: row.confidence as GrowthCandidateConfidence,
    rawValueText: (row.raw_value_text as string | null) ?? null,
    spokenAt: row.spoken_at as string,
  }));
}

/**
 * 최근에 이 종류의 값을 이미 확보했는지(§3-2).
 * 공식 기록이든 대기 중인 후보든 있으면 케이가 다시 묻지 않는다.
 */
export async function hasRecentGrowthSignal(input: {
  db: SupabaseClient;
  childId: string;
  measurementType: GrowthMeasurementType;
  withinDays: number;
}): Promise<boolean> {
  const since = new Date(Date.now() - input.withinDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: pending } = await input.db
    .from("growth_measurement_candidates")
    .select("id")
    .eq("child_id", input.childId)
    .eq("measurement_type", input.measurementType)
    .eq("status", "pending")
    .limit(1);
  if (pending && pending.length > 0) return true;

  const column = input.measurementType === "height" ? "height_cm" : "weight_kg";
  const { data: official } = await input.db
    .from("growth_measurements")
    .select("id")
    .eq("child_id", input.childId)
    .not(column, "is", null)
    .gte("measured_at", since.slice(0, 10))
    .limit(1);
  return Boolean(official && official.length > 0);
}

export interface ConfirmGrowthCandidateResult {
  ok: boolean;
  status: number;
  error?: string;
  measurementId?: string;
}

/**
 * 부모 승인 — 공식 growth_measurements 에 기록을 만든다(§3-9).
 *
 * 같은 측정일에 이미 행이 있으면 그 행의 해당 컬럼만 갱신한다. growth_measurements 는
 * UNIQUE(child_id, measured_at) 라 키와 몸무게가 한 행을 나눠 쓴다 — 새 행을 만들려 하면
 * 유니크 위반이 나고, 덮어쓰면 반대쪽 값이 지워진다.
 *
 * 이미 처리된 후보는 다시 처리하지 않는다(§3-9 2번, 중복 승인 방지).
 */
export async function confirmGrowthCandidate(input: {
  db: SupabaseClient;
  childId: string;
  candidateId: string;
  reviewerUserId: string;
  /** 부모가 값을 고쳤으면 그 값. 없으면 후보 원본 값을 쓴다(§6-5). */
  overrideValue?: number | null;
  /** 부모가 고른 측정일(YYYY-MM-DD). 없으면 오늘(KST)이다(§3-10). */
  measuredAt?: string | null;
}): Promise<ConfirmGrowthCandidateResult> {
  const { data: candidate, error: loadError } = await input.db
    .from("growth_measurement_candidates")
    .select("id, child_id, measurement_type, value, status")
    .eq("id", input.candidateId)
    .eq("child_id", input.childId)
    .maybeSingle();

  if (loadError || !candidate) {
    return { ok: false, status: 404, error: "후보를 찾을 수 없어요" };
  }
  if (candidate.status !== "pending") {
    return { ok: false, status: 409, error: "이미 처리된 기록이에요" };
  }

  const measurementType = candidate.measurement_type as GrowthMeasurementType;
  const value = input.overrideValue ?? Number(candidate.value);
  const measuredAt = input.measuredAt ?? todayInKst();
  const column = measurementType === "height" ? "height_cm" : "weight_kg";

  const { data: existing } = await input.db
    .from("growth_measurements")
    .select("id, source")
    .eq("child_id", input.childId)
    .eq("measured_at", measuredAt)
    .maybeSingle();

  let measurementId: string;
  if (existing) {
    // 값만 채우고 source 는 건드리지 않는다.
    //
    // growth_measurements 는 UNIQUE(child_id, measured_at) 라 같은 날 키·몸무게가 한 행을
    // 나눠 쓴다. 부모가 직접 입력한 행(parent_manual)에 아이 발화 후보를 얹는다고 그 행의
    // source 를 바꾸면, 부모가 손으로 넣은 값의 출처까지 소급해서 다시 쓰는 것이 된다
    // (§5-12 금지). 새로 만드는 행에만 parent_confirmed_child_report 를 붙인다.
    const { error } = await input.db
      .from("growth_measurements")
      .update({ [column]: value })
      .eq("id", existing.id);
    if (error) {
      console.error("[growth/candidates] 공식 기록 갱신 실패", error.message);
      return { ok: false, status: 500, error: "성장기록에 반영하지 못했어요" };
    }
    measurementId = existing.id as string;
  } else {
    const { data: created, error } = await input.db
      .from("growth_measurements")
      .insert({
        child_id: input.childId,
        measured_at: measuredAt,
        [column]: value,
        source: "parent_confirmed_child_report",
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[growth/candidates] 공식 기록 생성 실패", error?.message);
      return { ok: false, status: 500, error: "성장기록에 반영하지 못했어요" };
    }
    measurementId = created.id as string;
  }

  const { error: updateError } = await input.db
    .from("growth_measurement_candidates")
    .update({
      status: "confirmed",
      reviewed_by: input.reviewerUserId,
      reviewed_at: new Date().toISOString(),
      confirmed_measurement_id: measurementId,
      confirmed_value: value,
    })
    .eq("id", input.candidateId)
    .eq("status", "pending");
  if (updateError) {
    // 공식 기록은 이미 만들어졌다. 후보 상태만 못 바꾼 것이라 되돌리지 않는다 —
    // 부모에게 같은 후보가 한 번 더 보일 수는 있어도 기록이 사라지지는 않는다.
    console.error("[growth/candidates] 후보 상태 갱신 실패", updateError.message);
  }

  return { ok: true, status: 200, measurementId };
}

/** 부모 무시(§3-11). 공식 기록은 만들지 않고 다시 노출하지 않는다. */
export async function dismissGrowthCandidate(input: {
  db: SupabaseClient;
  childId: string;
  candidateId: string;
  reviewerUserId: string;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const { data, error } = await input.db
    .from("growth_measurement_candidates")
    .update({
      status: "dismissed",
      reviewed_by: input.reviewerUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.candidateId)
    .eq("child_id", input.childId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("[growth/candidates] 후보 무시 실패", error.message);
    return { ok: false, status: 500, error: "처리하지 못했어요" };
  }
  if (!data || data.length === 0) {
    return { ok: false, status: 409, error: "이미 처리된 기록이에요" };
  }
  return { ok: true, status: 200 };
}
