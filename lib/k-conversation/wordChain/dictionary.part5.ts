import { WordChainEntry } from "./dictionaryTypes";

/**
 * 끝말잇기 정적 사전 Part 5 — 실사용에서 거절된 기본어 보강.
 *
 * 2026-08-19 김서아 Dev 로그에서 아이가 "유리"를 말했는데 케이가
 * `"유리"(은)는 내가 아직 잘 모르는 단어야!` 라고 거절했다. 아이는 이렇게 말했다:
 *   "너 이거 끝말잇기 할 때 단어가 너무 몰라 (...) 이거 제대로 대응 해야 돼"
 *   "단어장을 니가 갖고 있어야 돼"
 *
 * Part 1~4(1404개) 대비 초등학생이 실제로 쓰는 기본 명사 중 빠진 것을 채운다.
 * 선정 기준은 "초등학생이 끝말잇기에서 낼 법한 일상 명사"이며, 고유명사·활용형·
 * 조사 결합형은 넣지 않는다(validateWordChainDictionary 규칙 그대로).
 *
 * 특히 '리'로 시작하는 낱말이 얇았다 — "유리" 다음에 이어갈 말이 없으면 게임이 막힌다.
 */
export const DICTIONARY_PART5: readonly WordChainEntry[] = [
  // 로그에서 실제로 거절당한 단어
  { word: "유리", difficulty: 1, category: "생활" },

  // '리'로 시작 — 위 단어 다음 차례를 위해 함께 넣는다
  { word: "리본", difficulty: 1, category: "생활" },
  { word: "리코더", difficulty: 2, category: "학교" },
  { word: "리듬", difficulty: 2, category: "음악" },
  { word: "리터", difficulty: 3, category: "단위" },

  // 탈것·사물
  { word: "자동차", difficulty: 1, category: "탈것" },
  { word: "배낭", difficulty: 2, category: "생활" },
  { word: "서랍", difficulty: 2, category: "생활" },
  { word: "지붕", difficulty: 2, category: "생활" },
  { word: "난로", difficulty: 2, category: "생활" },
  { word: "화면", difficulty: 2, category: "생활" },
  { word: "전화", difficulty: 1, category: "생활" },
  { word: "외투", difficulty: 2, category: "옷" },

  // 학교·놀이터
  { word: "도화지", difficulty: 2, category: "학교" },
  { word: "정문", difficulty: 2, category: "학교" },
  { word: "벤치", difficulty: 2, category: "장소" },
  { word: "분수", difficulty: 2, category: "장소" },

  // 동물
  { word: "거미", difficulty: 1, category: "동물" },
  { word: "지렁이", difficulty: 2, category: "동물" },
  { word: "달팽이", difficulty: 1, category: "동물" },
  { word: "올챙이", difficulty: 2, category: "동물" },
  { word: "고래", difficulty: 1, category: "동물" },
  { word: "조개", difficulty: 1, category: "동물" },

  // 먹을 것
  { word: "미역", difficulty: 1, category: "음식" },
  { word: "고기", difficulty: 1, category: "음식" },
  { word: "생선", difficulty: 1, category: "음식" },
  { word: "야채", difficulty: 1, category: "음식" },
  { word: "과일", difficulty: 1, category: "음식" },
  { word: "국수", difficulty: 1, category: "음식" },
  { word: "보리", difficulty: 2, category: "음식" },
  { word: "된장", difficulty: 2, category: "음식" },
  { word: "간장", difficulty: 2, category: "음식" },
  { word: "소금", difficulty: 1, category: "음식" },
  { word: "설탕", difficulty: 1, category: "음식" },
  { word: "식초", difficulty: 3, category: "음식" },
  { word: "기름", difficulty: 2, category: "음식" },
];
