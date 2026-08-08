// requests/request-parent-query-router-grade4-v1.md
// 초등학교 4학년 전용 부모 질문 라우터. 판정 순서는 고정: CRISIS → RED → GREEN → DEFAULT_RED.
// LLM은 후보 판정만 하고, 최종 route 결정은 이 파일의 결정론적 게이트가 내린다(§2 규칙1,
// §5.1 "LLM 단독 판정 금지"). 애매하거나 근거 부족이면 항상 RED로 fail-closed한다.

import {
  getApprovedSafeAlternativeById,
  resolveApprovedSafeAlternative,
  type SafeAlternative,
} from "./parentQuerySafeAlternatives";

export const POLICY_VERSION = "PQR-G4-1.1";
export const APPLICABLE_GRADE = 4;

export type ParentQueryRoute = "CRISIS" | "RED" | "GREEN";

export type GreenAreaId =
  | "interest"
  | "school_fun"
  | "subject_like"
  | "food_pref"
  | "pride"
  | "content"
  | "weekend"
  | "dream";

export interface GreenRule {
  id: string; // G-01..G-08
  area: GreenAreaId;
  parentIntentExamples: string;
  parentDraftText: string; // 부모 확인용 — "~물어볼까요?"
  childQuestionText: string; // 아이 실제 질문 — 2인칭 직접 질문
  reviewFlag: string;
}

// §6.2 표를 그대로 반영. expert_review_status는 정책 데이터 자체의 속성으로,
// 실제 판정 로그(parent_questions row)에는 사용된 policyVersion/ruleId만 남긴다(§12).
export const GREEN_RULES: readonly GreenRule[] = [
  {
    id: "G-01",
    area: "interest",
    parentIntentExamples: "좋아하는 것, 관심사, 요즘 빠진 것",
    parentDraftText: "요즘 가장 빠져 있는 것이 있는지 물어볼까요?",
    childQuestionText: "요즘 네가 제일 빠져 있는 거 있어?",
    reviewFlag: "적합",
  },
  {
    id: "G-02",
    area: "school_fun",
    parentIntentExamples: "학교에서 재밌었던 것",
    parentDraftText: "오늘 학교에서 가장 재밌었던 순간이 무엇인지 물어볼까요?",
    childQuestionText: "오늘 학교에서 제일 재밌었던 순간이 뭐였어?",
    reviewFlag: "적합",
  },
  {
    id: "G-03",
    area: "subject_like",
    parentIntentExamples: "좋아하는 과목, 해볼 만한 수업",
    parentDraftText: "요즘 재미있거나 해볼 만한 수업이 있는지 물어볼까요?",
    childQuestionText: "요즘 수업 중에 재미있거나 해볼 만한 거 있어?",
    reviewFlag: "수정 반영",
  },
  {
    id: "G-04",
    area: "food_pref",
    parentIntentExamples: "먹고 싶은 것, 좋아하는 음식",
    parentDraftText: "요즘 가장 먹고 싶은 음식이 있는지 물어볼까요?",
    childQuestionText: "요즘 제일 먹고 싶은 거 있어?",
    reviewFlag: "적합",
  },
  {
    id: "G-05",
    area: "pride",
    parentIntentExamples: "잘한 것, 자랑거리, 뿌듯한 일",
    parentDraftText: "오늘 스스로 잘했다고 느낀 일이 있는지 물어볼까요?",
    childQuestionText: "오늘 스스로 “이건 좀 잘했다” 싶은 거 있었어?",
    reviewFlag: "적합",
  },
  {
    id: "G-06",
    area: "content",
    parentIntentExamples: "요즘 보는 영상·게임",
    parentDraftText: "요즘 자주 보는 영상이나 즐기는 게임이 있는지 물어볼까요?",
    childQuestionText: "요즘 제일 자주 보는 영상이나 하는 게임 있어?",
    reviewFlag: "적합",
  },
  {
    id: "G-07",
    area: "weekend",
    parentIntentExamples: "주말에 하고 싶은 것",
    parentDraftText: "이번 주말에 하고 싶은 것이 있는지 물어볼까요?",
    childQuestionText: "이번 주말에 하고 싶은 거 정해둔 거 있어?",
    reviewFlag: "적합",
  },
  {
    id: "G-08",
    area: "dream",
    parentIntentExamples: "장래희망, 되고 싶은 것",
    parentDraftText: "요즘 멋있다고 느끼는 직업이나 해보고 싶은 일이 있는지 물어볼까요?",
    childQuestionText: "요즘 멋있다고 느끼는 직업이나 해보고 싶은 거 있어?",
    reviewFlag: "적합",
  },
] as const;

