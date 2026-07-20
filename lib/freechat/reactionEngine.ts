import reactionSeedData from './reactionSeed.json' with { type: 'json' };

export interface ReactionOptions {
  isLowConfidenceAsr?: boolean;
  isQuestionFromChild?: boolean;
}

export interface ReactionResult {
  id: string;
  text: string;
  situationGroup: number;
}

export interface ReactionSeedItem {
  id: string;
  situation_group: number;
  emotion: string;
  intensity: string;
  topic: string;
  keywords: string[];
  review_status: string;
  text: string;
}

const reactionSeed: ReactionSeedItem[] = reactionSeedData as ReactionSeedItem[];

export function classifyInput(text: string, opts?: ReactionOptions): number {
  if (opts?.isLowConfidenceAsr) {
    return 30;
  }
  
  const isQuestion = text.trim().endsWith('?') || /뭐야|왜|어떻게|누구야|어디야|언제야|무엇|무슨/.test(text);
  if (opts?.isQuestionFromChild || isQuestion) {
    return 29;
  }

  // Find the first group that has a matching keyword
  for (const item of reactionSeed) {
    if (item.keywords && item.keywords.length > 0) {
      for (const keyword of item.keywords) {
        if (text.includes(keyword)) {
          return item.situation_group;
        }
      }
    }
  }

  // Fallback
  return 5;
}

export function detectInputIntensity(text: string): 'low' | 'medium' | 'high' {
  const t = text.trim();
  if (t.length <= 5 || /^(그냥|몰라|어|응|아니|글쎄|뭐|응응|아니아니)$/.test(t)) {
    return 'low';
  }
  if (/(진짜|완전|너무너무|엄청|정말정말)/.test(t) || /[!~]{2,}/.test(t) || /[ㅠㅜ]{3,}/.test(t) || /([아-힣])\1{3,}/.test(t)) {
    return 'high';
  }
  return 'medium';
}

export function pickReaction(situationGroup: number, recentTextsHistory: string[], detectedIntensity?: 'low' | 'medium' | 'high'): { id: string; text: string } {
  let candidates = reactionSeed.filter(item => item.situation_group === situationGroup);
  
  if (candidates.length === 0) {
    candidates = reactionSeed.filter(item => item.situation_group === 5);
  }

  // Filter by intensity if provided
  let filteredCandidates = candidates;
  if (detectedIntensity) {
    const intensityMatched = candidates.filter(item => item.intensity === detectedIntensity);
    if (intensityMatched.length > 0) {
      filteredCandidates = intensityMatched;
    }
  }

  const available = filteredCandidates.filter(item => !recentTextsHistory.includes(item.text));
  const pool = available.length > 0 ? available : filteredCandidates;
  const finalPool = pool.length > 0 ? pool : candidates;
  const chosen = finalPool[Math.floor(Math.random() * finalPool.length)];
  
  return { id: chosen.id, text: chosen.text };
}

