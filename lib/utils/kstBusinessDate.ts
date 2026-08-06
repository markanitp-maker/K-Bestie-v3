// requests/065-production-business-date-null-recovery-and-prevention.md
// chat_sessions.business_date는 반드시 Asia/Seoul 기준 날짜여야 한다. UTC epoch를 그대로
// 잘라 쓰면 KST 자정 전후 세션이 하루 밀려 저장된다 — Intl.DateTimeFormat으로 타임존
// 변환까지 명시적으로 위임한다(서버 프로세스 자체 TZ 설정에 의존하지 않음).
export function getKstBusinessDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
