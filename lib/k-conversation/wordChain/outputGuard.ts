/**
 * 케이 응답이 끝말잇기 결정론적 진행 상태와 일치하는지 검증한다.
 * 지시문은 강제력이 없다 — 모델이 결정된 낱말을 말하지 않으면 게임 상태가 어긋나므로
 * 출력을 직접 검증하여 필수 낱말 누락을 감지한다.
 */
export function detectWordChainOutputViolation(
  text: string,
  requiredWord: string
): boolean {
  if (!requiredWord) return false;
  const cleanWord = requiredWord.trim();
  if (!cleanWord) return false;
  if (!text) return true;

  // 1. 단순 포함 검사
  if (text.includes(cleanWord)) return false;

  // 2. 공백 및 문장부호/특수문자 제거 후 정규화 비교 (단어 내 공백/따옴표/기호 차이 방어)
  const normalize = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, "");
  const normWord = normalize(cleanWord);
  const normText = normalize(text);

  if (normWord && normText.includes(normWord)) {
    return false;
  }

  return true;
}