export function getFreeChatReaction(text: string, recentTextsHistory: string[], opts?: ReactionOptions): ReactionResult {
  const situationGroup = classifyInput(text, opts);
  let detectedIntensity = detectInputIntensity(text);
  if (opts?.isLowConfidenceAsr) {
    detectedIntensity = 'low';
  }
  const reaction = pickReaction(situationGroup, recentTextsHistory, detectedIntensity);

  return {
    id: reaction.id,
    text: reaction.text,
    situationGroup
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 15개 감정/상황 카테고리 기반 "반영적 경청" 엔진 (아래부터 신규 추가분).
// 위의 classifyInput/pickReaction/getFreeChatReaction(1~30 situation_group,
// 질문형/저신뢰 폴백만 구분)은 그대로 유지하되, 자유대화 스펙이 요구하는
// 15개 명시적 카테고리 분류 + 부정 표현 인식 + 선택적 후속 질문을 추가로 얹는다.
// (a) 핵심 의미 반영 + (b) 공감 문장은 위 reactionSeed의 situation_group 텍스트를
// 그대로 재사용한다(새 문구를 새로 쓰지 않고 기존 300여 개 분류 데이터셋을 활용).

export type ReflectiveCategory =
  | "scoldedByParent" | "friendConflict" | "resentment" | "anger" | "upset"
  | "fear" | "loneliness" | "achievement" | "joy" | "excitement"
  | "pain" | "hungry" | "tired" | "boredom" | "neutral";

interface CategoryDef {
  category: ReflectiveCategory;
  keywords: string[];
  situationGroups: number[]; // (a)+(b) 반영/공감 문장을 뽑아올 situation_group 풀 (여러 개면 합쳐서 사용)
}

// 우선순위 순서 — 더 구체적/명확한 신호(꾸중, 친구갈등 등)를 먼저 검사하고,
// "힘들다"처럼 여러 맥락에서 쓰이는 범용 표현(피곤함)은 뒤로 미룬다.
const CATEGORY_DEFS: CategoryDef[] = [
  { category: "scoldedByParent", keywords: ["혼났", "혼나", "혼내"], situationGroups: [18] },
  { category: "friendConflict", keywords: ["싸웠", "다퉜", "절교", "놀려", "놀림받", "괴롭혀", "괴롭힘", "따돌림", "따돌려"], situationGroups: [15, 17] },
  { category: "resentment", keywords: ["억울", "오해"], situationGroups: [11] },
  { category: "anger", keywords: ["화나", "화났", "열받", "분해", "분하", "짜증"], situationGroups: [10] },
  { category: "upset", keywords: ["속상", "슬퍼", "슬펐", "슬프", "눈물", "울었", "울고", "우울", "마음아파"], situationGroups: [8] },
  { category: "fear", keywords: ["무서워", "무섭", "두려워", "두렵", "걱정", "불안", "떨려", "떨렸", "겁나", "겁났"], situationGroups: [12] },
  { category: "loneliness", keywords: ["외로워", "외롭", "혼자", "쓸쓸", "소외"], situationGroups: [13] },
  { category: "achievement", keywords: ["해냈", "잘했", "완성했", "일등", "칭찬받", "인정받"], situationGroups: [2, 3] },
  { category: "joy", keywords: ["좋아", "좋았", "행복", "기뻐", "기뻤"], situationGroups: [1] },
  { category: "excitement", keywords: ["신나", "신났", "설레", "기대돼", "두근"], situationGroups: [24, 1] },
  { category: "pain", keywords: ["아파", "아팠", "아프", "다쳤", "다쳐"], situationGroups: [27] },
  { category: "hungry", keywords: ["배고파", "배고픈", "배고팠", "배고프"], situationGroups: [31] },
  { category: "tired", keywords: ["피곤", "졸려", "졸리", "지쳐", "지쳤", "귀찮", "힘들"], situationGroups: [7] },
  { category: "boredom", keywords: ["심심", "지루", "따분", "재미없"], situationGroups: [6] },
];

const NEUTRAL_GROUP = 5;   // 평상시(폴백 — 아무 카테고리도 안 걸리지만 정상적인 문장)
const LOW_CONFIDENCE_GROUP = 30; // 저신뢰 ASR/분류 실패 폴백(중립 경청)

// "안 힘들어", "하나도 안 슬퍼" 처럼 키워드 앞에 부정어가 붙는 경우를 걸러낸다.
const NEGATION_PREFIX = /(?:^|[\s,.!?~])(안|전혀|하나도\s*안|별로\s*안|딱히\s*안|그다지\s*안)\s*$/;

function isNegatedAt(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 12), matchIndex);
  if (NEGATION_PREFIX.test(prefix)) return true;
  // "힘들지 않아/않았어"처럼 키워드 뒤에 부정 어미가 붙는 경우
  const suffix = text.slice(matchIndex, matchIndex + 20);
  if (/^[가-힣]*지\s*않/.test(suffix)) return true;
  return false;
}

export interface ReflectiveClassifyOptions {
  isLowConfidenceAsr?: boolean;
}

export interface ReflectiveClassifyResult {
  category: ReflectiveCategory;
  situationGroups: number[];
  isLowConfidenceFallback: boolean;
}

/** 15개 카테고리 분류 — 부정 표현을 인식해 긍정 카테고리로 오분류하지 않는다. */
export function classifyReflective(text: string, opts?: ReflectiveClassifyOptions): ReflectiveClassifyResult {
  if (opts?.isLowConfidenceAsr) {
    return { category: "neutral", situationGroups: [LOW_CONFIDENCE_GROUP], isLowConfidenceFallback: true };
  }

  for (const def of CATEGORY_DEFS) {
    for (const kw of def.keywords) {
      let idx = text.indexOf(kw);
      while (idx !== -1) {
        if (!isNegatedAt(text, idx)) {
          return { category: def.category, situationGroups: def.situationGroups, isLowConfidenceFallback: false };
        }
        idx = text.indexOf(kw, idx + 1);
      }
    }
  }

  return { category: "neutral", situationGroups: [NEUTRAL_GROUP], isLowConfidenceFallback: false };
}

