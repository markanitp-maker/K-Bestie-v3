export const ATTENDANCE_ROULETTE_RESULTS = [
  "LOSE",
  "RETRY",
  "KEY_1",
  "KEY_3",
  "KEY_5",
  "KEY_7",
  "KEY_9",
] as const;

export type AttendanceRouletteResultCode = (typeof ATTENDANCE_ROULETTE_RESULTS)[number];

export const ATTENDANCE_ROULETTE_LABELS: Record<AttendanceRouletteResultCode, string> = {
  LOSE: "꽝",
  RETRY: "한번 더",
  KEY_1: "황금열쇠 +1",
  KEY_3: "황금열쇠 +3",
  KEY_5: "황금열쇠 +5",
  KEY_7: "황금열쇠 +7",
  KEY_9: "황금열쇠 +9",
};

export const ATTENDANCE_ROULETTE_SECTOR_ANGLE = 360 / ATTENDANCE_ROULETTE_RESULTS.length;

/** 첫 섹터 중심을 12시 포인터에 두고 시계 방향으로 균등 배치한다. */
export function attendanceRouletteSectorCenterAngle(index: number): number {
  return -90 + index * ATTENDANCE_ROULETTE_SECTOR_ANGLE;
}

/** 서버 결과 섹터가 12시 포인터에 오도록 최소 fullTurns 바퀴 이상 전진한다. */
export function attendanceRouletteTargetRotation(
  currentRotation: number,
  resultCode: AttendanceRouletteResultCode,
  fullTurns = 4,
): number {
  const resultIndex = ATTENDANCE_ROULETTE_RESULTS.indexOf(resultCode);
  const remainder = -resultIndex * ATTENDANCE_ROULETTE_SECTOR_ANGLE;
  const minimumTarget = currentRotation + Math.max(1, fullTurns) * 360;
  const turns = Math.ceil((minimumTarget - remainder) / 360);
  return turns * 360 + remainder;
}

/** 마지막 결과를 애니메이션 없이 복원할 때 쓰는 정규화 회전각. */
export function attendanceRouletteRestingRotation(resultCode: AttendanceRouletteResultCode): number {
  const resultIndex = ATTENDANCE_ROULETTE_RESULTS.indexOf(resultCode);
  return -resultIndex * ATTENDANCE_ROULETTE_SECTOR_ANGLE;
}

export type AttendanceRouletteSpin = {
  spinId: string;
  attendanceDate: string;
  source: "BASE" | "RETRY";
  resultCode: AttendanceRouletteResultCode;
  keyReward: number;
  settledAt: string;
};

export type AttendanceRouletteStatus = {
  attendanceDate: string;
  canSpin: boolean;
  nextSource: "BASE" | "RETRY" | null;
  baseSpinUsed: boolean;
  retryCreditsRemaining: number;
  lastSpin: AttendanceRouletteSpin | null;
  balance: number;
};

export function kstDateKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isAttendanceRouletteResult(value: unknown): value is AttendanceRouletteResultCode {
  return typeof value === "string" && ATTENDANCE_ROULETTE_RESULTS.includes(value as AttendanceRouletteResultCode);
}
