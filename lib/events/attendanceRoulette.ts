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
