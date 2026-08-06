// 케이(K)의 "동갑내기 친구" 페르소나 — 아이가 케이와 나누는 모든 대화(미션/자유대화)에서
// 케이가 항상 그 아이와 같은 학년·같은 나이로 자신을 소개하게 만드는 공통 빌더.
// 부모-케이 대화·관리자·리포트·Memory Batch에는 적용하지 않는다(요청서 범위 밖).
//
// 나이 매핑은 법적 만 나이 계산이 아니라, 케이 캐릭터가 자기소개할 때 쓰는 한국식
// "학년 나이" 표현이다(초1=8살 ~ 중1=14살). parseGrade()의 중학교 1학년=7 인코딩과
// 짝을 맞춘다 — 콘텐츠 선택용 getEffectiveContentGrade()(중1→초6 대체)는 절대 여기
// 쓰지 않는다. 케이는 항상 실제 학년(중학교 1학년 14살)으로만 답해야 하고, 내부
// 문항 호환 매핑값(초6)을 노출하면 안 된다.
import { parseGrade } from "@/lib/mission/selectQuestions";
import type { SupabaseClient } from "@supabase/supabase-js";

export const GRADE_TO_PEER_AGE: Readonly<Record<number, number>> = {
  1: 8,
  2: 9,
  3: 10,
  4: 11,
  5: 12,
  6: 13,
  7: 14, // 중학교 1학년(parseGrade 인코딩) — 표시는 항상 "중학교 1학년"
};

export interface KPeerPersonaInfo {
  /** 학년 정보를 신뢰할 수 있어 동갑내기 정체성을 말해도 되는지 여부. */
  hasGrade: boolean;
  /** 실제 학년 숫자(parseGrade 결과, 중1=7). 없으면 null. */
  realGrade: number | null;
  /** 화면·LLM 프롬프트 노출용 학년 라벨(child_profiles.grade 원문 그대로, 예: "4학년", "중학교 1학년"). */
  gradeLabel: string;
  /** 케이가 자기소개에 쓸 한국식 학년 나이. 학년 정보가 없거나 매핑 밖이면 null. */
  peerAge: number | null;
}

const SAFE_NO_GRADE_LABEL = "학년 정보 확인 전";

// child_profiles.grade에 실제로 저장되는 정상 형식만 허용한다. parseGrade()는 문자열에서
// 첫 숫자를 그대로 추출하므로("고1"에서도 1을 뽑아냄) 형식 검증 없이 그대로 쓰면 "고1"
// 같은 허용되지 않은 값도 초1(8살)로 잘못 매핑될 수 있다 — 페르소나는 이 형식 화이트
// 리스트를 통과한 값만 신뢰하고, 그 외에는 나이를 추측하지 않는다(안전 fallback).
// "[1-6]" 단독 형식(예: "1")도 포함한다 — 실제 Dev/Production child_profiles.grade에
// "4학년" 같은 텍스트형과 "1" 같은 순수 숫자형이 함께 존재함을 직접 조회로 확인했다.
const VALID_GRADE_LABEL_PATTERN = /^([1-6]학년|[1-6]|중학교\s*1학년|중1)$/;

/** DB에서 막 읽어온 grade 원문(child_profiles.grade)만으로 페르소나 정보를 만든다.
 *  호출부가 이미 서버에서 검증한 child_id로 fetch한 값을 넘겨야 한다 — 클라이언트가
 *  보낸 값을 그대로 넘기지 말 것(스푸핑·형제자매 정보 혼입 방지). */
export function resolveKPeerPersona(gradeRaw: string | number | null | undefined): KPeerPersonaInfo {
  let realGrade: number | null = null;
  if (typeof gradeRaw === "number") {
    realGrade = Number.isInteger(gradeRaw) && gradeRaw >= 1 && gradeRaw <= 7 ? gradeRaw : null;
  } else if (typeof gradeRaw === "string" && VALID_GRADE_LABEL_PATTERN.test(gradeRaw.trim())) {
    realGrade = parseGrade(gradeRaw);
  }

  const peerAge = realGrade !== null ? GRADE_TO_PEER_AGE[realGrade] ?? null : null;

  if (realGrade === null || peerAge === null) {
    return { hasGrade: false, realGrade: null, gradeLabel: SAFE_NO_GRADE_LABEL, peerAge: null };
  }

  // "1" 같은 순수 숫자형 원문은 자연스러운 자기소개 문구가 아니므로 "1학년"으로
  // 정규화해서 노출한다. "4학년"/"중학교 1학년" 같은 이미 자연스러운 텍스트는 원문 그대로 쓴다.
  const rawTrimmed = typeof gradeRaw === "string" ? gradeRaw.trim() : "";
  const gradeLabel = rawTrimmed && !/^[1-6]$/.test(rawTrimmed) ? rawTrimmed : `${realGrade}학년`;
  return { hasGrade: true, realGrade, gradeLabel, peerAge };
}

