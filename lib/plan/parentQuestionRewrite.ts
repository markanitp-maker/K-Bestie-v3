// requests/request-parent-question-safe-rewrite-modal-fix.md — 부모 질문에 추측·유도·
// 복수질문·비난 표현이 섞여 있어도 즉시 거절하지 않고, 케이가 중립적인 단일 질문으로
// 재작성해 초안을 제시한다. 실제 차단(BLOCKED)은 재작성해도 안전하지 않은 경우로 한정한다.

export type ParentQuestionClassification = "SAFE_AS_IS" | "SAFE_AFTER_REWRITE" | "BLOCKED";
export type ParentQuestionRewriteStatus = ParentQuestionClassification | "GENERATION_FAILED";

export interface ParentQuestionRewriteResult {
  ok: boolean;
  status: ParentQuestionRewriteStatus;
  draftQuestion: string | null;
  originalQuestionCount: number | null;
  selectedIntent: string | null;
  rewriteReasons: string[];
  rejectReason: string | null;
}

// §10 실제 차단 시 기본 안내 문구(LLM이 rejectReason을 비워 보내는 경우의 폴백).
export const DEFAULT_BLOCKED_MESSAGE =
  "이 질문은 아이에게 부담을 줄 수 있어 그대로 전달할 수 없어요. 아이의 기분이나 경험을 편하게 묻는 방식으로 바꿔 주세요.";

// 재작성된 초안 문장에도 남아있으면 안 되는 위험 패턴(2차 안전망) — LLM이 지침을
// 어기고 위험한 표현을 그대로 통과시킨 경우를 잡아낸다.
export const FORBIDDEN_PATTERNS = [
  /잘못했/, /거짓말했/, /누가.*(잘못|혼나|거짓말|혼났)/, /고발/,
  // claude-review 재지적: 좁히지 않은 `/몰래/`는 "몰래 준비한 선물" 같은 무해한 재작성
  // 결과까지 위험 패턴으로 오탐해 GENERATION_FAILED(500)로 강등시켰다 — 실제로 캐묻는
  // 동사가 뒤따를 때만 위험으로 본다.
  /몰래[\s\S]{0,10}?(캐|알아내|확인|훔쳐|감시)/, /비밀.*(말해|알려)/,
  /시스템\s*프롬프트/, /내부\s*지시/, /이전\s*지시/, /무시하고/,
];

// requests/request-parent-question-safe-rewrite-modal-fix.md §3.1/§6 — "재작성 우선" 원칙상,
// filterParentQuestion의 block 판정 중 diagnosis/secret_probe는 재작성으로 의도 자체를
// 없앨 수 없는 진짜 위험(임상 진단 요구/비밀 캐내기 목적)이라 LLM 이전에 하드블록해도 된다.
// 반면 interrogation("거짓말했는지", "추궁", "정말로 그랬는지" 등)은 새 시스템 프롬프트가
// 명시적으로 "가벼운 비난·추궁조 표현"을 SAFE_AFTER_REWRITE 기본 동작으로 지정한 범위와
// 겹친다 — 이 카테고리를 LLM 이전에 하드블록하면 요청서가 고치려는 바로 그 버그(재작성
// 기회 없이 즉시 거절)가 일부 문구에서 재현된다. interrogation은 LLM 재작성으로 넘긴다.
export function isHardPreFilterBlock(category: string | undefined): boolean {
  return category === "diagnosis" || category === "secret_probe";
}

