// 요청서 019 §3-7, §3-8 — LLM Judge 에 넘길 최소 문맥을 만든다.
//
// [전체 대화를 통째로 넘기지 않는다]
// 요청서가 명시적으로 금지했다. 이유는 비용만이 아니다 — 아이 대화 전문을 매일
// 외부 모델에 통째로 보내는 것은 아이 프라이버시 측면에서도 해서는 안 되는 일이다.
// 판정에 필요한 최소 구간(직전 2~3턴 + 후보 턴 + 직후 1~2턴)만 자른다.

import type { DailyQaMessage } from "./ruleDetectors";

/** 후보 턴 앞뒤로 자를 턴 수(§3-8). */
export const JUDGE_CONTEXT_BEFORE_TURNS = 3;
export const JUDGE_CONTEXT_AFTER_TURNS = 2;

export interface JudgeContextTurn {
  role: "child" | "k";
  text: string;
  /** 판정 대상 턴인지. 프롬프트에서 어느 턴을 보라고 지목하는 데 쓴다. */
  isCandidate: boolean;
}

export interface JudgeContext {
  taxonomyCode: string;
  sessionId: string;
  childId: string;
  candidateMessageId: string;
  mode: "mission" | "free_chat";
  turns: JudgeContextTurn[];
}

/**
 * 후보 메시지 주변 문맥만 잘라 낸다.
 *
 * messages 는 **한 세션의** 메시지여야 한다. 세션이 섞이면 남의 대화가 문맥으로 들어간다.
 * 시간순 정렬은 이 함수가 직접 한다 — 호출자가 정렬을 보장했다고 믿지 않는다.
 */
export function buildJudgeContext(
  taxonomyCode: string,
  sessionMessages: readonly DailyQaMessage[],
  candidateMessageId: string,
): JudgeContext | null {
  const sorted = [...sessionMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const index = sorted.findIndex((message) => message.id === candidateMessageId);
  // 후보를 못 찾으면 문맥을 지어내지 않는다. 판정을 건너뛰는 것이 맞다.
  if (index === -1) return null;

  const candidate = sorted[index];
  const start = Math.max(0, index - JUDGE_CONTEXT_BEFORE_TURNS);
  const end = Math.min(sorted.length, index + JUDGE_CONTEXT_AFTER_TURNS + 1);

  return {
    taxonomyCode,
    sessionId: candidate.sessionId,
    childId: candidate.childId,
    candidateMessageId,
    mode: candidate.mode,
    turns: sorted.slice(start, end).map((message) => ({
      role: message.role,
      text: message.content,
      isCandidate: message.id === candidateMessageId,
    })),
  };
}

/**
 * Judge 프롬프트. 판정만 시키고 설명을 길게 받지 않는다 — 관리자 화면에 쓰는 것은
 * 판정과 짧은 근거뿐이고, 긴 자유 서술은 비용만 늘리고 재현성을 떨어뜨린다.
 */
export function buildJudgePrompt(context: JudgeContext, taxonomyDescription: string): string {
  const transcript = context.turns
    .map((turn) => {
      const who = turn.role === "child" ? "아이" : "케이";
      const marker = turn.isCandidate ? " ← 판정 대상" : "";
      return `${who}: ${turn.text}${marker}`;
    })
    .join("\n");

  return [
    "너는 아동용 대화 서비스의 품질 검수자다.",
    "아래 대화 조각에서 '판정 대상' 으로 표시된 케이 턴에 지적한 문제가 실제로 있는지 판정해라.",
    "",
    `[검사할 문제] ${taxonomyDescription}`,
    `[대화 모드] ${context.mode === "mission" ? "미션" : "자유대화"}`,
    "",
    "[대화 조각]",
    transcript,
    "",
    "[판정 규칙]",
    "- CONFIRMED: 문제가 명확히 있다.",
    "- LIKELY: 문제로 보이지만 앞뒤 문맥이 더 필요하다.",
    "- FALSE_POSITIVE: 문제가 아니다.",
    "- 애매하면 FALSE_POSITIVE 로 판정해라. 잘못된 지적이 놓친 지적보다 나쁘다 —",
    "  운영자가 없는 문제를 쫓게 만들면 진짜 문제를 볼 시간이 줄어든다.",
    "",
    "[출력 형식] 다음 JSON 만 출력해라. 다른 말을 덧붙이지 마라.",
    '{"verdict":"CONFIRMED|LIKELY|FALSE_POSITIVE","reason":"한 문장"}',
  ].join("\n");
}

/** 모델 응답에서 판정을 뽑는다. 형식이 어긋나면 FALSE_POSITIVE 로 떨어뜨린다. */
export function parseJudgeResponse(text: string): { verdict: "CONFIRMED" | "LIKELY" | "FALSE_POSITIVE"; reason: string } {
  const fallback = { verdict: "FALSE_POSITIVE" as const, reason: "판정 응답을 해석하지 못했다" };
  if (!text) return fallback;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]) as { verdict?: unknown; reason?: unknown };
    if (parsed.verdict !== "CONFIRMED" && parsed.verdict !== "LIKELY" && parsed.verdict !== "FALSE_POSITIVE") {
      return fallback;
    }
    return {
      verdict: parsed.verdict,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
    };
  } catch {
    return fallback;
  }
}
