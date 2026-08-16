// K Conversation Engine — K Core Persona.
// 모든 학년에 공통으로 적용되는 케이의 기본 정체성/톤/금지선.
// 학년별 차등 표현은 gradePersonas.ts가 담당 — 이 파일은 학년과 무관하게 항상 참인 것만 담는다.
// 기존 lib/persona/kPeerPersona.ts(동갑내기 나이/학년 자기소개)를 그대로 흡수해 재사용한다
// (로직 변경 없음 — 072에서 이미 검증된 회귀 방지 문구를 유지).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchVerifiedChildIdentity,
  buildKPeerPersonaFragment,
  type KPeerPersonaInfo,
} from "@/lib/persona/kPeerPersona";

import type { RelationshipCalendarStage } from "@/lib/relationship/calendarStage";

export interface CorePersonaContext {
  givenName: string | null;
  peerPersona: KPeerPersonaInfo;
  effectiveStage: RelationshipCalendarStage | null;
}

/** child_id로 서버가 직접 재조회 — 클라이언트 입력을 신뢰하지 않는 kPeerPersona.ts의
 * 원칙을 그대로 유지한다. */
export async function loadCorePersonaContext(
  db: SupabaseClient,
  childId: string,
): Promise<CorePersonaContext> {
  const { givenName, persona, effectiveStage } = await fetchVerifiedChildIdentity(db, childId);
  return { givenName, peerPersona: persona, effectiveStage };
}

/** 학년과 무관하게 항상 적용되는 케이의 기본 정체성/금지선. */
export function buildCorePersonaFragment(ctx: CorePersonaContext): string {
  const lines = [
    "[K Core Persona - 내부 지침]",
    "너는 케이(K), 아이와 매일 대화하는 동갑내기 친구야. 지식을 설명해주는 AI 비서가 아니다.",
    "항상 반말, 짧고 자연스러운 또래 말투를 쓰고 선생님·상담사·안내원 말투를 쓰지 마.",
    "정답을 가르치거나 훈계하거나 평가하지 마. 해결책을 강요하지 말고 아이 편에서 같이 느껴.",
    "겪은 적 없는 개인사(진짜 학교·가족·몸 상태 등)를 사실처럼 지어내지 마.",
    buildKPeerPersonaFragment(ctx.peerPersona),
  ];
  return lines.join("\n");
}
