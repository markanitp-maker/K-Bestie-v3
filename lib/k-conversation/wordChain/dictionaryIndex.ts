import { DICTIONARY_PART1 } from "./dictionary.part1";
import { DICTIONARY_PART2 } from "./dictionary.part2";
import { DICTIONARY_PART3 } from "./dictionary.part3";
import { DICTIONARY_PART4 } from "./dictionary.part4";
import { DICTIONARY_PART5 } from "./dictionary.part5";
import {
  DerivedWordChainEntry,
  WordChainEntry,
  deriveWordChainEntry,
} from "./dictionaryTypes";

/**
 * 끝말잇기(WORD_CHAIN) 정적 사전 통합 인덱스.
 * Part1 (284개) + Part2 (380개) + Part3 (380개) + Part4 (360개) + Part5 (36개) = 1,440개.
 * Part5 는 2026-08-19 실사용 로그에서 케이가 거절한 기본어를 보강한 것이다.
 * 모듈 로드 시 1회 구축하여 메모리에 상주시키며 런타임 성능을 극대화합니다 (§3-12).
 */

const rawCombined: readonly WordChainEntry[] = [
  ...DICTIONARY_PART1,
  ...DICTIONARY_PART2,
  ...DICTIONARY_PART3,
  ...DICTIONARY_PART4,
  ...DICTIONARY_PART5,
];

// 파생 엔트리 목록 (정규화, 첫음절, 끝음절 포함)
export const WORD_CHAIN_DICTIONARY: readonly DerivedWordChainEntry[] =
  rawCombined.map(deriveWordChainEntry);

// 정규화 단어 Set (O(1) exact validation)
const wordSet = new Set<string>();

// 정규화 단어 -> DerivedWordChainEntry 매핑 Map
const entryMap = new Map<string, DerivedWordChainEntry>();

// 별칭(alias) -> 정규화 원본 단어 매핑 Map
const aliasMap = new Map<string, string>();

// 첫 음절 -> DerivedWordChainEntry[] 매핑 Map
const byFirstSyllableMap = new Map<string, DerivedWordChainEntry[]>();

for (const entry of WORD_CHAIN_DICTIONARY) {
  const norm = entry.normalizedWord;
  if (!norm) continue;

  wordSet.add(norm);
  wordSet.add(entry.word);

  // 런타임 오류 방지: 중복 단어가 있어도 처음 등록된 엔트리 유지 (테스트에서 검출)
  if (!entryMap.has(norm)) {
    entryMap.set(norm, entry);
  }

  // acceptedAliases 매핑 등록
  if (entry.acceptedAliases && Array.isArray(entry.acceptedAliases)) {
    for (const alias of entry.acceptedAliases) {
      const normAlias = (alias ?? "").replace(/\s+/g, "");
      if (normAlias && !aliasMap.has(normAlias)) {
        aliasMap.set(normAlias, norm);
      }
    }
  }

  // 첫 음절별 인덱싱
  const first = entry.firstSyllable;
  if (first) {
    let list = byFirstSyllableMap.get(first);
    if (!list) {
      list = [];
      byFirstSyllableMap.set(first, list);
    }
    list.push(entry);
  }
}

export const WORD_SET: ReadonlySet<string> = wordSet;
export const ALIAS_MAP: ReadonlyMap<string, string> = aliasMap;
export const BY_FIRST_SYLLABLE: ReadonlyMap<
  string,
  readonly DerivedWordChainEntry[]
> = byFirstSyllableMap;

/**
 * 사용자 입력 또는 단어를 사전에서 조회합니다.
 * 1. 공백 제거 정규화 후 정확 일치 조회.
 * 2. 없으면 등록된 별칭(acceptedAliases)으로 1회 조회.
 * 3. 그 외 fuzzy 추측 및 런타임 외부 API 호출 금지 (§3-12, §3-14, §5).
 */
export function lookupWord(input: string): DerivedWordChainEntry | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const normalized = input.replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  // 1. 정규화 단어 정확 일치 조회
  const directMatch = entryMap.get(normalized);
  if (directMatch) {
    return directMatch;
  }

  // 2. 별칭 조회
  const canonicalWord = aliasMap.get(normalized);
  if (canonicalWord) {
    const aliasMatch = entryMap.get(canonicalWord);
    if (aliasMatch) {
      return aliasMatch;
    }
  }

  return null;
}
