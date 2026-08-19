import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule, PlaySkillTurnResult } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { PLAY_SKILL_REGISTRY, findDirectlyRequestedSkill, findSkillById } from "./skillRegistry";
import { isKPlayEnabled } from "./playAvailability";
import { resolveActiveSkill } from "./activeSkillCoordinator";
import { recordKPlayEvent } from "./kPlayAnalytics";
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
  recordEvent?: typeof recordKPlayEvent;
}

/**
 * K Play Skill Router (§3-3, 007 Hard Guard, 009 Coordinator).
 *
 * Router는 게임 규칙을 전혀 알지 못하며, 오직 등록된 Skill들의 생명주기 계약
 * (getActiveSession, matchesDirectRequest, handleTurn, start, end)과
 * Pending Play Proposal 상태 해석 및 Active Session Hard Guard를 조율합니다.
 *
 * 라우팅 우선순위:
 * 1. 명시적 종료/거절이면 세션을 끝낸다. 부정 감정만으로는 끝내지 않는다(015).
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
  if (!isKPlayEnabled()) {
    return { handled: false };
  }

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

    // 2. 명시적 종료 / 거절 / 감정 신호 확인 (Proposal 및 세션 정리)
    //
    // 015 — 부정 감정만으로는 놀이를 끝내지 않는다.
    //
    // 원래는 hasNegativeEmotion/hasConflict/hasPhysicalNeed 중 하나만 있어도 활성 세션을
    // 끝냈다. 그런데 아이가 짜증내는 대상은 대부분 놀이 자체다 — 케이가 못 알아들어서
    // 답답한 것이다. 그 짜증이 놀이를 꺼버리니 아이는 더 답답해진다.
    // 2026-08-19 김서아 Dev 로그 실측:
    //   아이: "아 진짜 졸라 짜증나네" → 초성게임 종료
    //   아이: "지금 방금 니 멋대로 KR 놀이가 꺼져버렸어 지금 우리 초성 게임 하고 있었는데
    //          갑자기 이렇게 꺼져버리면 어떡하냐"
    //   아이: "케이 놀이 선택 했으면 케이 놀이 끝날 때까지는 놀이에만 집중해"
    //
    // 그래서 놀이를 끝내는 것은 아이가 그만하자고 말했을 때뿐이다. 부정 감정이 있으면
    // 제안(proposal)만 거두고 세션은 살려 둔다 — 케이는 그 감정에 먼저 반응하고,
    // 다음 턴에 하던 놀이를 이어간다.
    //
    // 안전은 여기서 다루지 않는다. 실제 위험 신호는 respond() 1단계 Safety 가 이미
    // 가로채므로 이 지점에 도달하지 않는다.
    const isExplicitStop = Boolean(signals?.hasPlayStop || signals?.hasPlayRejection);
    const hasNegativeEmotion = Boolean(
      signals?.hasNegativeEmotion || signals?.hasConflict || signals?.hasPhysicalNeed
    );

    if (isExplicitStop) {
      await clearPendingPlayProposal(chatSessionId, db);
      if (activeSkill) {
        try {
          await activeSkill.end({
            db,
            childId,
            chatSessionId,
            reason: "EXPLICIT_STOP",
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

    if (hasNegativeEmotion) {
      // 제안은 거둔다 — 기분이 안 좋은 아이에게 새 놀이를 밀어넣지 않는다.
      // 하던 놀이는 그대로 둔다.
      await clearPendingPlayProposal(chatSessionId, db);
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
            recordKPlayStarted(input, requestedSkill.id);
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
          recordKPlayStarted(input, requestedSkill.id);
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
              recordKPlayStarted(input, targetSkill.id);
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

/**
 * 아이가 **말로** 게임을 시작한 경로의 계측.
 *
 * 모달 선택(`executeSkillSelection`)만 계측하면 "끝말잇기 하자"처럼 말로 시작한
 * 놀이가 통째로 안 잡힌다. 그쪽이 오히려 더 많다.
 */
function recordKPlayStarted(input: RoutePlaySkillTurnInput, skillId: string): void {
  const recorder = input.recordEvent ?? recordKPlayEvent;
  recorder("k_play_start", {
    db: input.db,
    childId: input.childId,
    chatSessionId: input.chatSessionId,
    skillId,
    route: "utterance",
  });
}