export type RedAreaId =
  | "emotion_cause"
  | "peer_conflict"
  | "academic_pressure"
  | "secret"
  | "family_complaint"
  | "appearance_body"
  | "romance"
  | "sns_control"
  | "fallback";

export interface RedRule {
  id: string; // R-01..R-06
  area: RedAreaId;
  pattern: RegExp | null; // fallback(R-06)은 패턴이 없다 — LLM 미매칭 시 기본값으로만 쓰인다.
  coachingText: string;
}

export const RED_RULES: readonly RedRule[] = [
  {
    id: "R-01",
    area: "emotion_cause",
    pattern: /(때문인\s*것\s*같|왜\s*그런지|무슨\s*일\s*있었는지\s*캐|기분\s*안\s*좋.{0,10}(이유|원인)|속상한\s*일\s*있었)/,
    coachingText:
      "케이가 원인을 대신 캐묻기는 어려워요. 아이의 기분을 미리 정하지 말고 편하게 이야기할 여지를 남겨 주세요.",
  },
  {
    id: "R-02",
    area: "peer_conflict",
    pattern: /(누구랑\s*싸웠|친구.{0,10}(싸운|다퉜|괴롭|따돌|왕따))/,
    coachingText:
      "케이가 친구 관계를 대신 캐물으면 아이가 마음을 닫을 수 있어요. 걱정이 이어지면 담임이나 상담 선생님과 상의해 주세요.",
  },
  {
    id: "R-03",
    area: "academic_pressure",
    pattern: /(시험\s*점수|성적.{0,10}(왜|떨어|올랐)|숙제.{0,10}(안\s*했|왜)|학원.{0,10}(태도|성실))/,
    coachingText:
      "공부 이야기를 추궁하면 아이가 대화를 피할 수 있어요. 압박보다 아이가 느끼는 난이도나 흥미를 직접 물어보세요.",
  },
  {
    id: "R-04",
    area: "secret",
    pattern: /(숨기는\s*(거|게|것)|비밀.{0,10}(있|캐|확인)|거짓말.{0,10}(했는지|인지)|몰래.{0,10}(뭐|무엇|무슨))/,
    coachingText:
      "케이는 아이 몰래 무언가를 알아내는 도구가 아니에요. 아이와의 신뢰를 지키기 위해 이 요청은 전달하지 않아요.",
  },
  {
    id: "R-05",
    area: "family_complaint",
    pattern: /((엄마|아빠|할머니|할아버지|부모님).{0,10}(싫어|미워|나쁘|불만)|가족.{0,10}(불만|평가))/,
    coachingText: "가족에 대한 아이 마음을 케이가 대신 캐묻지 않아요. 편안한 자리에서 직접 이야기해 주세요.",
  },
  {
    id: "R-06",
    area: "appearance_body",
    pattern: /(살\s*쪘|뚱뚱|말랐|다이어트|몸무게|체중.{0,10}(몇|얼마)|(살|체중|몸무게|다이어트).{0,15}(얼마나\s*먹|적게\s*먹))/,
    coachingText: "외모·몸·식사 관련은 케이가 대신 캐묻지 않아요. 걱정되는 점은 아이를 평가하지 않는 말로 직접 살펴봐 주세요.",
  },
  {
    id: "R-07",
    area: "romance",
    pattern: /(남자\s*친구|여자\s*친구|사귀는|좋아하는\s*애|누구\s*좋아하|썸\s*타)/,
    coachingText: "누구를 좋아하는지는 케이가 대신 캐묻지 않아요. 아이가 먼저 말할 때 편하게 들어 주세요.",
  },
  {
    id: "R-08",
    area: "sns_control",
    pattern: /(인스타|틱톡|SNS|DM|디엠|팔로워|누구랑\s*연락|카톡.{0,10}(누구|확인))/i,
    coachingText: "온라인 대화를 케이가 감시하거나 캐묻지 않아요. 사용 규칙은 아이와 함께 정해 주세요.",
  },
  {
    id: "R-09",
    area: "fallback",
    pattern: null,
    coachingText:
      "이 질문은 4학년 Green List에 명확히 해당하지 않아 아이에게 전달하지 않아요. 아이를 추궁하지 않는 관심사·학교의 즐거운 경험·먹고 싶은 것·주말 계획 같은 질문으로 바꿔 주세요.",
  },
];

