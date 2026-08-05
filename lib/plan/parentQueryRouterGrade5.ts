// requests/request-parent-query-router-grade5-v1.md — 초등학교 5학년 정책 데이터.
// §13: "4학년 안정화 후 3학년과 별도로 검증하고, 외모·이성·SNS 영역은 상담·법률 검토 후
// 활성화" — production_enabled=false. R-06~R-08(외모/이성/SNS)은 강한 Red 게이트(§7).

import {
  routeParentQuery,
  getGreenRuleById as getGreenRuleByIdGeneric,
  type GreenRule,
  type RedRule,
  type RouterPolicyConfig,
  type GenAILikeClient,
  type ParentQueryRouterResult,
} from "./parentQueryRouterEngine";

export const POLICY_VERSION = "PQR-G5-1.0";
export const APPLICABLE_GRADE = 5;

export const GREEN_RULES: readonly GreenRule[] = [
  { id: "G-01", area: "interest", parentDraftText: "요즘 가장 관심 가는 것이 있는지 물어볼까요?", childQuestionText: "요즘 제일 관심 가는 거 있어?" },
  { id: "G-02", area: "school_fun", parentDraftText: "오늘 학교에서 기억에 남는 순간이 있었는지 물어볼까요?", childQuestionText: "오늘 학교에서 기억에 남는 순간 있었어?" },
  { id: "G-03", area: "subject_like", parentDraftText: "요즘 관심 가는 수업이 있는지 물어볼까요?", childQuestionText: "요즘 수업 중에 관심 가는 거 있어?" },
  { id: "G-04", area: "food_pref", parentDraftText: "요즘 가장 먹고 싶은 것이 있는지 물어볼까요?", childQuestionText: "요즘 제일 먹고 싶은 거 있어?" },
  { id: "G-05", area: "pride", parentDraftText: "최근 뿌듯하게 느낀 일이 있는지 물어볼까요?", childQuestionText: "최근에 '이건 좀 잘했다' 싶은 거 있었어?" },
  { id: "G-06", area: "content", parentDraftText: "요즘 자주 보는 콘텐츠나 즐기는 게임이 있는지 물어볼까요?", childQuestionText: "요즘 제일 자주 보는 거나 하는 게임 있어?" },
  { id: "G-07", area: "weekend", parentDraftText: "이번 주말에 하고 싶은 것이 있는지 물어볼까요?", childQuestionText: "이번 주말에 하고 싶은 거 있어?" },
  { id: "G-08", area: "dream", parentDraftText: "요즘 해보고 싶은 일이 있는지 물어볼까요?", childQuestionText: "요즘 '이런 거 해보고 싶다' 싶은 거 있어?" },
];

