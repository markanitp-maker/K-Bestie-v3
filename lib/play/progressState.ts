/**
 * 게임 참여 공통 인프라 — k_play_sessions.progress_state 네임스페이스 유틸
 *
 * `progress_state`는 4종 놀이(comic_book/quiz/mbti/hairstyle)가 공유하는 애플리케이션
 * 정의 JSONB 컬럼이다. 각 놀이의 상세 진행 상태(문항 인덱스, 선택지 등 게임마다 다른
 * shape)는 `progress_state.<playType>` 네임스페이스 아래에만 쓰고, 루트의
 * `progressPercent`(app/api/play/progress/route.ts가 모든 놀이 타입에 공통으로 쓰는
 * 범용 진행률 필드)와는 절대 충돌하지 않게 분리한다 — MBTI에서 실제로 겪은
 * "progress_state 통째 덮어쓰기로 다른 필드가 사라지는" 버그의 재발을 구조적으로
 * 막기 위한 것이다. 신규 놀이 타입을 추가할 때도 이 모듈만 재사용하면 같은 실수를
 * 반복하지 않는다.
 */

/** progress_state 원시 JSONB 값을 안전한 객체로 정규화한다(비객체/null이면 빈 객체). */
export function readProgressStateObject(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

/** progress_state에서 특정 놀이 타입의 네임스페이스만 안전하게 꺼낸다(없으면 빈 객체). */
export function readNamespace(raw: unknown, playType: string): Record<string, unknown> {
  const root = readProgressStateObject(raw);
  return readProgressStateObject(root[playType]);
}

/**
 * 다음 progress_state를 조립한다 — 기존 루트 필드(다른 네임스페이스, progressPercent
 * 등)는 그대로 보존하고, 지정한 네임스페이스만 통째로 교체하며, rootPatch로 넘긴
 * 루트 레벨 필드(예: `{ progressPercent }`)만 함께 갱신한다.
 *
 * 네임스페이스 내부를 "완전 교체"할지 "기존 필드와 병합"할지는 호출부 책임이다
 * (예: 진행 저장은 answers 배열이 이미 누적값이라 완전 교체가 맞고, 완료 처리는
 * questionIndex/answers 같은 이전 필드를 보존한 채 mbtiType 등만 얹는 병합이 맞다 —
 * 두 경우 모두 호출부가 `readNamespace`로 기존 값을 읽어 원하는 대로 합친 뒤
 * `namespaceValue`로 넘기면 된다).
 */
export function buildProgressState(
  existingRaw: unknown,
  playType: string,
  namespaceValue: Record<string, unknown>,
  rootPatch?: Record<string, unknown>,
): Record<string, unknown> {
  const existing = readProgressStateObject(existingRaw);
  return {
    ...existing,
    ...rootPatch,
    [playType]: namespaceValue,
  };
}

/** progress_state->{playType}->>progressVersion CAS 비교용 PostgREST 필터 컬럼 표현식. */
export function progressVersionCasColumn(playType: string): string {
  return `progress_state->${playType}->>progressVersion`;
}

/** progress_state->{playType}가 아직 없음(null)을 확인하는 PostgREST 필터 컬럼 표현식. */
export function namespaceNullColumn(playType: string): string {
  return `progress_state->${playType}`;
}

export type SaveProgressResult =
  | { applied: true }
  | { applied: false; reason: "stale_progress_version" | "progress_version_conflict" }
  | { applied: false; reason: "internal_error"; error: unknown };

/**
 * 버전 CAS(progressVersion)로 보호된 진행 상태 저장. 조회 시점 storedVersion을 그대로
 * WHERE 절에 재확인시켜, 조회~쓰기 사이에 다른 요청이 먼저 갱신했다면 이 쓰기는
 * 조용히 무시된다(둘 다 오류가 아니라 "이 요청은 최신이 아니다"라는 정상 결과).
 *
 * @param service Supabase service-role 클라이언트
 * @param sessionId 대상 세션
 * @param playType 네임스페이스 키(예: "mbti")
 * @param storedVersion 조회 시점에 읽은 progressVersion(없었으면 null — 버전 비교
 *   자체는 0으로 취급하되, CAS UPDATE의 WHERE 절 분기(.is vs .eq)에는 null 여부를
 *   그대로 쓴다 — "네임스페이스가 아예 없던 최초 저장"과 "버전 0이 저장돼 있던
 *   저장"을 구분해야 하기 때문. 원본 MBTI 라우트의
 *   `storedVersion = storedProgress?.progressVersion ?? 0` 관용구와 동일한 결과를
 *   내도록 설계했다 — progressVersion<=0인 요청은 최초 저장이라도 stale로 조기 거부된다.
 * @param requestVersion 이번 요청이 저장하려는 progressVersion
 * @param nextProgressState buildProgressState로 미리 조립한 다음 progress_state 전체
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase 쿼리 빌더 제네릭을 그대로 받기 위함
export async function saveProgressWithVersionCas(
  service: any,
  sessionId: string,
  playType: string,
  storedVersion: number | null,
  requestVersion: number,
  nextProgressState: Record<string, unknown>,
): Promise<SaveProgressResult> {
  if (requestVersion <= (storedVersion ?? 0)) {
    return { applied: false, reason: "stale_progress_version" };
  }

  let updateQuery = service
    .from("k_play_sessions")
    .update({ progress_state: nextProgressState })
    .eq("id", sessionId)
    .eq("status", "in_progress");

  updateQuery =
    storedVersion === null
      ? updateQuery.is(namespaceNullColumn(playType), null)
      : updateQuery.eq(progressVersionCasColumn(playType), String(storedVersion));

  const { data, error } = await updateQuery.select("id");

  if (error) {
    return { applied: false, reason: "internal_error", error };
  }
  if (!data || data.length === 0) {
    return { applied: false, reason: "progress_version_conflict" };
  }
  return { applied: true };
}
