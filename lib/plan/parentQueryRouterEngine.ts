// requests/request-parent-query-router-grade{1,2,3,5,6}-v1.md — 4학년 구현
// (lib/plan/parentQueryRouterGrade4.ts, 이미 3라운드 정적리뷰+Dev/Prod 실측 검증을 거쳐
// 배포됨)을 "기준 인터페이스로 유지하고 재설계하지 않는다"는 각 지시서의 명시적 지침에
// 따라, 그 파일은 건드리지 않고 동일한 판정 로직을 학년별 정책 데이터로 매개변수화한
// 공용 엔진만 새로 만든다. 판정 순서(CRISIS→RED→GREEN→DEFAULT_RED)·fail-closed 원칙·
// LLM 역할 분리는 모든 학년 지시서가 동일하게 요구하므로 이 파일 하나로 공유한다.

import {
  getApprovedSafeAlternativeById,
  resolveApprovedSafeAlternative,
  type SafeAlternative,
} from "./parentQuerySafeAlternatives";

export type ParentQueryRoute = "CRISIS" | "RED" | "GREEN";

export interface GreenRule {
  id: string;
  area: string;
  parentDraftText: string;
  childQuestionText: string;
}

export interface RedRule {
  id: string;
  area: string;
  pattern: RegExp | null;
  coachingText: string;
}

// §8.1 위기 감지 범위 — 모든 학년 지시서가 문구까지 동일하게 명시(자해/자살/학대/성적피해/
// 폭력/따돌림/섭식이상/즉각적 안전우려). 결정론적 정규식(1차 방어), 학년 공통.
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

export interface RouterPolicyConfig {
  policyVersion: string;
  applicableGrade: number;
  greenRules: readonly GreenRule[];
  redRules: readonly RedRule[];
  /** LLM 프롬프트에 나열할 "area코드: 설명" 안내 — 학년마다 Green 영역 구성이 다르다. */
  greenAreaPromptGuide: string;
  redAreaPromptGuide: string;
}

export function detectRedPattern(config: RouterPolicyConfig, text: string): RedRule | null {
  for (const rule of config.redRules) {
    if (rule.pattern && rule.pattern.test(text)) return rule;
  }
  return null;
}

export interface ParentQueryCandidate {
  candidateRoute: "GREEN" | "RED" | "UNCLEAR";
  candidateArea: string | null;
  detectedRedArea: string | null;
  confidence: number;
  matchedEvidence: string[];
  detectedRisks: string[];
  questionCount: number;
  additionalCandidateAreas: string[];
}

const MIN_GREEN_CONFIDENCE = 0.6;

export function buildSystemPrompt(config: RouterPolicyConfig): string {
  return `당신은 초등학교 ${config.applicableGrade}학년 아동 서비스의 부모 질문 분류 보조자입니다.
부모가 케이(아이용 AI 친구)에게 아이에 대해 물어봐 달라고 입력한 문장을 분석합니다.
최종 결정은 당신이 아니라 정책 엔진이 내리므로, 당신은 후보 판정 정보만 정확히 제공하면 됩니다.

[당신의 역할]
1. 부모 의도 요약
2. 아래 Green 영역 중 후보 1개 선택(명확히 해당하지 않으면 null)
   ${config.greenAreaPromptGuide}
3. 아래 위험 신호가 있으면 candidate_route를 "RED"로, detected_red_area에 해당 영역
   코드를, detected_risks에 구체적 신호를 적는다
   ${config.redAreaPromptGuide}
   위 영역 중 어디에도 정확히 들어맞지 않지만 그래도 위험하다고 판단되면 detected_red_area는
   null로 두고 detected_risks에만 이유를 적는다.
4. 명확한 위험 신호도 없고 Green 영역에도 해당하지 않으면 candidate_route를 "UNCLEAR"로
5. 원문에 서로 다른 질문이 여러 개 섞여 있으면 question_count에 개수를 적고,
   additional_candidate_areas에 주된 후보(candidate_area) 외 나머지 질문들의 Green 영역
   후보를 나열한다(Green에 해당하지 않는 질문은 제외)
6. 부모 원문을 그대로 옮기지 말고 matched_evidence에 판단 근거가 된 짧은 구절만 인용

반드시 다음 JSON 스키마로만 응답하세요(다른 텍스트, 코드블록 금지):
{
  "candidate_route": "GREEN" | "RED" | "UNCLEAR",
  "candidate_area": "GREEN일 때만 Green 영역 중 하나, 그 외에는 null",
  "detected_red_area": "RED일 때 Red 영역 중 하나 또는 null, GREEN/UNCLEAR면 항상 null",
  "confidence": 0.0~1.0,
  "matched_evidence": ["판단 근거 짧은 구절"],
  "detected_risks": ["감지된 위험 신호 설명, 없으면 빈 배열"],
  "question_count": 원문에 섞인 질문 개수(정수, 1 이상),
  "additional_candidate_areas": ["question_count가 2 이상일 때 주 후보 외 나머지 Green 영역들"]
}`;
}

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

