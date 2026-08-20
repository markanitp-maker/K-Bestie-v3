import { DerivedWordChainEntry } from "./dictionaryTypes";
import { BY_FIRST_SYLLABLE } from "./dictionaryIndex";
import { allowedNextInitials } from "./dueum";

export interface SelectKNextWordInput {
  /** 아이가 낸 직전 단어 */
  previousWord: DerivedWordChainEntry;
  /** 이번 게임 판에서 이미 사용된 단어 목록 Set (아이가 낸 단어 + K가 낸 단어) */
  usedWords: ReadonlySet<string>;
  /** K의 선택 단어 최소 난이도 (학년별 기준, §3-19) */
  minDifficulty: number;
  /** K의 선택 단어 최대 난이도 (학년별 기준, §3-19) */
  maxDifficulty: number;
  /** 선택 함수에 주입 가능한 난수 생성기 (미제공 시 최고 점수 최상위 단어 100% 결정론 선택) */
  random?: () => number;
}

interface ScoredCandidate {
  entry: DerivedWordChainEntry;
  tier: number; // 3: 학년 적합 후속 단어 있음, 2: 전체 사전 후속 단어 있음, 1: 막다른 단어(후속 0개)
  gradeFollowUps: number;
  totalFollowUps: number;
}

/**
 * K의 다음 단어를 결정론적이고 아동 친화적으로 선택합니다 (§3-17, §3-18).
 *
 * [핵심 원칙 - §3-18 Dead-end 회피]
 * K는 게임에서 이기기 위해 아이를 막다른 단어로 몰아세우지 않습니다.
 * 1. 직전 단어의 끝 음절(표준 두음법칙 포함)로 시작하는 후보를 추출합니다.
 * 2. 이미 사용된 단어(usedWords) 및 학년별 난이도 범위를 적용합니다.
 * 3. 각 후보 단어의 마지막 음절에 대해 아이가 이어갈 수 있는 후속 단어(미사용 단어) 수를 사전 시뮬레이션합니다.
 * 4. 후속 단어가 풍부한 단어(Tier 3)를 최우선으로 선택하고, 막다른 단어(Tier 1, 후속 0개)는 최후의 수단으로만 배치합니다.
 * 5. random 주입을 지원하여 테스트 및 재현 시 100% 결정론적 동작을 보장합니다.
 */
