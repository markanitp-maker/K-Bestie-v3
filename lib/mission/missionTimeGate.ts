import type { RoundType } from "@/lib/mission/selectQuestions";

// v2 compatibility time policy. Production에서는 Mission v3 cutover 전에도
// 10:00~23:55 단일 신규 시작 창을 사용하고, round2_night를 canonical round로 반환한다.
// round2_night는 기존 클라이언트가 자정까지 이어하기 가능한 값으로 해석하므로 스키마와
// 프론트 계약을 바꾸지 않고 하루 1미션 정책을 적용할 수 있다.

export function getKstTime(date: Date = new Date()): { hour: number; minute: number; timeNum: number } {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600000);
  const hour = kst.getHours();
  const minute = kst.getMinutes();
  const timeNum = hour * 100 + minute;
  return { hour, minute, timeNum };
}

export function getKstHour(): number {
  return getKstTime().hour;
}

export function getKstMissionPhase(date: Date = new Date()): 1 | 2 | null {
  const { timeNum } = getKstTime(date);
  if (timeNum >= 1000 && timeNum < 1750) return 1;
  if (timeNum >= 1800 && timeNum < 2400) return 2;
  return null;
}

export function isVacation(date: Date = new Date()): boolean {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600000);
  const m = kst.getMonth() + 1;
  const d = kst.getDate();
  // Summer: 7.20 ~ 8.25
  if (m === 8 && d <= 25) return true;
  if (m === 7 && d >= 20) return true;
  // Winter: 12.25 ~ 2.28
  if (m === 1 || m === 2) return true;
  if (m === 12 && d >= 25) return true;
  return false;
}

export function currentRound(hour: number, scheduleEnforced: boolean = false, minute?: number): RoundType | null {
  const { hour: curHour, minute: curMin } = getKstTime();
  const resolvedMinute = minute ?? (hour === curHour ? curMin : 0);
  const timeNum = hour * 100 + resolvedMinute;

  if (scheduleEnforced) {
    return timeNum >= 1000 && timeNum < 2355 ? "round2_night" : null;
  }

  // scheduleEnforced=false의 레거시 표시 정책은 유지한다. 실제 Dev 신규 시작은
  // start route에서 시간 검증을 생략하므로 24시간 가능하다.
  if (minute !== undefined) {
    if (timeNum >= 1000 && timeNum < 1750) return "round1_day";
    if (timeNum >= 1800 && timeNum < 2400) return "round2_night";
    return null;
  }
  if (hour === curHour) {
    if (timeNum >= 1000 && timeNum < 1750) return "round1_day";
    if (timeNum >= 1800 && timeNum < 2400) return "round2_night";
    return null;
  }
  if (hour >= 10 && hour < 17) return "round1_day";
  if (hour >= 18 && hour < 24) return "round2_night";
  return null;
}
