// 요청서 012 §3-21, §3-22 — Shadow 계측.
//
// 재는 것: 후보 응답 수, 정규식 차단 수, Risk Gate 판정 분포, 판정 호출 수·결과·지연·오류.
// 재지 않는 것: 아이 대화 원문. 신규 저장소에 원문을 남기지 않는다(§3-22, §5).
// 남는 것은 숫자와 범주 이름뿐이라 로그로 봐도 아이를 식별할 수 없다.

import type { RelationshipRiskCategory } from "./relationshipTaxonomy";
import type { RelationshipRiskLevel } from "./relationshipRiskGate";

export interface RelationshipShadowCounters {
  totalCandidates: number;
  regexViolations: number;
  gateSafe: number;
  gateSuspicious: number;
  gateHighRisk: number;
  judgeCalls: number;
  judgeSafe: number;
  judgeUnsafe: number;
  judgeErrors: number;
  judgeTimeouts: number;
  /** 판정이 unsafe 로 본 범주 분포. */
  categoryCounts: Partial<Record<RelationshipRiskCategory, number>>;
  /** 판정 지연(ms) 목록. p50/p95 계산용. */
  latenciesMs: number[];
}

const counters: RelationshipShadowCounters = {
  totalCandidates: 0,
  regexViolations: 0,
  gateSafe: 0,
  gateSuspicious: 0,
  gateHighRisk: 0,
  judgeCalls: 0,
  judgeSafe: 0,
  judgeUnsafe: 0,
  judgeErrors: 0,
  judgeTimeouts: 0,
  categoryCounts: {},
  latenciesMs: [],
};

/** 지연 표본 상한 — 메모리가 무한정 늘지 않게 한다. */
const MAX_LATENCY_SAMPLES = 500;

export function recordCandidate(level: RelationshipRiskLevel, regexViolation: boolean): void {
  counters.totalCandidates += 1;
  if (regexViolation) counters.regexViolations += 1;
  if (level === "SAFE") counters.gateSafe += 1;
  else if (level === "SUSPICIOUS") counters.gateSuspicious += 1;
  else counters.gateHighRisk += 1;
}

export function recordJudge(result: {
  safeToSend: boolean | null;
  category: RelationshipRiskCategory | null;
  latencyMs: number;
  error: "timeout" | "call_failed" | "parse_failed" | null;
}): void {
  counters.judgeCalls += 1;
  if (result.error === "timeout") counters.judgeTimeouts += 1;
  else if (result.error) counters.judgeErrors += 1;

  if (result.safeToSend === true) counters.judgeSafe += 1;
  if (result.safeToSend === false) {
    counters.judgeUnsafe += 1;
    if (result.category) {
      counters.categoryCounts[result.category] = (counters.categoryCounts[result.category] ?? 0) + 1;
    }
  }

  counters.latenciesMs.push(result.latencyMs);
  if (counters.latenciesMs.length > MAX_LATENCY_SAMPLES) counters.latenciesMs.shift();
}

function percentile(values: readonly number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export interface RelationshipShadowReport extends Omit<RelationshipShadowCounters, "latenciesMs"> {
  judgeLatencyP50: number | null;
  judgeLatencyP95: number | null;
  /** 전체 후보 대비 판정 호출 비율. 비용 추정의 기준값이다. */
  judgeTriggerRate: number;
}

export function getRelationshipShadowReport(): RelationshipShadowReport {
  const { latenciesMs, ...rest } = counters;
  return {
    ...rest,
    categoryCounts: { ...counters.categoryCounts },
    judgeLatencyP50: percentile(latenciesMs, 0.5),
    judgeLatencyP95: percentile(latenciesMs, 0.95),
    judgeTriggerRate:
      counters.totalCandidates === 0 ? 0 : counters.judgeCalls / counters.totalCandidates,
  };
}

export function resetRelationshipShadowCounters(): void {
  counters.totalCandidates = 0;
  counters.regexViolations = 0;
  counters.gateSafe = 0;
  counters.gateSuspicious = 0;
  counters.gateHighRisk = 0;
  counters.judgeCalls = 0;
  counters.judgeSafe = 0;
  counters.judgeUnsafe = 0;
  counters.judgeErrors = 0;
  counters.judgeTimeouts = 0;
  counters.categoryCounts = {};
  counters.latenciesMs = [];
}

/**
 * 한 턴의 Shadow 결과를 로그로 남긴다. 원문 대신 길이와 범주만 남긴다.
 * 서버 로그에서 grep 하기 쉽도록 접두어를 고정한다.
 */
export function logShadowTurn(entry: {
  sessionId: string;
  mode: string;
  level: RelationshipRiskLevel;
  regexViolation: boolean;
  markers: readonly string[];
  judge?: {
    safeToSend: boolean | null;
    category: RelationshipRiskCategory | null;
    severity: string | null;
    confidence: number | null;
    latencyMs: number;
    error: string | null;
  };
  candidateLength: number;
}): void {
  console.log(
    "[relationship-shadow]",
    JSON.stringify({
      sessionId: entry.sessionId,
      mode: entry.mode,
      level: entry.level,
      regexViolation: entry.regexViolation,
      markers: entry.markers,
      candidateLength: entry.candidateLength,
      judge: entry.judge ?? null,
    })
  );
}
