// 끝말잇기 낱말 판정 — 사전이 모르는 낱말을 LLM 이 판정한다.
//
// 2026-08-20 대표님 실사용 지시:
//   "게임 방법도 모르고, 아는 단어도 부족하고, LLM 연동해서 끝말잇기 진행하라니까"
//
// 실측된 거절 사례: `이빨`, `이사`, `전선생`. 사전은 1810 낱말이라 아이가 흔히 쓰는
// 말도 자주 없다. 아이 입장에서는 케이가 말을 모르는 것으로 보인다.
//
// **역할 분담은 유지한다(010 §0).** 끝글자 규칙·차례·다음 낱말은 여전히 엔진이
// 결정론으로 정한다 — 그건 객관적 규칙이라 LLM 에 맡길 이유가 없다. LLM 이 맡는 것은
// 딱 하나, "이게 한국어 낱말인가?" 라는 사실 판단뿐이다. 그래서 케이가 게임을
// 지어내는 일(010 이 막으려던 것)은 생기지 않는다.
//
// 실패는 삼킨다. 판정을 못 받으면 사전 결과를 그대로 쓴다 — 놀이가 멈추면 안 된다.

import { extractJSON } from "@/app/api/_lib/utils";
import { getLlmModel } from "@/lib/llm/modelRouter";
import type { GenerateContentFn } from "../responseGenerator";

export interface WordJudgeVerdict {
  /** 한국어에 실제로 있는 낱말인가. */
  isRealWord: boolean;
  /** 초등학생이 알 만한 말인가. 아니어도 낱말이면 받아 준다. */
  childFriendly: boolean;
  /** 아이에게 보여도 되는 말인가. false 면 받지 않는다. */
  safeForChild: boolean;
}

export interface WordJudgeResult {
  verdict: WordJudgeVerdict | null;
  latencyMs: number;
  error: "timeout" | "call_failed" | "parse_failed" | null;
}

/** 판정 제한 시간. 넘으면 사전 결과로 돌아간다 — 아이를 기다리게 하지 않는다. */
export const WORD_JUDGE_TIMEOUT_MS = 1800;

export interface JudgeWordInput {
  ai: { models: { generateContent: GenerateContentFn } };
  /** 아이가 낸 낱말. */
  word: string;
  /** 이어야 하는 첫 글자. 판정에는 쓰지 않고 맥락으로만 준다. */
  requiredSyllable?: string;
  modelId?: string;
  timeoutMs?: number;
}

const buildInstruction = (): string =>
  [
    "너는 초등학생 끝말잇기에서 아이가 말한 낱말이 실제 한국어 낱말인지 판정한다.",
    "낱말을 새로 만들거나 고치지 마라. 판정만 한다.",
    "끝말잇기 규칙(끝 글자 이어짐)은 판정하지 마라 — 그건 다른 곳에서 이미 본다.",
    "",
    "[낱말로 인정할 것]",
    "- 표준어 명사. 사전에 오르는 말이면 아이가 잘 안 쓰는 말이어도 인정한다.",
    "- 아이들이 흔히 쓰는 입말(예: 이빨, 배꼽, 방귀).",
    "- 동식물·음식·물건·장소·사람 이름이 되는 일반 명사.",
    "",
    "[인정하지 않을 것]",
    "- 지어낸 말, 뜻이 없는 소리, 오타로 깨진 말.",
    "- 문장·구절(두 낱말 이상), 조사나 어미만 붙은 조각.",
    "- 사람 이름·상호처럼 고유명사인 것.",
    "",
    "[safeForChild 를 false 로 둘 것]",
    "- 욕설·비속어, 성적인 말, 폭력·자해를 가리키는 말.",
    "",
    "반드시 아래 JSON 객체 하나만 출력한다. 설명·코드펜스 금지.",
    '{"isRealWord":true,"childFriendly":true,"safeForChild":true}',
  ].join("\n");

function parseVerdict(value: unknown): WordJudgeVerdict | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { isRealWord, childFriendly, safeForChild } = value as Record<string, unknown>;
  if (typeof isRealWord !== "boolean") return null;
  return {
    isRealWord,
    childFriendly: typeof childFriendly === "boolean" ? childFriendly : true,
    // 안전 판단이 빠져 있으면 안전하다고 가정하지 않는다.
    safeForChild: typeof safeForChild === "boolean" ? safeForChild : false,
  };
}

/**
 * 낱말 판정. 실패해도 예외를 던지지 않는다 — 호출부가 사전 결과로 돌아간다.
 */
export async function judgeWordChainWord(input: JudgeWordInput): Promise<WordJudgeResult> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? WORD_JUDGE_TIMEOUT_MS;
  const modelId = input.modelId ?? getLlmModel("wordChainWordJudge");
  const word = input.word.trim();

  if (!word) {
    return { verdict: null, latencyMs: 0, error: "parse_failed" };
  }

  const context = [
    input.requiredSyllable ? `[이어야 하는 첫 글자] ${input.requiredSyllable}` : "",
    `[아이가 말한 낱말] ${word.slice(0, 40)}`,
  ]
    .filter(Boolean)
    .join("\n");

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const call = input.ai.models.generateContent({
      model: modelId,
      contents: [{ role: "user", parts: [{ text: context }] }],
      config: {
        systemInstruction: buildInstruction(),
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("word-judge-timeout")), timeoutMs);
    });

    const response = await Promise.race([call, timeout]);
    const text = (response as { text?: string })?.text ?? "";
    let parsed: unknown = null;
    try {
      parsed = extractJSON(text);
    } catch {
      return { verdict: null, latencyMs: Date.now() - startedAt, error: "parse_failed" };
    }
    const verdict = parseVerdict(parsed);
    return {
      verdict,
      latencyMs: Date.now() - startedAt,
      error: verdict ? null : "parse_failed",
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message === "word-judge-timeout";
    return {
      verdict: null,
      latencyMs: Date.now() - startedAt,
      error: isTimeout ? "timeout" : "call_failed",
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * 판정 결과를 "받아 줄지" 로 바꾼다.
 *
 * 낱말이고 안전하면 받는다. 아이가 잘 안 쓰는 말이어도 받는다 — 사전에 없다는
 * 이유로 거절당하는 경험이 훨씬 나쁘다.
 */
export function shouldAcceptJudgedWord(verdict: WordJudgeVerdict | null): boolean {
  if (!verdict) return false;
  return verdict.isRealWord && verdict.safeForChild;
}
