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
 * (getActiveSession, matchesDirectRequest, handleTurn, start, end)만 조율합니다.
 *
 * 라우팅 우선순위:
 * 1. 직접 요청 확인 (findDirectlyRequestedSkill)
 *    - 요청된 Skill이 현재 활성 Skill과 "다르면": 기존 활성 Skill.end() -> 요청된 Skill.start() (원자적 전환)
 *    - 요청된 Skill이 현재 활성 Skill과 "같으면": 그대로 handleTurn (진행 중인 판 유지)
 *    - 활성 Skill이 없으면: 요청된 Skill.start()
 * 2. 명시적 종료 확인 (hasPlayStop/hasPlayRejection)
 *    - 활성 Skill이 있으면: 활성 Skill.end() -> handled: false (일반 대화로 복귀)
 * 3. 직접 요청이 없으면: 활성 세션의 handleTurn 실행 (Invariant 3: stickiness 유지)
 * 4. 둘 다 없으면: { handled: false } 반환 (일반 대화로 fall-through)
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

    const activeSkill = activeSkills.length > 0 ? activeSkills[0].skill : null;

    // 2. 직접 요청 확인 (findDirectlyRequestedSkill) — Invariant 2: 명시적 요청이 활성 세션을 이긴다
    const requestedSkill = findDirectlyRequestedSkill(signals, utterance, registry);

    if (requestedSkill) {
      if (activeSkill) {
        if (activeSkill.id === requestedSkill.id) {
          // 요청된 Skill이 현재 활성 Skill과 같으면 기존 판을 끊지 않고 handleTurn
          return await activeSkill.handleTurn(input);
        } else {
          // 요청된 Skill이 현재 활성 Skill과 다르면: 기존 활성 Skill.end() -> 요청된 Skill.start()
          // 전환은 원자적이어야 한다: end가 실패하면 start하지 않고 기존 게임 유지
          try {
            for (const { skill } of activeSkills) {
              if (skill.id !== requestedSkill.id) {
                await skill.end({
                  db,
                  childId,
                  chatSessionId,
                  reason: `SWITCH_TO_${requestedSkill.id}`,
                });
              }
            }
          } catch (endError) {
            console.error(
              `[skillRouter] Failed to end active skill during transition to ${requestedSkill.id}:`,
              endError
            );
            return await activeSkill.handleTurn(input);
          }
          return await requestedSkill.start(input);
        }
      } else {
        // 활성 세션이 없으면 새 게임 start
        return await requestedSkill.start(input);
      }
    }

    // 3. 명시적 종료 의도 확인 (Invariant 3) — "그만할래", "안 할래", "그만하자" 등
    const isExplicitStop = Boolean(signals?.hasPlayStop || signals?.hasPlayRejection);
    if (isExplicitStop && activeSkills.length > 0) {
      for (const { skill } of activeSkills) {
        try {
          await skill.end({ db, childId, chatSessionId, reason: "EXPLICIT_STOP" });
        } catch (endError) {
          console.error(
            `[skillRouter] Failed to end active skill ${skill.id} on explicit stop:`,
            endError
          );
        }
      }
      return { handled: false };
    }

    // 4. 직접 요청이 없으면 활성 세션의 handleTurn 실행 (Invariant 3: stickiness 유지)
    if (activeSkill) {
      return await activeSkill.handleTurn(input);
    }

    // 5. 활성 세션도 없고 직접 요청도 아닌 경우
    return { handled: false };
  } catch (error) {
    console.error("[skillRouter] routePlaySkillTurn unhandled error:", error);
    return { handled: false };
  }
}
