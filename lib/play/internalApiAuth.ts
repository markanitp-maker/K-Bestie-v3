// 놀이 플랫폼 ↔ 독립 놀이 프로젝트(MBTI 등) 서버간 내부 API 인증 (딥 인터뷰 ③④, Round 8-3)
//
// 이 모듈이 지키는 API는 브라우저가 직접 호출할 수 없어야 한다 — 로그인 세션이 아니라
// 놀이 프로젝트별 서버 전용 비밀키(Authorization: Bearer)로만 인증하고, 타임스탬프
// 허용 오차로 재생(replay) 공격 노출 시간을 제한한다. 진행/완료/닫기/오류처럼 실제
// 부작용이 있는 호출은 별도로 idempotencyKey 중복 방지(play_internal_event_idempotency
// 테이블)까지 적용한다 — 이 파일은 인증만 담당하고 idempotency는 각 라우트가 처리한다.
//
// 놀이 프로젝트가 늘어나면 이 Map에 항목을 추가하면 된다(레지스트리 테이블에는 비밀값을
// 두지 않는다는 원칙 유지 — 비밀값은 항상 서버 전용 환경변수에만 존재).
const INTERNAL_API_KEYS_BY_PLAY_ID: Record<string, string | undefined> = {
  mbti: process.env.MBTI_INTERNAL_API_KEY,
};

/** 타임스탬프 허용 오차(ms) — 이 범위를 벗어난 요청은 재생 공격으로 간주해 거부한다. */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export type InternalAuthResult =
  | { ok: true; playId: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * MBTI 등 독립 놀이 서버가 보낸 요청인지 검증한다. `Authorization: Bearer <key>`,
 * `X-Play-Id: <playId>`, `X-Timestamp: <ISO8601>` 헤더를 확인한다.
 */
export function verifyInternalPlayRequest(req: Request): InternalAuthResult {
  const playId = req.headers.get("x-play-id");
  if (!playId) {
    return { ok: false, status: 401, reason: "missing_play_id" };
  }

  const expectedKey = INTERNAL_API_KEYS_BY_PLAY_ID[playId];
  if (!expectedKey) {
    // 등록되지 않은 playId이거나 서버 env에 키가 설정 안 됨 — 둘 다 인증 실패로 취급.
    return { ok: false, status: 401, reason: "unknown_play_id" };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const providedKey = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!providedKey || providedKey !== expectedKey) {
    return { ok: false, status: 401, reason: "invalid_credentials" };
  }

  const timestampHeader = req.headers.get("x-timestamp");
  if (!timestampHeader) {
    return { ok: false, status: 401, reason: "missing_timestamp" };
  }
  const requestTime = Date.parse(timestampHeader);
  if (Number.isNaN(requestTime) || Math.abs(Date.now() - requestTime) > TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, status: 401, reason: "timestamp_out_of_range" };
  }

  return { ok: true, playId };
}
