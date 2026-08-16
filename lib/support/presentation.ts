/** 접수 상세에서 닫기를 눌렀을 때 항상 돌아갈 목록 경로.
 *  상세에서 목록으로 push하면 history가 [목록, 상세, 목록]이 되어 뒤로가기가 다시
 *  상세로 들어간다. 호출부는 반드시 router.replace로 이 경로를 쓴다. */
export const SUPPORT_REQUEST_LIST_PATH = "/support/requests";

export type SupportRole = "parent" | "child";

export const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  inquiry: "문의", suggestion: "건의", bug: "버그", voc: "문의",
};

export function supportStatusLabel(status: string, role: SupportRole) {
  if (role === "child") {
    return ({ open: "접수됐어", in_progress: "처리하고 있어", resolved: "처리가 끝났어", closed: "확인이 끝났어" } as Record<string, string>)[status] ?? status;
  }
  return ({ open: "접수 완료", in_progress: "처리 중", resolved: "처리 완료", closed: "종료" } as Record<string, string>)[status] ?? status;
}

export function formatSupportDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}년 ${part("month")}월 ${part("day")}일 ${part("hour")}:${part("minute")}`;
}
