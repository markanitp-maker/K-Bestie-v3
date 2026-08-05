import { toKSTDateStr } from "@/lib/analytics/kstDate";
import { fetchInChunks } from "@/lib/analytics/kstDate";
import type { RetentionPeriodRange } from "@/lib/admin/retentionPeriod";
import { isDateInRange } from "@/lib/admin/retentionPeriod";

// 관리자 리텐션 화면(전체/부모/아이 탭, 상세 드릴다운, CSV)이 모두 이 함수 하나로
// "활성 일수"와 "미션 수"를 계산한다 — 서로 다른 쿼리·기준(로그인 이벤트 기반 활성일수
// vs 기간 필터 없는 mission_start 이벤트 누적 카운트)을 쓰던 것이 근본 결함이었다.
//
// - 활성 일수 = 미션(mission_progress)·자유대화(freechat_start)·놀이(play_start) 중
//   하나라도 발생한 Asia/Seoul 기준 고유 날짜 수(로그인 이벤트는 "활동"이 아니므로 제외).
// - 미션 수 = mission_progress를 child_id + business_date + round_type 기준으로
//   dedupe한 고유 슬롯 수. round_type은 round1_day(MISSION_I)/round2_night(MISSION_II)
//   두 값만 존재하므로 하루 최대 2, 활성 일수 대비 최대 2배를 구조적으로 보장한다.
//   mission_progress.session_id가 PK라 재시도·재입장으로 세션이 여러 번 생겨도(같은
//   child_id+business_date+round_type) Set으로 자동 dedupe된다 — behavior_events의
//   raw mission_start 이벤트를 그대로 세던 기존 방식은 이 dedupe가 전혀 없었다.
export interface ChildActivityMetrics {
  activeDaysTotal: number;
  missionCount: number;
  freechatCount: number;
  playCount: number;
  lastActivityAt: string | null;
  /** 감사용 — 날짜 오름차순 */
  activeDates: string[];
  /** 감사용 — business_date -> { mission1, mission2 } */
  missionByDate: Record<string, { mission1: boolean; mission2: boolean }>;
}

const ROUND_TYPE_TO_SLOT: Record<string, "mission1" | "mission2"> = {
  round1_day: "mission1",
  round2_night: "mission2",
};

export async function computeChildActivityMetrics(
  service: any,
  childIds: string[],
  range: RetentionPeriodRange
): Promise<Map<string, ChildActivityMetrics>> {
  const result = new Map<string, ChildActivityMetrics>();
  if (childIds.length === 0) return result;

  const missionDatesByChild = new Map<string, Map<string, { mission1: boolean; mission2: boolean }>>();
  const activeDatesByChild = new Map<string, Set<string>>();
  const freechatCountByChild = new Map<string, number>();
  const playCountByChild = new Map<string, number>();
  const lastActivityByChild = new Map<string, string>();

  const ensure = (childId: string) => {
    if (!missionDatesByChild.has(childId)) missionDatesByChild.set(childId, new Map());
    if (!activeDatesByChild.has(childId)) activeDatesByChild.set(childId, new Set());
  };

  // 1. mission_progress — child_id+business_date+round_type 기준 dedupe.
  const missionRows = await fetchInChunks<{ child_id: string; business_date: string; round_type: string; updated_at: string }>(
    (chunk, from, to) =>
      service
        .from("mission_progress")
        .select("child_id, business_date, round_type, updated_at")
        .in("child_id", chunk)
        .order("child_id")
        .range(from, to),
    childIds
  );

  for (const row of missionRows) {
    if (!row.business_date || !isDateInRange(row.business_date, range)) continue;
    const slot = ROUND_TYPE_TO_SLOT[row.round_type];
    if (!slot) continue; // 알 수 없는 round_type은 안전하게 집계에서 제외(과대집계 방지)
    ensure(row.child_id);
    const dateMap = missionDatesByChild.get(row.child_id)!;
    const entry = dateMap.get(row.business_date) || { mission1: false, mission2: false };
    entry[slot] = true;
    dateMap.set(row.business_date, entry);
    activeDatesByChild.get(row.child_id)!.add(row.business_date);
    if (row.updated_at) {
      const prev = lastActivityByChild.get(row.child_id);
      if (!prev || new Date(row.updated_at).getTime() > new Date(prev).getTime()) {
        lastActivityByChild.set(row.child_id, row.updated_at);
      }
    }
  }

  // 2. behavior_events — freechat_start/play_start (활성일수 산입 + 원시 카운트).
  const eventRows = await fetchInChunks<{ child_id: string; event_name: string; occurred_at: string }>(
    (chunk, from, to) =>
      service
        .from("behavior_events")
        .select("child_id, event_name, occurred_at")
        .in("child_id", chunk)
        .in("event_name", ["freechat_start", "play_start"])
        .order("child_id")
        .range(from, to),
    childIds
  );

  for (const row of eventRows) {
    const kstDate = toKSTDateStr(row.occurred_at);
    if (!isDateInRange(kstDate, range)) continue;
    ensure(row.child_id);
    activeDatesByChild.get(row.child_id)!.add(kstDate);
    if (row.event_name === "freechat_start") {
      freechatCountByChild.set(row.child_id, (freechatCountByChild.get(row.child_id) || 0) + 1);
    } else if (row.event_name === "play_start") {
      playCountByChild.set(row.child_id, (playCountByChild.get(row.child_id) || 0) + 1);
    }
    const prev = lastActivityByChild.get(row.child_id);
    if (!prev || new Date(row.occurred_at).getTime() > new Date(prev).getTime()) {
      lastActivityByChild.set(row.child_id, row.occurred_at);
    }
  }

  for (const childId of childIds) {
    const missionByDate = missionDatesByChild.get(childId) || new Map();
    const activeDates = Array.from(activeDatesByChild.get(childId) || new Set<string>()).sort();
    let missionCount = 0;
    const missionByDateObj: Record<string, { mission1: boolean; mission2: boolean }> = {};
    for (const [date, flags] of missionByDate.entries()) {
      missionByDateObj[date] = flags;
      missionCount += (flags.mission1 ? 1 : 0) + (flags.mission2 ? 1 : 0);
    }

    result.set(childId, {
      activeDaysTotal: activeDates.length,
      missionCount,
      freechatCount: freechatCountByChild.get(childId) || 0,
      playCount: playCountByChild.get(childId) || 0,
      lastActivityAt: lastActivityByChild.get(childId) || null,
      activeDates,
      missionByDate: missionByDateObj,
    });
  }

  return result;
}
