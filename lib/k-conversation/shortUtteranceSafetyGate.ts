// 요청서 014 — 짧은 단어 하나에 안전 로직이 곧바로 발동하지 않게 한다.
//
// 대표님 지시:
//   "단순 단어에 처음부터 안전 로직이 동작할 필요 없다. 처음에는 아이가 말한 그대로 대응을 한다.
//    대화 중 문맥이 정말 '안전 로직'이 필요한 경우 '엄마아빠한테 말해줘'라고 한다.
//    일반적으로는 단순하게 나오는 단어 1-2번 정도는 그냥 그대로 아이와 대화를 진행한다."
//
// 실제로 무엇이 문제인지(2026-08-19 실측):
//   "맞았어"  → violence   (초성게임·퀴즈에서 "정답 맞았어" 라는 뜻인데 폭력으로 잡힌다)
//   "자살골"  → self_harm  (축구 자책골)
//   "굶주림"  → neglect    (낱말 자체)
//   "왕따"    → violence   (낱말 자체)
// 2026-08-17 Production 에서는 "고추장"이 성 안전 경고를 4번 연속 냈고 아이가
// "왜 이걸 말하면 안 돼?"라고 항의했다(그 건은 1233fa7 에서 별도 수정됨).
//
// [무엇을 유예하고 무엇을 유예하지 않는가]
// 유예 대상은 **짧은 낱말 하나**뿐이다. 문장으로 말하면 그건 맥락이 있는 것이므로 그대로 발동한다.
// 그리고 명백한 위험 표현("죽고싶어", "자해", "때려요" 같은 진술)은 길이와 무관하게 **항상**
// 즉시 발동한다 — 아래 ALWAYS_ESCALATE_PATTERNS 가 그 경계다. 이 목록은 절대 완화하지 않는다.
//
// 유예는 무제한이 아니다. 같은 범주가 이 세션에서 반복되면 그건 낱말이 아니라 신호다.

import type { SafetySubcategory } from "@/lib/freeChatReactions";

/**
 * 유예를 허용하는 범주.
 *
 * 이 두 개만이다. 실측된 오탐이 전부 여기서 나온다 —
 * "맞았어"(퀴즈 정답)·"왕따"·"때렸어" → violence, "굶주림"·"집에 혼자" → neglect.
 *
 * 나머지는 절대 유예하지 않는다:
 *   - inappropriate_contact: 명백 키워드가 짧다("만졌" 3자, "더듬" 2자, "만지려" 3자).
 *     길이로 거르면 아이가 성 안전 피해를 한 단어로 말했을 때 그대로 묻힌다.
 *   - self_harm: 길이와 무관하게 즉시 발동해야 한다.
 *   - threat: 협박은 낱말놀이로 나오지 않는다.
 * 이 목록은 넓히지 않는다.
 */
const DEFERRABLE_SUBCATEGORIES: ReadonlySet<SafetySubcategory> = new Set(["violence", "neglect"]);

/**
 * 길이와 무관하게 항상 즉시 발동하는 표현.
 *
 * 여기 걸리면 유예하지 않는다. 아이가 한 단어로 "자해"라고만 말해도 그건 낱말놀이가 아니다.
 * 판단이 갈리면 발동하는 쪽이 옳다 — 놓치는 비용이 오탐 비용보다 훨씬 크다.
 */
const ALWAYS_ESCALATE_PATTERNS: readonly RegExp[] = [
  /죽고\s*싶/,
  /죽어\s*버/,
  /사라지고\s*싶/,
  /없어지고\s*싶/,
  /살기\s*싫/,
  /살고\s*싶지\s*않/,
  /태어나지\s*(말|않)/,
  /자해/,
  /칼로\s*긋/,
  /몸에\s*상처/,
  /^자살$/,
];

/**
 * 유예를 허용할 최대 길이(공백 제거 기준).
 *
 * 초성게임·넌센스퀴즈 답, 끝말잇기 낱말은 대부분 2~5자다. 8자면 "집에 혼자"(4자)나
 * "굶주림"(3자) 같은 낱말은 들어오고, "친구가 나를 때렸어" 같은 문장은 들어오지 않는다.
 */
export const MAX_DEFERRABLE_LENGTH = 8;

/** 같은 범주를 이 횟수까지 유예한다. 넘으면 낱말이 아니라 신호로 본다. */
export const MAX_DEFERRALS_PER_CATEGORY = 2;

/** 이 시간 동안 갱신이 없으면 세션 상태를 버린다. */
const DEFERRAL_TTL_MS = 60 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 500;

interface DeferralState {
  counts: Partial<Record<SafetySubcategory, number>>;
  /**
   * 마지막으로 유예한 턴의 식별자. 같은 턴이 두 번 판정되는 것을 막는다.
   *
   * 한 턴에서 checkSafetyPreflight() 와 respond() 가 각각 이 함수를 부른다. 그대로 두면
   * 한 턴이 유예 횟수를 2 소모해 "1-2번은 그냥 진행한다"가 사실상 한 번이 된다.
   *
   * 발화 텍스트로 구분하면 안 된다 — 아이가 다음 턴에 같은 낱말을 또 말하면 영원히
   * 유예된다(리뷰 HIGH 지적). 턴 ID 를 쓰고, 없으면 짧은 시간창으로 대신한다.
   */
  lastDeferredTurnKey: string | null;
  lastDeferredAt: number;
  updatedAt: number;
}

/**
 * 세션 상태는 프로세스 메모리에 있다. 서버 인스턴스가 N 개면 최악의 경우 유예가
 * 범주당 2N 회까지 일어날 수 있다(리뷰 LOW 지적). 유예 대상이 violence/neglect 로
 * 한정돼 있고 그 사이에도 부모 리포트 경로는 살아 있으므로 감수한다.
 * 정확한 상한이 필요해지면 상태를 DB 로 올려야 한다 — 그때는 턴마다 왕복이 늘어난다.
 */
