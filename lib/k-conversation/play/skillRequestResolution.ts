// 요청서 014 — 아이가 한 문장에서 놀이를 여러 개 언급했을 때 어느 놀이를 요청한 것인지 고른다.
//
// 2026-08-18 23:55 Dev 실측(김서아):
//   아이: "너 초성 게임 못 하니까 초성 게임은 다시 개발 해 개판이야 끝말잇기나 하자"
//   케이: "자, 다시 낼게! 초성은 'ㅈㅇㄱ' 이야. 뭘까?"   ← 끝말잇기 요청을 무시했다
//   아이: "아니 내가 뭐라 그랬어 … 나는 지금 끝말잇기 하자 그랬잖아"
//   케이: "자, 다시 낼게! 초성은 'ㅈㅇㄱ' 이야. 뭘까?"   ← 같은 말을 또 했다
//
// 원인은 findDirectlyRequestedSkill 이 레지스트리 **첫 매칭**을 돌려주는 것이었다. 아이 문장에서
// 초성게임이 먼저 등록돼 있으니, 아이가 뒤에 "끝말잇기나 하자" 라고 해도 초성이 이겼다.
//
// 규칙(사람이 말하는 순서를 따른다):
//   1. 불만·거절 맥락에서 언급된 놀이는 요청이 아니다("초성 게임은 개판이야", "초성게임 말고").
//   2. 요청 동사(하자/할래/해줘/하고 싶어)에 가장 가까운 놀이를 고른다.
//   3. 그래도 못 가리면 문장에서 **나중에** 언급된 놀이를 고른다.

/** 놀이 이름 언급 위치. 각 스킬이 자기 이름 후보를 넘긴다. */
export interface SkillMentionCandidate<T> {
  skill: T;
  /** 이 스킬을 가리키는 이름들(별칭 포함). */
  aliases: readonly string[];
}

const COMPLAINT_MARKERS = [
  "개판",
  "못 하",
  "못하",
  "다시 개발",
  "싫어",
  "재미없",
  "이상해",
  "안 돼",
  "안돼",
  "그만",
];

const REQUEST_MARKERS = ["하자", "할래", "해줘", "하고 싶", "해보자", "하기로", "고 싶어", "해 봐", "해봐"];

/** 문장에서 별칭이 등장한 마지막 위치. 없으면 -1. */
function lastMentionIndex(utterance: string, aliases: readonly string[]): number {
  let index = -1;
  for (const alias of aliases) {
    const found = utterance.lastIndexOf(alias);
    if (found > index) index = found;
  }
  return index;
}

/** 언급 주변(뒤쪽 24자)에서 요청 동사까지의 거리. 없으면 null. */
function distanceToRequest(utterance: string, mentionIndex: number, aliasLength: number): number | null {
  const tailStart = mentionIndex + aliasLength;
  const tail = utterance.slice(tailStart, tailStart + 24);
  let best: number | null = null;
  for (const marker of REQUEST_MARKERS) {
    const found = tail.indexOf(marker);
    if (found >= 0 && (best === null || found < best)) best = found;
  }
  return best;
}

/**
 * 언급이 불만·제외 맥락인지.
 *
 * 창을 넓게 잡으면 "개판이야 끝말잇기나 하자" 처럼 앞 문장의 불만이 뒤 요청까지 오염시킨다
 * (실측에서 그래서 요청이 사라졌다). 그래서 요청 동사가 뒤에 붙어 있으면 불만으로 보지 않고,
 * 창도 언급 바로 앞 6자 / 뒤 12자로 좁힌다.
 */
function isComplaintContext(
  utterance: string,
  mentionIndex: number,
  aliasLength: number,
  hasRequestVerb: boolean
): boolean {
  const from = Math.max(0, mentionIndex - 6);
  const to = Math.min(utterance.length, mentionIndex + aliasLength + 12);
  const window = utterance.slice(from, to);

  // 제외 표현은 요청 동사보다 먼저 본다. "초성게임은 나중에 하자" 는 뒤에 "하자" 가 붙어도
  // 지금 하자는 뜻이 아니다(2026-08-19 리뷰 지적).
  if (/말고/.test(window)) return true;
  if (/(나중에|다음에|이따|끝나고)/.test(window)) return true;

  if (hasRequestVerb) return false;
  return COMPLAINT_MARKERS.some((marker) => window.includes(marker));
}

