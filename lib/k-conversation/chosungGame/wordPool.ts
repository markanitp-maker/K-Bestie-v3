import { extractChosung } from "./chosungUtil";

export const CHOSUNG_CATEGORIES = [
  "음식",
  "동물",
  "학교",
  "놀이",
  "게임",
  "스포츠",
  "캐릭터",
  "장소",
  "물건",
  "자연",
] as const;

export type ChosungCategory = (typeof CHOSUNG_CATEGORIES)[number];

export interface ChosungWord {
  word: string;
  chosung: string;
  category: ChosungCategory;
  difficulty: number;
  acceptedAnswers?: string[];
}

type WordSeed = Omit<ChosungWord, "chosung">;

// All entries are human-reviewed, child-safe everyday words. The pool deliberately
// excludes sexual content, serious violence, profanity/hate, alcohol/tobacco/drugs,
// gambling, age-inappropriate material, and personal information.
const WORD_SEEDS: readonly WordSeed[] = [
  { word: "사과", category: "음식", difficulty: 1 },
  { word: "우유", category: "음식", difficulty: 1 },
  { word: "바나나", category: "음식", difficulty: 2 },
  { word: "김밥", category: "음식", difficulty: 2 },
  { word: "딸기", category: "음식", difficulty: 3 },
  { word: "비빔밥", category: "음식", difficulty: 4 },
  { word: "샌드위치", category: "음식", difficulty: 5 },
  { word: "초콜릿", category: "음식", difficulty: 6 },

  { word: "강아지", category: "동물", difficulty: 1 },
  { word: "고양이", category: "동물", difficulty: 1 },
  { word: "토끼", category: "동물", difficulty: 2 },
  { word: "코끼리", category: "동물", difficulty: 3 },
  { word: "기린", category: "동물", difficulty: 3 },
  { word: "펭귄", category: "동물", difficulty: 4 },
  { word: "다람쥐", category: "동물", difficulty: 5 },
  { word: "카멜레온", category: "동물", difficulty: 6 },

  { word: "책", category: "학교", difficulty: 1 },
  { word: "연필", category: "학교", difficulty: 1 },
  { word: "공책", category: "학교", difficulty: 2 },
  { word: "교실", category: "학교", difficulty: 2 },
  { word: "지우개", category: "학교", difficulty: 3 },
  { word: "색연필", category: "학교", difficulty: 4 },
  { word: "도서관", category: "학교", difficulty: 5 },
  { word: "과학실", category: "학교", difficulty: 6 },

  { word: "공놀이", category: "놀이", difficulty: 1 },
  { word: "숨바꼭질", category: "놀이", difficulty: 2 },
  { word: "줄넘기", category: "놀이", difficulty: 2 },
  { word: "미끄럼틀", category: "놀이", difficulty: 3 },
  { word: "비눗방울", category: "놀이", difficulty: 4 },
  { word: "종이접기", category: "놀이", difficulty: 5 },
  { word: "보물찾기", category: "놀이", difficulty: 5 },
  { word: "블록놀이", category: "놀이", difficulty: 6 },

  { word: "퍼즐", category: "게임", difficulty: 1 },
  { word: "체스", category: "게임", difficulty: 2 },
  { word: "장기", category: "게임", difficulty: 2 },
  { word: "보드게임", category: "게임", difficulty: 3 },
  { word: "테트리스", category: "게임", difficulty: 4 },
  { word: "마리오", category: "게임", difficulty: 4 },
  { word: "마인크래프트", category: "게임", difficulty: 5, acceptedAnswers: ["마크"] },
  { word: "닌텐도", category: "게임", difficulty: 6 },

  { word: "축구", category: "스포츠", difficulty: 1 },
  { word: "수영", category: "스포츠", difficulty: 1 },
  { word: "농구", category: "스포츠", difficulty: 2 },
  { word: "달리기", category: "스포츠", difficulty: 2 },
  { word: "줄넘기", category: "스포츠", difficulty: 3 },
  { word: "배드민턴", category: "스포츠", difficulty: 4 },
  { word: "탁구", category: "스포츠", difficulty: 5 },
  { word: "스케이트보드", category: "스포츠", difficulty: 6 },

  { word: "뽀로로", category: "캐릭터", difficulty: 1 },
  { word: "피카츄", category: "캐릭터", difficulty: 1 },
  { word: "루피", category: "캐릭터", difficulty: 2 },
  { word: "마리오", category: "캐릭터", difficulty: 3 },
  { word: "헬로키티", category: "캐릭터", difficulty: 4 },
  { word: "미키마우스", category: "캐릭터", difficulty: 5 },
  { word: "도라에몽", category: "캐릭터", difficulty: 6 },
  { word: "미니언즈", category: "캐릭터", difficulty: 6 },

  { word: "집", category: "장소", difficulty: 1 },
  { word: "학교", category: "장소", difficulty: 1 },
  { word: "공원", category: "장소", difficulty: 2 },
  { word: "놀이터", category: "장소", difficulty: 2 },
  { word: "도서관", category: "장소", difficulty: 3 },
  { word: "동물원", category: "장소", difficulty: 4 },
  { word: "수족관", category: "장소", difficulty: 5 },
  { word: "과학관", category: "장소", difficulty: 6 },

  { word: "공", category: "물건", difficulty: 1 },
  { word: "우산", category: "물건", difficulty: 1 },
  { word: "가방", category: "물건", difficulty: 2 },
  { word: "시계", category: "물건", difficulty: 2 },
  { word: "자전거", category: "물건", difficulty: 3 },
  { word: "카메라", category: "물건", difficulty: 4 },
  { word: "망원경", category: "물건", difficulty: 5 },
  { word: "리모컨", category: "물건", difficulty: 6 },

  { word: "해", category: "자연", difficulty: 1 },
  { word: "달", category: "자연", difficulty: 1 },
  { word: "별", category: "자연", difficulty: 2 },
  { word: "구름", category: "자연", difficulty: 2 },
  { word: "나무", category: "자연", difficulty: 3 },
  { word: "무지개", category: "자연", difficulty: 4 },
  { word: "단풍잎", category: "자연", difficulty: 5 },
  { word: "반딧불이", category: "자연", difficulty: 6 },
];