/** 서버가 이미 인증/권한 검증을 마친 childId로 child_profiles.grade를 새로 조회해
 *  페르소나를 만든다. 세션 시작·복원을 포함해 매 호출마다 새로 조회하므로(캐시하지
 *  않음) 학년 변경이 다음 요청부터 즉시 반영되고, 아이별로 완전히 분리된다. */
export async function fetchKPeerPersonaForChild(
  db: SupabaseClient,
  childId: string
): Promise<KPeerPersonaInfo> {
  const { data } = await db.from("child_profiles").select("grade").eq("id", childId).maybeSingle();
  return resolveKPeerPersona(data?.grade ?? null);
}

/** given_name + 페르소나를 한 번에 서버에서 새로 조회한다. 이름·학년 모두 클라이언트가
 *  보낸 값(예: 요청 body의 childContext)을 신뢰하지 않고, 이미 인증/권한 검증을 마친
 *  childId로 항상 새로 가져온다 — 형제자매 정보 혼입·스푸핑을 원천 차단한다. */
export async function fetchVerifiedChildIdentity(
  db: SupabaseClient,
  childId: string
): Promise<{ givenName: string | null; persona: KPeerPersonaInfo }> {
  const { data } = await db
    .from("child_profiles")
    .select("given_name, grade")
    .eq("id", childId)
    .maybeSingle();
  return {
    givenName: data?.given_name ?? null,
    persona: resolveKPeerPersona(data?.grade ?? null),
  };
}

export interface KPeerPersonaFragmentOptions {
  /** true면 15자 안팎의 초단문 리액션 전용 경로(mission/respond, respond-lean)에 맞춰
   *  훨씬 짧은 정체성 답변 예시를 쓴다. 실측(Dev E2E)에서 "나도 4학년 11살이야. 우리
   *  동갑이네!" 같은 풀 예시 문구를 15자 캡이 걸린 경로에 그대로 주면 모델이 길이
   *  제한과 정체성 답변 지시가 충돌한다고 판단해 정체성 질문에 아예 답하지 않고
   *  넘어가버리는 회귀가 확인됐다 — 짧은 예시로 명시해 이 경로에서도 확실히 답하게 한다. */
  compact?: boolean;
}

/** 시스템 프롬프트에 덧붙일 동갑내기 페르소나 지시문. 기존 K_SYSTEM_PROMPT/
 *  MISSION_CHAT_SYSTEM_PROMPT/FREE_CHAT_SYSTEM_PROMPT의 안전 규칙·말투 규칙은 그대로
 *  둔 채 "덧붙이는" 용도로만 쓴다 — 대체하지 않는다. */
export function buildKPeerPersonaFragment(
  persona: KPeerPersonaInfo,
  options?: KPeerPersonaFragmentOptions
): string {
  const compact = options?.compact ?? false;

  if (!persona.hasGrade) {
    return compact
      ? `[동갑내기 친구 설정] 학년 정보가 없어. 나이·학년을 물으면 추측하지 말고 "학년 확인이 필요해!"처럼 15자 이내로 짧게만 답해.`
      : `
[동갑내기 친구 설정]
지금은 이 아이의 학년 정보를 확인할 수 없어. 나이나 학년을 절대 추측해서 말하지 말고,
아이가 몇 살인지·몇 학년인지 물으면 "우리 학년 정보를 먼저 확인해야 해"처럼 안전하게
대답해. 임의의 학년·나이를 지어내서 답하지 마.
`.trim();
  }

  if (compact) {
    return `[동갑내기 친구 설정] 너는 이 아이와 같은 학년·나이(${persona.gradeLabel}, ${persona.peerAge}살)인 동갑내기야. 아이가 "몇 살이야?", "몇 학년이야?", "동갑이야?"처럼 물으면 "나도 ${persona.gradeLabel}이야!"처럼 15자 이내로 아주 짧게만 답한 뒤 바로 다음 말로 넘어가. 무시·놀림·비속어 금지, 겪은 적 없는 개인사(학교·가족 등) 지어내기 금지.`;
  }

  return `
[동갑내기 친구 설정]
지금 대화 중인 아이는 ${persona.gradeLabel}(${persona.peerAge}살, 한국식 학년 나이)이고,
너도 똑같이 ${persona.gradeLabel} ${persona.peerAge}살이야. 아이가 "너 몇 살이야?", "너 몇
학년이야?", "우리 동갑이야?"처럼 물으면 존댓말이나 선생님·상담사 말투가 아니라 편한
반말로 "나도 ${persona.gradeLabel} ${persona.peerAge}살이야. 우리 동갑이네!"처럼 자연스럽게
답해. 아이를 무시하거나 놀리지 말고, 비속어나 과한 유행어도 쓰지 마. 실제로 겪은 적 없는
학교·반·집·가족·신체·생일 같은 개인사를 지어내지 말고 학교생활을 사실처럼 말하지도 마 —
공감할 땐 "나도 너랑 같은 또래라 그런 마음 알 것 같아"처럼 또래 관점으로만 말해.
`.trim();
}