const store = new Map<string, DeferralState>();

function prune(now: number): void {
  for (const [sessionId, state] of store) {
    if (now - state.updatedAt > DEFERRAL_TTL_MS) store.delete(sessionId);
  }
  if (store.size <= MAX_TRACKED_SESSIONS) return;
  const oldestFirst = [...store.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  for (const [sessionId] of oldestFirst.slice(0, store.size - MAX_TRACKED_SESSIONS)) {
    store.delete(sessionId);
  }
}

/**
 * 1인칭 표지. "나 맞았어"는 낱말이 아니라 자기 피해 진술이다(리뷰 MEDIUM 지적).
 * 아이가 자기 얘기로 말한 순간 유예 대상이 아니다.
 * 복수형("우리 맞았어", "우릴 때렸어")도 자기가 포함된 피해 진술이므로 함께 막는다.
 */
const FIRST_PERSON_MARKERS =
  /(^|\s)(나|내|날|저|제|우리|우릴|저희)(\s|가|는|를|한테|에게|도|만)/;

/** 문장이 아니라 낱말 하나인지. 공백·문장부호가 있으면 맥락이 있는 발화로 본다. */
export function isSingleShortWord(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_DEFERRABLE_LENGTH) return false;
  // 자기 얘기로 말했으면 낱말놀이가 아니다.
  if (FIRST_PERSON_MARKERS.test(trimmed)) return false;
  // 조사·어미가 붙은 한 낱말까지만 — 띄어쓰기가 두 번 이상이면 문장이다.
  const words = trimmed.split(/\s+/);
  if (words.length > 2) return false;
  // 물음표·느낌표는 그대로 두되, 마침표로 끝나는 서술문은 문장으로 본다.
  return !/[.]$/.test(trimmed);
}

/** 길이와 무관하게 즉시 발동해야 하는 표현인지. */
export function mustEscalateImmediately(text: string): boolean {
  return ALWAYS_ESCALATE_PATTERNS.some((pattern) => pattern.test(text));
}

export interface SafetyDeferralDecision {
  /** true 면 이번 턴은 안전 응답 대신 평소대로 대화한다. */
  defer: boolean;
  /** 유예하지 않은 이유(로그·테스트용). */
  reason: "not_short" | "always_escalate" | "not_deferrable_category" | "limit_reached" | "deferred";
}

/**
 * 이번 안전 판정을 유예할지 결정한다.
 *
 * 유예 조건은 전부 만족해야 한다:
 *   1. 항상 발동해야 하는 표현이 아니다
 *   2. 범주가 violence 또는 neglect 다(성 안전·자해·협박은 유예 대상이 아니다)
 *   3. 낱말 하나다(문장이 아니다)
 *   4. 이 세션에서 같은 범주를 아직 MAX_DEFERRALS_PER_CATEGORY 회 미만으로 유예했다
 *
 * 유예하면 그 사실을 세션에 기록한다 — 같은 범주가 반복되면 다음에는 발동한다.
 */
/**
 * 턴 ID 가 없을 때 "같은 턴"으로 볼 시간창.
 * 한 요청 안의 두 호출은 수 ms 안에 일어난다. 아이가 다시 말하는 것은 그보다 훨씬 느리다.
 */
const SAME_TURN_WINDOW_MS = 3000;

export function decideSafetyDeferral(input: {
  sessionId: string;
  text: string;
  subcategory: SafetySubcategory | undefined;
  /** 이 턴의 식별자. 있으면 이걸로 같은 턴을 판별한다(권장). */
  turnId?: string | null;
  now?: number;
}): SafetyDeferralDecision {
  const now = input.now ?? Date.now();

  if (mustEscalateImmediately(input.text)) return { defer: false, reason: "always_escalate" };
  if (!input.subcategory) return { defer: false, reason: "not_deferrable_category" };
  if (!DEFERRABLE_SUBCATEGORIES.has(input.subcategory)) {
    return { defer: false, reason: "not_deferrable_category" };
  }
  if (!isSingleShortWord(input.text)) return { defer: false, reason: "not_short" };

  const existing = store.get(input.sessionId);
  const state: DeferralState =
    existing && now - existing.updatedAt <= DEFERRAL_TTL_MS
      ? existing
      : { counts: {}, lastDeferredTurnKey: null, lastDeferredAt: 0, updatedAt: now };

  // 같은 턴을 다시 판정하면 횟수를 더 쓰지 않고 앞선 결정을 그대로 돌려준다.
  // 턴 ID 가 없으면 짧은 시간창으로 대신한다 — 다음 턴의 같은 낱말은 새로 센다.
  const turnKey = input.turnId?.trim() || `t:${input.text.trim()}`;
  const sameTurn =
    state.lastDeferredTurnKey === turnKey &&
    (input.turnId ? true : now - state.lastDeferredAt <= SAME_TURN_WINDOW_MS);
  if (sameTurn) {
    state.updatedAt = now;
    store.set(input.sessionId, state);
    return { defer: true, reason: "deferred" };
  }

  const used = state.counts[input.subcategory] ?? 0;
  if (used >= MAX_DEFERRALS_PER_CATEGORY) {
    return { defer: false, reason: "limit_reached" };
  }

  state.counts[input.subcategory] = used + 1;
  state.lastDeferredTurnKey = turnKey;
  state.lastDeferredAt = now;
  state.updatedAt = now;
  store.set(input.sessionId, state);
  prune(now);
  return { defer: true, reason: "deferred" };
}

/** 테스트 전용 — 세션 상태를 비운다. */
export function resetSafetyDeferralsForTest(): void {
  store.clear();
}
