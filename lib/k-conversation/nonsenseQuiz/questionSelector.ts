import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NonsenseQuestionRow,
  NonsenseQuestionHistoryRow,
} from "./nonsenseQuizTypes";

/** 180일 재출제 방지 쿨다운 상수 (§3-6) */
export const NONSENSE_COOLDOWN_DAYS = 180;
export const NONSENSE_COOLDOWN_MS = NONSENSE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** 학년별 기본 난이도 범위 (§3-4) */
export const NONSENSE_GRADE_DIFFICULTY: Record<
  number,
  { min: number; max: number }
> = {
  1: { min: 1, max: 2 },
  2: { min: 1, max: 3 },
  3: { min: 2, max: 4 },
  4: { min: 2, max: 5 },
  5: { min: 3, max: 6 },
  6: { min: 3, max: 6 },
};

export interface SelectNonsenseQuestionParams {
  candidates: readonly NonsenseQuestionRow[];
  history: readonly NonsenseQuestionHistoryRow[];
  childGrade: number; // 1~6
  currentDifficulty?: number;
  recentPunTypes?: readonly string[];
  recentCategories?: readonly string[];
  now?: number; // ms timestamp (기본값: Date.now())
  seed?: string; // 결정론적 선택을 위한 시드
}

/**
 * 넌센스 퀴즈 문제 선택기 (순수 함수 — Gemini 관여 금지, §3-6, §3-7).
 *
 * [선택 우선순위]
 * 1. ACTIVE + child_safe
 * 2. 학년 범위 일치 (min_grade <= childGrade <= max_grade)
 * 3. 동일 아이 최근 180일 출제 이력(presented_at >= cutoff) 완전 제외
 * 4. 아직 한 번도 출제되지 않은 신규(NEW) 문제 최우선
 * 5. NEW 문제가 소진된 경우에만 180일 초과 문제 중 가장 오래전에 출제된 순(oldest-first)으로 재활용
 * 6. 현재 학년 난이도(baseline difficulty) 적합도 고려
 * 7. 직전 round와 동일 pun_type / category 연속 반복 최소화
 * 8. 후보 0건이면 null 반환 (임의 문제 생성 절대 금지)
 */
