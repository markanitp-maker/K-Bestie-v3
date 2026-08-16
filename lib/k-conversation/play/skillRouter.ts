import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule, PlaySkillTurnResult } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { PLAY_SKILL_REGISTRY, findDirectlyRequestedSkill } from "./skillRegistry";

export interface RoutePlaySkillTurnInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  gradeRaw?: string | number | null;
  utterance: string;
  signals: UtteranceSignals;
  registry?: readonly PlaySkillModule[];
}

/**
 * K Play Skill Router (§3-3).
 *
 * Router는 게임 규칙을 전혀 알지 못하며, 오직 등록된 Skill들의 생명주기 계약
 * (getActiveSession, matchesDirectRequest, handleTurn, start)만 조율합니다.
 *
 * 라우팅 우선순위:
 * 1. 활성 Skill 확인 -> active 세션이 있으면 해당 Skill의 handleTurn으로 dispatch.
 *    (Cross-game Guard: 2개 이상 발견 시 에러 로그를 남기고 첫 번째 것만 진행)
 * 2. 활성 세션이 없으면 직접 요청 확인 -> matchesDirectRequest 일치 시 start로 dispatch.
 * 3. 둘 다 없으면 { handled: false } 반환 (일반 대화로 fall-through).
 *
 * 실패 격리 (§3-22): 모든 경로에서 예외 발생 시 fail-open({ handled: false })하여
 * 게임 문제로 인해 일반 대화가 중단되지 않도록 보장합니다.
 */
export async function routePlaySkillTurn(
  input: RoutePlaySkillTurnInput
): Promise<PlaySkillTurnResult> {
  try {
    const { db, childId, chatSessionId, utterance, signals } = input;

    if (!db || !childId || !chatSessionId) {
      return { handled: false };
    }

    const registry = input.registry ?? PLAY_SKILL_REGISTRY;

    // 1. 활성 Skill 확인 & Cross-game Active Guard (§3-23)
    const activeSkills: { skill: PlaySkillModule; session: { id: string } }[] = [];

    for (const skill of registry) {
      try {
        const session = await skill.getActiveSession(db, childId);
        if (session) {
          activeSkills.push({ skill, session });
        }
      } catch (err) {
        console.error(
          `[skillRouter] Failed checking active session for skill ${skill.id}:`,
          err
        );
      }
    }

    if (activeSkills.length > 1) {
      console.error(
        `[skillRouter] Cross-game active guard: multiple active skills detected for child ${childId} (${activeSkills.map((s) => s.skill.id).join(", ")}). Proceeding with first active skill: ${activeSkills[0].skill.id}`
      );
    }

    if (activeSkills.length >= 1) {
      const activeSkill = activeSkills[0].skill;
      const turnResult = await activeSkill.handleTurn(input);
      return turnResult;
    }

    // 2. 직접 요청 확인 (새 게임 start 전 다른 활성 세션이 없음을 1단계에서 이미 확인)
    const requestedSkill = findDirectlyRequestedSkill(signals, utterance, registry);
    if (requestedSkill) {
      const startResult = await requestedSkill.start(input);
      return startResult;
    }

    // 3. 활성 세션도 없고 직접 요청도 아닌 경우
    return { handled: false };
  } catch (error) {
    console.error("[skillRouter] routePlaySkillTurn unhandled error:", error);
    return { handled: false };
  }
}
