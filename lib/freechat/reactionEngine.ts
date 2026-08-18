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

export const UNCLEAR_AUDIO_TEMPLATES = [
  "말을 잘 못 알아들었어. 다시 말해도 괜찮아.",
  "미안해, 잘 안 들렸어. 다시 한 번 말해줄래?",
  "음, 무슨 말인지 놓쳤어. 다시 얘기해줄 수 있을까?",
  "내가 잘 이해를 못했어. 다시 말해줄래?",
  "미안, 다시 한 번만 말해주면 안 될까?",
  "아, 잘 못 들었어. 다시 말해줄래?",
  "어, 다시 한 번 얘기해줄래?",
  "미안한데, 다시 한 번 말해주면 좋겠어.",
  "잘 안 들렸어, 다시 말해줄 수 있어?",
  "음, 놓쳐버렸어. 다시 말해줄래?",
  "뭐라고 했는지 못 들었어. 다시 말해줘.",
  "아차, 못 들었네. 다시 얘기해줄래?",
  "미안, 한 번만 더 말해줄래?",
  "잘 못 알아들었어. 다시 얘기해줘.",
  "어라, 잘 안 들렸어. 다시 말해볼래?",
  "다시 한 번 말해줄 수 있을까? 잘 못 들었어.",
  "미안, 무슨 말인지 잘 안 들렸어.",
  "응? 다시 한 번 말해줄래?",
  "다시 얘기해줘, 잘 안 들렸거든.",
  "뭐라고 했어? 다시 말해줄래?",
  "잘 못 들었어. 한 번 더 말해줄래?"
];

export const APP_MODE_TEMPLATES = [
  "그건 잘 모르겠어.",
  "아쉽게도 그 부분은 내가 잘 몰라.",
  "미안해, 그건 내가 대답하기 어려워.",
  "그건 내가 아는 내용이 아니네.",
  "음, 그건 잘 모르겠어.",
  "아, 그건 내가 잘 모르는 거야.",
  "미안, 그건 잘 모르겠네.",
  "어, 그건 잘 모르겠어.",
  "저기, 그건 내가 잘 모르는 부분이야.",
  "그건 대답하기가 좀 어려워.",
  "미안한데, 그건 잘 모르겠어.",
  "그 부분은 내가 잘 모르는 거네.",
  "음... 그건 내가 잘 모르는 내용이야.",
  "아쉽지만 그건 잘 모르겠어.",
  "그건 잘 모르겠는데?",
  "그건 내가 잘 알지 못하는 거야.",
  "미안해, 그건 잘 모르겠어.",
  "그건 내가 대답하기 힘든 질문이네.",
  "그건 잘 모르는 거야. 미안해.",
  "어, 그건 내가 잘 모르겠어.",
  "그건 내가 잘 아는 게 아니야."
];

export const REPEAT_TEMPLATES = [
  "계속 반복돼서 답답했구나.",
  "아, 계속 반복돼서 답답했구나.",
  "음, 계속 반복돼서 답답했구나.",
  "그래, 계속 반복돼서 답답했구나.",
  "자꾸 반복돼서 답답했구나.",
  "반복되니까 답답했구나.",
  "아, 반복돼서 많이 답답했구나.",
  "음, 자꾸 반복되니까 답답했지.",
  "계속 반복되니까 답답했구나.",
  "반복되는 게 답답했구나.",
  "아하, 반복돼서 답답했구나.",
  "맞아, 반복되면 답답하지.",
  "음, 계속 반복돼서 답답했지.",
  "어, 반복돼서 답답했구나.",
  "저런, 계속 반복돼서 답답했구나.",
  "계속 반복되어서 답답했구나.",
  "반복돼서 답답했지?",
  "자꾸 반복되는 게 답답했구나.",
  "그래, 계속 반복되니까 답답했겠다.",
  "아, 반복돼서 답답한 거구나.",
  "음, 계속 반복되는 게 답답했구나."
];

