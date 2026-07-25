// 퀴즈마스터 프로젝트에서 포팅 — 버그 신고 요청 바디 검증. user_id는 이 타입에 없다 -
// 라우트가 항상 인증 세션에서 직접 도출해야 하며 클라이언트가 보낸 값을 신뢰하지 않는다.

export interface BugReportInput {
  session_id: string | null;
  location: string;
  error_code: string;
  detail_log: string | null;
  block_reason: string | null;
}

export type ParseBugReportResult =
  | { ok: true; data: BugReportInput }
  | { ok: false; error: string };

export const KNOWN_BUG_REPORT_LOCATIONS = [
  "redeem",
  "subject_select",
  "quiz_engine",
  "submit",
] as const;

function nullableString(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === "string" ? value : undefined;
}

export function parseBugReportPayload(body: unknown): ParseBugReportResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.location !== "string" || b.location.trim() === "") {
    return { ok: false, error: "`location` is required and must be a non-empty string." };
  }
  if (typeof b.error_code !== "string" || b.error_code.trim() === "") {
    return { ok: false, error: "`error_code` is required and must be a non-empty string." };
  }

  const session_id = nullableString(b.session_id);
  if (session_id === undefined) {
    return { ok: false, error: "`session_id` must be a string or null." };
  }

  const detail_log = nullableString(b.detail_log);
  if (detail_log === undefined) {
    return { ok: false, error: "`detail_log` must be a string or null." };
  }

  const block_reason = nullableString(b.block_reason);
  if (block_reason === undefined) {
    return { ok: false, error: "`block_reason` must be a string or null." };
  }

  return {
    ok: true,
    data: {
      session_id,
      location: b.location,
      error_code: b.error_code,
      detail_log,
      block_reason,
    },
  };
}
