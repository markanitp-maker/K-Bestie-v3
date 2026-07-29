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

// 031: scheduleEnforced는 명시적 인자로만 받는다(내부에서 process.env를 직접 읽지
// 않음) — 이 파일은 클라이언트 번들에도 포함되는데, NEXT_PUBLIC_ 접두어가 없는
// 환경변수는 Next.js가 클라이언트 빌드 시 항상 undefined로 치환하므로 여기서 직접
// 읽으면 서버(Production 실제 값)와 클라이언트(항상 false)의 판정이 어긋난다.
// 서버(API route)에서 isMissionScheduleEnforced()로 계산한 값을 그대로 넘기고,
// 클라이언트는 서버 응답에 담긴 값을 사용하도록 해 판정 주체를 서버로 통일한다.
export function currentRound(hour: number, scheduleEnforced: boolean = false): RoundType | null {
  if (scheduleEnforced) {
    if (hour >= 12 && hour < 17) return "round1_day";
    if (hour >= 19 && hour < 23) return "round2_night";
    return null;
  }
  if (hour >= 13 && hour < 17) return "round1_day";
  if (hour >= 19 && hour <= 23) return "round2_night";
  return null;
}
