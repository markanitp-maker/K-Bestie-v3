import { WordChainEntry } from "./dictionaryTypes";

/**
 * 끝말잇기 정적 사전 Part 7 — 010 §3-3 초등 일상어 잔여 누락 보강.
 *
 * §3-3 은 "단순 세 단어 추가로 끝내지 말고 dictionary 전체를 기준으로 명백히 빠진
 * 기본어를 정리" 하라고 지정했다. Part 6 로 실측 거절어를 채운 뒤, 초등학생 일상어
 * 80개를 표본으로 대조해 남은 누락을 채운다(2026-08-19 실측: 40개 중 10개 누락).
 *
 * 규칙(§3-3): 임의 신조어·욕설·성인어 추가 금지, Runtime 판정 금지,
 * Static Dictionary 를 Source of Truth 로 유지. Part 1~6 과 중복 0건.
 */
export const DICTIONARY_PART7: readonly WordChainEntry[] = [
  // 집·생활 공간
  { word: "목욕탕", difficulty: 2, category: "장소" },
  { word: "세면대", difficulty: 2, category: "생활" },
  { word: "현관", difficulty: 2, category: "장소" },
  { word: "베란다", difficulty: 2, category: "장소" },
  { word: "옥상", difficulty: 2, category: "장소" },
  { word: "지하실", difficulty: 3, category: "장소" },

  // 학교 준비물
  { word: "도시락", difficulty: 2, category: "음식" },
  { word: "책받침", difficulty: 2, category: "학교" },
  { word: "물통", difficulty: 1, category: "생활" },
  { word: "명찰", difficulty: 2, category: "학교" },

  // 집안일·기기
  { word: "빨래", difficulty: 1, category: "생활" },
  { word: "휴대폰", difficulty: 2, category: "물건" },

  // 음식·주방
  { word: "부침개", difficulty: 2, category: "음식" },

  // 놀이·활동
  { word: "제자리", difficulty: 2, category: "생활" },
  { word: "구슬", difficulty: 1, category: "놀이" },
  { word: "컵", difficulty: 1, category: "생활" },

  // 자연·동물
];