export function selectKNextWord(
  input: SelectKNextWordInput
): DerivedWordChainEntry | null {
  const { previousWord, usedWords, minDifficulty, maxDifficulty, random } = input;

  if (!previousWord || !previousWord.lastSyllable) {
    return null;
  }

  // 1. K가 시작할 수 있는 허용 시작 음절 목록 (직접 연결 + 표준 두음법칙)
  const allowedInitials = allowedNextInitials(previousWord.lastSyllable);
  if (allowedInitials.length === 0) {
    return null;
  }

  // 2. 허용 음절로 시작하는 사전 엔트리 수집
  const pool: DerivedWordChainEntry[] = [];
  const seenInPool = new Set<string>();

  for (const initial of allowedInitials) {
    const list = BY_FIRST_SYLLABLE.get(initial);
    if (!list) continue;

    for (const entry of list) {
      const norm = entry.normalizedWord;
      if (
        !seenInPool.has(norm) &&
        !usedWords.has(norm) &&
        !usedWords.has(entry.word) &&
        norm !== previousWord.normalizedWord
      ) {
        seenInPool.add(norm);
        pool.push(entry);
      }
    }
  }

  if (pool.length === 0) {
    return null;
  }

  // 3. 학년 난이도(minDifficulty ~ maxDifficulty) 필터링
  const inDifficultyPool = pool.filter(
    (entry) =>
      entry.difficulty >= minDifficulty && entry.difficulty <= maxDifficulty
  );

  // 난이도 범위 내 단어가 있으면 우선 사용, 없으면 전체 pool 사용 (안전 폴백)
  const targetPool = inDifficultyPool.length > 0 ? inDifficultyPool : pool;

  // 4. Dead-end 회피 평가 (§3-18)
  const scoredCandidates: ScoredCandidate[] = targetPool.map((candidate) => {
    const nextInitialsForChild = allowedNextInitials(candidate.lastSyllable);
    let gradeFollowUps = 0;
    let totalFollowUps = 0;
    const seenFollowUps = new Set<string>();

    for (const init of nextInitialsForChild) {
      const followUpList = BY_FIRST_SYLLABLE.get(init);
      if (!followUpList) continue;

      for (const fw of followUpList) {
        const fwNorm = fw.normalizedWord;
        if (
          !seenFollowUps.has(fwNorm) &&
          !usedWords.has(fwNorm) &&
          !usedWords.has(fw.word) &&
          fwNorm !== candidate.normalizedWord &&
          fwNorm !== previousWord.normalizedWord
        ) {
          seenFollowUps.add(fwNorm);
          totalFollowUps++;
          if (
            fw.difficulty >= minDifficulty &&
            fw.difficulty <= maxDifficulty
          ) {
            gradeFollowUps++;
          }
        }
      }
    }

    let tier = 1; // Tier 1: 막다른 단어 (후속 0개)
    if (gradeFollowUps > 0) {
      tier = 3; // Tier 3: 아이 학년에 맞는 후속 단어 존재 (최선)
    } else if (totalFollowUps > 0) {
      tier = 2; // Tier 2: 사전에 후속 단어 존재 (양호)
    }

    return {
      entry: candidate,
      tier,
      gradeFollowUps,
      totalFollowUps,
    };
  });

  // 5. 정렬: Tier 내림차순 -> 학년 후속수 내림차순 -> 전체 후속수 내림차순 -> 단어 사전순
  scoredCandidates.sort((a, b) => {
    if (b.tier !== a.tier) {
      return b.tier - a.tier;
    }
    if (b.gradeFollowUps !== a.gradeFollowUps) {
      return b.gradeFollowUps - a.gradeFollowUps;
    }
    if (b.totalFollowUps !== a.totalFollowUps) {
      return b.totalFollowUps - a.totalFollowUps;
    }
    // 동점 시 안정적인 결정론적 정렬
    return a.entry.normalizedWord.localeCompare(b.entry.normalizedWord, "ko");
  });

  // 무작위 후보군을 고른다.
  //
  // 무작위성이 없으면 케이가 매번 같은 1순위를 내서 아이가 "아까 그 단어잖아" 하게 된다
  // (2026-08-20 실측: `임시`·`장수풍뎅이` 각 2회). 그렇다고 최고 Tier 전체를 균등
  // 추첨하면 §3-18 dead-end 회피가 무너진다 — 이어갈 낱말이 훨씬 적은 후보가 같은
  // 확률로 뽑혀 케이가 더 자주 막힌다(리뷰 지적).
  //
  // 그래서 **최고 점수 대비 안전 임계치 안**에서만 흔든다.
  const best = scoredCandidates[0];
  const MIN_FOLLOWUP_RATIO = 0.7; // 1순위의 이어갈 낱말 수 대비 이만큼은 돼야 후보
  const MAX_RANDOM_POOL = 5;

  const safeCandidates = scoredCandidates.filter((c) => {
    if (c.tier !== best.tier) return false;
    // 1순위에 이어갈 낱말이 없으면 비율 판단이 무의미하다 — Tier만 본다.
    if (best.gradeFollowUps <= 0) return true;
    return c.gradeFollowUps >= best.gradeFollowUps * MIN_FOLLOWUP_RATIO;
  });
  const topCandidates = safeCandidates.slice(0, MAX_RANDOM_POOL);

  // random 제공 시 안전 후보군 내에서 무작위, 미제공 시 1순위 (결정론 보장)
  if (random && typeof random === "function") {
    const r = Math.abs(random());
    const idx = Math.floor(r * topCandidates.length) % topCandidates.length;
    return topCandidates[idx].entry;
  }

  return topCandidates[0].entry;
}
