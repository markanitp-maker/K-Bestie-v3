// requests/request-parent-query-router-grade1-v1.md — 초등학교 1학년 정책 데이터.
// 공용 엔진(parentQueryRouterEngine.ts)에 이 학년의 Green/Red 화이트리스트만 주입한다.
// §13 배포 원칙: "1학년은 전체 학년 중 가장 마지막에 활성화" — production_enabled=false로
// 유지하며, 활성화 여부는 app/api/parent/k-chat/route.ts의 GRADE_ROUTER_CONFIG에서 관리한다.

import {
  routeParentQuery,
  getGreenRuleById as getGreenRuleByIdGeneric,
  getSafeAlternativeById as getSafeAlternativeByIdGeneric,
  type GreenRule,
  type RedRule,
  type RouterPolicyConfig,
  type GenAILikeClient,
  type ParentQueryRouterResult,
} from "./parentQueryRouterEngine";

export const POLICY_VERSION = "PQR-G1-1.1";
export const APPLICABLE_GRADE = 1;

// §6 GREEN LIST — dream 영역 제외(§6 1학년 특칙).
export const GREEN_RULES: readonly GreenRule[] = [
  { id: "G-01", area: "interest", parentDraftText: "제일 좋아하는 게 뭔지 물어볼까요?", childQuestionText: "제일 좋아하는 거 뭐야?" },
  { id: "G-02", area: "school_fun", parentDraftText: "오늘 학교에서 재밌었던 일이 있는지 물어볼까요?", childQuestionText: "오늘 학교에서 뭐가 재밌었어?" },
  { id: "G-03", area: "play", parentDraftText: "가장 좋아하는 놀이가 무엇인지 물어볼까요?", childQuestionText: "무슨 놀이가 제일 좋아?" },
  { id: "G-04", area: "food_pref", parentDraftText: "지금 먹고 싶은 것이 있는지 물어볼까요?", childQuestionText: "뭐 먹고 싶어?" },
  { id: "G-05", area: "positive_activity", parentDraftText: "오늘 즐겁게 한 일이 있는지 물어볼까요?", childQuestionText: "오늘 재밌게 한 거 있어?" },
  { id: "G-06", area: "content", parentDraftText: "가장 좋아하는 캐릭터가 무엇인지 물어볼까요?", childQuestionText: "제일 좋아하는 캐릭터 뭐야?" },
  { id: "G-07", area: "weekend", parentDraftText: "주말에 하고 싶은 것이 있는지 물어볼까요?", childQuestionText: "주말에 뭐 하고 싶어?" },
];

// §7 RED LIST
export const RED_RULES: readonly RedRule[] = [
  {
    id: "R-01",
    area: "emotion_cause",
    pattern: /(때문인\s*것\s*같|왜\s*그런지|무슨\s*일\s*있었는지\s*캐|기분\s*안\s*좋.{0,10}(이유|원인)|속상한\s*일\s*있었)/,
    coachingText:
      "1학년은 어른이 제시한 이유에 맞춰 답하기 쉬워요. 케이는 원인을 대신 캐묻지 않아요. 직접은 '오늘 기억에 남는 일 있어?'처럼 짧게 열어 주세요.",
  },
  {
    id: "R-02",
    area: "peer_conflict",
    pattern: /(누구랑\s*싸웠|친구.{0,10}(싸운|다퉜|괴롭|따돌|왕따))/,
    coachingText: "이 나이에는 친구 문제를 캐물으면 그대로 맞춰 답하거나 입을 닫을 수 있어요. 아이가 먼저 말하면 판단 없이 들어 주세요.",
  },
  {
    id: "R-03",
    area: "academic_pressure",
    pattern: /(시험\s*점수|성적.{0,10}(왜|떨어|올랐)|숙제.{0,10}(안\s*했|왜)|학원.{0,10}(태도|성실))/,
    coachingText: "저학년 공부 압박은 대화를 피하게 만들어요. 결과보다 오늘 재미있게 한 활동을 물어보세요.",
  },
  {
    id: "R-04",
    area: "secret",
    pattern: /(숨기는\s*(거|게|것)|비밀.{0,10}(있|캐|확인)|거짓말.{0,10}(했는지|인지)|몰래[\s\S]{0,10}?(캐|알아내|확인|훔쳐|감시))/,
    coachingText: "케이는 아이 몰래 알아내는 도구가 아니에요. 아이와의 믿음을 지키기 위해 이 요청은 전달하지 않아요.",
  },
  {
    id: "R-05",
    area: "family_complaint",
    pattern: /((엄마|아빠|할머니|할아버지|부모님).{0,10}(싫어|미워|나쁘|불만)|가족.{0,10}(불만|평가))/,
    coachingText: "가족에 대한 아이 마음은 케이가 대신 캐묻지 않아요. 편안한 자리에서 직접 이야기해 주세요.",
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
      "이 질문은 이 학년 허용 질문에 명확히 해당하지 않아 아이에게 전달하지 않아요. 부담 없는 관심사·놀이·학교의 즐거운 경험·먹고 싶은 것·주말 계획 질문으로 바꿔 주세요.",
  },
];

const CONFIG: RouterPolicyConfig = {
  policyVersion: POLICY_VERSION,
  applicableGrade: APPLICABLE_GRADE,
  greenRules: GREEN_RULES,
  redRules: RED_RULES,
  greenAreaPromptGuide:
    "interest(좋아하는 것), school_fun(학교에서 재밌었던 것), play(좋아하는 놀이), food_pref(먹고 싶은 것), positive_activity(즐겁게 한 일), content(좋아하는 캐릭터), weekend(주말 계획)",
  redAreaPromptGuide:
    "emotion_cause(기분 원인 캐기), peer_conflict(친구 갈등·따돌림), academic_pressure(성적·공부 추궁), secret(비밀·거짓말 적발), family_complaint(가족 불만 확인), appearance_body(외모·몸·식사량 캐묻기), romance(이성 관계 캐묻기), sns_control(SNS 통제·감시)",
};

export function getGreenRuleById(ruleId: string): GreenRule | null {
  return getGreenRuleByIdGeneric(CONFIG, ruleId);
}

export function getSafeAlternativeById(alternativeId: string) {
  return getSafeAlternativeByIdGeneric(CONFIG, alternativeId);
}

export async function routeParentQueryGrade1(
  ai: GenAILikeClient,
  model: string,
  rawText: string,
): Promise<ParentQueryRouterResult> {
  return routeParentQuery(CONFIG, ai, model, rawText);
}
