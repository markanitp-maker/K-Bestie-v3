/**
 * Hangul Jamo Unicode Ranges:
 * - \u1100-\u11FF: Hangul Jamo (초성, 중성, 종성)
 * - \u3130-\u318F: Hangul Compatibility Jamo (ㄱ-ㅎ, ㅏ-ㅣ 등)
 * - \uA960-\uA97F: Hangul Jamo Extended-A
 * - \uD7B0-\uD7FF: Hangul Jamo Extended-B
 */
const HANGUL_JAMO_ONLY_REGEX = /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]+$/;

/**
 * STT 전사 결과가 유효하지 않아 버려야 하는지 판정하는 순수 함수.
 * 공백과 문장부호/기호를 제거한 뒤:
 * 1. 빈 문자열
 * 2. 한글 자모만으로 이루어진 문자열 (길이 무관)
 * 위의 경우 true(버림)를 반환한다.
 *
 * 주의: "응", "네", "아니", "왜", "뭐", "나", "너", "음", "어", "아", "웅", "넹" 등의
 * 완성형 한글 음절([가-힣]), 숫자, 영문이 하나라도 포함되어 있으면 false(유효)를 반환한다.
 */
export function isDiscardableTranscript(text: string | null | undefined): boolean {
  if (typeof text !== "string") return true;
  // 공백(\s) 및 문장부호(\p{P}), 기호(\p{S}) 제거
  const stripped = text.replace(/[\s\p{P}\p{S}]/gu, "");
  if (stripped.length === 0) {
    return true;
  }
  return HANGUL_JAMO_ONLY_REGEX.test(stripped);
}
