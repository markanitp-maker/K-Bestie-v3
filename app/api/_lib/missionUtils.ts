import { toZonedTime } from "date-fns-tz";
import { isMissionScheduleEnforced } from "@/lib/mission/missionScheduleFlag";

// Historical v2 mission route helper. daily_single routes must use
// lib/mission-v3/timePolicy.ts and must not infer round1/round2 from the clock.

export function getMissionPhase(
  missionType: 'round1_day' | 'round2_night' | 'common',
  isTestAccount: boolean = false,
  scheduleEnforced: boolean = true
): 1 | 2 | null {
  if (!scheduleEnforced) {
    // DEV(scheduleEnforced=false): 시간 게이트를 완전히 비활성화한다. missionType에만
    // 의존하는 고정값을 반환해, 세션 생성 시점과 재개(resume) 시점 사이에 실제 시계가
    // 바뀌어도 절대 값이 달라지지 않게 한다 — 그래야 아래 assertMissionSessionActive의
    // currentPhase !== expectedPhase 판정이 DEV에서는 절대 force_end_mission_session을
    // 트리거하지 않는다(시간 기반 휴리스틱을 쓰면 자정을 넘기는 세션 등에서 값이
    // 바뀌어 오히려 강제종료를 유발할 수 있어 고정값을 쓴다).
    if (missionType === 'round1_day') return 1;
    if (missionType === 'round2_night') return 2;
    return 1;
  }

  const kstNow = toZonedTime(new Date(), "Asia/Seoul");
  const hour = kstNow.getHours();
  const min = kstNow.getMinutes();
  const time = hour * 100 + min;

  // Production 신규 생성은 10:00 inclusive ~ 23:55 exclusive 단일 창이다.
  // canonical round2_night는 기존 클라이언트의 자정 마감 계약을 재사용한다. 이미 시작한
  // 세션의 이어하기 가능 여부는 아래 assertMissionSessionActive가 business_date로 판정한다.
  if (time < 1000 || time >= 2355) {
    return isTestAccount ? (missionType === 'round1_day' ? 1 : 2) : null;
  }
  return missionType === 'round1_day' ? 1 : 2;
}

export function getKstBusinessDate(date: Date = new Date()): string {
  const kstDate = toZonedTime(date, "Asia/Seoul");
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isSameKstBusinessDate(startedAt: string, now: Date = new Date()): boolean {
  const startedAtDate = new Date(startedAt);
  return Number.isFinite(startedAtDate.getTime())
    && getKstBusinessDate(startedAtDate) === getKstBusinessDate(now);
}

export type MissionSessionCheckResult =
  | { allowed: true }
  | { allowed: false; status: string; expired: boolean; error: string; code: string };

export async function assertMissionSessionActive(
  service: any,
  sessionId: string
): Promise<MissionSessionCheckResult> {
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .select("id, session_type, mission_phase, demo_mode, child_id, started_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessErr || !session) {
    return {
      allowed: false,
      status: "NOT_FOUND",
      expired: false,
      error: "유효하지 않거나 찾을 수 없는 미션 세션입니다.",
      code: "INVALID_MISSION_SESSION",
    };
  }

  if (session.session_type !== "mission") {
    return {
      allowed: false,
      status: "INVALID_SESSION_TYPE",
      expired: false,
      error: "미션 세션이 아닙니다.",
      code: "INVALID_MISSION_SESSION",
    };
  }

  const { data: progress, error: progErr } = await service
    .from("mission_progress")
    .select("status, round_type")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (progErr || !progress) {
    return {
      allowed: false,
      status: "PROGRESS_NOT_FOUND",
      expired: false,
      error: "미션 진행 정보를 찾을 수 없습니다.",
      code: "MISSION_NOT_READY",
    };
  }

  if (progress.status === "FORCE_ENDED") {
    return {
      allowed: false,
      status: "FORCE_ENDED",
      expired: true,
      error: "미션 시간이 끝났어요",
      code: "MISSION_EXPIRED",
    };
  }

  if (progress.status === "COMPLETED" || progress.status === "SAFETY_PAUSED") {
    return {
      allowed: false,
      status: progress.status,
      expired: false,
      error: `Mission is ${progress.status}`,
      code: progress.status,
    };
  }

  if (session.demo_mode === true) {
    return { allowed: true };
  }

  const roundType = (progress.round_type as 'round1_day' | 'round2_night' | 'common') ?? 'common';
  const expectedPhase = session.mission_phase ?? (roundType === "round2_night" ? 2 : 1);
  const scheduleEnforced = isMissionScheduleEnforced();
  const currentPhase = scheduleEnforced
    ? (isSameKstBusinessDate(session.started_at) ? expectedPhase : null)
    : getMissionPhase(roundType, false, false);

  if (currentPhase === null || currentPhase !== expectedPhase) {
    const { data: rpcData, error: rpcErr } = await service.rpc("force_end_mission_session", {
      p_session_id: sessionId,
    });

    if (rpcErr) {
      console.error("[assertMissionSessionActive] force_end_mission_session RPC error:", rpcErr);
      return {
        allowed: false,
        status: "PERSISTENCE_FAILURE",
        expired: true,
        error: "미션 시간이 끝났어요",
        code: "PERSISTENCE_FAILURE",
      };
    }

    const rpcStatus = Array.isArray(rpcData) ? rpcData[0]?.status : rpcData?.status;

    if (rpcStatus === "COMPLETED" || rpcStatus === "SAFETY_PAUSED") {
      return {
        allowed: false,
        status: rpcStatus,
        expired: false,
        error: `Mission is ${rpcStatus}`,
        code: rpcStatus,
      };
    }

    if (rpcStatus === "NOT_FOUND") {
      return {
        allowed: false,
        status: "NOT_FOUND",
        expired: false,
        error: "유효하지 않거나 찾을 수 없는 미션 세션입니다.",
        code: "INVALID_MISSION_SESSION",
      };
    }

    if (rpcStatus === "FORCE_ENDED") {
      return {
        allowed: false,
        status: "FORCE_ENDED",
        expired: true,
        error: "미션 시간이 끝났어요",
        code: "MISSION_EXPIRED",
      };
    }

    return {
      allowed: false,
      status: rpcStatus ?? "UNKNOWN",
      expired: false,
      error: "유효하지 않거나 찾을 수 없는 미션 세션입니다.",
      code: "INVALID_MISSION_SESSION",
    };
  }

  return { allowed: true };
}
