import type { RoundType } from "@/lib/mission/selectQuestions";

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

export function currentRound(hour: number, scheduleEnforced: boolean = false, minute?: number): RoundType | null {
  // Authoritative KST operating hours:
  // Mission I: 10:00 <= KST < 17:50
  // Mission II: 18:00 <= KST < 24:00
  if (minute !== undefined) {
    const timeNum = hour * 100 + minute;
    if (timeNum >= 1000 && timeNum < 1750) return "round1_day";
    if (timeNum >= 1800 && timeNum < 2400) return "round2_night";
    return null;
  }
  const { hour: curHour, minute: curMin } = getKstTime();
  if (hour === curHour) {
    const timeNum = curHour * 100 + curMin;
    if (timeNum >= 1000 && timeNum < 1750) return "round1_day";
    if (timeNum >= 1800 && timeNum < 2400) return "round2_night";
    return null;
  }
  if (hour >= 10 && hour < 17) return "round1_day";
  if (hour >= 18 && hour < 24) return "round2_night";
  return null;
}

