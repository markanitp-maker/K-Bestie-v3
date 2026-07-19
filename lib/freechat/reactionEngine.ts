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
