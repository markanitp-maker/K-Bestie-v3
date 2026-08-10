const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const CHOSUNG_INTERVAL = 588;

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/**
 * Converts each precomposed Hangul syllable (가~힣) to its initial consonant.
 * Whitespace and every non-Hangul character (numbers, Latin letters, punctuation,
 * standalone jamo, and emoji) are preserved exactly so callers can control display
 * formatting without losing information.
 */
export const extractChosung = (text: string): string => {
  let result = "";

  for (const character of text) {
    const code = character.charCodeAt(0);

    if (code >= HANGUL_SYLLABLE_START && code <= HANGUL_SYLLABLE_END) {
      const chosungIndex = Math.floor((code - HANGUL_SYLLABLE_START) / CHOSUNG_INTERVAL);
      result += CHOSUNG[chosungIndex];
      continue;
    }

    result += character;
  }

  return result;
};
