import { toZonedTime } from "date-fns-tz";

export function getMissionPhase(
  missionType: 'round1_day' | 'round2_night' | 'common',
  isTestAccount: boolean = false
): 1 | 2 | null {
  const kstNow = toZonedTime(new Date(), "Asia/Seoul");
  const hour = kstNow.getHours();
  const min = kstNow.getMinutes();
  const time = hour * 100 + min;

  let currentPhase: 1 | 2 | null = null;
  if (time >= 1000 && time < 1750) {
    currentPhase = 1;
  } else if (time >= 1800 && time < 2400) {
    currentPhase = 2;
  }

  if (missionType === 'common') {
    // If not in operating hours, common only falls back if caller is an authorized test account.
    // Normal user routes must fail closed when operating hours are closed.
    if (currentPhase === null) {
      return isTestAccount ? (hour >= 18 ? 2 : 1) : null;
    }
    return currentPhase;
  }

  // Reject if not in operating hours
  if (currentPhase === null) return null;

  // Reject if client request doesn't match server operating hours
  if (missionType === 'round1_day' && currentPhase !== 1) return null;
  if (missionType === 'round2_night' && currentPhase !== 2) return null;

  return currentPhase;
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
    .select("id, session_type, mission_phase, demo_mode, child_id")
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
  const currentPhase = getMissionPhase(roundType, false);

  const expectedPhase = session.mission_phase ?? (roundType === "round2_night" ? 2 : 1);

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

