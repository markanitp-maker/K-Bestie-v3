import reactionSeedData from './reactionSeed.json' with { type: 'json' };

export type ReflectiveCategory = 
  | "emotion_disclosure"
  | "event_story"
  | "positive_experience"
  | "physical_need"
  | "preference_interest"
  | "direct_question"
  | "app_mode_question"
  | "unclear_audio"
  | "safety_signal"
  | "neutral_statement";

export interface ReactionSeedItem {
  id: string;
  intent: string;
  text: string;
  slotRequired: boolean;
  slotType: string;
  banConditions: string[];
}

const reactionSeed: ReactionSeedItem[] = reactionSeedData as ReactionSeedItem[];

export interface ReflectiveReactionOptions {
  isLowConfidenceAsr?: boolean;
  rand?: () => number;
}

export interface ReflectiveReactionResult {
  text: string;
  category: ReflectiveCategory;
}

// 1. Keyword dictionaries for extraction and classification
const EMOTION_KWS = ["화나", "화났", "짜증", "속상", "슬퍼", "슬펐", "우울", "무서워", "무섭", "놀랐", "불안", "억울", "서운", "답답", "기뻐", "행복", "신나"];
const POSITIVE_KWS = ["재밌", "재미", "최고", "좋았", "좋아", "신나", "맛있", "자랑", "해냈", "성공"];
const PHYSICAL_KWS = ["배고파", "배고프", "졸려", "졸리", "피곤", "지쳐", "지쳤", "아파", "아프", "추워", "더워"];
const PREF_KWS = ["관심", "좋아해", "이쁘", "예쁘", "멋지", "멋져", "갖고싶"];
const APP_MODE_KWS = ["수동", "자동", "모드", "레고", "동작"];
const EVENT_KWS = ["봤", "만났", "갔", "했", "놀았", "만들었", "샀", "먹었", "왔"];

function isNegated(text: string, kw: string): boolean {
  const idx = text.indexOf(kw);
  if (idx === -1) return false;
  
  const before = text.slice(Math.max(0, idx - 15), idx);
  const after = text.slice(idx + kw.length, Math.min(text.length, idx + kw.length + 15)).replace(/\s+/g, "");

  const negWords = ["안", "전혀", "하나도", "못", "별로"];
  const hasNegWord = negWords.some(n => before.includes(n + " ") || before.endsWith(n));
  const hasNegEnding = ["지않", "않아", "않았", "진않"].some(n => after.includes(n));
  
  return hasNegWord || hasNegEnding;
}

function extractKeyword(text: string, dict: string[]): string | null {
  for (const kw of dict) {
    if (text.includes(kw)) {
      if (isNegated(text, kw)) continue;
      return kw;
    }
  }
  return null;
}

function conjugateVerb(word: string): string {
  const map: Record<string, string> = {
    "관심": "관심 있",
    "좋아해": "좋아하",
    "멋져": "멋지",
    "재미": "재밌",
    "자랑": "자랑스럽",
    "성공": "성공했",
    "짜증": "짜증나",
    "행복": "행복하",
    "불안": "불안하",
    "억울": "억울하",
    "서운": "서운하",
    "답답": "답답하",
    "우울": "우울하",
    "속상": "속상하",
    "무서워": "무섭",
    "기뻐": "기쁘",
    "슬퍼": "슬프",
    "아파": "아프",
    "배고파": "배고프",
    "졸려": "졸리"
  };
  
  if (map[word]) return map[word];

  if (word.endsWith("고파")) return "배고프";
  if (word.endsWith("파")) return word.slice(0, -1) + "프";
  if (word.endsWith("아")) return word.slice(0, -1);
  if (word.endsWith("어")) return word.slice(0, -1);
  return word;
}

export function classifyAndExtract(text: string, opts?: ReflectiveReactionOptions): { category: ReflectiveCategory, extracted: string | null } {
  if (opts?.isLowConfidenceAsr || text.trim().length < 2) {
    return { category: "unclear_audio", extracted: null };
  }

  // 1. App mode question
  if (APP_MODE_KWS.some(kw => text.includes(kw)) && text.includes("?")) {
    return { category: "app_mode_question", extracted: null };
  }

  // 2. Direct question
  if (text.includes("?") || ["누구", "어디", "왜", "언제", "무엇", "어떻게"].some(q => text.includes(q))) {
    return { category: "direct_question", extracted: null };
  }

  // 3. Emotion disclosure
  const emotion = extractKeyword(text, EMOTION_KWS);
  if (emotion) {
    return { category: "emotion_disclosure", extracted: conjugateVerb(emotion) };
  }

  // 4. Physical need
  const phys = extractKeyword(text, PHYSICAL_KWS);
  if (phys) {
    return { category: "physical_need", extracted: conjugateVerb(phys) };
  }

  // 5. Positive experience
  const pos = extractKeyword(text, POSITIVE_KWS);
  if (pos) {
    return { category: "positive_experience", extracted: conjugateVerb(pos) };
  }

  // 6. Preference / Interest
  const pref = extractKeyword(text, PREF_KWS);
  if (pref) {
    return { category: "preference_interest", extracted: conjugateVerb(pref) };
  }

  // 7. Event story
  const evt = extractKeyword(text, EVENT_KWS);
  if (evt) {
    return { category: "event_story", extracted: conjugateVerb(evt) };
  }

  // fallback if too vague
  return { category: "neutral_statement", extracted: null };
}

function pickAvoiding<T>(list: T[], avoid: Set<string>, textOf: (item: T) => string, rand: () => number): T | null {
  const candidates = list.filter((item) => !avoid.has(textOf(item)));
  const finalPool = candidates.length > 0 ? candidates : list;
  if (finalPool.length === 0) return null;
  return finalPool[Math.floor(rand() * finalPool.length)];
}

function fillSlot(template: string, extracted: string | null): string {
  if (!extracted) return template;
  return template.replace(/\{(emotion|content)\}/g, extracted);
}

export function generateReflectiveReaction(
  childText: string,
  recentKTexts: string[],
  opts?: ReflectiveReactionOptions
): ReflectiveReactionResult {
  const rand = opts?.rand ?? Math.random;
  const avoid = new Set(recentKTexts.filter(Boolean));

  let { category, extracted } = classifyAndExtract(childText, opts);

  if (extracted && extracted.length > 15) {
    extracted = null;
  }

  if (category === "unclear_audio") {
    return { text: "말을 잘 못 알아들었어. 천천히 다시 말해도 괜찮아.", category };
  }
  
  if (category === "app_mode_question") {
    return { text: "그건 잘 모르겠어.", category };
  }

  if (category === "neutral_statement") {
    return { text: "그랬구나.", category };
  }

  let pool = reactionSeed.filter((item) => item.intent === category);
  
  if (pool.length === 0) {
    pool = reactionSeed.filter((item) => item.intent === "event_story");
  }

  if (!extracted) {
    pool = pool.filter(p => !p.banConditions.includes("!hasExplicitEmotion") && !p.slotRequired);
  }

  if (pool.length === 0) {
    return { text: "그랬구나.", category };
  }

  const filledPool = pool.map(item => ({
    ...item,
    filledText: fillSlot(item.text, extracted)
  }));

  const reflectItem = pickAvoiding(filledPool, avoid, (item) => item.filledText, rand);
  if (!reflectItem) {
    return { text: "그랬구나.", category };
  }

  let finalText = reflectItem.filledText;

  if (finalText.includes("{")) {
    finalText = "그랬구나.";
  }

  if (finalText.split(/\s+/).length > 15) {
    finalText = "그랬구나.";
  }

  return { text: finalText, category };
}
