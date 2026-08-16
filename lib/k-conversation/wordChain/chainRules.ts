import { DerivedWordChainEntry } from "./dictionaryTypes";
import { lookupWord } from "./dictionaryIndex";
import { isChainConnected } from "./dueum";

/**
 * 끝말잇기(WORD_CHAIN) 단어 판정 거절 사유.
 */
export type WordChainRejection =
  | "EMPTY"
  | "NOT_HANGUL"
  | "NOT_IN_DICTIONARY"
  | "ALREADY_USED"
  | "CHAIN_MISMATCH";

/**
 * 끝말잇기 단어 판정 결과.
 */
export interface WordChainJudgement {
  accepted: boolean;
  rejection?: WordChainRejection;
  entry?: DerivedWordChainEntry;
}

/**
 * 한글 완성형 음절 정규식 (가-힣).
 */
const HANGUL_COMPLETE_REGEX = /^[가-힣]+$/;

/**
 * 아이가 입력한 단어를 끝말잇기 규칙에 따라 엄격하고 결정론적으로 판정합니다 (§3-15).
 *
 * [판정 순서 - 반드시 엄수]
 * 1. EMPTY: 빈 문자열 또는 공백만 있는 입력
 * 2. NOT_HANGUL: 한글 완성형 음절(가-힣) 이외 문자(영문, 숫자, 자모 단독, 특수문자 등) 포함
 * 3. NOT_IN_DICTIONARY: 사전에 등록되지 않은 단어 (정규화 및 별칭 조회 실패, fuzzy/오타 자동 인정 금지)
 * 4. ALREADY_USED: 이번 게임 판에서 이미 사용된 단어
 * 5. CHAIN_MISMATCH: 직전 단어의 끝 음절과 이어지지 않음 (표준 두음법칙 불일치 포함)
 *
 * @param input.raw 아이의 원본 발화/입력 문자열
 * @param input.previousWord 직전 단어 (첫 턴이면 null)
 * @param input.usedWords 이번 판에서 이미 사용된 단어 목록 Set
 */
export function judgeChildWord(input: {
  raw: string;
  previousWord: DerivedWordChainEntry | null;
  usedWords: ReadonlySet<string>;
}): WordChainJudgement {
  const { raw, previousWord, usedWords } = input;

  // 1. 빈 입력 검사 (EMPTY)
  if (!raw || typeof raw !== "string") {
    return { accepted: false, rejection: "EMPTY" };
  }

  const normalized = raw.replace(/\s+/g, "");
  if (normalized.length === 0) {
    return { accepted: false, rejection: "EMPTY" };
  }

  // 2. 한글 완성형 음절 검사 (NOT_HANGUL)
  if (!HANGUL_COMPLETE_REGEX.test(normalized)) {
    return { accepted: false, rejection: "NOT_HANGUL" };
  }

  // 3. 사전 등록 유효성 검사 (NOT_IN_DICTIONARY)
  const entry = lookupWord(normalized);
  if (!entry) {
    return { accepted: false, rejection: "NOT_IN_DICTIONARY" };
  }

  // 4. 중복 단어 검사 (ALREADY_USED)
  if (
    usedWords.has(entry.normalizedWord) ||
    usedWords.has(entry.word) ||
    usedWords.has(normalized)
  ) {
    return { accepted: false, rejection: "ALREADY_USED", entry };
  }

  // 5. 끝말잇기 연결 규칙 및 두음법칙 검사 (CHAIN_MISMATCH)
  if (previousWord !== null) {
    const connected = isChainConnected(
      previousWord.lastSyllable,
      entry.firstSyllable
    );
    if (!connected) {
      return { accepted: false, rejection: "CHAIN_MISMATCH", entry };
    }
  }

  // 6. 모든 규칙 통과 (ACCEPTED)
  return {
    accepted: true,
    entry,
  };
}
