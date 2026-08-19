// 놀이 정답 대조용 후보 추출 (015 2차).
//
// 아이는 답만 딱 말하지 않는다. 되풀이하고("마네킹 이라고 마네킹"), 앞뒤에 말을 붙이고
// ("그러니까 도서관", "어 도서관 이라고"), 조사를 단다. 발화 전체를 하나로 붙여 정답과
// 완전히 같은지만 보면 이런 답이 전부 오답이 된다.
//
// 2026-08-19 김서아 Dev 실측 — 같은 원인이 두 놀이에서 세 가지 증상으로 나타났다:
//   넌센스: 아이가 "마네킹"을 세 번 말했는데 계속 오답 → 힌트 루프
//   초성:   "도서관 이라고" 가 오답 처리되어 세션이 안 넘어가고 같은 초성이 다시 나옴
//
// 그래서 어절 단위로 자른 뒤 이어붙인 조합까지 후보로 만든다.
// **부분 문자열로 비교하지 않는다** — 그러면 정답 "달"이 아이가 말한 "달력"에 걸려
// 틀린 답이 정답이 된다. 어절 경계를 지키는 한 그런 오탐은 생기지 않는다.

/** 이어붙일 최대 어절 수. 문장 전체가 후보가 되는 것을 막는다. */
export const MAX_ANSWER_WINDOW = 3;

const TRIM_PUNCTUATION = /^[\s!?.~^,;:…"']+|[\s!?.~^,;:…"']+$/g;

/**
 * 아이 발화에서 정답 후보 집합을 만든다.
 *
 * @param normalize 놀이별 정규화 함수(초성게임과 넌센스퀴즈의 규칙이 다르다).
 */
export function collectPlayAnswerCandidates(
  childUtterance: string,
  normalize: (text: string) => string
): Set<string> {
  const candidates = new Set<string>();
  const add = (value: string) => {
    const normalized = normalize(value);
    if (normalized) candidates.add(normalized);
  };

  add(childUtterance);

  const words = childUtterance
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(TRIM_PUNCTUATION, ""))
    .filter(Boolean);

  for (let start = 0; start < words.length; start += 1) {
    for (let size = 1; size <= MAX_ANSWER_WINDOW && start + size <= words.length; size += 1) {
      add(words.slice(start, start + size).join(""));
    }
  }
  return candidates;
}
