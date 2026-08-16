/**
 * 한글 음소(자모) 분해 및 음성 유사도 유틸리티.
 * STT 오인식 복구를 위해 한글 음절을 초성·중성·종성으로 분해하고 자모 편집 거리를 계산한다.
 */

const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;

const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const JUNGSUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

const JONGSUNG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/**
 * 한글 음절을 초성·중성·종성으로 분해한다.
 * 한글 음절(가~힣)이 아니면(낱자 자모, 알파벳, 숫자 등) 문자를 그대로 둔다.
 */
export function decomposeHangul(text: string): string {
  let result = "";

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (code >= HANGUL_SYLLABLE_START && code <= HANGUL_SYLLABLE_END) {
      const offset = code - HANGUL_SYLLABLE_START;
      const jongIndex = offset % 28;
      const jungIndex = Math.floor(offset / 28) % 21;
      const choIndex = Math.floor(offset / (28 * 21));

      result += CHOSUNG[choIndex] + JUNGSUNG[jungIndex] + JONGSUNG[jongIndex];
    } else {
      result += text[i];
    }
  }

  return result;
}

/**
 * 자모 기준 Levenshtein 편집 거리.
 * 짧은 문자열(단어/구) 비교용 DP 알고리즘.
 */
export function jamoEditDistance(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;

  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  let prev = Array.from({ length: lenB + 1 }, (_, i) => i);
  let curr = new Array<number>(lenB + 1).fill(0);

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    const charA = a[i - 1];

    for (let j = 1; j <= lenB; j++) {
      const cost = charA === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
    }

    const temp = prev;
    prev = curr;
    curr = temp;
  }

  return prev[lenB];
}

/**
 * 공백 및 문장부호/특수문자를 제거하여 순수 글자만 남긴다.
 */
function normalizeForPhonetic(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * 오인식 가능성을 고려해 두 표현이 같은 말인지 판정한다.
 * 공백·문장부호는 비교 전에 제거하며, 길이에 비례한 허용 오차를 적용한다.
 *
 * [길이별 허용치 설계 근거]
 * 1. 2음절 이하(자모 길이 <= 5, 예: '퀴즈' 4자모, '초성' 5자모): maxDist = 1
 *    - 2음절 단어에서 2자모 이상 차이나면 완전히 다른 단어가 된다 (예: '기말' ↔ '끝말' 거리 2 차단).
 * 2. 3음절 이상(자모 길이 >= 6, 예: '초성퀴즈' 9자모, '끝말잇기' 10자모): maxDist = 2
 *    - 긴 표현에서는 발음 뭉개짐(자음/모음 변형 및 탈락)으로 2자모까지 허용하되,
 *      오탐 방지를 위해 3자모 이상은 차단한다 (예: '기말고사' ↔ '끝말잇기' 거리 5 차단).
 */
export function isPhoneticallySimilar(input: string, target: string): boolean {
  const cleanInput = normalizeForPhonetic(input);
  const cleanTarget = normalizeForPhonetic(target);

  if (!cleanInput || !cleanTarget) return false;
  if (cleanInput === cleanTarget) return true;

  const jamoInput = decomposeHangul(cleanInput);
  const jamoTarget = decomposeHangul(cleanTarget);

  const dist = jamoEditDistance(jamoInput, jamoTarget);

  const targetJamoLen = jamoTarget.length;
  const maxAllowed = targetJamoLen <= 5 ? 1 : 2;

  return dist <= maxAllowed;
}