export interface ResolvedSkillRequest<T> {
  skill: T;
  /** 선택 근거. 로그·테스트용. */
  reason: "request_verb" | "last_mention" | "only_match";
}

/**
 * 여러 놀이가 언급된 문장에서 실제 요청 대상을 고른다.
 * 후보가 하나면 그대로, 전부 불만 맥락이면 null.
 */
export function resolveRequestedSkill<T>(
  utterance: string,
  candidates: ReadonlyArray<SkillMentionCandidate<T>>
): ResolvedSkillRequest<T> | null {
  const normalized = utterance.replace(/\s+/g, " ");
  if (!normalized.trim() || candidates.length === 0) return null;

  interface Scored {
    skill: T;
    mentionIndex: number;
    requestDistance: number | null;
    complaint: boolean;
  }

  const scored: Scored[] = [];
  for (const candidate of candidates) {
    const mentionIndex = lastMentionIndex(normalized, candidate.aliases);
    if (mentionIndex < 0) {
      // 이름이 문장에 없다. 다른 신호로 매칭됐을 수는 있으나 근거가 약하므로 최하위로 둔다.
      scored.push({ skill: candidate.skill, mentionIndex: -1, requestDistance: null, complaint: false });
      continue;
    }
    const aliasLength =
      candidate.aliases.find((alias) => normalized.lastIndexOf(alias) === mentionIndex)?.length ?? 0;
    const requestDistance = distanceToRequest(normalized, mentionIndex, aliasLength);
    scored.push({
      skill: candidate.skill,
      mentionIndex,
      requestDistance,
      complaint: isComplaintContext(normalized, mentionIndex, aliasLength, requestDistance !== null),
    });
  }

  if (scored.length === 1) {
    // 후보가 하나면 불만 맥락이어도 그 스킬로 본다 — 되묻기는 상위 로직이 판단한다.
    return { skill: scored[0].skill, reason: "only_match" };
  }

  // 이름이 실제로 언급된 후보가 하나라도 있으면 그 안에서만 고른다.
  const mentioned = scored.filter((item) => item.mentionIndex >= 0);
  const base = mentioned.length > 0 ? mentioned : scored;
  const positive = base.filter((item) => !item.complaint);
  const pool = positive.length > 0 ? positive : base;

  // 1) 요청 동사에 가장 가까운 언급
  const withRequest = pool.filter((item) => item.requestDistance !== null);
  if (withRequest.length > 0) {
    withRequest.sort((left, right) => (left.requestDistance ?? 0) - (right.requestDistance ?? 0));
    return { skill: withRequest[0].skill, reason: "request_verb" };
  }

  // 2) 문장에서 나중에 언급된 것
  const sorted = [...pool].sort((left, right) => right.mentionIndex - left.mentionIndex);
  return { skill: sorted[0].skill, reason: "last_mention" };
}

/** 아이가 지금 판을 새로 시작하자고 한 것인지("다시 시작", "처음부터"). */
export function wantsRestart(utterance: string): boolean {
  return /(다시\s*시작|처음부터|새로\s*(하자|시작)|리셋)/.test(utterance);
}

/** 문장에 이름이 언급된 후보만 남긴다. 레지스트리 단계에서 다중 언급을 판별할 때 쓴다. */
export function filterMentionedCandidates<T>(
  utterance: string,
  candidates: ReadonlyArray<SkillMentionCandidate<T>>
): Array<SkillMentionCandidate<T>> {
  const normalized = utterance.replace(/\s+/g, " ");
  return candidates.filter((candidate) =>
    candidate.aliases.some((alias) => normalized.includes(alias))
  );
}

/** 아이가 지금 놀이를 하자고 한 것인지(요청 동사 존재). 단순 언급과 구분한다. */
export function hasPlayRequestMarker(utterance: string): boolean {
  const normalized = utterance.replace(/\s+/g, " ");
  return REQUEST_MARKERS.some((marker) => normalized.includes(marker));
}