// 후속 질문 뱅크 — "왜 그랬어?" 류의 추궁형 금지, 이미 아이가 말한 범위를 벗어나는 새 주제 금지.
// neutral은 질문 뱅크가 없음(중립일 때는 절대 질문을 강제하지 않는다).
const QUESTION_BANK: Partial<Record<ReflectiveCategory, string[]>> = {
  scoldedByParent: ["무슨 일이 있었는지 말해줄래?"],
  friendConflict: ["무슨 일로 그렇게 됐는지 말해줄래?"],
  resentment: ["어떤 부분이 제일 억울했어?"],
  anger: ["뭐 때문에 그랬는지 말해줄래?"],
  upset: ["무슨 일이 있었는지 말해줄래?", "어떤 게 제일 속상했어?"],
  fear: ["뭐가 제일 무서웠어?"],
  loneliness: ["누구랑 같이 있고 싶었어?"],
  achievement: ["어떤 부분이 제일 뿌듯했어?"],
  joy: ["뭐가 제일 좋았어?"],
  excitement: ["가장 신났던 순간이 언제였어?"],
  pain: ["어디가 제일 아팠어?"],
  hungry: ["지금 먹고 싶은 게 있어?"],
  tired: ["어떤 게 가장 힘들었는지 이야기해도 괜찮아."],
  boredom: ["뭐 하면 재밌을 것 같아?"],
};

function poolForGroups(groups: number[]): ReactionSeedItem[] {
  const pool = reactionSeed.filter((item) => groups.includes(item.situation_group));
  return pool.length > 0 ? pool : reactionSeed.filter((item) => item.situation_group === NEUTRAL_GROUP);
}

function pickAvoiding<T>(list: T[], avoid: Set<string>, textOf: (item: T) => string, rand: () => number): T {
  const candidates = list.filter((item) => !avoid.has(textOf(item)));
  const finalPool = candidates.length > 0 ? candidates : list;
  return finalPool[Math.floor(rand() * finalPool.length)];
}

export interface ReflectiveReactionOptions {
  isLowConfidenceAsr?: boolean;
  /** 테스트 결정성을 위한 난수 함수 주입(기본 Math.random) */
  rand?: () => number;
}

export interface ReflectiveReactionResult {
  text: string;
  category: ReflectiveCategory;
}

/**
 * 아이 발화를 15개 카테고리로 분류해 (a) 핵심 의미 반영 + (b) 공감 문장 → (c) 선택적 후속 질문
 * 구조의 케이 반응을 생성한다. LLM 호출 없음 — 전부 규칙/데이터셋 기반.
 * @param childText 아이의 최종 STT 문장(정규화된 텍스트)
 * @param recentKTexts 최근 케이가 실제로 말한 문장들(동일 문장 연속 반복 방지용)
 */
export function generateReflectiveReaction(
  childText: string,
  recentKTexts: string[],
  opts?: ReflectiveReactionOptions
): ReflectiveReactionResult {
  const rand = opts?.rand ?? Math.random;
  const avoid = new Set(recentKTexts.filter(Boolean));

  const { category, situationGroups } = classifyReflective(childText, { isLowConfidenceAsr: opts?.isLowConfidenceAsr });
  const pool = poolForGroups(situationGroups);
  const reflectItem = pickAvoiding(pool, avoid, (item) => item.text, rand);
  let reflectLine = reflectItem.text;
  if (!/[.!?~]$/.test(reflectLine)) reflectLine += ".";

  const questions = QUESTION_BANK[category];
  const shouldAsk = !!questions && questions.length > 0 && rand() < 0.5;
  let finalText = reflectLine;

  if (shouldAsk && questions) {
    const question = pickAvoiding(questions, avoid, (q) => q, rand);
    const candidate = `${reflectLine} ${question}`;
    // 후속 질문까지 붙인 최종 문장이 최근 반복이면, 질문 없이 반영/공감 문장만으로 대체한다.
    finalText = avoid.has(candidate) ? reflectLine : candidate;
  }

  return { text: finalText, category };
}
