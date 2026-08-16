/**
 * 끝말잇기(WORD_CHAIN) 사전 엔트리 타입 정의 및 파생값 계산 유틸리티.
 * 요청서 §3-11, §3-14 준수.
 */

export interface WordChainEntry {
  word: string;              // REQUIRED
  difficulty: number;        // REQUIRED, 1~6
  properNoun?: boolean;      // OPTIONAL
  category?: string;         // OPTIONAL
  acceptedAliases?: string[];// OPTIONAL
}

/**
 * 파생값. 원본에 저장하지 않고 계산한다(§3-11 derived).
 */
export interface DerivedWordChainEntry extends WordChainEntry {
  normalizedWord: string;
  firstSyllable: string;
  lastSyllable: string;
}

/**
 * 단어 엔트리로부터 정규화된 단어, 첫 음절, 마지막 음절을 파생 계산합니다.
 * 정규화 규칙: 앞뒤 및 내부 공백 제거. 그 외 변형(fuzzy 등) 금지 (§3-14).
 */
export function deriveWordChainEntry(entry: WordChainEntry): DerivedWordChainEntry {
  const normalizedWord = (entry.word ?? '').replace(/\s+/g, '');
  const firstSyllable = normalizedWord.length > 0 ? normalizedWord.slice(0, 1) : '';
  const lastSyllable = normalizedWord.length > 0 ? normalizedWord.slice(-1) : '';

  return {
    ...entry,
    normalizedWord,
    firstSyllable,
    lastSyllable,
  };
}
