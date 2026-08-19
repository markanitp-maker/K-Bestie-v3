import { WordChainEntry } from "./dictionaryTypes";

/**
 * 끝말잇기 정적 사전 Part 6 — 010 §3-2 실사용 누락어 보강.
 *
 * 2026-08-19 Dev 자유대화에서 아이가 낸 "도둑", "밥도둑" 이 사전에 없어 거절당했다.
 * 함께 초등학생이 끝말잇기에서 흔히 쓰는 일상 명사를 넓게 채운다.
 * Part 1~5 와 중복 0건, validateWordChainDictionary 통과 기준을 그대로 지킨다.
 */
export const DICTIONARY_PART6: readonly WordChainEntry[] = [
  // 로그에서 실제로 거절당한 단어
  { word: "도둑", difficulty: 1, category: "생활" },
  { word: "밥도둑", difficulty: 2, category: "음식" },

  // 사물·생활
  { word: "뚜껑", difficulty: 1, category: "생활" },
  { word: "망치", difficulty: 1, category: "도구" },
  { word: "저울", difficulty: 2, category: "도구" },
  { word: "줄자", difficulty: 2, category: "도구" },
  { word: "붕대", difficulty: 2, category: "생활" },
  { word: "봉투", difficulty: 1, category: "생활" },
  { word: "엽서", difficulty: 2, category: "생활" },
  { word: "성냥", difficulty: 2, category: "생활" },
  { word: "촛불", difficulty: 1, category: "생활" },
  { word: "지팡이", difficulty: 2, category: "생활" },
  { word: "주사위", difficulty: 1, category: "놀이" },
  { word: "스티커", difficulty: 1, category: "놀이" },
  { word: "인형극", difficulty: 2, category: "놀이" },
  { word: "축구공", difficulty: 1, category: "놀이" },
  { word: "야구공", difficulty: 1, category: "놀이" },
  { word: "탁구공", difficulty: 1, category: "놀이" },
  { word: "왕관", difficulty: 1, category: "사물" },
  { word: "보석", difficulty: 1, category: "사물" },
  { word: "향수", difficulty: 2, category: "사물" },
  { word: "헬멧", difficulty: 1, category: "사물" },
  { word: "한복", difficulty: 1, category: "옷" },
  { word: "표지판", difficulty: 2, category: "생활" },
  { word: "전봇대", difficulty: 2, category: "생활" },
  { word: "우물", difficulty: 2, category: "장소" },
  { word: "오솔길", difficulty: 2, category: "장소" },
  { word: "목장", difficulty: 2, category: "장소" },
  { word: "북극", difficulty: 2, category: "장소" },
  { word: "모래성", difficulty: 2, category: "장소" },
  { word: "허수아비", difficulty: 2, category: "사물" },
  { word: "학교종", difficulty: 2, category: "학교" },
  { word: "종이배", difficulty: 1, category: "놀이" },
  { word: "짚신", difficulty: 3, category: "사물" },
  { word: "재봉틀", difficulty: 3, category: "도구" },
  { word: "용수철", difficulty: 3, category: "도구" },
  { word: "톱니", difficulty: 3, category: "도구" },
  { word: "흑연", difficulty: 3, category: "사물" },
  { word: "회오리", difficulty: 2, category: "자연" },

  // 자연·동물
  { word: "벌집", difficulty: 1, category: "자연" },
  { word: "불꽃", difficulty: 1, category: "자연" },
  { word: "진흙", difficulty: 2, category: "자연" },
  { word: "잉어", difficulty: 2, category: "동물" },
  { word: "호랑나비", difficulty: 2, category: "동물" },
  { word: "둘리", difficulty: 1, category: "만화", properNoun: true },

  // 음식
  { word: "멸치", difficulty: 1, category: "음식" },
  { word: "컵라면", difficulty: 1, category: "음식" },
  { word: "통조림", difficulty: 2, category: "음식" },
  { word: "후추", difficulty: 2, category: "음식" },
  { word: "포도알", difficulty: 1, category: "음식" },
  { word: "수박씨", difficulty: 1, category: "음식" },
  { word: "선물", difficulty: 1, category: "생활" },
  { word: "심부름", difficulty: 2, category: "생활" },
  { word: "미소", difficulty: 2, category: "생활" },
  { word: "희망", difficulty: 3, category: "생활" },
  { word: "삼각형", difficulty: 2, category: "학교" },
  { word: "세모", difficulty: 1, category: "학교" },
  { word: "피리", difficulty: 1, category: "음악" },
  { word: "큰북", difficulty: 1, category: "음악" },
  { word: "마차", difficulty: 2, category: "탈것" },
];
