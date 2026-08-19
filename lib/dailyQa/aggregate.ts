// 요청서 019 §3-4, §3-12, §3-13 — 탐지 결과를 이슈 행으로 묶는다.
//
// 순수 함수로 둔다. DB 나 LLM 을 타지 않으므로 실제 운영 데이터 없이도 규칙을 고정할 수 있다.

import {
  DAILY_QA_EXCERPT_MAX_CHARS,
  DAILY_QA_MAX_EXAMPLES,
  findDailyQaTaxonomy,
  type DailyQaSeverity,
} from "./taxonomy";
import type { DailyQaDetection } from "./ruleDetectors";

export interface DailyQaIssueDraft {
  taxonomyCode: string;
  severity: DailyQaSeverity;
  title: string;
  eventCount: number;
  affectedChildrenCount: number;
  affectedSessionsCount: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  representativeExamples: { sessionId: string; messageId: string; excerpt: string }[];
  sessionIds: string[];
  messageIds: string[];
}

function truncateExcerpt(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= DAILY_QA_EXCERPT_MAX_CHARS) return trimmed;
  return trimmed.slice(0, DAILY_QA_EXCERPT_MAX_CHARS);
}

/**
 * 탐지 결과를 taxonomy 별로 한 줄씩 묶는다.
 *
 * [대표 사례를 3개로 제한하는 이유 (§3-13)]
 * 전체 대화를 신규 테이블에 복제하지 않는다. 이슈가 몇 건이든 저장하는 excerpt 는
 * 최대 3개다. 나머지는 session_ids/message_ids 로 원문을 찾아가면 된다.
 *
 * [대표 사례를 무엇으로 고르는가]
 * 처음 3건이 아니라 **서로 다른 세션** 을 우선한다. 같은 세션에서 3번 터진 것을
 * 3개 보여주면 "한 아이한테만 나는 문제" 인지 "여러 아이한테 나는 문제" 인지 구분이 안 된다.
 */
export function aggregateDetections(detections: readonly DailyQaDetection[]): DailyQaIssueDraft[] {
  const byCode = new Map<string, DailyQaDetection[]>();
  for (const detection of detections) {
    const list = byCode.get(detection.taxonomyCode);
    if (list) list.push(detection);
    else byCode.set(detection.taxonomyCode, [detection]);
  }

  const drafts: DailyQaIssueDraft[] = [];
  for (const [code, items] of byCode) {
    const taxonomy = findDailyQaTaxonomy(code);
    // 모르는 코드는 버리지 않는다 — 버리면 탐지기가 새 코드를 내기 시작했을 때
    // 아무도 모르는 채로 이슈가 사라진다. LOW 로 올려 두고 화면에서 보이게 한다.
    const severity: DailyQaSeverity = taxonomy?.defaultSeverity ?? "LOW";
    const title = taxonomy?.label ?? code;

    const sorted = [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const sessionIds = [...new Set(sorted.map((item) => item.sessionId))];
    const childIds = new Set(sorted.map((item) => item.childId));
    const messageIds = [...new Set(sorted.map((item) => item.messageId))];

    // 서로 다른 세션을 먼저 채우고, 그래도 자리가 남으면 나머지에서 채운다.
    const examples: DailyQaIssueDraft["representativeExamples"] = [];
    const usedSessions = new Set<string>();
    for (const item of sorted) {
      if (examples.length >= DAILY_QA_MAX_EXAMPLES) break;
      if (usedSessions.has(item.sessionId)) continue;
      usedSessions.add(item.sessionId);
      examples.push({
        sessionId: item.sessionId,
        messageId: item.messageId,
        excerpt: truncateExcerpt(item.excerpt),
      });
    }
    for (const item of sorted) {
      if (examples.length >= DAILY_QA_MAX_EXAMPLES) break;
      if (examples.some((example) => example.messageId === item.messageId)) continue;
      examples.push({
        sessionId: item.sessionId,
        messageId: item.messageId,
        excerpt: truncateExcerpt(item.excerpt),
      });
    }

    drafts.push({
      taxonomyCode: code,
      severity,
      title,
      eventCount: sorted.length,
      affectedChildrenCount: childIds.size,
      affectedSessionsCount: sessionIds.length,
      firstDetectedAt: sorted[0].occurredAt,
      lastDetectedAt: sorted[sorted.length - 1].occurredAt,
      representativeExamples: examples,
      sessionIds,
      messageIds,
    });
  }

  return drafts;
}
