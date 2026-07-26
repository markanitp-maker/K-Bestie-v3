// 요금제 축소/재상향에 따른 보존기간 스탬프(소프트삭제)·복구 — 트리거 소스 무관 범용 서버 함수.
// 반드시 service-role 클라이언트로만 호출한다(chat_messages/daily_reports/weekly_summaries의
// UPDATE가 RLS상 service_role 전용 — family_clean_slate.sql chat_messages_service_only,
// daily_reports_update, weekly_summaries_update 참고).
//
// 호출부(app/api/child/[id]/route.ts)는 이 함수를 호출하기 전에 반드시 사용자 클라이언트로
// child_profiles 소유권을 전용 SELECT로 선확인해야 한다(TOCTOU 안전 — update rowcount/에러로
// 소유권을 추론하지 않는다). 이 모듈 자체는 소유권 검증을 하지 않는다(이미 검증됐다고 가정).
//
// 나이 앵커: 세션 스코프(chat_sessions/chat_messages/daily_reports)는 chat_sessions.started_at
// (chat_sessions에는 created_at이 없음), weekly_summaries는 자기 week_start.
// 스탬프와 복구가 동일한 getEffectiveRetention/isPurgeCandidate 계산기를 공유하므로
// 대칭 역연산이 보장된다.

import { createServiceClient } from "@/lib/supabase/server";
import { getEffectiveRetention, isPurgeCandidate, type Tier } from "@/lib/plan/retention";

const GRACE_DAYS = 30;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/** 축소(다운그레이드) 시 유효 보존기간을 초과한 데이터에 deleted_at을 스탬프한다(세션 경계 일괄). */
export async function stampRetention(childId: string, newTier: Tier, activePackCount = 0): Promise<void> {
  const retention = getEffectiveRetention(newTier, activePackCount);
  const service = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // ── 세션 스코프: chat_sessions.started_at 앵커로 초과 세션 판정 → 세션 경계 일괄 스탬프 ──
  const { data: sessions } = await service
    .from("chat_sessions")
    .select("id, started_at")
    .eq("child_id", childId)
    .is("deleted_at", null);

  const overSessionIds = (sessions ?? [])
    .filter((s) => isPurgeCandidate({ anchorTs: new Date(s.started_at) }, now, retention))
    .map((s) => s.id);

  if (overSessionIds.length > 0) {
    await service.from("chat_sessions").update({ deleted_at: nowIso }).in("id", overSessionIds);
    await service.from("chat_messages").update({ deleted_at: nowIso }).in("session_id", overSessionIds);
  }

  // ── daily_reports: requests/017-report-check.md 이후 child_id+business_date로 여러
  // 세션을 합쳐 생성되므로(session_id는 더 이상 신뢰 가능한 앵커가 아니고 신규 생성분은
  // NULL일 수 있음), 리포트 자신의 business_date를 앵커로 독립 판정한다.
  const { data: reports } = await service
    .from("daily_reports")
    .select("id, business_date")
    .eq("child_id", childId)
    .is("deleted_at", null);

  const overReportIds = (reports ?? [])
    .filter((r) => r.business_date && isPurgeCandidate({ anchorTs: new Date(`${r.business_date}T00:00:00+09:00`) }, now, retention))
    .map((r) => r.id);

  if (overReportIds.length > 0) {
    await service.from("daily_reports").update({ deleted_at: nowIso }).in("id", overReportIds);
  }

  // ── weekly_summaries: child_id 스코프 + 자기 week_start 앵커로 독립 판정/스탬프 ──
  const { data: weeklies } = await service
    .from("weekly_summaries")
    .select("id, week_start")
    .eq("child_id", childId)
    .is("deleted_at", null);

  const overWeeklyIds = (weeklies ?? [])
    .filter((w) => isPurgeCandidate({ anchorTs: new Date(w.week_start) }, now, retention))
    .map((w) => w.id);

  if (overWeeklyIds.length > 0) {
    await service.from("weekly_summaries").update({ deleted_at: nowIso }).in("id", overWeeklyIds);
  }
}

/** 재상향(재구독/재설정)으로 유효 보존기간이 재확대되면, 유예 30일 내 & 새 보존기간 내로
 *  들어오는 데이터만 deleted_at을 해제(복구)한다. 세션은 통째로 복구(부분 복구 금지),
 *  유예 경과분·여전히 보존기간 밖인 데이터는 복구하지 않는다(과잉 복구 방지). */
export async function restoreRetention(childId: string, newTier: Tier, activePackCount = 0): Promise<void> {
  const retention = getEffectiveRetention(newTier, activePackCount);
  const service = createServiceClient();
  const now = new Date();
  const graceThreshold = new Date(now.getTime() - GRACE_MS);

  // ── 세션 스코프: started_at 앵커로 재판정, 세션 통째 복구 ──
  const { data: sessions } = await service
    .from("chat_sessions")
    .select("id, started_at, deleted_at")
    .eq("child_id", childId)
    .not("deleted_at", "is", null);

  const restoreSessionIds = (sessions ?? [])
    .filter((s) => {
      const deletedAt = new Date(s.deleted_at as string);
      if (deletedAt < graceThreshold) return false; // 유예 경과 — 복구 제외
      return !isPurgeCandidate({ anchorTs: new Date(s.started_at) }, now, retention);
    })
    .map((s) => s.id);

  if (restoreSessionIds.length > 0) {
    await service.from("chat_sessions").update({ deleted_at: null }).in("id", restoreSessionIds);
    await service.from("chat_messages").update({ deleted_at: null }).in("session_id", restoreSessionIds);
  }

  // ── daily_reports: business_date 앵커로 독립 판정(stampRetention과 동일한 이유).
  const { data: deletedReports } = await service
    .from("daily_reports")
    .select("id, business_date, deleted_at")
    .eq("child_id", childId)
    .not("deleted_at", "is", null);

  const restoreReportIds = (deletedReports ?? [])
    .filter((r) => {
      const deletedAt = new Date(r.deleted_at as string);
      if (deletedAt < graceThreshold) return false;
      if (!r.business_date) return false;
      return !isPurgeCandidate({ anchorTs: new Date(`${r.business_date}T00:00:00+09:00`) }, now, retention);
    })
    .map((r) => r.id);

  if (restoreReportIds.length > 0) {
    await service.from("daily_reports").update({ deleted_at: null }).in("id", restoreReportIds);
  }

  // ── weekly_summaries: week_start 앵커로 재판정, child_id 스코프 ──
  const { data: weeklies } = await service
    .from("weekly_summaries")
    .select("id, week_start, deleted_at")
    .eq("child_id", childId)
    .not("deleted_at", "is", null);

  const restoreWeeklyIds = (weeklies ?? [])
    .filter((w) => {
      const deletedAt = new Date(w.deleted_at as string);
      if (deletedAt < graceThreshold) return false;
      return !isPurgeCandidate({ anchorTs: new Date(w.week_start) }, now, retention);
    })
    .map((w) => w.id);

  if (restoreWeeklyIds.length > 0) {
    await service.from("weekly_summaries").update({ deleted_at: null }).in("id", restoreWeeklyIds);
  }
}
