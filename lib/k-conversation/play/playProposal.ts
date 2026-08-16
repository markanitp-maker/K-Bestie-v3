import type { SupabaseClient } from "@supabase/supabase-js";
import type { UtteranceSignals } from "../utteranceSignals";
import type { PlaySkillId, PlaySkillModule } from "./skillTypes";
import { PLAY_SKILL_REGISTRY } from "./skillRegistry";
import { isTopicOnCooldownForK, recordTopicUsage } from "../semanticTopicHistory";

export interface PlayProposalDecision {
  shouldPropose: boolean;
  skillId?: PlaySkillId;
  blockedReason?: string; // 관측용
}

export interface DecidePlayProposalInput {
  db: SupabaseClient;
  childId: string;
  signals: UtteranceSignals;
  boredom: "none" | "rising" | "high";
  hasActivePlaySession: boolean;
  sessionRejected: boolean; // 이번 세션에서 이미 거절했는가
  registry?: readonly PlaySkillModule[];
}

/**
 * K Play Proposal Decision (§3-1, §3-2).
 *
 * K가 먼저 아이에게 놀이를 제안할지 여부와 무엇을 제안할지 결정합니다.
 *
 * [핵심 원칙]
 * 1. PLAY_PROPOSAL은 게임을 직접 실행하지 않는다 (제안 여부 및 대상 Skill만 결정).
 * 2. 특정 Skill 직접 요청은 PLAY_PROPOSAL을 거치지 않는다 (SkillRouter로 직접 진입).
 * 3. child-initiated 요청은 언제든 허용한다 (쿨다운은 K가 먼저 제안할 때만 적용).
 * 4. 차단 조건이 제안 조건보다 항상 우선한다 (§3-2).
 *
 * [차단 조건 평가 순서]
 * 1) 부정 감정 / 화남 / 짜증 (signals.hasNegativeEmotion)
 * 2) 갈등 (signals.hasConflict)
 * 3) 신체 불편 (signals.hasPhysicalNeed)
 * 4) 진지한 성취 (signals.hasAchievement)
 * 5) 강한 현재 대화 흐름 (기억 회상 질의, 일반 지식 질문)
 * 6) 특정 게임 직접 요청 발화 (signals.hasChosungGameStart, signals.hasWordChainGameStart)
 * 7) 이미 활성 게임 세션 존재 (hasActivePlaySession)
 * 8) 이번 세션에서 이미 거절함 (sessionRejected)
 * 9) K 놀이 제안 쿨다운 중 (isTopicOnCooldownForK('PLAY_PROPOSAL'))
 *
 * [제안 발동 조건]
 * - 명시적 놀이 요청(게임 미지정) (signals.hasPlayRequestWithoutTarget)
 * - 장난스러운/silly 분위기 (signals.hasPlayfulSilly)
 * - Boredom rising 또는 high (boredom === 'rising' || boredom === 'high')
 *
 * [Skill 선택]
 * - Registry에서 K 쿨다운이 걸리지 않은 Skill을 우선 선택합니다.
 */
