import "server-only";

// 퀴즈마스터 프로젝트에서 포팅 — 리더보드 표시용 identity(name/login_id) 조회.
// 퀴즈마스터 원본은 K-Bestie의 사용자 테이블을 볼 수 없어 플레이스홀더(항상 null)로
// 남겨뒀던 부분이다(quiz_submit_attempt는 identity가 null이면 리더보드 upsert만 건너뛰고
// 점수/상태/타이머는 정상 확정한다) — K-Bestie 내부로 포팅된 지금도 login_id에 대응하는
// 필드가 K-Bestie 스키마에 확정돼 있지 않아 동일하게 null로 유지한다(리더보드는 이번
// 포팅 범위 밖의 후속 과제).

export interface LeaderboardIdentity {
  name: string;
  login_id: string;
}

export async function getLeaderboardIdentity(
  userId: string
): Promise<LeaderboardIdentity | null> {
  void userId;
  return null;
}