const RED_RULES_BY_AREA = new Map(RED_RULES.map((r) => [r.area, r]));
const RED_FALLBACK = RED_RULES.find((r) => r.id === "R-09")!;
const GREEN_RULES_BY_AREA = new Map(GREEN_RULES.map((r) => [r.area, r]));

// §8.1 위기 감지 범위 — 결정론적 정규식(1차 방어). 자해/자살/학대/성적피해/폭력/따돌림/
// 섭식이상/즉각적 안전우려. 오탐보다 누락이 훨씬 위험하므로 넓게 잡는다(fail-closed).
export const CRISIS_PATTERNS: readonly RegExp[] = [
  /(자해|손목.{0,5}(그었|그어)|자살|죽고\s*싶|죽어버리고\s*싶|삶을\s*끝내)/,
  /(학대|때렸|맞았다고|폭행당|감금)/,
  /(성폭행|성추행|성적\s*(피해|학대)|몸을\s*만졌)/,
  /(폭력.{0,5}(당했|휘둘렀)|흉기|칼로\s*위협)/,
  /(왕따|따돌림|괴롭힘.{0,10}(계속|심하게|매일))/,
  /(거식|폭식|굶고\s*있|먹지\s*않으려)/,
];

export function detectCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

export function detectRedPattern(text: string): RedRule | null {
  for (const rule of RED_RULES) {
    if (rule.pattern && rule.pattern.test(text)) return rule;
  }
  return null;
}

export interface ParentQueryCandidate {
  candidateRoute: "GREEN" | "RED" | "UNCLEAR";
  candidateArea: string | null;
  confidence: number;
  matchedEvidence: string[];
  detectedRisks: string[];
  questionCount: number;
  additionalCandidateAreas: string[];
  detectedRedArea: RedAreaId | null;
}

const MIN_GREEN_CONFIDENCE = 0.6;

