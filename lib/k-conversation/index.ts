// K Conversation Engine — 단일 진입점 (071 전체 계약).
// Adapter(자유대화/미션)는 이 respond() 하나만 호출한다. Engine 내부 어떤 모듈도
// adapterContext의 존재/내용으로 분기하지 않는다 — Goal/Completion/parent_questions는
// Adapter가 스스로 처리하고, adapterInstruction(불투명 문자열)만 responseGenerator에
// 그대로 전달된다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationAction, EngineInput, EngineOutput } from "./types";
import { pickReaction, insertSafetyEventWithDedupe } from "./safety";
import { loadCorePersonaContext, buildCorePersonaFragment, type CorePersonaContext } from "./corePersona";
import { resolveGradePersona, buildGradePersonaFragment } from "./gradePersonas";
import { loadRelationshipMemory, formatRelationshipMemory, type RelationshipMemorySnapshot } from "./memory";
import { assessBoredom, buildBoredomUtterances } from "./boredomDetection";
import { selectAction } from "./actionSelector";
import { extractUtteranceSignals, estimateSemanticGroup } from "./utteranceSignals";
import { recordTopicUsage } from "./semanticTopicHistory";
import { generateResponse, type GenerateArgs, type ResponseGeneratorHistoryTurn } from "./responseGenerator";
import { normalizeSameSessionText, type SessionTurn } from "./memory/sameSession";
import { classifyAndExtract, generateReflectiveReaction } from "@/lib/freechat/reactionEngine";
import { routePlaySkillTurn } from "./play/skillRouter";
import { resolveScenarioCard, buildScenarioCardFragment } from "@/lib/relationship/scenarioCard";
import { decidePlayProposal, recordPlayRejection, recordPlayProposal } from "./play/playProposal";
import { PLAY_SKILL_REGISTRY, findSkillById, buildPlayCatalogFragment } from "./play/skillRegistry";
import { setPendingPlayProposal, clearPendingPlayProposal } from "./play/pendingProposalStore";

export type { EngineInput, EngineOutput, ConversationAction, ConversationMode } from "./types";
export type { GenerateArgs } from "./responseGenerator";

export interface RespondDependencies {
  db: SupabaseClient;
  ai: GenerateArgs["ai"];
  modelId: string;
  /** Mission Adapter가 넘기는 불투명 지시문. Engine은 해석하지 않고 프롬프트에 얹기만 한다. */
  adapterInstruction?: string;
  /** 최근 K가 선택했던 Action(Action 다양성 유지용, Adapter가 세션 상태에서 유지). */
  recentActions?: ConversationAction[];
}

export interface SafetyPreflightOptions {
  persistEvent?: boolean;
  childId?: string;
  mode?: EngineInput["mode"];
}

/** Safety가 걸렸을 때 safety_events를 기록한다 — Mission/자유대화 모두 동일하게 필요한
 * 공통 관심사라 Adapter마다 중복하지 않고 Engine에서 한 번만 처리한다. */
async function logSafetyEvent(
  db: SupabaseClient,
  input: EngineInput,
  subcategory: string | undefined,
): Promise<void> {
  try {
    const res = await insertSafetyEventWithDedupe(db, {
      sessionId: input.sessionId,
      childId: input.childId || null,
      subcategory,
      childText: input.currentUtterance,
      source: "QUESTION_ENGINE",
    });
    if (res.error) {
      console.error("[k-conversation/index] safety_events insert failed", (res.error as { message?: string }).message ?? res.error);
    }
  } catch (error) {
    console.error("[k-conversation/index] safety_events insert threw", (error as Error).message);
  }
}

/** Safety만 단독으로 먼저 확인한다. Adapter가 방학 규칙·기억회상처럼 respond() 호출 전에
 * 조기 반환하는 경로를 갖고 있을 때, 그 경로들보다도 Safety가 먼저 실행되도록 하기 위한
 * preflight다(codex-rv Phase 5 지적: 조기 반환 경로가 Safety를 완전히 건너뛰는 회귀가
 * 있었다). 걸리면 EngineOutput을 그대로 반환하고, 안 걸리면 null — Adapter는 null일 때만
 * 기존 조기 반환 로직을 계속 타고, 그 로직도 없으면 결국 respond()를 호출한다. respond()
 * 내부에서도 Safety를 다시 확인하므로(idempotent, 이미 안전하면 재확인은 부작용 없음)
 * 이중 호출을 걱정하지 않아도 된다. */
