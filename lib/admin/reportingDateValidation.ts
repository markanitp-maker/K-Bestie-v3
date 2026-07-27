// codex 리뷰 지적: "YYYY-MM-DD" 정규식만으로는 2026-99-99, 2026-02-30 같은 존재하지
// 않는 날짜도 통과한다. UTC 자정으로 파싱한 뒤 각 필드를 되짚어(round-trip) 실제
// 존재하는 날짜인지 확인한다.
export function isRealCalendarDate(dateStr: string): boolean {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() + 1 === Number(m) &&
    date.getUTCDate() === Number(d)
  );
}