// §7 RED LIST — R-06~R-08(외모·이성·SNS)은 강한 Red 게이트. 단순 키워드 매칭보다
// "캐묻거나 감시하려는 의도"가 핵심이라 결정론 정규식은 좁게 잡고 LLM 시맨틱 판정에
// 상당 부분 의존한다(§7 "단순 키워드만이 아니라... 의도가 확인되면 Red로 확정").
export const RED_RULES: readonly RedRule[] = [
  {
    id: "R-01",
    area: "emotion_cause",
    pattern: /(때문인\s*것\s*같|왜\s*그런지|무슨\s*일\s*있었는지\s*캐|기분\s*안\s*좋.{0,10}(이유|원인))/,
    coachingText: "5학년은 원인을 캐물으면 방어가 생길 수 있어요. 케이는 대신 캐묻지 않고, 직접은 '무슨 일 있으면 언제든 이야기해'처럼 여지만 열어 주세요.",
    safeAlternativeGreenId: "G-02",
  },
  {
    id: "R-02",
    area: "peer_conflict",
    pattern: /(누구랑\s*싸웠|친구.{0,10}(싸운|다퉜|괴롭|따돌|왕따|소외))/,
    coachingText:
      "이 나이에는 친구 문제를 캐물으면 입을 닫을 수 있어요. 판단 없이 들을 준비를 보여 주고, 소외·괴롭힘이 의심되면 담임·상담 선생님과 상의해 주세요.",
    safeAlternativeGreenId: "G-02",
  },
  {
    id: "R-03",
    area: "academic_pressure",
    pattern: /(시험\s*점수|성적.{0,10}(왜|떨어|올랐)|숙제.{0,10}(안\s*했|왜)|학원.{0,10}(태도|성실)|중학.{0,5}(대비|준비))/,
    coachingText: "성적 압박은 대화를 끊을 수 있어요. 결과보다 노력과 아이가 느끼는 부담을 존중해 주세요.",
    safeAlternativeGreenId: "G-03",
  },
  {
    id: "R-04",
    area: "secret",
    pattern: /(숨기는\s*(거|게|것)|비밀.{0,10}(있|캐|확인)|거짓말.{0,10}(했는지|인지)|몰래[\s\S]{0,10}?(캐|알아내|확인|훔쳐|감시))/,
    coachingText: "케이는 아이 몰래 알아내는 도구가 아니에요. 신뢰를 지키기 위해 이 요청은 전달하지 않아요.",
    safeAlternativeGreenId: null,
  },
  {
    id: "R-05",
    area: "family_complaint",
    pattern: /((엄마|아빠|할머니|할아버지|부모님).{0,10}(싫어|미워|나쁘|불만)|가족.{0,10}(불만|평가))/,
    coachingText: "가족에 대한 아이 마음은 케이가 대신 캐묻지 않아요. 아이가 먼저 꺼낼 여지를 두세요.",
    safeAlternativeGreenId: "G-07",
  },
  {
    id: "R-06",
    area: "appearance_body",
    // claude-review 재지적: "얼마나 먹|적게 먹" 단독 매칭은 "오늘 얼마나 먹었는지"처럼
    // 무해한 식사 질문(G-04 food_pref)까지 결정론 단계에서 즉시 RED로 과차단한다. 체중·
    // 다이어트 맥락과 함께일 때만 매칭하도록 좁힌다 — 그 외 감시성 식사 질문은 LLM 시맨틱
    // 판정(detected_risks)에 맡긴다(설계 의도대로).
    pattern: /(살\s*쪘|뚱뚱|말랐|다이어트|몸무게|체중.{0,10}(몇|얼마)|(살|체중|몸무게|다이어트).{0,15}(얼마나\s*먹|적게\s*먹))/,
    coachingText: "외모·몸·식사 관련은 케이가 대신 캐묻지 않고 리포트에도 수치로 다루지 않아요. 우려되면 전문 상담을 권해요.",
    safeAlternativeGreenId: null,
  },
  {
    id: "R-07",
    area: "romance",
    pattern: /(남자\s*친구|여자\s*친구|사귀는|좋아하는\s*애|썸\s*타)/,
    coachingText: "이성 관계는 케이가 대신 캐묻지 않아요. 사생활 존중이 신뢰의 핵심이에요.",
    safeAlternativeGreenId: null,
  },
  {
    id: "R-08",
    area: "sns_control",
    pattern: /(인스타|틱톡|SNS|DM|디엠|팔로워|누구랑\s*연락|카톡.{0,10}(누구|확인))/i,
    coachingText: "SNS 사용을 케이가 감시하거나 캐묻지 않아요. 규칙은 아이와 함께 정하시길 권해요.",
    safeAlternativeGreenId: null,
  },
  {
    id: "R-09",
    area: "fallback",
    pattern: null,
    coachingText: "이 질문은 이 학년 허용 질문에 명확히 해당하지 않아 아이에게 전달하지 않아요. 추궁하지 않는 다른 질문으로 바꾸거나 리포트를 확인해 주세요.",
    safeAlternativeGreenId: null,
  },
];

const CONFIG: RouterPolicyConfig = {
  policyVersion: POLICY_VERSION,
  applicableGrade: APPLICABLE_GRADE,
  greenRules: GREEN_RULES,
  redRules: RED_RULES,
  greenAreaPromptGuide:
    "interest(관심사), school_fun(학교에서 기억에 남은 순간), subject_like(관심 가는 과목), food_pref(먹고 싶은 것), pride(뿌듯했던 일), content(콘텐츠·유행), weekend(주말 계획), dream(관심 있는 진로)",
  redAreaPromptGuide:
    "emotion_cause(기분 원인 캐기), peer_conflict(친구 갈등·따돌림·소외), academic_pressure(성적·공부·중학대비 추궁), secret(비밀·거짓말 적발), family_complaint(가족 불만), appearance_body(외모·몸무게·식사량 캐묻기), romance(이성 관계 캐묻기), sns_control(SNS 통제·감시) — 이 세 영역은 단순 언급이 아니라 부모가 캐묻거나 감시하려는 의도가 있을 때만 RED로 판정",
};

export function getGreenRuleById(ruleId: string): GreenRule | null {
  return getGreenRuleByIdGeneric(CONFIG, ruleId);
}

export async function routeParentQueryGrade5(
  ai: GenAILikeClient,
  model: string,
  rawText: string,
): Promise<ParentQueryRouterResult> {
  return routeParentQuery(CONFIG, ai, model, rawText);
}