export const STOP_TEMPLATES = [
  "이제 그만했으면 좋겠구나.",
  "아, 이제 그만했으면 좋겠구나.",
  "음, 이제 그만했으면 좋겠구나.",
  "그래, 이제 그만했으면 좋겠구나.",
  "그만했으면 좋겠구나.",
  "이제 그만하고 싶구나.",
  "아, 그만했으면 하는구나.",
  "음, 이제 그만하고 싶구나.",
  "그만했으면 좋겠다는 뜻이구나.",
  "아하, 이제 그만하고 싶다는 거구나.",
  "맞아, 이제 그만했으면 좋겠지.",
  "음, 그만했으면 좋겠다는 거지.",
  "어, 이제 그만했으면 좋겠구나.",
  "저런, 이제 그만했으면 좋겠구나.",
  "이제 그만할까 싶구나.",
  "그만했으면 좋겠지?",
  "이제 그만했으면 하는 마음이구나.",
  "그래, 그만하고 싶구나.",
  "아, 이제 그만하고 싶은 거구나.",
  "음, 그만했으면 좋겠구나.",
  "이제 그만하고 싶다는 이야기구나."
];

export const PASSIVE_TEMPLATES = [
  "수동으로 이야기하고 싶구나.",
  "아, 수동으로 이야기하고 싶구나.",
  "음, 수동으로 이야기하고 싶구나.",
  "그래, 수동으로 이야기하고 싶구나.",
  "수동으로 하고 싶구나.",
  "수동 모드로 이야기하고 싶구나.",
  "아, 수동으로 하고 싶구나.",
  "음, 수동으로 이야기하고 싶다는 거구나.",
  "수동으로 이야기하고 싶다는 뜻이구나.",
  "아하, 수동으로 하고 싶구나.",
  "맞아, 수동으로 이야기하고 싶지.",
  "음, 수동으로 하고 싶다는 거지.",
  "어, 수동으로 이야기하고 싶구나.",
  "수동 모드를 원하는구나.",
  "수동으로 이야기할까 싶구나.",
  "수동으로 하고 싶지?",
  "수동으로 이야기하고 싶은 마음이구나.",
  "그래, 수동으로 하고 싶구나.",
  "아, 수동으로 하고 싶은 거구나.",
  "음, 수동으로 하고 싶구나.",
  "수동으로 이야기하고 싶다는 이야기구나."
];

export function getNeutralTemplates(formatted: string): string[] {
  return [
    `${formatted}구나.`,
    `아, ${formatted}구나.`,
    `음, ${formatted}구나.`,
    `그래, ${formatted}구나.`,
    `그렇게 ${formatted}구나.`,
    `정말 ${formatted}구나.`,
    `아하, ${formatted}구나.`,
    `음... ${formatted}구나.`,
    `진짜 ${formatted}구나.`,
    `오, ${formatted}구나.`,
    `맞아, ${formatted}구나.`,
    `응, ${formatted}구나.`,
    `어, ${formatted}구나.`,
    `저런, ${formatted}구나.`,
    `그랬지, ${formatted}구나.`,
    `아무래도 ${formatted}구나.`,
    `역시 ${formatted}구나.`,
    `그렇지, ${formatted}구나.`,
    `그러게, ${formatted}구나.`,
    `확실히 ${formatted}구나.`,
    `정말로 ${formatted}구나.`
  ];
}

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

/** 1글자여도 뜻이 분명한 대답. 이걸 "못 알아들었어"로 받으면 아이는
 *  자기가 분명히 대답했는데 케이가 무시했다고 느낀다(2026-08-18 안서아 사고). */
export const CLEAR_SINGLE_CHAR_UTTERANCES = new Set([
  "응", "어", "네", "예", "왜", "뭐", "음", "아", "오", "흠", "그", "안", "헐", "짱", "굿",
  "쉿", "콜", "얍", "엥", "꺅", "와", "야", "흥", "휴", "헉", "웅", "엉", "넵", "넹", "넴"
]);