export async function checkSafetyPreflight(
  db: SupabaseClient,
  sessionId: string,
  currentUtterance: string,
  options: SafetyPreflightOptions = {},
): Promise<EngineOutput | null> {
  const safety = pickReaction(currentUtterance);
  if (!safety.flaggedForParent && safety.category !== "safety") return null;
  if (safety.flaggedForParent && options.persistEvent !== false) {
    await logSafetyEvent(db, {
      childId: options.childId ?? "",
      sessionId,
      mode: options.mode ?? "FREE_CHAT",
      currentUtterance,
    }, safety.safetySubcategory);
  }
  return {
    text: safety.text,
    action: "COMFORT",
    category: "safety",
    safetyFlagged: safety.flaggedForParent,
    safetySubcategory: safety.safetySubcategory,
    tokenIn: 0,
    tokenOut: 0,
  };
}

/** MISSION 모드 등에서 input.currentUtteranceAlreadyInSession === true인 경우,
 * memorySnapshot.sameSession의 마지막 턴이 child이고 그 텍스트가 currentUtterance와 일치할 때만
 * 1건을 제외하여 LLM 프롬프트에 발화가 두 번 들어가는 버그를 방지한다. */
export function filterRecentHistory(
  sameSession: SessionTurn[],
  currentUtterance: string,
  currentUtteranceAlreadyInSession?: boolean,
): ResponseGeneratorHistoryTurn[] {
  let turns = sameSession;
  // 2026-08-17: 원래 currentUtteranceAlreadyInSession === true 일 때만 제거했는데
  // **자유대화·미션 어느 경로도 이 플래그를 넘기지 않았다.** 그래서 중복 제거가
  // 한 번도 동작하지 않았다.
  //
  // 아이 발화는 /api/chat/messages 로 **먼저 저장된 뒤** 응답 요청이 간다. 그래서
  // 세션 이력의 마지막 턴이 곧 현재 발화이고, 여기에 currentUtterance 를 또 붙이면
  // Gemini 는 아이가 같은 말을 두 번 한 것으로 본다. 실제로 Production 에서
  // 케이가 "두 번 말할 정도로 반가웠나 봐" 라고 답했다(박서현, 2026-08-17).
  //
  // 플래그에 의존하지 않고 **마지막 턴이 현재 발화와 같으면 항상 제거**한다.
  // 아이가 같은 말을 정말 두 번 한 경우에도 마지막 하나만 제거되므로
  // 앞선 발화는 이력에 그대로 남는다. 아직 저장 전이면 마지막 턴이 K 라서
  // 아무것도 제거되지 않는다.
  if (turns.length > 0) {
    const lastTurn = turns[turns.length - 1];
    if (
      lastTurn.role === "child" &&
      normalizeSameSessionText(lastTurn.content) === normalizeSameSessionText(currentUtterance)
    ) {
      turns = turns.slice(0, -1);
    }
  }
  void currentUtteranceAlreadyInSession;
  return turns.map((turn) => ({
    role: turn.role,
    text: turn.content,
  }));
}

/** K Conversation Engine의 단일 진입점. 순서: Safety(최우선) → 저신뢰 ASR/앱모드 질문
 * 결정론적 단락 → 4-tier Memory 병렬 조회 → Boredom 판정 → Action 선택 →
 * Response 생성 → Semantic Topic History 기록. */
