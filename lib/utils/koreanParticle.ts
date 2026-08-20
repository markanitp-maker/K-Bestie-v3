export function getVocativeParticle(name: string | null | undefined): string {
  const cleanName = (name ?? "").trim();
  if (!cleanName) return "야"; // 기본값
  const lastChar = cleanName.charCodeAt(cleanName.length - 1);
  // 한글 완성형 음절 범위: 0xAC00(가) ~ 0xD7A3(힣)
  if (lastChar < 0xac00 || lastChar > 0xd7a3) return "야";
  const hasJongseong = (lastChar - 0xac00) % 28 !== 0;
  return hasJongseong ? "아" : "야";
}

export function appendVocative(name: string | null | undefined): string {
  const cleanName = (name ?? "").trim();
  if (!cleanName) return "";
  return `${cleanName}${getVocativeParticle(cleanName)}`;
}

/**
 * 받침(종성) 정보. 한글 완성형이 아니면 null 을 돌려준다.
 *
 * 010 (2026-08-20 Dev QA 실측) — 끝말잇기 지시문이 `"전기"(은)는 글자가 이어지지 않아!`
 * 처럼 조사 자리표시자를 그대로 담고 있었다. 이 문장은 Gemini 에게 주는 지시문이지만,
 * 케이가 자주 그대로 옮겨 말해 아이 화면에 `"전기"(은)는`, `"과제"(으)로` 가 찍혔다.
 * wordChainSkill 의 openingLine 처럼 LLM 을 거치지 않고 바로 쓰이는 문장은 늘 새어 나갔다.
 * 그래서 문장을 만들 때 조사를 확정한다.
 */
function getJongseong(word: string): { hasJongseong: boolean; isRieul: boolean } | null {
  const clean = (word ?? "").trim().replace(/["'‘’“”]/g, "");
  if (!clean) return null;
  const code = clean.charCodeAt(clean.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return null;
  const jongseong = (code - 0xac00) % 28;
  return { hasJongseong: jongseong !== 0, isRieul: jongseong === 8 };
}

/** 은/는 — 받침이 있으면 "은". 한글이 아니면 "는". */
export function topicParticle(word: string): string {
  const info = getJongseong(word);
  return info?.hasJongseong ? "은" : "는";
}

/**
 * 이라고/라고 — 받침이 있으면 "이라고".
 *
 * 2026-08-20 Dev QA 실측: 케이가 `내가 "땀"라고 들었는데` 라고 말했다.
 * 받침 있는 낱말에 `라고` 를 붙여서 아이가 읽기에 어색하다.
 */
export function quotativeParticle(word: string): string {
  const info = getJongseong(word);
  return info?.hasJongseong ? "이라고" : "라고";
}

/** 이/가 — 받침이 있으면 "이". */
export function subjectParticle(word: string): string {
  const info = getJongseong(word);
  return info?.hasJongseong ? "이" : "가";
}

/** 을/를 — 받침이 있으면 "을". */
export function objectParticle(word: string): string {
  const info = getJongseong(word);
  return info?.hasJongseong ? "을" : "를";
}

/**
 * 으로/로 — 받침이 없으면 "로", 받침이 'ㄹ' 이어도 "로"(예: 서울로).
 * 그 밖의 받침에서만 "으로".
 */
export function instrumentalParticle(word: string): string {
  const info = getJongseong(word);
  if (!info) return "로";
  if (!info.hasJongseong || info.isRieul) return "로";
  return "으로";
}
