import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillId, PlaySkillModule } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { PLAY_SKILL_REGISTRY, findSkillById } from "./skillRegistry";
import { resolveActiveSkill } from "./activeSkillCoordinator";
import { clearPendingPlayProposal } from "./pendingProposalStore";
import { recordKPlayEvent } from "./kPlayAnalytics";

export interface PlaySkillDto {
  id: string;
  name: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
}

export interface PlaySkillsCatalogResponse {
  skills: PlaySkillDto[];
  activeSkillId: string | null;
}

export interface ExecuteSkillSelectionParams {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  skillId: string;
  gradeRaw?: string | number | null;
  registry?: readonly PlaySkillModule[];
}

export interface ExecuteSkillSelectionResult {
  ok: boolean;
  skillId?: string;
  sessionId?: string;
  /** 아이에게 보일 문구는 여기 담지 않는다. 내부 지시문 유출을 구조적으로 막는다.
   *  게임 시작 안내는 케이가 다음 턴에 직접 말한다. */
  resumed?: boolean;
  openingLine?: string;
  error?: string;
}

/**
 * UI 선택 시 발화가 없으므로 전달할 빈 UtteranceSignals 생성 (§3-3).
 * 가짜 발화("끝말잇기 하자")를 만들어 라우터에 주입하지 않습니다.
 */
export function createEmptyUtteranceSignals(): UtteranceSignals {
  return {
    hasAchievement: false,
    hasConflict: false,
    hasPlayfulSilly: false,
    hasImaginative: false,
    hasMemoryRecallQuery: false,
    hasGeneralKnowledgeQuestion: false,
    hasNegativeEmotion: false,
    hasPositiveEmotion: false,
    hasPhysicalNeed: false,
    isVeryShortLowEffort: false,
    hasChosungGameStart: false,
    hasChosungAnswerAttempt: false,
    hasChosungHintRequest: false,
    hasChosungAnswerRequest: false,
    hasWordChainGameStart: false,
    hasNonsenseGameStart: false,
    hasNonsenseAnswerAttempt: false,
    hasNonsenseHintRequest: false,
    hasPlayRequestWithoutTarget: false,
    hasGenericPlayAcceptance: false,
    hasPlayRejection: false,
    hasPlayStop: false,
  };
}

/**
 * Play Skill Registry를 UI 모달용 카탈로그 DTO로 변환합니다 (§3-2, §3-17).
 * 거대한 게임별 if/else 없이 registry를 매핑하여 새 놀이 추가 시 자동 반영됩니다.
 */
export function buildPlaySkillsCatalogDto(
  registry: readonly PlaySkillModule[] = PLAY_SKILL_REGISTRY,
  activeSkillId: string | null = null
): PlaySkillsCatalogResponse {
  const skills: PlaySkillDto[] = registry.map((skill) => ({
    id: skill.id,
    name: skill.displayName,
    description: skill.childFacingDescription,
    available: true,
  }));

  return {
    skills,
    activeSkillId,
  };
}

/**
 * 명시적 Skill Selection 실행 로직 (§3-4, §3-7).
 *
 * 1. Registry에 존재하는 Skill인지 확인 (findSkillById)
 * 2. availability 확인 (현재는 모두 true)
 * 3. resolveActiveSkill로 현재 활성 조회 (stale 정리 및 1개 이하 보장)
 * 4. 같은 스킬이 이미 활성이면 새로 만들지 않고 그대로 재개 응답 (§3-5)
 * 5. 다른 스킬이 활성이면 end() 호출로 정상 종료 후 다음
 * 6. Pending Play Proposal 정리 (§3-12)
 * 7. 선택 스킬 start({ db, childId, chatSessionId, gradeRaw, utterance: "", signals })
 * 8. getActiveSession으로 실제 생성됐는지 검증 (Hard Guard §3-7)
 * 9. 결과 반환 { ok, skillId, sessionId, text }
 */
