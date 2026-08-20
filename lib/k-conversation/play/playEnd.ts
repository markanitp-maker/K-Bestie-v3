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

  // 2-0. 조회가 실패했으면 "활성 스킬 없음" 은 사실이 아니라 모르는 것이다.
  //      이걸 "이미 정리됨" 으로 통과시키면, 아이가 "그만" 이라고 했는데 세션이
  //      그대로 남는다. 다음 턴에 놀이가 되살아나 아이 뜻과 어긋난다.
  if (!activeResolution.skill && activeResolution.lookupFailed) {
    console.error(
      `[executeSkillEnd] 활성 놀이 조회 실패로 종료를 확정할 수 없다 (child ${childId})`
    );
    return {
      ok: false,
      ended: false,
      error: "Failed to look up active play session before termination",
    };
  }

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
  //
  // 조회 실패를 삼키면 null 이 와서 "종료 확인됨" 으로 오인한다. 그러면 세션이
  // 남아 있는데 ok:true 를 돌려주는, 하드 가드가 있으나 마나인 상태가 된다.
  // 그래서 여기서는 실패를 던지게 하고 종료 실패로 처리한다.
  let remainingSession: { id: string } | null = null;
  try {
    remainingSession = await activeSkill.getActiveSession(db, childId, {
      throwOnError: true,
    });
  } catch (err) {
    console.error(
      `[executeSkillEnd] 종료 확인 조회 실패 (${activeSkill.id}, child ${childId}):`,
      err
    );
    return {
      ok: false,
      ended: false,
      skillId: activeSkill.id,
      error: "Failed to verify play session termination",
    };
  }

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

  // 4-1. 못 읽은 스킬이 있었으면 한 번 더 확인한다.
  //
  // 활성 스킬을 하나 찾았다는 것과 "전부 확인했다" 는 다르다. 조회에 실패한 스킬에
  // 중복 활성 세션이 남아 있으면, 그것 하나만 끝내고 "전부 끝났다" 고 답하게 된다
  // (리뷰 지적, 2026-08-20). 아이는 그만하자고 했는데 다음 턴에 놀이가 되살아난다.
  if (activeResolution.lookupFailed) {
    const recheck = await resolveActiveSkill(db, childId, {
      registry,
      chatSessionId,
    });
    if (recheck.skill && recheck.sessionId) {
      // 남아 있던 다른 놀이다. 이어서 끝내고, 끝났는지 **검증까지** 한다.
      const remaining = recheck.skill;
      try {
        await remaining.end({ db, childId, chatSessionId, reason });
      } catch (err) {
        console.error(
          `[executeSkillEnd] 재확인에서 찾은 ${remaining.id} 종료 실패:`,
          err
        );
        return {
          ok: false,
          ended: false,
          skillId: remaining.id,
          error: "Failed to end a play session found on recheck",
        };
      }

      // 검증을 빼면 재확인이 형식만 남는다 — 끝난 척을 한 번 더 허용하는 셈이다.
      try {
        const stillThere = await remaining.getActiveSession(db, childId, {
          throwOnError: true,
        });
        if (stillThere && stillThere.id) {
          console.error(
            `[executeSkillEnd] 재확인 종료 후에도 ${remaining.id} 세션 ${stillThere.id} 가 남아 있다 (child ${childId})`
          );
          return {
            ok: false,
            ended: false,
            skillId: remaining.id,
            error: "Play session still exists after recheck termination",
          };
        }
      } catch (err) {
        console.error(
          `[executeSkillEnd] 재확인 종료 검증 조회 실패 (${remaining.id}):`,
          err
        );
        return {
          ok: false,
          ended: false,
          skillId: remaining.id,
          error: "Failed to verify recheck termination",
        };
      }

      // 재확인 자체가 또 실패를 안고 있으면 "전부 끝났다" 고 말할 근거가 없다.
      if (recheck.lookupFailed) {
        console.error(
          `[executeSkillEnd] 재확인에도 못 읽은 스킬이 남아 전체 종료를 확정할 수 없다 (child ${childId})`
        );
        return {
          ok: false,
          ended: false,
          skillId: remaining.id,
          error: "Could not confirm all play sessions ended",
        };
      }
    } else if (recheck.lookupFailed) {
      // 여전히 못 읽었다. 전부 끝났다고 말할 근거가 없다.
      console.error(
        `[executeSkillEnd] 재확인도 실패해 전체 종료를 확정할 수 없다 (child ${childId})`
      );
      return {
        ok: false,
        ended: false,
        skillId: activeSkill.id,
        error: "Could not confirm all play sessions ended",
      };
    }
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
