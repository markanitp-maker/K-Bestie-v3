import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule } from "./skillTypes";
import { PLAY_SKILL_REGISTRY } from "./skillRegistry";
import { resolveActiveSkill } from "./activeSkillCoordinator";
import { clearPendingPlayProposal } from "./pendingProposalStore";
import { recordKPlayEvent } from "./kPlayAnalytics";

export interface ExecuteSkillEndParams {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  reason?: string;
  registry?: readonly PlaySkillModule[];
}

export interface ExecuteSkillEndResult {
  ok: boolean;
  ended: boolean;
  skillId?: string;
  error?: string;
}

/**
 * 명시적 또는 생명주기 연계 Play Skill 종료 로직 (§3-9, §3-12, §3-13, §3-14).
 *
 * 1. resolveActiveSkill로 현재 활성 Skill 조회 (stale 정리 및 1개 이하 보장)
 * 2. 활성 Skill이 없으면 이미 종료된 상태이므로 { ok: true, ended: false } 반환 (오류 아님)
 * 3. 활성 Skill이 있으면 end({ db, childId, chatSessionId, reason }) 호출
 * 4. getActiveSession으로 실제 세션이 종료되었는지 재확인 (Hard Guard: 끝난 척 방지)
 * 5. clearPendingPlayProposal로 제안 상태 정리
 * 6. 결과 반환 { ok: true, ended: true, skillId }
 */
export async function executeSkillEnd(
  params: ExecuteSkillEndParams
): Promise<ExecuteSkillEndResult> {
  const { db, childId, chatSessionId, reason = "USER_ENDED" } = params;
  const registry = params.registry ?? PLAY_SKILL_REGISTRY;

  if (!db || !childId || !chatSessionId) {
    return { ok: false, ended: false, error: "Missing required parameters" };
  }

  // 1. 현재 활성 스킬 조회
  const activeResolution = await resolveActiveSkill(db, childId, {
    registry,
    chatSessionId,
  });

  // 2. 활성 스킬이 없으면 이미 정리된 상태이므로 성공 반환
  if (!activeResolution.skill || !activeResolution.sessionId) {
    // 혹시 남아있을 수 있는 proposal 정리
    await clearPendingPlayProposal(chatSessionId, db);
    return { ok: true, ended: false };
  }

  const activeSkill = activeResolution.skill;

  // 3. 활성 스킬 end() 호출
  try {
    await activeSkill.end({
      db,
      childId,
      chatSessionId,
      reason,
    });
  } catch (err) {
    console.error(
      `[executeSkillEnd] Error calling end() on skill ${activeSkill.id}:`,
      err
    );
    return {
      ok: false,
      ended: false,
      skillId: activeSkill.id,
      error: "Failed while invoking skill end",
    };
  }

  // 4. getActiveSession으로 실제 종료되었는지 재확인 (§3-7, §3-9 하드 가드)
  const remainingSession = await activeSkill.getActiveSession(db, childId);
  if (remainingSession && remainingSession.id) {
    console.error(
      `[executeSkillEnd] Hard Guard violation: end was called for ${activeSkill.id} but active session ${remainingSession.id} is still present for child ${childId}`
    );
    return {
      ok: false,
      ended: false,
      skillId: activeSkill.id,
      error: "Active play session still exists after termination attempt",
    };
  }

  // 5. Pending Play Proposal 정리 (§3-12)
  await clearPendingPlayProposal(chatSessionId, db);

  // 6. 케이 놀이 종료 이벤트 계측 (실패 격리, fire-and-forget)
  recordKPlayEvent("k_play_complete", {
    db,
    childId,
    chatSessionId,
    skillId: activeSkill.id,
    route: "/api/play/skill/end",
  });

  // 7. 정상 종료 결과 반환
  return {
    ok: true,
    ended: true,
    skillId: activeSkill.id,
  };
}