export async function executeSkillSelection(
  params: ExecuteSkillSelectionParams
): Promise<ExecuteSkillSelectionResult> {
  const { db, childId, chatSessionId, skillId, gradeRaw } = params;
  const registry = params.registry ?? PLAY_SKILL_REGISTRY;

  if (!db || !childId || !chatSessionId || !skillId) {
    return { ok: false, error: "Missing required parameters" };
  }

  // 1. Registry에 존재하는 Skill인지 확인
  const targetSkill = findSkillById(skillId as PlaySkillId, registry);
  if (!targetSkill) {
    return { ok: false, error: "Invalid skillId" };
  }

  // 2. availability 확인 (현재 전원 사용 가능)

  // 3. resolveActiveSkill로 현재 활성 조회
  const activeResolution = await resolveActiveSkill(db, childId, {
    registry,
    chatSessionId,
  });

  // 4. 같은 스킬이 이미 활성이면 새로 만들지 않고 기존 세션 재개 (§3-5)
  if (
    activeResolution.skill &&
    activeResolution.skill.id === targetSkill.id &&
    activeResolution.sessionId
  ) {
    return {
      ok: true,
      skillId: targetSkill.id,
      sessionId: activeResolution.sessionId,
      resumed: true,
    };
  }

  // 5. 다른 스킬이 활성이면 end() 호출로 안전 종료
  if (activeResolution.skill && activeResolution.skill.id !== targetSkill.id) {
    try {
      await activeResolution.skill.end({
        db,
        childId,
        chatSessionId,
        reason: `SWITCH_TO_${targetSkill.id}`,
      });
    } catch (err) {
      console.error(
        `[executeSkillSelection] Failed to end previous active skill ${activeResolution.skill.id}:`,
        err
      );
    }
  }

  // 6. Pending play proposal 정리 (§3-12)
  await clearPendingPlayProposal(chatSessionId, db);

  // 7. 선택 스킬 start() 실행 (빈 signals, 발화 없음)
  const signals = createEmptyUtteranceSignals();
  const startResult = await targetSkill.start({
    db,
    childId,
    chatSessionId,
    gradeRaw,
    utterance: "",
    signals,
  });

  // 8. getActiveSession으로 실제 생성됐는지 검증 (Hard Guard §3-7)
  const verifiedSession = await targetSkill.getActiveSession(db, childId);
  if (!verifiedSession || !verifiedSession.id) {
    console.error(
      `[executeSkillSelection] Hard Guard violation: start was called for ${targetSkill.id} but no active session was verified for child ${childId}`
    );
    return {
      ok: false,
      error: "Failed to create active play session",
    };
  }

  // 9. 케이 놀이 시작 이벤트 계측 (실패 격리, fire-and-forget)
  recordKPlayEvent("k_play_start", {
    db,
    childId,
    chatSessionId,
    skillId: targetSkill.id,
    route: "/api/play/skill/select",
  });

  // 10. 결과 반환 { ok, skillId, sessionId, openingLine }
  //
  // ★ `startResult.instruction` 을 **절대 밖으로 내보내지 않는다.**
  // 그것은 Gemini 에게 주는 내부 지시문이다(PlaySkillTurnResult 주석 참고).
  // 2026-08-18 프로덕션 사고: 이 값을 text 로 돌려줬더니 모달이 그대로 말풍선에
  // 띄워, 아이가 "- 너는 이 문제의 정답을 모르는 상태로 행동해라..." 같은
  // 시스템 프롬프트를 읽었다. 아이에게 보일 문구는 지시문이 아니라 케이가 만든
  // 응답이어야 하고, 그건 다음 대화 턴에서 나온다. 대신 openingLine 을 내보낸다.
  let safeOpeningLine: string | undefined = startResult.openingLine;
  if (
    safeOpeningLine &&
    (safeOpeningLine === startResult.instruction ||
      safeOpeningLine.startsWith("[") ||
      safeOpeningLine.includes("\n- "))
  ) {
    safeOpeningLine = undefined;
  }

  return {
    ok: true,
    skillId: targetSkill.id,
    sessionId: verifiedSession.id,
    openingLine: safeOpeningLine,
  };
}