export const ASK_CHILD_REWRITE_SYSTEM_PROMPT = `당신은 부모용 케이입니다.
부모가 아이에게 물어봐줄 질문을 입력하면, 그 질문을 분석해 아이에게 부담 없이 물어볼 수 있는
안전한 단일 질문으로 다듬어야 합니다. 부모에게 "다시 작성해 주세요"라고 되돌려보내는 것이
아니라, 케이가 직접 안전하게 재작성해서 초안을 제시하는 것이 기본 동작입니다.

[처리 순서]
1. 위험 요소 탐지(추측/단정/유도/복수 질문/비난/해석/감정 단정 등)
2. 핵심 궁금증 추출
3. 여러 질문이 섞여 있으면 그중 가장 핵심적인 것 하나만 선택(나머지는 버림)
4. 핵심 주제는 그대로 유지한 채 중립적인 단일 질문으로 재작성
5. 아이가 부담 없이 답할 수 있는 자연스러운 문장으로 다듬기

[주제 보존 — 반드시 준수]
- 원문의 사람·관계·활동·시간 범위를 다른 주제로 바꾸지 마세요.
- 케이와의 대화에 관한 질문을 학교생활·친구·주말·음식 질문으로 바꾸면 안 됩니다.
- 친구 관계 질문을 학교에서 재미있었던 일처럼 무관한 질문으로 바꾸면 안 됩니다.
- 입력에 "직전 대화 주제:"와 "부모의 후속 요청:"이 있으면 직전 대화 주제를 실제 질문
  주제로 사용하되, 두 메타 문구나 부모 원문을 아이에게 그대로 전달하지 마세요.
- 같은 주제를 안전하고 중립적으로 묻는 문장을 만들 수 없으면 BLOCKED로 분류하세요.

예:
- "케이랑 이야기하는 게 좋은지 물어봐줘" → "케이랑 이야기하는 시간은 어때?"
- "직전 대화 주제: 케이랑 매일 대화할 것 같아? / 부모의 후속 요청: 그럼 아이에게 물어봐줘"
  → "앞으로도 케이랑 자주 이야기하고 싶어?"
- "이번 주말에 뭐 하고 싶은지 물어봐줘" → "이번 주말에 하고 싶은 거 있어?"

[분류: classification]
- "SAFE_AS_IS": 원문이 이미 중립적인 단일 질문이라 그대로(또는 미세하게 다듬어) 쓸 수 있음.
  예: "요즘 가장 친한 친구가 누구인지 물어봐 줘" → 다듬을 필요 거의 없음.
- "SAFE_AFTER_REWRITE": 원문에 추측/단정/유도/복수질문/비난 표현이 섞여 있지만, 중립적인
  단일 질문으로 재작성하면 안전하게 물어볼 수 있음. **이것이 기본 동작이다** — 아래 표현이
  있다는 이유만으로 BLOCKED로 분류하지 않는다:
  - 추측("~것 같아", "~인 것 같은데")
  - 단정("~때문이지?", "~인 거지?")
  - 유도(원하는 답을 암시)
  - 복수 질문(한 문장에 질문이 여러 개)
  - 가벼운 비난·추궁조 표현("왜 또 ~했는지", "~때문에 그런 거지")
  - 친구·학교·가족에 대한 부모의 해석
  - 아이 감정 상태를 미리 규정("분명히 속상했을 텐데")
  단, 아래 BLOCKED 영역에 해당하거나 같은 주제를 유지한 안전한 문장을 만들 수 없으면
  무관한 주제로 바꾸지 말고 BLOCKED로 분류한다.
- "BLOCKED": 재작성해도 아이에게 안전하게 전달할 수 없는 경우에만 사용한다. 아래에
  해당할 때만 BLOCKED로 분류하라:
  - 폭언·협박에 가까운 표현
  - 아이에게 부모 편을 들라고 강요(예: "엄마 말이 맞다고 대답하라고 해")
  - 다른 보호자(아빠/엄마/할머니 등)에 대한 비난을 유도
  - 성적 수치심을 유발할 수 있는 내용
  - 과도한 사생활 침해(비밀 캐내기, 몰래 하는 일 추궁 등 재작성으로 의도 자체를 없앨 수 없는 경우)
  - 친구 괴롭힘·갈등을 몰래 확인하거나 감정·성적 원인을 대신 캐묻는 요청
  - 그 외 안전상 그대로도, 재작성해도 아이에게 전달하면 안 되는 내용
  단순히 추측·단정·유도·복수질문·비난조 표현이 있다는 이유만으로는 BLOCKED를 쓰지 않는다.
  그런 경우는 위 SAFE_AFTER_REWRITE로 재작성하라.

[재작성 결과 문장 요건 — draftQuestion]
- 아이에게 실제로 물어볼 자연스러운 한 문장(예: "~있었어?", "~인지 궁금해!")
- 원문의 핵심 주제와 대상을 유지함(무관한 안전 주제로 치환 금지)
- 아이를 추궁하지 않음 / 특정 답을 강요하지 않음
- 부모가 시켰다는 느낌이 없음
- 원문 대화 원문 공개를 요구하지 않음
- 민감정보를 직접 요구하지 않음
- 100자 이내

반드시 다음 JSON 스키마로만 응답하세요(다른 텍스트, 코드블록 금지):
{
  "classification": "SAFE_AS_IS" | "SAFE_AFTER_REWRITE" | "BLOCKED",
  "originalQuestionCount": 원문에 섞여 있던 질문 개수(정수, 1 이상),
  "selectedIntent": "이 질문으로 확인하려는 핵심 궁금증 한 줄 요약 (BLOCKED면 null)",
  "draftQuestion": "아이에게 실제로 물어볼 최종 문장 (BLOCKED면 null)",
  "rewriteReasons": ["재작성하며 제거·수정한 요소들을 짧게 나열 (SAFE_AS_IS면 빈 배열 가능)"],
  "rejectReason": "BLOCKED일 때만, 왜 전달할 수 없는지 부모에게 보여줄 짧은 설명 (그 외 null)"
}`;