export async function decidePlayProposal(
  input: DecidePlayProposalInput
): Promise<PlayProposalDecision> {
  const {
    db,
    childId,
    signals,
    boredom,
    hasActivePlaySession,
    sessionRejected,
  } = input;

  const registry = input.registry ?? PLAY_SKILL_REGISTRY;

  // --- 1. 차단 조건 평가 (Blocking Conditions) ---

  // 1) 부정 감정 / 화남 / 짜증 / 슬픔
  if (signals.hasNegativeEmotion) {
    return { shouldPropose: false, blockedReason: "negative_emotion" };
  }

  // 2) 친구 갈등
  if (signals.hasConflict) {
    return { shouldPropose: false, blockedReason: "conflict" };
  }

  // 3) 신체 불편 / 피로 / 배고픔
  if (signals.hasPhysicalNeed) {
    return { shouldPropose: false, blockedReason: "physical_need" };
  }

  // 4) 진지한 현재 Topic / 성취
  if (signals.hasAchievement) {
    return { shouldPropose: false, blockedReason: "serious_topic_achievement" };
  }

  // 5) 강한 현재 대화 흐름 (기억 회상, 일반 지식 질문)
  if (signals.hasMemoryRecallQuery) {
    return { shouldPropose: false, blockedReason: "serious_topic_memory_recall" };
  }
  if (signals.hasGeneralKnowledgeQuestion) {
    return { shouldPropose: false, blockedReason: "serious_topic_general_question" };
  }

  // 6) 특정 게임 직접 요청인 경우 (PLAY_PROPOSAL을 거치지 않고 바로 Skill로 진입)
  if (signals.hasChosungGameStart || signals.hasWordChainGameStart) {
    return { shouldPropose: false, blockedReason: "direct_game_request" };
  }

  // 7) 이미 활성 게임 세션이 있는 경우
  if (hasActivePlaySession) {
    return { shouldPropose: false, blockedReason: "active_play_session" };
  }

  // 8) 이번 세션에서 이미 거절한 경우
  if (sessionRejected) {
    return { shouldPropose: false, blockedReason: "session_rejected" };
  }

  // 9) K의 PLAY_PROPOSAL 쿨다운 확인 (DB)
  if (db && childId) {
    const isGeneralCooldown = await isTopicOnCooldownForK(db, childId, "PLAY_PROPOSAL");
    if (isGeneralCooldown) {
      return { shouldPropose: false, blockedReason: "k_proposal_cooldown" };
    }
  }

  // --- 2. 제안 발동 조건 평가 (Trigger Conditions) ---
  const hasTrigger =
    signals.hasPlayRequestWithoutTarget ||
    signals.hasPlayfulSilly ||
    boredom === "rising" ||
    boredom === "high";

  if (!hasTrigger) {
    return { shouldPropose: false, blockedReason: "no_trigger_signal" };
  }

  // --- 3. 제안할 Skill 선택 (Registry 기반 & K 쿨다운 회피) ---
  // Registry에서 K 쿨다운이 걸리지 않은 Skill을 우선 탐색합니다.
  const availableSkills: PlaySkillModule[] = [];

  for (const skill of registry) {
    if (db && childId) {
      const isSkillCooldown = await isTopicOnCooldownForK(
        db,
        childId,
        `PLAYFUL_GAME_${skill.id}`
      );
      if (!isSkillCooldown) {
        availableSkills.push(skill);
      }
    } else {
      availableSkills.push(skill);
    }
  }

  // 만약 모든 개별 스킬이 쿨다운 중이라면 제안하지 않음
  if (availableSkills.length === 0) {
    return { shouldPropose: false, blockedReason: "all_skills_on_cooldown" };
  }

  // 사용 가능한 스킬 중 첫 번째 선택
  const selectedSkill = availableSkills[0];

  return {
    shouldPropose: true,
    skillId: selectedSkill.id,
  };
}

/**
 * 아이의 놀이 제안 거절을 기록하여 같은 세션/기간 동안 K가 반복 제안하지 않도록 합니다.
 */
export async function recordPlayRejection(
  db: SupabaseClient,
  childId: string,
  mode: "mission" | "free_chat" = "free_chat"
): Promise<void> {
  if (!db || !childId) return;
  await recordTopicUsage(db, childId, "PLAY_PROPOSAL", mode, "k", 1);
}

/**
 * K의 놀이 제안을 기록합니다.
 */
export async function recordPlayProposal(
  db: SupabaseClient,
  childId: string,
  skillId?: PlaySkillId,
  mode: "mission" | "free_chat" = "free_chat"
): Promise<void> {
  if (!db || !childId) return;
  await recordTopicUsage(db, childId, "PLAY_PROPOSAL", mode, "k", 1);
  if (skillId) {
    await recordTopicUsage(db, childId, `PLAYFUL_GAME_${skillId}`, mode, "k", 1);
  }
}
