// requests/request-parent-query-router-grade3-v1.md — 초등학교 3학년 정책 데이터.
// §13: "4학년 실사용·회귀 검증 후 두 번째 순서로 활성화 검토" — production_enabled=false.

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

export const POLICY_VERSION = "PQR-G3-1.1";
export const APPLICABLE_GRADE = 3;

// §6 GREEN LIST — dream 대신 admiration(§6 3학년 특칙).
export const GREEN_RULES: readonly GreenRule[] = [
  { id: "G-01", area: "interest", parentDraftText: "요즘 가장 좋아하거나 빠져 있는 것이 있는지 물어볼까요?", childQuestionText: "요즘 제일 좋아하는 거 뭐야?" },
  { id: "G-02", area: "school_fun", parentDraftText: "오늘 학교에서 가장 재밌었던 일이 무엇인지 물어볼까요?", childQuestionText: "오늘 학교에서 제일 재밌었던 거 하나만 말해줄래?" },
  { id: "G-03", area: "subject_like", parentDraftText: "학교에서 무엇을 할 때 가장 좋은지 물어볼까요?", childQuestionText: "학교에서 뭐 할 때가 제일 좋아?" },
  { id: "G-04", area: "food_pref", parentDraftText: "요즘 가장 먹고 싶은 것이 있는지 물어볼까요?", childQuestionText: "요즘 제일 먹고 싶은 거 있어?" },
  { id: "G-05", area: "pride", parentDraftText: "오늘 스스로 잘했다고 느낀 일이 있는지 물어볼까요?", childQuestionText: "오늘 '나 이거 잘했다!' 싶은 거 있었어?" },
  { id: "G-06", area: "content", parentDraftText: "요즘 자주 보는 것이나 즐기는 게임이 있는지 물어볼까요?", childQuestionText: "요즘 제일 자주 보는 거나 하는 게임 있어?" },
  { id: "G-07", area: "weekend", parentDraftText: "이번 주말에 하고 싶은 것이 있는지 물어볼까요?", childQuestionText: "이번 주말에 뭐 하고 싶어?" },
  { id: "G-08", area: "admiration", parentDraftText: "요즘 멋있다고 느끼는 것이 있는지 물어볼까요?", childQuestionText: "요즘 '이거 멋있다!' 싶은 거 있어?" },
];

// §7 RED LIST
export const RED_RULES: readonly RedRule[] = [
  {
    id: "R-01",
    area: "emotion_cause",
    pattern: /(때문인\s*것\s*같|왜\s*그런지|무슨\s*일\s*있었는지\s*캐|기분\s*안\s*좋.{0,10}(이유|원인)|속상한\s*일\s*있었)/,
    coachingText:
      "3학년은 '왜'라고 물으면 어른 짐작에 맞춰 답하기 쉬워요. 케이는 원인을 캐묻지 않고, 직접은 '오늘 기억에 남는 일 있어?'처럼 열어 주세요.",
  },
  {
    id: "R-02",
    area: "peer_conflict",
    pattern: /(누구랑\s*싸웠|친구.{0,10}(싸운|다퉜|괴롭|따돌|왕따))/,
    coachingText: "이 나이에는 친구 문제를 캐물으면 오히려 입을 닫을 수 있어요. 아이가 먼저 이야기하면 편들거나 판단하지 말고 들어 주세요.",
  },
  {
    id: "R-03",
    area: "academic_pressure",
    pattern: /(시험\s*점수|성적.{0,10}(왜|떨어|올랐)|숙제.{0,10}(안\s*했|왜)|학원.{0,10}(태도|성실))/,
    coachingText: "3학년 공부 압박은 대화 자체를 피하게 만들 수 있어요. '오늘 어떤 활동이 재미있었어?'처럼 부담 없이 물어보세요.",
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
    "interest(좋아하는 것/요즘 빠진 것), school_fun(학교에서 재밌었던 것), subject_like(좋아하는 과목·활동), food_pref(먹고 싶은 것), pride(잘한 것/뿌듯한 일), content(보는 영상·게임), weekend(주말 계획), admiration(멋있다고 느끼는 것)",
  redAreaPromptGuide:
    "emotion_cause(기분 원인 캐기), peer_conflict(친구 갈등·따돌림), academic_pressure(성적·공부 추궁), secret(비밀·거짓말 적발), family_complaint(가족 불만 확인), appearance_body(외모·몸·식사량 캐묻기), romance(이성 관계 캐묻기), sns_control(SNS 통제·감시)",
};

export function getGreenRuleById(ruleId: string): GreenRule | null {
  return getGreenRuleByIdGeneric(CONFIG, ruleId);
}

export function getSafeAlternativeById(alternativeId: string) {
  return getSafeAlternativeByIdGeneric(CONFIG, alternativeId);
}

export async function routeParentQueryGrade3(
  ai: GenAILikeClient,
  model: string,
  rawText: string,
): Promise<ParentQueryRouterResult> {
  return routeParentQuery(CONFIG, ai, model, rawText);
}