function extractJSON(text: string) {
  try {
    const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(cleanText);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        /* fallthrough */
      }
    }
    throw new Error("JSON 파싱 오류");
  }
}

const VALID_CLASSIFICATIONS: ParentQuestionClassification[] = ["SAFE_AS_IS", "SAFE_AFTER_REWRITE", "BLOCKED"];

function failed(): ParentQuestionRewriteResult {
  return {
    ok: false,
    status: "GENERATION_FAILED",
    draftQuestion: null,
    originalQuestionCount: null,
    selectedIntent: null,
    rewriteReasons: [],
    rejectReason: null,
  };
}

/** LLM 응답 텍스트를 파싱·검증해 분류 결과로 변환한다(순수 함수 — 네트워크 호출 없음). */
export function parseParentQuestionRewriteResponse(aiResponseText: string): ParentQuestionRewriteResult {
  let parsed: any;
  try {
    parsed = extractJSON(aiResponseText);
  } catch {
    return failed();
  }

  const classification = parsed?.classification;
  if (typeof classification !== "string" || !VALID_CLASSIFICATIONS.includes(classification as ParentQuestionClassification)) {
    return failed();
  }

  const originalQuestionCount =
    typeof parsed.originalQuestionCount === "number" && Number.isFinite(parsed.originalQuestionCount)
      ? Math.max(1, Math.round(parsed.originalQuestionCount))
      : null;

  if (classification === "BLOCKED") {
    const rejectReason = typeof parsed.rejectReason === "string" && parsed.rejectReason.trim()
      ? parsed.rejectReason.trim()
      : DEFAULT_BLOCKED_MESSAGE;
    return {
      ok: false,
      status: "BLOCKED",
      draftQuestion: null,
      originalQuestionCount,
      selectedIntent: null,
      rewriteReasons: [],
      rejectReason,
    };
  }

  const draftQuestion = typeof parsed.draftQuestion === "string" ? parsed.draftQuestion.trim() : "";
  const isInvalidDraft =
    draftQuestion.length === 0 ||
    draftQuestion.length > 100 ||
    FORBIDDEN_PATTERNS.some((p) => p.test(draftQuestion));
  if (isInvalidDraft) {
    // LLM이 SAFE로 분류했지만 실제 문장이 지침을 어겼다면(2차 안전망), 안전을 우선해
    // 생성 실패로 취급한다 — 위험한 문장을 그대로 통과시키지 않는다.
    return failed();
  }

  const selectedIntent = typeof parsed.selectedIntent === "string" ? parsed.selectedIntent.trim() : null;
  const rewriteReasons = Array.isArray(parsed.rewriteReasons)
    ? parsed.rewriteReasons.filter((r: unknown): r is string => typeof r === "string")
    : [];

  return {
    ok: true,
    status: classification as ParentQuestionClassification,
    draftQuestion,
    originalQuestionCount,
    selectedIntent,
    rewriteReasons,
    rejectReason: null,
  };
}

export interface GenAILikeClient {
  models: {
    generateContent: (args: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }) => Promise<{ text?: string }>;
  };
}

/** 부모 질문을 LLM으로 분류·재작성한다. 네트워크 실패도 GENERATION_FAILED로 흡수한다. */
export async function classifyAndRewriteParentQuestion(
  ai: GenAILikeClient,
  model: string,
  questionText: string,
): Promise<ParentQuestionRewriteResult> {
  let aiResponseText = "";
  try {
    const response = await ai.models.generateContent({
      model,
      contents: questionText,
      config: {
        systemInstruction: ASK_CHILD_REWRITE_SYSTEM_PROMPT,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    aiResponseText = response.text || "";
  } catch (err) {
    console.error("LLM 호출 실패(부모 질문 안전 재작성):", err);
    return failed();
  }
  return parseParentQuestionRewriteResponse(aiResponseText);
}
