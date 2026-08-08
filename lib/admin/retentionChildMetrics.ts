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
  /** 선택 기간 내 존재한 고유 미션 슬롯 수. 기존 missionCount 의미를 유지한다. */
  missionCount: number;
  /** 선택 기간 내 status='COMPLETED'인 고유 미션 슬롯 수. */
  completedMissionCount: number;
  /** 선택 기간 내 완료되지 않은 고유 미션 슬롯 수. */
  incompleteMissionCount: number;
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

export type MissionProgressMetricRow = {
  child_id: string;
  business_date: string;
  round_type: string;
  status: string | null;
  updated_at: string | null;
};

type MissionDayFlags = {
  mission1: boolean;
  mission2: boolean;
  completedMission1: boolean;
  completedMission2: boolean;
};

export type MissionSlotAggregate = {
  missionCount: number;
  completedMissionCount: number;
  incompleteMissionCount: number;
  activeDates: string[];
  lastActivityAt: string | null;
  missionByDate: Record<string, { mission1: boolean; mission2: boolean }>;
};

/**
 * 동일한 아이·날짜·라운드에 재입장 세션이 여러 개 있어도 한 슬롯으로 센다.
 * 그중 하나라도 COMPLETED면 해당 슬롯은 완료로 센다.
 */
export function aggregateMissionProgressRows(
  rows: MissionProgressMetricRow[],
  range: RetentionPeriodRange
): Map<string, MissionSlotAggregate> {
  const daysByChild = new Map<string, Map<string, MissionDayFlags>>();
  const lastActivityByChild = new Map<string, string>();

  for (const row of rows) {
    if (!row.business_date || !isDateInRange(row.business_date, range)) continue;
    const slot = ROUND_TYPE_TO_SLOT[row.round_type];
    if (!slot) continue;

    if (!daysByChild.has(row.child_id)) daysByChild.set(row.child_id, new Map());
    const dateMap = daysByChild.get(row.child_id)!;
    const flags = dateMap.get(row.business_date) ?? {
      mission1: false,
      mission2: false,
      completedMission1: false,
      completedMission2: false,
    };
    flags[slot] = true;
    if (row.status === "COMPLETED") {
      flags[slot === "mission1" ? "completedMission1" : "completedMission2"] = true;
    }
    dateMap.set(row.business_date, flags);

    if (row.updated_at) {
      const previous = lastActivityByChild.get(row.child_id);
      if (!previous || new Date(row.updated_at).getTime() > new Date(previous).getTime()) {
        lastActivityByChild.set(row.child_id, row.updated_at);
      }
    }
  }

  const result = new Map<string, MissionSlotAggregate>();
  for (const [childId, dateMap] of daysByChild) {
    let missionCount = 0;
    let completedMissionCount = 0;
    const missionByDate: Record<string, { mission1: boolean; mission2: boolean }> = {};
    for (const [date, flags] of dateMap) {
      missionByDate[date] = { mission1: flags.mission1, mission2: flags.mission2 };
      missionCount += Number(flags.mission1) + Number(flags.mission2);
      completedMissionCount += Number(flags.completedMission1) + Number(flags.completedMission2);
    }
    result.set(childId, {
      missionCount,
      completedMissionCount,
      incompleteMissionCount: missionCount - completedMissionCount,
      activeDates: [...dateMap.keys()].sort(),
      lastActivityAt: lastActivityByChild.get(childId) ?? null,
      missionByDate,
    });
  }
  return result;
}

export async function computeChildActivityMetrics(
  service: any,
  childIds: string[],
  range: RetentionPeriodRange
): Promise<Map<string, ChildActivityMetrics>> {
  const result = new Map<string, ChildActivityMetrics>();
  if (childIds.length === 0) return result;

  const activeDatesByChild = new Map<string, Set<string>>();
  const freechatCountByChild = new Map<string, number>();
  const playCountByChild = new Map<string, number>();
  const lastActivityByChild = new Map<string, string>();

  const ensure = (childId: string) => {
    if (!activeDatesByChild.has(childId)) activeDatesByChild.set(childId, new Set());
  };

  // 1. mission_progress — child_id+business_date+round_type 기준 dedupe.
  const missionRows = await fetchInChunks<MissionProgressMetricRow>(
    (chunk, from, to) =>
      service
        .from("mission_progress")
        .select("child_id, business_date, round_type, status, updated_at")
        .in("child_id", chunk)
        .order("child_id")
        .range(from, to),
    childIds
  );

  const missionAggregates = aggregateMissionProgressRows(missionRows, range);
  for (const [childId, aggregate] of missionAggregates) {
    ensure(childId);
    for (const date of aggregate.activeDates) activeDatesByChild.get(childId)!.add(date);
    if (aggregate.lastActivityAt) lastActivityByChild.set(childId, aggregate.lastActivityAt);
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
    const activeDates = Array.from(activeDatesByChild.get(childId) || new Set<string>()).sort();
    const mission = missionAggregates.get(childId);

    result.set(childId, {
      activeDaysTotal: activeDates.length,
      missionCount: mission?.missionCount ?? 0,
      completedMissionCount: mission?.completedMissionCount ?? 0,
      incompleteMissionCount: mission?.incompleteMissionCount ?? 0,
      freechatCount: freechatCountByChild.get(childId) || 0,
      playCount: playCountByChild.get(childId) || 0,
      lastActivityAt: lastActivityByChild.get(childId) || null,
      activeDates,
      missionByDate: mission?.missionByDate ?? {},
    });
  }

  return result;
}