export function parseParentQueryCandidateResponse(
  config: RouterPolicyConfig,
  aiResponseText: string,
): ParentQueryCandidate | null {
  let parsed: any;
  try {
    parsed = extractJSON(aiResponseText);
  } catch {
    return null;
  }
  if (typeof parsed.candidate_route !== "string" || !VALID_CANDIDATE_ROUTES.includes(parsed.candidate_route)) {
    return null;
  }
  const validAreas = new Set(config.greenRules.map((r) => r.area));
  const validRedAreas = new Set(config.redRules.filter((r) => r.area !== "fallback").map((r) => r.area));

  const candidateArea =
    typeof parsed.candidate_area === "string" && validAreas.has(parsed.candidate_area) ? parsed.candidate_area : null;
  const detectedRedArea =
    typeof parsed.detected_red_area === "string" && validRedAreas.has(parsed.detected_red_area)
      ? parsed.detected_red_area
      : null;
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
    ? parsed.additional_candidate_areas.filter((a: unknown): a is string => typeof a === "string" && validAreas.has(a))
    : [];

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
  config: RouterPolicyConfig,
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
        systemInstruction: buildSystemPrompt(config),
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    text = response.text || "";
  } catch (err) {
    console.error(`LLM 호출 실패(부모 질문 라우터 후보 분류, ${config.policyVersion}):`, err);
    return null;
  }
  return parseParentQueryCandidateResponse(config, text);
}

export type ParentQueryRouterResult =
  | { route: "CRISIS"; policyVersion: string }
  | {
      route: "RED";
      ruleId: string;
      area: string;
      coachingText: string;
      safeAlternative: SafeAlternative | null;
      policyVersion: string;
    }
  | {
      route: "GREEN";
      ruleId: string;
      area: string;
      parentDraftText: string;
      childQuestionText: string;
      confidence: number;
      evidence: string[];
      policyVersion: string;
    }
  | {
      route: "MULTI_QUESTION_SELECT";
      questionCount: number;
      candidates: Array<{ ruleId: string; area: string; parentDraftText: string; childQuestionText: string }>;
      policyVersion: string;
    }
  | { route: "GENERATION_FAILED" };

export function normalizeParentQueryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function getGreenRuleById(config: RouterPolicyConfig, ruleId: string): GreenRule | null {
  return config.greenRules.find((r) => r.id === ruleId) ?? null;
}

export function getSafeAlternativeById(
  config: RouterPolicyConfig,
  alternativeId: string,
): SafeAlternative | null {
  return getApprovedSafeAlternativeById(config.applicableGrade, alternativeId);
}

function safeAlternativeForRed(config: RouterPolicyConfig, rule: RedRule): SafeAlternative | null {
  return resolveApprovedSafeAlternative({
    sourceGrade: config.applicableGrade,
    redId: rule.id,
    requestedArea: rule.area,
  });
}

function greenRuleFromArea(config: RouterPolicyConfig, area: string | null): GreenRule | null {
  if (!area) return null;
  return config.greenRules.find((r) => r.area === area) ?? null;
}

/**
 * 학년 공통 부모 질문 라우터 파이프라인. 판정 순서 고정: CRISIS → RED(결정론) → LLM 후보 →
 * RED(LLM 시맨틱/위험신호) → GREEN 화이트리스트 검증 → DEFAULT_RED. 애매하면 항상 RED다.
 * parentQueryRouterGrade4.ts의 라이브 검증을 거친 로직과 동일 — 4학년 파일 자체는
 * 건드리지 않고(이미 배포됨) 다른 학년이 이 공용 함수를 쓴다.
 */
export async function routeParentQuery(
  config: RouterPolicyConfig,
  ai: GenAILikeClient,
  model: string,
  rawText: string,
): Promise<ParentQueryRouterResult> {
  const text = normalizeParentQueryText(rawText);
  const redFallback = config.redRules.find((r) => r.area === "fallback");
  if (!redFallback) {
    // 정책 설정 오류 — fallback 규칙 없이는 fail-closed를 보장할 수 없으므로 안전하게 실패.
    console.error(`정책 설정 오류: ${config.policyVersion}에 fallback RED 규칙이 없음`);
    return { route: "GENERATION_FAILED" };
  }

  if (detectCrisis(text)) {
    return { route: "CRISIS", policyVersion: config.policyVersion };
  }

  const redMatch = detectRedPattern(config, text);
  if (redMatch) {
    return {
      route: "RED",
      ruleId: redMatch.id,
      area: redMatch.area,
      coachingText: redMatch.coachingText,
      safeAlternative: safeAlternativeForRed(config, redMatch),
      policyVersion: config.policyVersion,
    };
  }

  const candidate = await classifyParentQueryCandidate(config, ai, model, text);
  if (!candidate) {
    return { route: "GENERATION_FAILED" };
  }

  if (candidate.candidateRoute === "RED" || candidate.detectedRisks.length > 0) {
    const rule = config.redRules.find((r) => r.area === candidate.detectedRedArea) || redFallback;
    return {
      route: "RED",
      ruleId: rule.id,
      area: rule.area,
      coachingText: rule.coachingText,
      safeAlternative: safeAlternativeForRed(config, rule),
      policyVersion: config.policyVersion,
    };
  }

  if (candidate.candidateRoute !== "GREEN") {
    return {
      route: "RED",
      ruleId: redFallback.id,
      area: redFallback.area,
      coachingText: redFallback.coachingText,
      safeAlternative: null,
      policyVersion: config.policyVersion,
    };
  }

  const primaryRule = greenRuleFromArea(config, candidate.candidateArea);
  const isValidGreen =
    !!primaryRule &&
    candidate.confidence >= MIN_GREEN_CONFIDENCE &&
    candidate.matchedEvidence.length > 0 &&
    candidate.detectedRisks.length === 0;

  if (!isValidGreen) {
    return {
      route: "RED",
      ruleId: redFallback.id,
      area: redFallback.area,
      coachingText: redFallback.coachingText,
      safeAlternative: null,
      policyVersion: config.policyVersion,
    };
  }

  if (candidate.questionCount > 1) {
    const seen = new Set<string>([primaryRule!.id]);
    const candidates = [primaryRule!];
    for (const area of candidate.additionalCandidateAreas) {
      const rule = greenRuleFromArea(config, area);
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
      policyVersion: config.policyVersion,
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
    policyVersion: config.policyVersion,
  };
}
