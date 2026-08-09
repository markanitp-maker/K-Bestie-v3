// K Conversation Engine — 발화 의미 신호 추출 (codex-rv 지적 반영: 기존
// lib/freechat/reactionEngine.ts의 10-카테고리 분류는 canned 템플릿 선택용으로 설계되어
// 071의 12개 Action을 구분하기엔 너무 성기다("100점 맞았어"가 neutral로 떨어지거나,
// 방귀/투명인간/기억회상/일반지식 질문이 전부 direct_question 하나로 뭉개짐).
// 이 파일은 Action Selector 전용의 더 세밀한 신호를 만든다 — canned 텍스트는 절대 생성하지 않는다.

export interface UtteranceSignals {
  hasAchievement: boolean; // 성공/합격/1등/맞았어/해냈어/이겼어
  hasConflict: boolean; // 친구와 싸움/삐짐/미움
  hasPlayfulSilly: boolean; // 방귀/똥/장난스러운 드립
  hasImaginative: boolean; // 상상/가정("~라면", "투명인간이라면")
  hasMemoryRecallQuery: boolean; // "전에 말했잖아/기억나?" 류 — 아이가 K에게 과거를 되묻는 것
  hasGeneralKnowledgeQuestion: boolean; // 사실/지식형 질문(케이 정체성/취향 질문 제외)
  hasNegativeEmotion: boolean;
  hasPositiveEmotion: boolean;
  hasPhysicalNeed: boolean;
  isVeryShortLowEffort: boolean; // 극단적으로 짧고 내용이 거의 없는 응답(2자 이하 등)
}

const ACHIEVEMENT_KWS = ["1등", "100점", "맞았어", "해냈", "성공했", "이겼", "합격", "칭찬받"];
const CONFLICT_KWS = ["싸웠", "삐졌", "삐쳤", "미워", "화해", "절교", "다퉜"];
const PLAYFUL_SILLY_KWS = ["방귀", "똥", "히히", "ㅋㅋ", "ㅎㅎ", "웃겨", "장난"];
const IMAGINATIVE_KWS = ["라면 좋겠", "라면 어떨까", "만약", "상상", "투명인간", "된다면"];
const MEMORY_RECALL_KWS = ["기억나", "전에 말했", "저번에 말했", "아까 말했", "기억해"];
const NEGATIVE_EMOTION_KWS = ["화나", "화났", "짜증", "속상", "슬퍼", "슬펐", "우울", "무서워", "무섭", "불안", "억울", "서운", "답답"];
const POSITIVE_EMOTION_KWS = ["재밌", "재미", "최고", "좋았", "신나", "기뻐", "행복"];
const PHYSICAL_KWS = ["배고파", "배고프", "졸려", "졸리", "피곤", "지쳐", "아파", "아프"];
const QUESTION_WORDS = ["누구", "어디", "왜", "언제", "무엇", "어떻게", "얼마"];
// 케이 자기 정체성/취향에 대한 질문은 일반지식 질문이 아니라 kPeerPersona/코어 정체성이 이미 처리.
const IDENTITY_QUESTION_KWS = ["몇 살", "몇 학년", "너 이름", "너는 누구", "너 뭐 좋아"];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

export function extractUtteranceSignals(text: string): UtteranceSignals {
  const trimmed = text.trim();
  const isQuestion = /[?？]/.test(trimmed) || includesAny(trimmed, QUESTION_WORDS);
  const isIdentityQuestion = includesAny(trimmed, IDENTITY_QUESTION_KWS);

  return {
    hasAchievement: includesAny(trimmed, ACHIEVEMENT_KWS),
    hasConflict: includesAny(trimmed, CONFLICT_KWS),
    hasPlayfulSilly: includesAny(trimmed, PLAYFUL_SILLY_KWS),
    hasImaginative: includesAny(trimmed, IMAGINATIVE_KWS),
    hasMemoryRecallQuery: includesAny(trimmed, MEMORY_RECALL_KWS),
    hasGeneralKnowledgeQuestion: isQuestion && !isIdentityQuestion && !includesAny(trimmed, MEMORY_RECALL_KWS),
    hasNegativeEmotion: includesAny(trimmed, NEGATIVE_EMOTION_KWS),
    hasPositiveEmotion: includesAny(trimmed, POSITIVE_EMOTION_KWS),
    hasPhysicalNeed: includesAny(trimmed, PHYSICAL_KWS),
    isVeryShortLowEffort: trimmed.length <= 2 && !/[!?ㅋㅎ]/.test(trimmed),
  };
}

/** semantic_group 추정 — Semantic Topic History 기록/조회에 쓸 대략적인 주제 그룹.
 * 071 §9의 MOOD_CHECK류 예시처럼 "의미가 같으면 같은 그룹"을 지향하되, 071 단계에서는
 * 질문은행 metadata(073에서 정식 도입)가 없으므로 신호 기반 근사치를 쓴다. */
export function estimateSemanticGroup(signals: UtteranceSignals): string {
  if (signals.hasAchievement) return "ACHIEVEMENT";
  if (signals.hasConflict) return "FRIEND_CONFLICT";
  if (signals.hasNegativeEmotion) return "MOOD_CHECK";
  if (signals.hasPositiveEmotion) return "MOOD_CHECK";
  if (signals.hasPhysicalNeed) return "PHYSICAL_STATE";
  if (signals.hasMemoryRecallQuery) return "MEMORY_RECALL";
  if (signals.hasImaginative || signals.hasPlayfulSilly) return "PLAYFUL_IMAGINATION";
  if (signals.hasGeneralKnowledgeQuestion) return "GENERAL_QUESTION";
  return "GENERAL_CHAT";
}
