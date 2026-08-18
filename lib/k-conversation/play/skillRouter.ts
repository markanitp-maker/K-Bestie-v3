import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule, PlaySkillTurnResult } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { PLAY_SKILL_REGISTRY, findDirectlyRequestedSkill, findSkillById } from "./skillRegistry";
import { resolveActiveSkill } from "./activeSkillCoordinator";
import {
  getPendingPlayProposal,
  clearPendingPlayProposal,
  setPendingPlayProposal,
} from "./pendingProposalStore";

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
 * K Play Skill Router (§3-3, 007 Hard Guard, 009 Coordinator).
 *
 * Router는 게임 규칙을 전혀 알지 못하며, 오직 등록된 Skill들의 생명주기 계약
 * (getActiveSession, matchesDirectRequest, handleTurn, start, end)과
 * Pending Play Proposal 상태 해석 및 Active Session Hard Guard를 조율합니다.
 *
 * 라우팅 우선순위:
 * 1. 명시적 종료 / 거절 / 부정감정 / 안전 신호 확인 (Proposal 및 세션 정리)
 * 2. 직접 요청 확인 (findDirectlyRequestedSkill 또는 Pending Proposal 선택 매칭)
 *    - Pending Proposal 즉시 clear
 *    - 활성 세션과 다르면 원자적 전환(end -> start)
 *    - 새 세션 start 후 [Hard Guard: getActiveSession 검증]
 * 3. 직접 요청이 없으면: 활성 세션의 handleTurn 실행 (Invariant 3: stickiness 유지)
 * 4. 활성 세션 없음 & Pending Proposal 존재:
 *    - (A) 포괄 수락(signals.hasGenericPlayAcceptance):
 *        - offeredSkills가 1개: 해당 Skill start 시도 -> Hard Guard 검증 -> 성공 시 clear, 실패 시 handled: false
 *        - offeredSkills가 2개 이상: 임의 선택 안 함! 되묻기 지침 반환 (selection required)
 *    - (B) 제안된 스킬 중 하나를 선택한 발화: 해당 Skill start 시도 -> Hard Guard 검증
 * 5. 둘 다 없으면: { handled: false } 반환 (일반 대화로 fall-through)
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
    const pendingProposal = await getPendingPlayProposal(chatSessionId, db, childId);

    // 1. 활성 Skill 확인 & Single Active Skill Coordinator (§3-5, §3-6, §3-15, §3-16)
    const activeSkillResolution = await resolveActiveSkill(db, childId, {
      registry,
      chatSessionId,
    });
    const activeSkill = activeSkillResolution.skill;

    // 2. 명시적 종료 / 거절 / 감정·안전 신호 확인 (Proposal 및 세션 정리)
    const isExplicitStop = Boolean(signals?.hasPlayStop || signals?.hasPlayRejection);
    const hasNegativeOrSafety = Boolean(
      signals?.hasNegativeEmotion || signals?.hasConflict || signals?.hasPhysicalNeed
    );

    if (isExplicitStop || hasNegativeOrSafety) {
      await clearPendingPlayProposal(chatSessionId, db);
      if (activeSkill) {
        try {
          await activeSkill.end({
            db,
            childId,
            chatSessionId,
            reason: isExplicitStop ? "EXPLICIT_STOP" : "SAFETY_OR_NEGATIVE_EMOTION",
          });
        } catch (endError) {
          console.error(
            `[skillRouter] Failed to end active skill ${activeSkill.id}:`,
            endError
          );
        }
      }
      return { handled: false };
    }

    // 3. 직접 요청 확인 (findDirectlyRequestedSkill 또는 Pending Proposal 선택 매칭)
    let requestedSkill = findDirectlyRequestedSkill(signals, utterance, registry);

    // 만약 Pending Proposal이 있고 단답으로 제안된 스킬명을 말한 경우 (예: "초성", "끝말") 매칭
    if (!requestedSkill && pendingProposal && pendingProposal.offeredSkills?.length) {
      const trimmed = utterance.trim();
      for (const skillId of pendingProposal.offeredSkills) {
        const skill = findSkillById(skillId, registry);
        if (!skill) continue;
        if (
          trimmed.includes(skill.displayName) ||
          trimmed.includes(skill.proposal.label) ||
          (skillId === "CHOSUNG" && (trimmed.includes("초성") || trimmed.includes("ㅊㅅ"))) ||
          (skillId === "WORD_CHAIN" && (trimmed.includes("끝말") || trimmed.includes("말잇기"))) ||
          (skillId === "NONSENSE_QUIZ" && (trimmed.includes("넌센스") || trimmed.includes("수수께끼")))
        ) {
          requestedSkill = skill;
          break;
        }
      }
    }

    if (requestedSkill) {
      await clearPendingPlayProposal(chatSessionId, db);
      if (activeSkill) {
        if (activeSkill.id === requestedSkill.id) {
          // 요청된 Skill이 현재 활성 Skill과 같으면 기존 판을 끊지 않고 handleTurn
          const turnResult = await activeSkill.handleTurn(input);
          return {
            ...turnResult,
            skillId: turnResult.skillId ?? activeSkill.id,
          };
        } else {
          // 요청된 Skill이 현재 활성 Skill과 다르면: 기존 활성 Skill.end() -> 요청된 Skill.start()
          try {
            await activeSkill.end({
              db,
              childId,
              chatSessionId,
              reason: `SWITCH_TO_${requestedSkill.id}`,
            });
          } catch (endError) {
            console.error(
              `[skillRouter] Failed to end active skill during transition to ${requestedSkill.id}:`,
              endError
            );
            const turnResult = await activeSkill.handleTurn(input);
            return {
              ...turnResult,
              skillId: turnResult.skillId ?? activeSkill.id,
            };
          }
          const startResult = await requestedSkill.start(input);
          if (startResult.handled && startResult.instruction) {
            return {
              ...startResult,
              skillId: startResult.skillId ?? requestedSkill.id,
            };
          }
          return { handled: false };
        }
      } else {
        // 활성 세션이 없으면 새 게임 start
        const startResult = await requestedSkill.start(input);
        if (startResult.handled && startResult.instruction) {
          return {
            ...startResult,
            skillId: startResult.skillId ?? requestedSkill.id,
          };
        }
        return { handled: false };
      }
    }

    // 4. 직접 요청이 없으면 활성 세션의 handleTurn 실행 (Invariant 3: stickiness 유지)
    if (activeSkill) {
      await clearPendingPlayProposal(chatSessionId, db);
      const turnResult = await activeSkill.handleTurn(input);
      if (turnResult.handled && turnResult.instruction) {
        return {
          ...turnResult,
          skillId: turnResult.skillId ?? activeSkill.id,
        };
      }
      return { handled: false };
    }

    // 5. 활성 세션 없음 & Pending Proposal 존재할 때 아이의 포괄 수락 확인
    if (pendingProposal && pendingProposal.offeredSkills?.length > 0) {
      if (signals?.hasGenericPlayAcceptance) {
        if (pendingProposal.offeredSkills.length === 1) {
          // 단일 제안 수락 -> 해당 스킬 start 시도
          const targetSkillId = pendingProposal.offeredSkills[0];
          const targetSkill = findSkillById(targetSkillId, registry);
          if (targetSkill) {
            const startResult = await targetSkill.start(input);
            await clearPendingPlayProposal(chatSessionId, db);
            if (startResult.handled && startResult.instruction) {
              return {
                ...startResult,
                skillId: startResult.skillId ?? targetSkill.id,
              };
            }
            return { handled: false };
          }
        } else {
          // 복수 제안 수락 -> 임의 선택 금지, 되묻기 요청 (selection required)
          const skillNames = pendingProposal.offeredSkills
            .map((id) => findSkillById(id, registry)?.displayName)
            .filter(Boolean);
          const skillListText = skillNames.join("이랑 ");
          const instruction = `[놀이 선택 안내]\n아이가 놀이를 하자고 수락했지만 어떤 놀이를 할지 고르지 않았어. 아이에게 '${skillListText} 중 뭐 할래?'라고 물어서 아이가 직접 하나를 고르도록 해줘. 절대 네가 먼저 특정 놀이를 시작하거나 문제를 내지 마.`;

          await setPendingPlayProposal({
            ...pendingProposal,
            selectionRequired: true,
            proposedAt: Date.now(),
          }, db);

          return {
            handled: true,
            instruction,
          };
        }
      }
    }

    // 6. 활성 세션도 없고 직접 요청/수락/거절도 아닌 무관한 대화인 경우:
    // 제안은 바로 다음 1턴에만 유효하므로 수락 없이 다른 얘기로 넘어가면 즉시 정리
    if (pendingProposal) {
      await clearPendingPlayProposal(chatSessionId, db);
    }

    return { handled: false };
  } catch (error) {
    console.error("[skillRouter] routePlaySkillTurn unhandled error:", error);
    return { handled: false };
  }
}