export const PARENT_QUERY_ROUTER_SYSTEM_PROMPT = `당신은 초등학교 4학년 아동 서비스의 부모 질문 분류 보조자입니다.
부모가 케이(아이용 AI 친구)에게 아이에 대해 물어봐 달라고 입력한 문장을 분석합니다.
최종 결정은 당신이 아니라 정책 엔진이 내리므로, 당신은 후보 판정 정보만 정확히 제공하면 됩니다.

[당신의 역할]
1. 부모 의도 요약
2. 아래 8개 Green 영역 중 후보 1개 선택(명확히 해당하지 않으면 null)
   - interest(관심사/요즘 빠진 것), school_fun(학교에서 재밌었던 것), subject_like(좋아하는
     과목/수업), food_pref(먹고 싶은 것), pride(잘한 것/자랑거리), content(보는 영상/게임),
     weekend(주말 계획), dream(장래희망)
3. 아래 위험 영역 중 하나에 해당하면 candidate_route를 "RED"로, detected_red_area에
   해당 영역 코드를 적고, detected_risks에 구체적 신호를 적는다
   - emotion_cause: 기분/감정의 원인을 캐묻거나 단정
   - peer_conflict: 친구 갈등·다툼·따돌림 확인
   - academic_pressure: 성적·공부·숙제·학원 태도 추궁
   - secret: 비밀·거짓말 적발, 숨긴 것 확인
   - family_complaint: 가족에 대한 불만이나 평가 요구
   - appearance_body: 외모·몸무게·식사량 캐묻기
   - romance: 이성 관계 캐묻기
   - sns_control: SNS 통제·감시
   위 영역 중 어디에도 정확히 들어맞지 않지만 그래도 위험하다고 판단되면 detected_red_area는
   null로 두고 detected_risks에만 이유를 적는다.
4. 명확한 위험 신호도 없고 8개 영역에도 해당하지 않으면 candidate_route를 "UNCLEAR"로
5. 원문에 서로 다른 질문이 여러 개 섞여 있으면 question_count에 개수를 적고,
   additional_candidate_areas에 주된 후보(candidate_area) 외 나머지 질문들의 Green 영역
   후보를 나열한다(Green에 해당하지 않는 질문은 제외)
6. 부모 원문을 그대로 옮기지 말고 matched_evidence에 판단 근거가 된 짧은 구절만 인용

반드시 다음 JSON 스키마로만 응답하세요(다른 텍스트, 코드블록 금지):
{
  "candidate_route": "GREEN" | "RED" | "UNCLEAR",
  "candidate_area": "GREEN일 때만 8개 영역 중 하나, 그 외에는 null",
  "detected_red_area": "RED일 때 emotion_cause|peer_conflict|academic_pressure|secret|family_complaint|appearance_body|romance|sns_control 중 하나 또는 null, GREEN/UNCLEAR면 항상 null",
  "confidence": 0.0~1.0,
  "matched_evidence": ["판단 근거 짧은 구절"],
  "detected_risks": ["감지된 위험 신호 설명, 없으면 빈 배열"],
  "question_count": 원문에 섞인 질문 개수(정수, 1 이상),
  "additional_candidate_areas": ["question_count가 2 이상일 때 주 후보 외 나머지 Green 영역들"]
}`;

function extractJSON(text: string) {
  try {
    const clean = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(clean);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fallthrough */
      }
    }
    throw new Error("JSON 파싱 오류");
  }
}

const VALID_CANDIDATE_ROUTES = ["GREEN", "RED", "UNCLEAR"];
const VALID_AREAS = new Set<string>(GREEN_RULES.map((r) => r.area));
const VALID_RED_AREAS = new Set<string>(RED_RULES.filter((r) => r.area !== "fallback").map((r) => r.area));

