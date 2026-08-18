/**
 * 케이 응답이 초성게임 상태와 어긋나는지 본다.
 * 지시문은 강제력이 없다 — 이 프로젝트에서 이미 여러 번 뚫렸다. 출력을 직접 본다.
 */
export function detectChosungAnswerLeak(text: string, currentWord: string): boolean {
  if (!text || !currentWord) return false;
  const cleanWord = currentWord.trim();
  if (!cleanWord) return false;
  return text.includes(cleanWord);
}

/**
 * 케이 응답이 이번 턴에 내야 하는 초성과 일치하는지 검증한다.
 * 모델이 초성을 임의로 지어내어 출제하는 사고(2026-08-18)를 막기 위해
 * 출력을 직접 검증하여 필수 초성 누락/불일치를 감지한다.
 */
export function detectChosungPuzzleMismatch(
  text: string,
  requiredChosung: string
): boolean {
  if (!requiredChosung) return false;
  const cleanChosung = requiredChosung.trim();
  if (!cleanChosung) return false;
  if (!text) return true;

  // 1. 단순 포함 검사
  if (text.includes(cleanChosung)) return false;

  // 2. 공백 및 문장부호/특수문자 제거 후 정규화 비교
  const normalize = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, "");
  const normChosung = normalize(cleanChosung);
  const normText = normalize(text);

  if (normChosung && normText.includes(normChosung)) {
    return false;
  }

  return true;
}

