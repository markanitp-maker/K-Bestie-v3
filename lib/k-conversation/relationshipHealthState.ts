// 요청서 012 §3-11 ~ §3-13 — Relationship Health State.
//
// 한 문장만 보면 약한 신호도 여러 턴 쌓이면 관계가 기울어진다. 그래서 세션 단위로 신호를 누적한다.
// 장기 Memory 에 저장하지 않는다(§3-12, §5) — 프로세스 안에서만 살고, 세션이 끝나거나
// 오래되면 사라진다. 저장하는 것은 범주별 횟수와 시각뿐이고 대화 원문은 담지 않는다(§3-22).

import type { RelationshipRiskCategory } from "./relationshipTaxonomy";

export interface RelationshipHealthSnapshot {
  sessionId: string;
  /** 범주별 누적 신호 수. */
  counts: Partial<Record<RelationshipRiskCategory, number>>;
  /** 이 세션에서 본 K 응답 수. */
  turns: number;
  /** 마지막 갱신(ms). */
  updatedAt: number;
}

/** 같은 범주가 이 횟수 이상 반복되면 다음 턴을 SUSPICIOUS 로 올린다(§3-13). */
export const MULTI_TURN_RISK_THRESHOLD = 2;

/** 이 시간 동안 갱신이 없으면 상태를 버린다(세션 종료 신호를 못 받는 경우 대비). */
export const HEALTH_STATE_TTL_MS = 60 * 60 * 1000;

/** 메모리 상한 — 서버 인스턴스 하나가 들고 있을 세션 수. 넘치면 오래된 것부터 버린다. */
const MAX_TRACKED_SESSIONS = 500;

const store = new Map<string, RelationshipHealthSnapshot>();

function prune(now: number): void {
  for (const [sessionId, snapshot] of store) {
    if (now - snapshot.updatedAt > HEALTH_STATE_TTL_MS) store.delete(sessionId);
  }
  if (store.size <= MAX_TRACKED_SESSIONS) return;
  const oldestFirst = [...store.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  for (const [sessionId] of oldestFirst.slice(0, store.size - MAX_TRACKED_SESSIONS)) {
    store.delete(sessionId);
  }
}

export function getRelationshipHealth(
  sessionId: string,
  now: number = Date.now()
): RelationshipHealthSnapshot {
  const existing = store.get(sessionId);
  if (existing && now - existing.updatedAt <= HEALTH_STATE_TTL_MS) return existing;
  const fresh: RelationshipHealthSnapshot = { sessionId, counts: {}, turns: 0, updatedAt: now };
  store.set(sessionId, fresh);
  return fresh;
}

/** K 응답 한 턴을 반영한다. categories 가 비어 있어도 turns 는 증가한다. */
export function recordRelationshipSignals(
  sessionId: string,
  categories: readonly RelationshipRiskCategory[],
  now: number = Date.now()
): RelationshipHealthSnapshot {
  const snapshot = getRelationshipHealth(sessionId, now);
  snapshot.turns += 1;
  for (const category of categories) {
    snapshot.counts[category] = (snapshot.counts[category] ?? 0) + 1;
  }
  snapshot.updatedAt = now;
  store.set(sessionId, snapshot);
  prune(now);
  return snapshot;
}

/** 임계치를 넘긴 범주들. 비어 있으면 누적 위험 없음. */
export function accumulatedRiskCategories(
  snapshot: RelationshipHealthSnapshot,
  threshold: number = MULTI_TURN_RISK_THRESHOLD
): RelationshipRiskCategory[] {
  return (Object.entries(snapshot.counts) as Array<[RelationshipRiskCategory, number]>)
    .filter(([, count]) => count >= threshold)
    .map(([category]) => category);
}

/** 세션이 끝나면 버린다. */
export function clearRelationshipHealth(sessionId: string): void {
  store.delete(sessionId);
}

/** 테스트 전용 — 상태를 비운다. */
export function resetRelationshipHealthStoreForTest(): void {
  store.clear();
}