export function parseParentQueryCandidateResponse(aiResponseText: string): ParentQueryCandidate | null {
  let parsed: any;
  try {
    parsed = extractJSON(aiResponseText);
  } catch {
    return null;
  }
  if (typeof parsed.candidate_route !== "string" || !VALID_CANDIDATE_ROUTES.includes(parsed.candidate_route)) {
    return null;
  }
  const candidateArea =
    typeof parsed.candidate_area === "string" && VALID_AREAS.has(parsed.candidate_area) ? parsed.candidate_area : null;
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? parsed.confidence : 0;
  const matchedEvidence = Array.isArray(parsed.matched_evidence)
    ? parsed.matched_evidence.filter((e: unknown): e is string => typeof e === "string")
    : [];
  const detectedRisks = Array.isArray(parsed.detected_risks)
    ? parsed.detected_risks.filter((e: unknown): e is string => typeof e === "string")
    : [];
  const questionCount =
    typeof parsed.question_count === "number" && Number.isFinite(parsed.question_count)
      ? Math.max(1, Math.round(parsed.question_count))
      : 1;
  const additionalCandidateAreas = Array.isArray(parsed.additional_candidate_areas)
    ? parsed.additional_candidate_areas.filter((a: unknown): a is string => typeof a === "string" && VALID_AREAS.has(a))
    : [];
  const detectedRedArea =
    typeof parsed.detected_red_area === "string" && VALID_RED_AREAS.has(parsed.detected_red_area)
      ? (parsed.detected_red_area as RedAreaId)
      : null;

  return {
    candidateRoute: parsed.candidate_route,
    candidateArea,
    detectedRedArea,
    confidence,
    matchedEvidence,
    detectedRisks,
    questionCount,
    additionalCandidateAreas,
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

export async function classifyParentQueryCandidate(
  ai: GenAILikeClient,
  model: string,
  questionText: string,
): Promise<ParentQueryCandidate | null> {
  let text = "";
  try {
    const response = await ai.models.generateContent({
      model,
      contents: questionText,
      config: {
        systemInstruction: PARENT_QUERY_ROUTER_SYSTEM_PROMPT,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    text = response.text || "";
  } catch (err) {
    console.error("LLM 호출 실패(부모 질문 라우터 후보 분류):", err);
    return null;
  }
  return parseParentQueryCandidateResponse(text);
}

export type ParentQueryRouterResult =
  | {
      route: "CRISIS";
      policyVersion: string;
    }
  | {
      route: "RED";
      ruleId: string;
      area: RedAreaId;
      coachingText: string;
      safeAlternative: SafeAlternative | null;
      policyVersion: string;
    }
  | {
      route: "GREEN";
      ruleId: string;
      area: GreenAreaId;
      parentDraftText: string;
      childQuestionText: string;
      confidence: number;
      evidence: string[];
      policyVersion: string;
    }
  | {
      // §10 다중 질문 — 부모가 1개를 선택해야 한다. 자동 선택 금지.
      route: "MULTI_QUESTION_SELECT";
      questionCount: number;
      candidates: Array<{ ruleId: string; area: GreenAreaId; parentDraftText: string; childQuestionText: string }>;
      policyVersion: string;
    }
  | {
      route: "GENERATION_FAILED";
    };

/** 원문을 정규화한다(연속 공백 정리 등) — 순수 함수. */
export function normalizeParentQueryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function greenRuleFromArea(area: string | null): GreenRule | null {
  if (!area) return null;
  return GREEN_RULES_BY_AREA.get(area as GreenAreaId) ?? null;
}

function safeAlternativeForRed(rule: RedRule): SafeAlternative | null {
  return resolveApprovedSafeAlternative({
    sourceGrade: APPLICABLE_GRADE,
    redId: rule.id,
    requestedArea: rule.area,
  });
}

export function getSafeAlternativeById(alternativeId: string): SafeAlternative | null {
  return getApprovedSafeAlternativeById(APPLICABLE_GRADE, alternativeId);
}

/**
 * 4학년 전용 부모 질문 라우터. 판정 순서 고정: CRISIS → RED(결정론) → LLM 후보 → RED(LLM
 * 시맨틱/위험신호) → GREEN 화이트리스트 검증 → DEFAULT_RED. 애매하면 항상 RED다.
 */
export async function routeParentQueryGrade4(
  ai: GenAILikeClient,
  model: string,
  rawText: string,
): Promise<ParentQueryRouterResult> {
  const text = normalizeParentQueryText(rawText);

  // [2] 위기 신호 — 결정론적, LLM 호출 없이 즉시 판정(속도·신뢰성 우선).
  if (detectCrisis(text)) {
    return { route: "CRISIS", policyVersion: POLICY_VERSION };
  }

  // [3] Red 결정론적 패턴 — LLM이 "Green"이라 판단해도 이 단계에서 이미 걸러지므로
  // §15.1 "LLM이 Green이라 해도 Red 패턴 감지 → Red"를 구조적으로 만족한다.
  const redMatch = detectRedPattern(text);
  if (redMatch) {
    return {
      route: "RED",
      ruleId: redMatch.id,
      area: redMatch.area,
      coachingText: redMatch.coachingText,
      safeAlternative: safeAlternativeForRed(redMatch),
      policyVersion: POLICY_VERSION,
    };
  }

  const candidate = await classifyParentQueryCandidate(ai, model, text);
  if (!candidate) {
    return { route: "GENERATION_FAILED" };
  }

  // LLM 시맨틱 Red 판정 또는 위험신호 감지 — Green이라 답했어도 위험신호가 있으면 무시하지
  // 않는다(fail-closed).
  if (candidate.candidateRoute === "RED" || candidate.detectedRisks.length > 0) {
    // claude-review 재지적: candidate.candidateArea는 스키마상 Green 8개 영역 코드만
    // 나올 수 있어(§5.2), 여기서 그 값을 RED_RULES_BY_AREA(Red 영역 코드가 키)로 조회하면
    // 절대 매칭되지 않고 항상 fallback(R-06)으로 빠져 위험유형별 맞춤 코칭·안전 대안이
    // LLM 경로에서 전혀 동작하지 않았다 — 반드시 detectedRedArea(별도 필드)를 써야 한다.
    const rule = (candidate.detectedRedArea && RED_RULES_BY_AREA.get(candidate.detectedRedArea)) || RED_FALLBACK;
    return {
      route: "RED",
      ruleId: rule.id,
      area: rule.area,
      coachingText: rule.coachingText,
      safeAlternative: safeAlternativeForRed(rule),
      policyVersion: POLICY_VERSION,
    };
  }

  if (candidate.candidateRoute !== "GREEN") {
    // UNCLEAR — 근거 부족, default Red.
    return {
      route: "RED",
      ruleId: RED_FALLBACK.id,
      area: RED_FALLBACK.area,
      coachingText: RED_FALLBACK.coachingText,
      safeAlternative: null,
      policyVersion: POLICY_VERSION,
    };
  }

  const primaryRule = greenRuleFromArea(candidate.candidateArea);
  const isValidGreen =
    !!primaryRule &&
    candidate.confidence >= MIN_GREEN_CONFIDENCE &&
    candidate.matchedEvidence.length > 0 &&
    candidate.detectedRisks.length === 0;

  if (!isValidGreen) {
    return {
      route: "RED",
      ruleId: RED_FALLBACK.id,
      area: RED_FALLBACK.area,
      coachingText: RED_FALLBACK.coachingText,
      safeAlternative: null,
      policyVersion: POLICY_VERSION,
    };
  }

  // §10 다중 질문 — 자동으로 1개를 골라 등록하지 않는다. question_count>1이면 항상
  // 선택 UI로 보낸다(유효한 Green 후보가 1개뿐이어도 마찬가지).
  if (candidate.questionCount > 1) {
    const seen = new Set<string>([primaryRule!.id]);
    const candidates = [primaryRule!];
    for (const area of candidate.additionalCandidateAreas) {
      const rule = greenRuleFromArea(area);
      if (rule && !seen.has(rule.id)) {
        seen.add(rule.id);
        candidates.push(rule);
      }
    }
    return {
      route: "MULTI_QUESTION_SELECT",
      questionCount: candidate.questionCount,
      candidates: candidates.map((r) => ({
        ruleId: r.id,
        area: r.area,
        parentDraftText: r.parentDraftText,
        childQuestionText: r.childQuestionText,
      })),
      policyVersion: POLICY_VERSION,
    };
  }

  return {
    route: "GREEN",
    ruleId: primaryRule!.id,
    area: primaryRule!.area,
    parentDraftText: primaryRule!.parentDraftText,
    childQuestionText: primaryRule!.childQuestionText,
    confidence: candidate.confidence,
    evidence: candidate.matchedEvidence,
    policyVersion: POLICY_VERSION,
  };
}

/** ruleId만으로 Green 규칙을 조회한다(다중 질문 선택 확정 시 재사용). */
export function getGreenRuleById(ruleId: string): GreenRule | null {
  return GREEN_RULES.find((r) => r.id === ruleId) ?? null;
}