export async function respond(
  input: EngineInput,
  deps: RespondDependencies,
): Promise<EngineOutput> {
  // 1) Safety — 항상 최우선. 걸리면 Persona/Memory/Action 전부 스킵.
  const safety = pickReaction(input.currentUtterance);
  if (safety.flaggedForParent || safety.category === "safety") {
    if (input.sessionId) {
      await clearPendingPlayProposal(input.sessionId, deps.db);
    }
    if (safety.flaggedForParent) {
      await logSafetyEvent(deps.db, input, safety.safetySubcategory);
    }
    return {
      text: safety.text,
      action: "COMFORT",
      category: "safety",
      safetyFlagged: safety.flaggedForParent,
      safetySubcategory: safety.safetySubcategory,
      tokenIn: 0,
      tokenOut: 0,
    };
  }

  // 2) 앱 모드 질문("자동/수동 모드가 뭐야")은 세션 UI 상태를 정확히 답해야 하므로
  // Adapter가 넘겨준 appMode로 결정론적으로 답한다(Gemini 미호출). 저신뢰 ASR는
  // generateReflectiveReaction의 unclear_audio 템플릿을 그대로 쓴다 — 둘 다 기존
  // route.ts의 정확도를 그대로 보존한다(codex-rv 지적: 이전 버전은 이 구분 없이
  // app_mode_question까지 "모르겠어" 일반 템플릿을 써서 부정확했다).
  const isLowConfidenceAsr = (input.asrConfidence ?? 1) < 0.4;
  const { category: utteranceCategory } = classifyAndExtract(input.currentUtterance, {
    isLowConfidenceAsr,
  });
  if (utteranceCategory === "app_mode_question") {
    const modeLabel = input.appMode === "manual" ? "수동" : "자동";
    return {
      text: `응, 지금은 ${modeLabel} 모드야.`,
      action: "JUST_LISTEN",
      category: "deterministic",
      tokenIn: 0,
      tokenOut: 0,
    };
  }
  if (utteranceCategory === "unclear_audio") {
    const recentKTexts = input.recentKTexts ?? [];
    const reflective = generateReflectiveReaction(input.currentUtterance, recentKTexts, { isLowConfidenceAsr });
    return {
      text: reflective.text,
      action: "JUST_LISTEN",
      category: "deterministic",
      tokenIn: 0,
      tokenOut: 0,
    };
  }

  // 3) 4-tier Memory + Core/Grade Persona 병렬 조회.
  // AGENTS.md 병렬 호출 하드룰: Promise.all 금지, Promise.allSettled 필수(codex-rv 2차 지적 —
  // 최상위 조립부에도 남아 있었다).
  const [memorySettled, coreCtxSettled] = await Promise.allSettled([
    loadRelationshipMemory(deps.db, {
      childId: input.childId,
      sessionId: input.sessionId,
      currentUtterance: input.currentUtterance,
      currentTurnId: input.currentTurnId,
    }),
    loadCorePersonaContext(deps.db, input.childId),
  ]);
  if (memorySettled.status === "rejected") {
    console.error("[k-conversation/index] loadRelationshipMemory rejected", memorySettled.reason);
  }
  if (coreCtxSettled.status === "rejected") {
    console.error("[k-conversation/index] loadCorePersonaContext rejected", coreCtxSettled.reason);
  }
  const memorySnapshot: RelationshipMemorySnapshot =
    memorySettled.status === "fulfilled"
      ? memorySettled.value
      : { sameSession: [], sameDay: [], recentEpisode: null, longTermFacts: [], tiersUsed: [] };
  const coreCtx: CorePersonaContext =
    coreCtxSettled.status === "fulfilled"
      ? coreCtxSettled.value
      : {
          givenName: null,
          peerPersona: { hasGrade: false, realGrade: null, gradeLabel: "학년 정보 확인 전", peerAge: null },
          effectiveStage: null,
        };
  const gradePersona = resolveGradePersona(coreCtx.peerPersona.realGrade ?? coreCtx.peerPersona.gradeLabel);
  const scenarioCard = resolveScenarioCard({
    grade: coreCtx.peerPersona.realGrade ?? coreCtx.peerPersona.gradeLabel,
    effectiveStage: coreCtx.effectiveStage,
  });
  const relationshipFragment = scenarioCard
    ? buildScenarioCardFragment(scenarioCard, coreCtx.effectiveStage)
    : undefined;

  const corePersonaFragment = buildCorePersonaFragment(coreCtx);
  const gradePersonaFragment = gradePersona
    ? buildGradePersonaFragment(gradePersona)
    : "[Grade Persona] 학년 정보 없음 — 나이/학년을 추측해 말하지 마.";
  const memoryFragment = formatRelationshipMemory(memorySnapshot);

  // 4) Boredom — same-session의 아이 발화만 근거로 다중턴 판단.
  const recentChildUtterances = memorySnapshot.sameSession
    .filter((turn) => turn.role === "child")
    .map((turn) => turn.content);
  const boredom = assessBoredom(buildBoredomUtterances(
    recentChildUtterances,
    input.currentUtterance,
    input.currentUtteranceAlreadyInSession === true,
  ));

  // 5) 발화 의미 신호 추출(071 대표 시나리오 구분용 — reactionEngine의 성긴 10-카테고리 대신
  // 사용) + semantic_group 추정.
  //
  // cooldown을 이번 턴 Action 선택에 직접 반영하지 않는다 — 자유대화는 항상 아이 발화에
  // "반응"하는 구조라, currentUtterance에서 뽑은 semantic_group이 cooldown 중이라는 것은
  // 곧 "아이가 지금 그 주제를 스스로 다시 꺼냈다"는 뜻이다(071 §9: 아이가 먼저 꺼내는
  // 주제는 절대 제한하지 않는다). isTopicOnCooldownForK를 여기서 그대로 적용하면 오히려
  // 정책을 위반한다(codex-rv 3차 지적으로 발견). K가 스스로 새 화제를 먼저 제안하는
  // 시점(예: 073의 질문은행 능동 선택)이 생기기 전까지는 semanticTopicHistory의 기록만
  // 남기고, cooldown 판단은 그 능동 선택 로직이 생길 때 붙인다.
  const signals = extractUtteranceSignals(input.currentUtterance);
  const semanticGroup = estimateSemanticGroup(signals);
  const topicMode = input.mode === "MISSION" ? "mission" : "free_chat";

  // 5-1) 놀이 제안 거절 기록 — 아이가 이번 턴에 명확히 거절했으면 쿨다운을 기록하여 반복 제안 차단
  if (signals.hasPlayRejection && input.childId) {
    if (input.sessionId) {
      await clearPendingPlayProposal(input.sessionId, deps.db);
    }
    try {
      await recordPlayRejection(deps.db, input.childId, topicMode);
    } catch (err) {
      console.error("[k-conversation/index] recordPlayRejection failed:", err);
    }
  }

  // 5-2) 활성 놀이 세션 존재 여부 확인 (Registry 순회)
  let hasActivePlaySession = false;
  if (input.childId) {
    for (const skill of PLAY_SKILL_REGISTRY) {
      try {
        const session = await skill.getActiveSession(deps.db, input.childId);
        if (session) {
          hasActivePlaySession = true;
          break;
        }
      } catch (err) {
        console.error("[k-conversation/index] getActiveSession failed:", err);
      }
    }
  }

  // 6) 놀이 스킬 턴 처리 (§3-3, §3-22) — Router를 통해 활성 세션 또는 직접 요청 dispatch.
  // Router가 handled: true면 instruction을 adapterInstruction 앞에 결합하고,
  // handled: false면 기존 자유대화 흐름을 그대로 유지한다.
  let playSkillInstruction: string | undefined;
  let playSkillHandled = false;
  const gradeRaw =
    input.gradeRaw ??
    coreCtx.peerPersona.realGrade ??
    coreCtx.peerPersona.gradeLabel;

  if (input.childId && input.sessionId) {
    try {
      const playTurnResult = await routePlaySkillTurn({
        db: deps.db,
        childId: input.childId,
        chatSessionId: input.sessionId,
        gradeRaw,
        utterance: input.currentUtterance,
        signals,
      });

      if (playTurnResult.handled) {
        playSkillHandled = true;
        if (playTurnResult.instruction) {
          playSkillInstruction = playTurnResult.instruction;
        }
      }
    } catch (error) {
      console.error("[k-conversation/index] play turn failed:", error);
    }
  }

  // 6-1) Action 선택 — 방향만 결정, 고정 문구 아님.
  let action = selectAction({
    signals,
    boredom,
    hasRecentEpisode: Boolean(memorySnapshot.recentEpisode),
    hasLongTermMemory: memorySnapshot.longTermFacts.length > 0,
    recentActions: deps.recentActions ?? [],
  });

  // Hard Guard (§3-5): 활성 세션이 없고 Router가 처리하지 않았으면 gameplay action 차단
  if (!hasActivePlaySession && !playSkillHandled) {
    if (
      action === "PLAYFUL_GAME_CHOSUNG" ||
      (action as string) === "PLAYFUL_GAME_WORD_CHAIN" ||
      (action as string) === "PLAYFUL_GAME_NONSENSE_QUIZ"
    ) {
      action = "FOLLOW_UP";
    }
  }

  // Topic Shift 시 Pending Proposal 정리
  if (action === "TOPIC_SHIFT" && input.sessionId) {
    await clearPendingPlayProposal(input.sessionId, deps.db);
  }

  // 6-2) PLAY_PROPOSAL 제안 결정 — 게임이 처리되지 않은 턴에만 제안 가능
  let playProposalInstruction: string | undefined;
  if (!playSkillHandled && (action === "PLAY_PROPOSAL" || signals.hasPlayRequestWithoutTarget)) {
    try {
      const proposalDecision = await decidePlayProposal({
        db: deps.db,
        childId: input.childId,
        signals,
        boredom: boredom.level,
        hasActivePlaySession,
        sessionRejected: false,
      });

      if (proposalDecision.shouldPropose && proposalDecision.offeredSkills?.length) {
        action = "PLAY_PROPOSAL";
        const offeredSkills = proposalDecision.offeredSkills;

        if (offeredSkills.length === 1) {
          const proposedSkill = findSkillById(offeredSkills[0]);
          if (proposedSkill) {
            playProposalInstruction = `[놀이 제안 지침]\n아이에게 '${proposedSkill.proposal.label}'(${proposedSkill.proposal.shortDescription}) 놀이 하나만 해보자고 친구처럼 자연스럽게 제안해줘. 다른 놀이를 함께 제안하거나 임의로 덧붙이지 말고 같이 하자고 가볍게 권유해.`;
          }
        } else {
          const skillLabels = offeredSkills
            .map((id) => findSkillById(id)?.proposal.label)
            .filter(Boolean);
          playProposalInstruction = `[놀이 제안 지침]\n아이에게 '${skillLabels.join("이나 ")} 할래?'처럼 등록된 놀이(${skillLabels.join(", ")})를 제안해줘. 이 목록 외의 다른 놀이는 절대 언급하거나 임의로 덧붙이지 마.`;
        }

        if (input.sessionId) {
          await setPendingPlayProposal({
            chatSessionId: input.sessionId,
            childId: input.childId,
            offeredSkills,
            proposedAt: Date.now(),
            initiatedBy: "k",
          }, deps.db);
        }

        try {
          await recordPlayProposal(deps.db, input.childId, proposalDecision.skillId, topicMode);
        } catch (err) {
          console.error("[k-conversation/index] recordPlayProposal failed:", err);
        }
      } else if (action === "PLAY_PROPOSAL") {
        action = "FOLLOW_UP";
      }
    } catch (error) {
      console.error("[k-conversation/index] decidePlayProposal failed:", error);
      if (action === "PLAY_PROPOSAL") {
        action = "FOLLOW_UP";
      }
    }
  } else if (playSkillHandled && action === "PLAY_PROPOSAL") {
    action = "FOLLOW_UP";
  }

  const combinedAdapterInstruction = [
    playSkillInstruction,
    playProposalInstruction,
    deps.adapterInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  // 7) 응답 생성 — Gemini 자연생성, 30자/물음표 hard guard 없음.
  const recentHistory = filterRecentHistory(
    memorySnapshot.sameSession,
    input.currentUtterance,
    input.currentUtteranceAlreadyInSession,
  );
  const playCatalogFragment =
    input.mode === "FREE_CHAT" ? buildPlayCatalogFragment() : undefined;
  const generated = await generateResponse({
    ai: deps.ai,
    modelId: deps.modelId,
    input: {
      mode: input.mode,
      action,
      corePersonaFragment,
      gradePersonaFragment,
      relationshipFragment,
      memoryFragment,
      currentUtterance: input.currentUtterance,
      recentHistory,
      adapterInstruction: combinedAdapterInstruction || undefined,
      isGeneralKnowledgeQuestion: signals.hasGeneralKnowledgeQuestion,
      playCatalogFragment,
      hasActivePlaySession,
      playSkillHandled,
    },
  });

  // 8) Semantic Topic History 기록.
  try {
    await recordTopicUsage(deps.db, input.childId, semanticGroup, topicMode, "child");
    if (action === "TOPIC_SHIFT") {
      const kResponseSemanticGroup = estimateSemanticGroup(extractUtteranceSignals(generated.text));
      if (kResponseSemanticGroup !== semanticGroup) {
        await recordTopicUsage(deps.db, input.childId, kResponseSemanticGroup, topicMode, "k");
      }
    } else if (action === "PLAY_PROPOSAL") {
      await recordTopicUsage(deps.db, input.childId, "PLAY_PROPOSAL", topicMode, "k");
    }
  } catch (err) {
    console.error("[k-conversation/index] recordTopicUsage failed:", err);
  }

  return {
    text: generated.text,
    action,
    category: "generated",
    boredom,
    memoryTiersUsed: memorySnapshot.tiersUsed,
    tokenIn: generated.tokenIn,
    tokenOut: generated.tokenOut,
  };
}
