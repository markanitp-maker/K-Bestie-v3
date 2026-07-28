import type { RoundType } from "@/lib/mission/selectQuestions";

// app/child/missions/page.tsx의 기존 운영시간 게이트를 그대로 추출한 것 — 값을 바꾸지 않았다.
// 이전에 app/child/home/page.tsx와 app/api/mission/today-progress/route.ts가 각자
// 13~19시/19~23시(미만)로 새로 지어내 실제 정책(13~17시/19~23시 포함)과 어긋난 적이 있어
// 이 파일 하나로 통일한다.
export function getKstHour(): number {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 3600000).getHours();
}

export function currentRound(hour: number): RoundType | null {
  if (hour >= 13 && hour < 17) return "round1_day";
  if (hour >= 19 && hour <= 23) return "round2_night";
  return null;
}