export function selectNonsenseQuestion(
  params: SelectNonsenseQuestionParams
): NonsenseQuestionRow | null {
  const {
    candidates,
    history,
    childGrade,
    currentDifficulty,
    recentPunTypes = [],
    recentCategories = [],
    now = Date.now(),
    seed,
  } = params;

  // 1. 유효 학년 보정 (1~6)
  const effectiveGrade = Math.max(1, Math.min(6, Math.floor(childGrade || 3)));
  const diffRange = NONSENSE_GRADE_DIFFICULTY[effectiveGrade] ?? { min: 2, max: 4 };

  // 2. 기본 필터링 (ACTIVE, child_safe, 학년 범위)
  const eligibleCandidates = candidates.filter((q) => {
    if (q.status !== "ACTIVE") return false;
    if (!q.child_safe) return false;
    if (q.min_grade > effectiveGrade || q.max_grade < effectiveGrade) {
      return false;
    }
    return true;
  });

  if (eligibleCandidates.length === 0) {
    return null;
  }

  // 3. 180일 쿨다운 및 출제 이력 맵 구축
  const cutoff = now - NONSENSE_COOLDOWN_MS;
  const recentExcludedIds = new Set<string>();
  const latestPresentedMap = new Map<string, number>();

  for (const h of history) {
    const presentedTime = new Date(h.presented_at).getTime();
    if (Number.isNaN(presentedTime)) continue;

    // 180일 이내 출제 이력이 있으면 제외 대상 등록
    if (presentedTime >= cutoff) {
      recentExcludedIds.add(h.question_id);
    }

    // 아이별 특정 문제의 가장 최근 출제 시각 갱신
    const existing = latestPresentedMap.get(h.question_id);
    if (existing === undefined || presentedTime > existing) {
      latestPresentedMap.set(h.question_id, presentedTime);
    }
  }

  // 180일 이내 출제 문제 제외
  const nonCooldownCandidates = eligibleCandidates.filter(
    (q) => !recentExcludedIds.has(q.id)
  );

  if (nonCooldownCandidates.length === 0) {
    return null;
  }

  // 4. NEW 문제 우선 분류 vs 180일 경과 재활용 문제 분류
  const newCandidates = nonCooldownCandidates.filter(
    (q) => !latestPresentedMap.has(q.id)
  );
  const recycleCandidates = nonCooldownCandidates.filter(
    (q) => latestPresentedMap.has(q.id)
  );

  let activePool: NonsenseQuestionRow[] = [];

  if (newCandidates.length > 0) {
    // 신규 문제가 존재하면 신규 문제만 사용
    activePool = newCandidates;
  } else if (recycleCandidates.length > 0) {
    // 신규 문제가 소진된 경우: 가장 오래전에 출제된 순(last_presented_at ASC)으로 정렬하여 최오래 출제군 추출
    recycleCandidates.sort((a, b) => {
      const timeA = latestPresentedMap.get(a.id) ?? 0;
      const timeB = latestPresentedMap.get(b.id) ?? 0;
      return timeA - timeB;
    });

    const oldestTime = latestPresentedMap.get(recycleCandidates[0].id) ?? 0;
    // 가장 오래된 시점과 인접(동일하거나 1일 이내 차이)한 상위 재활용 후보군 구성
    const oldestGroup = recycleCandidates.filter((q) => {
      const t = latestPresentedMap.get(q.id) ?? 0;
      return t <= oldestTime + 24 * 60 * 60 * 1000;
    });

    activePool = oldestGroup.length > 0 ? oldestGroup : recycleCandidates;
  } else {
    return null;
  }

  // 5. 난이도 적합도 필터링
  const targetMin = diffRange.min;
  const targetMax = diffRange.max;
  const preferredDifficulty = currentDifficulty ?? Math.round((targetMin + targetMax) / 2);

  // 1) 정확 난이도 매칭 시도
  const exactDiffMatches = activePool.filter((q) => q.difficulty === preferredDifficulty);
  // 2) 학년 기본 난이도 범위 내 매칭
  const rangeDiffMatches = activePool.filter(
    (q) => q.difficulty >= targetMin && q.difficulty <= targetMax
  );

  let diffFilteredPool = activePool;
  if (exactDiffMatches.length > 0) {
    diffFilteredPool = exactDiffMatches;
  } else if (rangeDiffMatches.length > 0) {
    diffFilteredPool = rangeDiffMatches;
  }

  // 6. pun_type 및 category 연속 반복 최소화
  let varietyFilteredPool = diffFilteredPool;

  if (recentPunTypes.length > 0) {
    const lastPunType = recentPunTypes[recentPunTypes.length - 1];
    const diffPunTypePool = varietyFilteredPool.filter(
      (q) => !q.pun_type || q.pun_type !== lastPunType
    );
    if (diffPunTypePool.length > 0) {
      varietyFilteredPool = diffPunTypePool;
    }
  }

  if (recentCategories.length > 0) {
    const lastCategory = recentCategories[recentCategories.length - 1];
    const diffCategoryPool = varietyFilteredPool.filter(
      (q) => !q.category || q.category !== lastCategory
    );
    if (diffCategoryPool.length > 0) {
      varietyFilteredPool = diffCategoryPool;
    }
  }

  const finalPool = varietyFilteredPool.length > 0 ? varietyFilteredPool : diffFilteredPool;

  // 7. 결정론적/랜덤-안전 선택
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const index = Math.abs(hash) % finalPool.length;
    return finalPool[index];
  }

  const randomIndex = Math.floor(Math.random() * finalPool.length);
  return finalPool[randomIndex];
}

/**
 * DB에서 후보 문제와 출제 이력을 로드하여 최적의 넌센스 퀴즈 문제를 선택합니다.
 */
export async function fetchAndSelectNonsenseQuestion(
  db: SupabaseClient,
  childId: string,
  childGrade: number,
  options: {
    currentDifficulty?: number;
    recentPunTypes?: readonly string[];
    recentCategories?: readonly string[];
    seed?: string;
  } = {}
): Promise<NonsenseQuestionRow | null> {
  if (!db || !childId) return null;

  const effectiveGrade = Math.max(1, Math.min(6, Math.floor(childGrade || 3)));

  // 1. ACTIVE + child_safe + 학년 범위 문제 조회
  const { data: candidateData, error: qError } = await db
    .from("nonsense_questions")
    .select("*")
    .eq("status", "ACTIVE")
    .eq("child_safe", true)
    .lte("min_grade", effectiveGrade)
    .gte("max_grade", effectiveGrade);

  if (qError || !candidateData || candidateData.length === 0) {
    if (qError) {
      console.error("[fetchAndSelectNonsenseQuestion] questions query error:", qError);
    }
    return null;
  }

  // 2. 해당 아이의 출제 이력 조회
  const { data: historyData, error: hError } = await db
    .from("nonsense_question_history")
    .select("*")
    .eq("child_id", childId);

  if (hError) {
    console.error("[fetchAndSelectNonsenseQuestion] history query error:", hError);
  }

  const candidates = candidateData as NonsenseQuestionRow[];
  const history = (historyData ?? []) as NonsenseQuestionHistoryRow[];

  return selectNonsenseQuestion({
    candidates,
    history,
    childGrade: effectiveGrade,
    currentDifficulty: options.currentDifficulty,
    recentPunTypes: options.recentPunTypes,
    recentCategories: options.recentCategories,
    seed: options.seed,
  });
}
