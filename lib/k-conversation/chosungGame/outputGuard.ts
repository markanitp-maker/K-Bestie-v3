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