export function classifyAndExtract(text: string, opts?: ReflectiveReactionOptions): { category: ReflectiveCategory, extracted: string | null } {
  const trimmed = text.trim();
  const isUnclearShort = trimmed.length === 0 || (trimmed.length === 1 && !CLEAR_SINGLE_CHAR_UTTERANCES.has(trimmed));
  if (opts?.isLowConfidenceAsr || isUnclearShort) {
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
  const cleanText = text.replace(/[.?!,]/g, '').trim();
  if (cleanText.length >= 2 || CLEAR_SINGLE_CHAR_UTTERANCES.has(cleanText)) {
    const normText = cleanText.replace(/\s+/g, '');
    if (normText.includes("너무많이반복해")) return { category: "neutral_statement", extracted: "계속 반복돼서 답답했" };
    if (normText.includes("이제그만해")) return { category: "neutral_statement", extracted: "이제 그만했으면 좋겠" };
    if (normText.includes("수동으로해줘")) return { category: "neutral_statement", extracted: "수동으로 이야기하고 싶" };
    
    return { category: "neutral_statement", extracted: cleanText };
  }
  return { category: "unclear_audio", extracted: null };
}

function normalizeText(t: string) {
  return t.replace(/[\s.?!,]/g, '');
}


const VARIANTS = [
  (t: string) => `아, ${t}`,
  (t: string) => `음, ${t}`,
  (t: string) => `그렇구나. ${t}`,
  (t: string) => `그래, ${t}`,
  (t: string) => `${t} 그랬구나.`,
  (t: string) => `정말 ${t}`,
  (t: string) => `${t} 맞지?`,
  (t: string) => `${t} 알겠어.`,
  (t: string) => `${t} 이해했어.`,
  (t: string) => `아하, ${t}`,
  (t: string) => `음... ${t}`,
  (t: string) => `진짜 ${t}`,
  (t: string) => `그랬구나, ${t}`,
  (t: string) => `그렇게 ${t}`,
  (t: string) => `정말로 ${t}`,
  (t: string) => `오, ${t}`,
  (t: string) => `그렇구나, ${t}`,
  (t: string) => `알았어. ${t}`,
  (t: string) => `${t} 그렇구나.`,
  (t: string) => `맞아, ${t}`,
  (t: string) => `응, ${t}`,
  (t: string) => `어, ${t}`,
  (t: string) => `저런, ${t}`,
  (t: string) => `그랬구나... ${t}`
];

function pickAvoiding<T>(
  list: T[], 
  history: string[], 
  textOf: (item: T) => string, 
  rand: () => number,
  mutate?: (item: T, idx: number) => T
): T | null {
  if (list.length === 0) return null;
  const normHistory = history.filter(Boolean).map(normalizeText);
  const avoid = new Set(normHistory);

  let candidates = list.filter((item) => !avoid.has(normalizeText(textOf(item))));
  
  if (candidates.length > 0) {
    return candidates[Math.floor(rand() * candidates.length)];
  }

  if (mutate) {
    const variations: T[] = [];
    for (let i = 0; i < VARIANTS.length; i++) {
      for (const item of list) {
        variations.push(mutate(item, i));
      }
    }
    candidates = variations.filter((item) => !avoid.has(normalizeText(textOf(item))));
    if (candidates.length > 0) {
      return candidates[Math.floor(rand() * candidates.length)];
    }
  }

  for (let keep = normHistory.length - 1; keep >= 1; keep--) {
    const smallerAvoid = new Set(normHistory.slice(-keep));
    const fallbackCandidates = list.filter(item => !smallerAvoid.has(normalizeText(textOf(item))));
    if (fallbackCandidates.length > 0) {
      return fallbackCandidates[Math.floor(rand() * fallbackCandidates.length)];
    }
  }

  return list[Math.floor(rand() * list.length)];
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
  
  let { category, extracted } = classifyAndExtract(childText, opts);

  if (extracted && extracted.length > 15) {
    extracted = null;
  }

  
  if (category === "unclear_audio" || (!extracted && category === "neutral_statement")) {
    const text = pickAvoiding(UNCLEAR_AUDIO_TEMPLATES, recentKTexts, t => t, rand)!;
    return { text, category: "unclear_audio" };
  }
  
  if (category === "app_mode_question") {
    const text = pickAvoiding(APP_MODE_TEMPLATES, recentKTexts, t => t, rand)!;
    return { text, category };
  }


  if (category === "neutral_statement" && extracted) {
    let formatted = extracted;
    if (formatted === "계속 반복돼서 답답했") {
       const text = pickAvoiding(REPEAT_TEMPLATES, recentKTexts, t => t, rand)!;
       return { text, category };
    }
    if (formatted === "이제 그만했으면 좋겠") {
       const text = pickAvoiding(STOP_TEMPLATES, recentKTexts, t => t, rand)!;
       return { text, category };
    }
    if (formatted === "수동으로 이야기하고 싶") {
       const text = pickAvoiding(PASSIVE_TEMPLATES, recentKTexts, t => t, rand)!;
       return { text, category };
    }

    if (formatted.endsWith("해줘")) formatted = formatted.replace(/해줘$/, "하고 싶");
    else if (formatted.endsWith("해")) formatted = formatted.replace(/해$/, "하");
    else if (formatted.endsWith("고 싶어")) formatted = formatted.replace(/고 싶어$/, "고 싶");
    else if (formatted.endsWith("싶어")) formatted = formatted.replace(/싶어$/, "싶");
    else if (formatted.endsWith("야")) formatted = formatted.replace(/야$/, "이");
    else if (formatted.endsWith("다")) formatted = formatted.replace(/다$/, "");
    else if (formatted.endsWith("어")) formatted = formatted.replace(/어$/, "었");

    const templates = getNeutralTemplates(formatted);
    const reflectText = pickAvoiding(templates, recentKTexts, t => t, rand);
    return { text: reflectText!, category };
  }

  let pool = reactionSeed.filter((item) => item.intent === category);
  
  if (pool.length === 0) {
    pool = reactionSeed.filter((item) => item.intent === "event_story");
  }

  if (!extracted) {
    pool = pool.filter(p => !p.banConditions.includes("!hasExplicitEmotion") && !p.slotRequired);
  }

  if (pool.length === 0) {
    {
    const text = pickAvoiding(UNCLEAR_AUDIO_TEMPLATES, recentKTexts, t => t, rand)!;
    return { text, category: "unclear_audio" };
  }
  }

  const filledPool = pool.map(item => ({
    ...item,
    filledText: fillSlot(item.text, extracted)
  }));

  const reflectItem = pickAvoiding(filledPool, recentKTexts, (item) => item.filledText, rand, (item, idx) => ({ ...item, filledText: VARIANTS[idx % VARIANTS.length](item.filledText) }));
  if (!reflectItem) {
    {
    const text = pickAvoiding(UNCLEAR_AUDIO_TEMPLATES, recentKTexts, t => t, rand)!;
    return { text, category: "unclear_audio" };
  }
  }

  let finalText = reflectItem.filledText;

  if (finalText.includes("{")) {
    {
    const text = pickAvoiding(UNCLEAR_AUDIO_TEMPLATES, recentKTexts, t => t, rand)!;
    return { text, category: "unclear_audio" };
  }
  }

  if (finalText.split(/\s+/).length > 15) {
    {
    const text = pickAvoiding(UNCLEAR_AUDIO_TEMPLATES, recentKTexts, t => t, rand)!;
    return { text, category: "unclear_audio" };
  }
  }

  return { text: finalText, category };
}