/**
 * 초성이 욕설·비속어로 읽히는 조합.
 *
 * 2026-08-20 대표님 Dev QA 실측 — 케이가 "숨바꼭질"(ㅅㅂㄲㅈ)을 냈고 아이가
 * "시발꼬주?" 라고 답했다. 케이는 "아니야, 그런 욕 아니거든!" 이라고 받았다.
 * 아이에게 욕을 떠올리게 하고 타이핑하게 만드는 문제이므로 출제 자체를 막는다.
 *
 * 낱말 자체는 아무 문제가 없다 — 초성만 떼면 그렇게 읽히는 것이다. 그래서 낱말을
 * 지우는 대신 **초성 게임 출제 풀에서만** 뺀다.
 */
const PROFANE_CHOSUNG_PATTERNS: readonly string[] = [
  "ㅅㅂ", "ㅆㅂ", "ㅄ", "ㅂㅅ",
  "ㅈㄹ", "ㅈㄴ", "ㅆㄴ",
  "ㅁㅊ", "ㄲㅈ", "ㄱㅅㄲ", "ㄷㅊ",
];

export function readsAsProfanity(chosung: string): boolean {
  if (!chosung) return false;
  const compact = chosung.replace(/\s+/g, "");
  return PROFANE_CHOSUNG_PATTERNS.some((pattern) => compact.includes(pattern));
}

export const WORD_POOL: readonly ChosungWord[] = WORD_SEEDS.map((entry) => ({
  ...entry,
  chosung: extractChosung(entry.word),
})).filter((entry) => !readsAsProfanity(entry.chosung));

export const getWordsByDifficulty = (
  min: number,
  max: number,
  category?: ChosungCategory,
): ChosungWord[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return [];
  }

  return WORD_POOL.filter((entry) =>
    entry.difficulty >= min
    && entry.difficulty <= max
    && (category === undefined || entry.category === category),
  );
};
