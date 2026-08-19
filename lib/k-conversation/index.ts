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
import { extractGrowthCandidates } from "@/lib/growth/utteranceExtraction";
import { recordGrowthCandidates } from "@/lib/growth/candidates";
import { resolveGrowthQuestionOpportunity } from "@/lib/growth/questionOpportunity";
import { buildUnclearAudioRecovery } from "@/lib/freechat/unclearAudioRecovery";
import { decideSafetyDeferral } from "./shortUtteranceSafetyGate";
import { extractUtteranceSignals, estimateSemanticGroup } from "./utteranceSignals";
import { recordTopicUsage } from "./semanticTopicHistory";
import { generateResponse, type GenerateArgs, type ResponseGeneratorHistoryTurn } from "./responseGenerator";
import { applyRelationshipSafety } from "./relationshipSafety";
import { categoryForRule } from "./relationshipTaxonomy";
import { assessRelationshipRisk } from "./relationshipRiskGate";
import {
  accumulatedRiskCategories,
  getRelationshipHealth,
  recordRelationshipSignals,
} from "./relationshipHealthState";
import {
  isRelationshipJudgeShadowEnabled,
  judgeRelationshipRisk,
} from "./relationshipSemanticJudge";
import {
  logShadowTurn,
  recordCandidate,
  recordJudge,
} from "./relationshipShadowTelemetry";
import { normalizeSameSessionText, type SessionTurn } from "./memory/sameSession";
import { classifyAndExtract, generateReflectiveReaction } from "@/lib/freechat/reactionEngine";
import { routePlaySkillTurn } from "./play/skillRouter";
import { detectFakeGameplay, hasUnauthorizedGameMove, pickFakeGameplayRecoveryText, type FakeGameplayKind } from "./play/fakeGameplayDetector";
import { detectChosungAnswerLeak, detectChosungPuzzleMismatch } from "./chosungGame/outputGuard";
import { detectWordChainOutputViolation } from "./wordChain/outputGuard";
import { lookupWord } from "./wordChain/dictionaryIndex";
import { deriveWordChainEntry } from "./wordChain/dictionaryTypes";
import {
  detectFabricatedRecall,
  pickFabricatedRecallFallbackText,
} from "./memory/fabricatedRecallDetector";
import { resolveScenarioCard, buildScenarioCardFragment } from "@/lib/relationship/scenarioCard";
import { decidePlayProposal, recordPlayRejection, recordPlayProposal } from "./play/playProposal";
import { PLAY_SKILL_REGISTRY, findSkillById, buildPlayCatalogFragment } from "./play/skillRegistry";
import { isKPlayEnabled, getPlayDisabledResponse } from "./play/playAvailability";
import { setPendingPlayProposal, clearPendingPlayProposal } from "./play/pendingProposalStore";
import type { PlaySkillId } from "./play/skillTypes";

/**
 * PlaySkillId ↔ FakeGameplayKind 매핑 (§3)
 * - CHOSUNG: 초성 퀴즈 특성상 초성 자음(CHOSUNG) 및 퀴즈 발화(QUIZ: "문제", "맞혀봐", "정답은")를 모두 포함
 * - WORD_CHAIN: 끝말잇기 발화(WORD_CHAIN)
 * - NONSENSE_QUIZ: 퀴즈 발화(QUIZ)
 */
const PLAY_SKILL_TO_FAKE_GAMEPLAY_KINDS: Record<PlaySkillId, FakeGameplayKind[]> = {
  CHOSUNG: ["CHOSUNG", "QUIZ"],
  WORD_CHAIN: ["WORD_CHAIN"],
  NONSENSE_QUIZ: ["QUIZ"],
};

export type { EngineInput, EngineOutput, ConversationAction, ConversationMode } from "./types";
export type { GenerateArgs } from "./responseGenerator";

export interface RespondDependencies {
  db: SupabaseClient;
  ai: GenerateArgs["ai"];
  modelId: string;
  /** 020 §3-2 — 응답 생성 primary 실패 시 1회만 쓰는 대체 모델. 없으면 대체 호출을 하지 않는다. */
  fallbackModelId?: string;
  /** Mission Adapter가 넘기는 불투명 지시문. Engine은 해석하지 않고 프롬프트에 얹기만 한다. */
  adapterInstruction?: string;
  /** 최근 K가 선택했던 Action(Action 다양성 유지용, Adapter가 세션 상태에서 유지). */
  recentActions?: ConversationAction[];
}

export interface SafetyPreflightOptions {
  persistEvent?: boolean;
  childId?: string;
  mode?: EngineInput["mode"];
  /** 이 턴의 식별자. 014 유예 게이트가 한 턴을 두 번 세지 않도록 쓴다. */
  turnId?: string | null;
}

/**
 * 지금 진행 중인 놀이 세션이 하나라도 있는지(010).
 * 되묻기가 게임 답변을 가로채지 않도록 판단하는 데만 쓴다. 실패하면 false —
 * 판단이 안 되면 기존 동작(되묻기)을 유지하는 쪽이 안전하다.
 */
async function hasAnyActivePlaySession(db: SupabaseClient, childId: string): Promise<boolean> {
  for (const skill of PLAY_SKILL_REGISTRY) {
    try {
      if (await skill.getActiveSession(db, childId)) return true;
    } catch (error) {
      console.error("[k-conversation/index] 활성 놀이 세션 확인 실패:", error);
    }
  }
  return false;
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
  // 014 — 낱말 하나에 곧바로 안전 응답을 내지 않는다. 명백한 위험 표현은 여기서 유예되지 않는다.
  if (
    decideSafetyDeferral({
      sessionId,
      text: currentUtterance,
      subcategory: safety.safetySubcategory,
      turnId: options.turnId,
    }).defer
  ) {
    return null;
  }
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
  //
  // 014 — 단, 낱말 하나(초성게임 답 같은)에는 곧바로 발동하지 않는다.
  // 한 턴에서 preflight 와 여기가 각각 판정하지만, 같은 발화는 횟수를 한 번만 쓴다
  // (shortUtteranceSafetyGate 의 lastDeferredText).
  const safety = pickReaction(input.currentUtterance);
  const safetyDeferral = decideSafetyDeferral({
    sessionId: input.sessionId,
    text: input.currentUtterance,
    subcategory: safety.safetySubcategory,
    turnId: input.currentTurnId,
  });
  if ((safety.flaggedForParent || safety.category === "safety") && !safetyDeferral.defer) {
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
    // 010 — **놀이 중에는 되묻기가 가로채지 않는다.**
    //
    // 2026-08-19 15:12~15:22 김서아 Dev QA 실측: 케이 응답 47개 중 12개(26%)가
    // "내가 '○○'라고 들었는데, 이게 맞니?" 였다. 아이가 게임 답을 짧게 말할 때마다
    // ("소", "무료", "지민", "스마트폰") ASR 신뢰도가 낮아 이 경로가 먼저 잡아채
    // 정답 판정까지 가지도 못했다. 아이는 "왜 자꾸 못 알아듣냐"고 했다.
    //
    // 놀이 중이면 그 답이 맞는지는 게임이 판정할 수 있다 — 게임은 정답을 알고 있다.
    // 되묻기는 판정할 근거가 없는 일반 대화에서만 의미가 있다.
    // (014 리뷰에서 이 위험을 MEDIUM 으로 지적받았는데 내가 별건으로 미뤘다. 그게 틀렸다.)
    const playSessionActive =
      input.mode === "FREE_CHAT" && input.childId
        ? await hasAnyActivePlaySession(deps.db, input.childId)
        : false;

    if (!playSessionActive) {
    const recentKTexts = input.recentKTexts ?? [];
    // 014 — 들린 게 있으면 "못 들었어" 대신 들은 대로 되묻는다.
    // 케이가 "다시 말해줄래?"만 반복해 아이가 항의한 사고(2026-08-18)의 대응이다.
    // 아무것도 안 들렸을 때만 기존 템플릿으로 떨어진다.
    const recovery = buildUnclearAudioRecovery({
      childUtterance: input.currentUtterance,
      recentKTexts,
    });
    const reflective = generateReflectiveReaction(input.currentUtterance, recentKTexts, { isLowConfidenceAsr });
    return {
      text: recovery.text ?? reflective.text,
      action: "JUST_LISTEN",
      category: "deterministic",
      tokenIn: 0,
      tokenOut: 0,
    };
    }
    // 놀이 중이면 여기서 반환하지 않고 아래 놀이 처리로 내려간다.
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

  // 4-1) 성장정보 후보 수집 (요청서 013 §3-3, §3-6).
  //
  // 아이가 키·몸무게를 말했으면 후보로만 쌓는다. 공식 성장기록은 부모가 [반영]을 눌렀을
  // 때만 만들어진다(§5-1). Engine 은 아이에게 그 숫자를 평가해 주지 않고, 이 결과로
  // 응답을 바꾸지도 않는다(§3-13, §3-18) — 저장만 하고 지나간다.
  //
  // 실패해도 대화를 막지 않는다. 성장정보는 부모 기능이고 아이 대화보다 뒤다.
  try {
    const growthCandidates = extractGrowthCandidates({
      utterance: input.currentUtterance,
      previousKUtterance: input.recentKTexts?.[input.recentKTexts.length - 1]
        ?? memorySnapshot.sameSession.filter((turn) => turn.role === "k").at(-1)?.content
        ?? null,
    });
    if (growthCandidates.length > 0) {
      await recordGrowthCandidates({
        db: deps.db,
        childId: input.childId,
        candidates: growthCandidates,
        sourceType: input.mode === "MISSION"
          ? "child_utterance_mission"
          : "child_utterance_free_chat",
        sourceSessionId: input.sessionId,
        sourceMessageId: input.currentTurnId ?? null,
      });
    }
  } catch (error) {
    console.error("[k-conversation/index] 성장정보 후보 수집 실패:", error);
  }

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

  // 5-0) 놀이 꺼짐 상태에서 놀이 요청 시 결정론 안내 반환
  // hasGenericPlayAcceptance는 단독 수락("좋아", "응" 등)이므로 단독일 때는 제외하고
  // 나머지 4개 신호 중 하나라도 true일 때만 결정론 분기를 탄다.
  const hasDirectPlaySignal = Boolean(
    signals.hasChosungGameStart ||
    signals.hasWordChainGameStart ||
    signals.hasNonsenseGameStart ||
    signals.hasPlayRequestWithoutTarget
  );

  if (!isKPlayEnabled() && hasDirectPlaySignal) {
    if (input.sessionId) {
      try {
        await clearPendingPlayProposal(input.sessionId, deps.db);
      } catch (err) {
        console.error("[k-conversation/index] clearPendingPlayProposal error:", err);
      }
    }
    const recentKTexts = input.recentKTexts ?? [];
    const text = getPlayDisabledResponse(recentKTexts);
    return {
      text,
      action: "JUST_LISTEN",
      category: "deterministic",
      tokenIn: 0,
      tokenOut: 0,
    };
  }

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

  // 5-2) 놀이 세션 확인 및 턴 처리
  let hasActivePlaySession = false;
  let activePlaySkillId: PlaySkillId | undefined;
  let playSkillInstruction: string | undefined;
  let playSkillHandled = false;
  let handledPlaySkillId: PlaySkillId | undefined;
  let playSkillAnswerMustNotAppear: string | undefined;
  let playSkillRequiredWordInOutput: string | undefined;
  let playSkillRequiredChosungInOutput: string | undefined;

  if (input.mode === "MISSION") {
    // 미션 모드: 놀이 스킬 진행 완전 차단.
    // 이전 자유대화에서 닫히지 않고 남아있는 게임 세션이 있으면 조용히 종료한다.
    if (input.childId) {
      // allSettled 는 reject 하지 않는다. 결과를 안 보면 종료 실패가 조용히 묻히고,
      // 안 닫힌 세션이 다음 미션 턴에도 그대로 남는다 — 이번 사고의 원인이 정확히 그것이다.
      const cleanup = await Promise.allSettled(
        PLAY_SKILL_REGISTRY.map((skill) =>
          skill.end({
            db: deps.db,
            childId: input.childId!,
            chatSessionId: input.sessionId,
            reason: "mission_mode_cleanup",
          })
        )
      );
      cleanup.forEach((r, i) => {
        if (r.status === "rejected") {
          console.error("[k-conversation/index] 미션 진입 시 놀이 세션 종료 실패 — 다음 턴에도 남는다", {
            skillId: PLAY_SKILL_REGISTRY[i]?.id,
            childId: input.childId,
            sessionId: input.sessionId,
            reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
    }
    if (input.sessionId) {
      try {
        await clearPendingPlayProposal(input.sessionId, deps.db);
      } catch (err) {
        console.error("[k-conversation/index] clearPendingPlayProposal error:", err);
      }
    }
  } else {
    // 자유대화 모드: 놀이 활성화 여부에 따른 세션 확인 및 턴 처리
    if (!isKPlayEnabled()) {
      if (input.childId) {
        for (const skill of PLAY_SKILL_REGISTRY) {
          try {
            const session = await skill.getActiveSession(deps.db, input.childId);
            if (session) {
              await skill.end({
                db: deps.db,
                childId: input.childId,
                chatSessionId: input.sessionId,
                reason: "K_PLAY_DISABLED",
              });
            }
          } catch (err) {
            console.error("[k-conversation/index] disabled k-play session cleanup failed:", err);
          }
        }
      }
      if (input.sessionId) {
        try {
          await clearPendingPlayProposal(input.sessionId, deps.db);
        } catch (err) {
          console.error("[k-conversation/index] clearPendingPlayProposal error:", err);
        }
      }
      hasActivePlaySession = false;
    } else {
      // 자유대화 모드: 활성 놀이 세션 존재 여부 확인 (Registry 순회)
      if (input.childId) {
        for (const skill of PLAY_SKILL_REGISTRY) {
          try {
            const session = await skill.getActiveSession(deps.db, input.childId);
            if (session) {
              hasActivePlaySession = true;
              activePlaySkillId = skill.id;
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
            handledPlaySkillId = playTurnResult.skillId;
            if (playTurnResult.instruction) {
              playSkillInstruction = playTurnResult.instruction;
            }
            if (playTurnResult.answerMustNotAppear) {
              playSkillAnswerMustNotAppear = playTurnResult.answerMustNotAppear;
            }
            if (playTurnResult.requiredWordInOutput) {
              playSkillRequiredWordInOutput = playTurnResult.requiredWordInOutput;
            }
            if (playTurnResult.requiredChosungInOutput) {
              playSkillRequiredChosungInOutput = playTurnResult.requiredChosungInOutput;
            }
          }
        } catch (error) {
          console.error("[k-conversation/index] play turn failed:", error);
        }
      }
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

  // 미션 모드 액션 가드: 미션 중에는 어떠한 놀이 액션이나 제안 액션도 허용되지 않음
  if (input.mode === "MISSION") {
    if (
      action === "PLAY_PROPOSAL" ||
      action === "PLAYFUL_GAME_CHOSUNG" ||
      (action as string) === "PLAYFUL_GAME_WORD_CHAIN" ||
      (action as string) === "PLAYFUL_GAME_NONSENSE_QUIZ"
    ) {
      action = "FOLLOW_UP";
    }
  } else {
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
  }

  // Topic Shift 시 Pending Proposal 정리
  if (action === "TOPIC_SHIFT" && input.sessionId) {
    await clearPendingPlayProposal(input.sessionId, deps.db);
  }

  // 6-2) PLAY_PROPOSAL 제안 결정 — 게임이 처리되지 않은 턴 & 미션이 아닐 때만 제안 가능
  let playProposalInstruction: string | undefined;
  if (
    input.mode !== "MISSION" &&
    !playSkillHandled &&
    (action === "PLAY_PROPOSAL" || signals.hasPlayRequestWithoutTarget)
  ) {
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
  } else if (action === "PLAY_PROPOSAL") {
    action = "FOLLOW_UP";
  }

  // 013 §3-1, §3-2 — 아이가 먼저 키·몸무게 화제를 꺼냈고 최근 값이 없을 때만 문이 열린다.
  // 신호가 없으면 DB 조회조차 하지 않으므로 대부분의 턴은 여기서 바로 빠져나간다.
  let growthQuestionInstruction: string | undefined;
  try {
    const opportunity = await resolveGrowthQuestionOpportunity({
      db: deps.db,
      childId: input.childId,
      utterance: input.currentUtterance,
    });
    growthQuestionInstruction = opportunity.instruction;
  } catch (error) {
    console.error("[k-conversation/index] 성장 질문 판정 실패:", error);
  }

  const combinedAdapterInstruction = [
    playSkillInstruction,
    playProposalInstruction,
    growthQuestionInstruction,
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
    input.mode === "FREE_CHAT"
      ? isKPlayEnabled()
        ? buildPlayCatalogFragment()
        : `[놀이 안내]
- 아이가 놀이·게임을 하자고 하면 "놀이는 지금 준비 중이야" 라는 뜻으로 짧고
  다정하게 말하고 대화를 이어가.
- 매번 똑같은 문장을 반복하지 말고 자연스럽게 표현해.
- 다른 놀이를 대신 제안하지 마.
- 초성 문제·끝말잇기·넌센스 퀴즈를 네가 직접 만들어 내지 마.`
      : undefined;
  const generated = await generateResponse({
    ai: deps.ai,
    modelId: deps.modelId,
    fallbackModelId: deps.fallbackModelId,
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
      activePlaySkillName: activePlaySkillId
        ? PLAY_SKILL_REGISTRY.find((skill) => skill.id === activePlaySkillId)?.displayName
        : undefined,
      playSkillHandled,
      correlationId: input.currentTurnId ?? input.sessionId,
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

  // 9) 가짜 게임 출력 차단 (게임별 좁힘).
  // 활성 세션이 있거나 이번 턴에 Router가 처리한 게임 외의 다른 게임을 케이가 진행하면 차단한다.
  // (2026-08-17 사고 재발 방지: 초성 세션 활성 중 끝말잇기 환각 차단)
  let finalText = generated.text;

  // 8-1) 놀이 중 자연어 생성이 실패했을 때(010).
  //
  // 자유대화용 폴백 "응, 듣고 있어. 더 얘기해줄래?" 는 놀이 중에 나오면 아이가 방금 낸
  // 답을 무시하고 다시 말하라는 뜻이 된다. 2026-08-19 Dev QA 실측: 아이가 "이름표" 를
  // 냈는데 이 문구가 나갔다. 019 에서 미션에 적용한 원칙을 놀이에도 적용한다 —
  // 아이 차례가 이미 끝난 자리에서는 되묻지 않는다.
  //
  // 케이가 문제·정답·단어를 지어내면 안 되므로(가짜 게임 차단) 여기서는 게임 내용을
  // 만들지 않고, 잠깐 문제가 생겼다는 것만 알리고 이어가자고 한다.
  if (generated.fallbackUsed && hasActivePlaySession && input.mode !== "MISSION") {
    const playName =
      (activePlaySkillId
        ? PLAY_SKILL_REGISTRY.find((skill) => skill.id === activePlaySkillId)?.displayName
        : undefined) ?? "놀이";
    finalText = `앗, 잠깐 멈췄네. 미안! 우리 ${playName} 계속하자.`;
    console.warn("[k-conversation/index] 놀이 중 생성 실패 — 자유대화 폴백 대신 놀이 문구로 대체", {
      childId: input.childId,
      sessionId: input.sessionId,
      activePlaySkillId,
      failureType: generated.failureType ?? null,
    });
  }

  if (input.mode !== "MISSION") {
    const verdict = detectFakeGameplay(finalText);
    if (verdict.isFake) {
      const allowedKinds = new Set<FakeGameplayKind>();
      if (activePlaySkillId && PLAY_SKILL_TO_FAKE_GAMEPLAY_KINDS[activePlaySkillId]) {
        for (const kind of PLAY_SKILL_TO_FAKE_GAMEPLAY_KINDS[activePlaySkillId]) {
          allowedKinds.add(kind);
        }
      }
      if (handledPlaySkillId && PLAY_SKILL_TO_FAKE_GAMEPLAY_KINDS[handledPlaySkillId]) {
        for (const kind of PLAY_SKILL_TO_FAKE_GAMEPLAY_KINDS[handledPlaySkillId]) {
          allowedKinds.add(kind);
        }
      }

      const blockedKinds = verdict.kinds.filter((kind) => !allowedKinds.has(kind));
      if (blockedKinds.length > 0) {
        console.warn("[k-conversation/index] 활성 세션/처리 스킬 외 게임을 진행하는 응답을 차단했다", {
          childId: input.childId,
          sessionId: input.sessionId,
          activePlaySkillId,
          handledPlaySkillId,
          kinds: verdict.kinds,
          blockedKinds,
          blockedPreview: finalText.slice(0, 60),
        });
        finalText = pickFakeGameplayRecoveryText(input.recentKTexts ?? []);
      }
    }

    // 010 — 엔진이 이번 턴에 게임 내용을 내주지 않았는데 케이가 새 수를 두면 차단한다.
    //
    // 위 kind 검사는 "활성 세션이 있으면 그 게임 발화는 정상" 으로 본다. 그래야 아이가
    // "문제 뭐였지?" 물었을 때 현재 문제를 다시 말해 줄 수 있다. 그런데 그 관용 때문에
    // 세션이 살아 있는 동안 케이가 자기 단어와 이어갈 글자를 지어내도 통과했다
    // (2026-08-19 대표님 QA: 편의점을 낸 케이가 "'점퍼'였구나 ... 나는 '전화기' 할게").
    //
    // 그래서 "새 수" 만 따로 좁게 막는다. 판단 기준은 세션 유무가 아니라
    // **이번 턴에 엔진이 실제로 내줬는가(handledPlaySkillId)** 다.
    if (!handledPlaySkillId && hasUnauthorizedGameMove(finalText)) {
      console.warn("[k-conversation/index] 엔진이 내주지 않은 게임 수를 차단했다", {
        childId: input.childId,
        sessionId: input.sessionId,
        activePlaySkillId,
        handledPlaySkillId,
        blockedPreview: finalText.slice(0, 60),
      });
      finalText = pickFakeGameplayRecoveryText(input.recentKTexts ?? []);
    }
  }

  // 9-1) 초성게임 정답 유출 차단.
  // 힌트·오답 턴 등 정답을 발설하면 안 되는 턴에서 케이가 정답 낱말을 말하면
  // 정답을 뺀 안전한 대체 문구로 바꾸고 경고를 남긴다.
  let chosungAnswerLeaked = false;
  if (
    playSkillAnswerMustNotAppear &&
    detectChosungAnswerLeak(finalText, playSkillAnswerMustNotAppear)
  ) {
    chosungAnswerLeaked = true;
    console.warn("[k-conversation/index] 초성게임 정답 유출을 감지하여 안전한 대체 문구로 변경했다", {
      childId: input.childId,
      sessionId: input.sessionId,
      answer: playSkillAnswerMustNotAppear,
      blockedPreview: finalText.slice(0, 60),
    });
    finalText = "음, 힌트 하나 더 줄게! 초성을 잘 생각해서 맞춰봐.";
  }

  // 9-1b) 초성게임 필수 초성 누락/불일치 차단.
  // 스킬이 결정론적으로 고른 초성을 케이가 말하지 않고 임의로 지어내는 사고(2026-08-18)를 막는다.
  if (
    !chosungAnswerLeaked &&
    playSkillRequiredChosungInOutput &&
    detectChosungPuzzleMismatch(finalText, playSkillRequiredChosungInOutput)
  ) {
    console.warn("[k-conversation/index] 초성게임 필수 초성 누락/불일치를 감지하여 안전한 대체 문구로 변경했다", {
      childId: input.childId,
      sessionId: input.sessionId,
      requiredChosung: playSkillRequiredChosungInOutput,
      blockedPreview: finalText.slice(0, 60),
    });
    finalText = `자, 다시 낼게! 초성은 '${playSkillRequiredChosungInOutput}' 이야. 뭘까?`;
  }

  // 9-2) 끝말잇기 필수 낱말 누락 차단.
  // 케이가 낼 낱말을 스킬이 결정론적으로 골랐는데 케이가 그 낱말을 말하지 않으면
  // DB 상태와 아이가 들은 말이 어긋나 게임이 무너지므로, 케이가 낼 낱말이 포함된
  // 안전한 대체 문구로 바꾸고 경고를 남긴다.
  if (
    playSkillRequiredWordInOutput &&
    detectWordChainOutputViolation(finalText, playSkillRequiredWordInOutput)
  ) {
    const lastChar =
      lookupWord(playSkillRequiredWordInOutput)?.lastSyllable ??
      deriveWordChainEntry({ word: playSkillRequiredWordInOutput, difficulty: 1 }).lastSyllable;

    console.warn("[k-conversation/index] 끝말잇기 필수 낱말 누락을 감지하여 안전한 대체 문구로 변경했다", {
      childId: input.childId,
      sessionId: input.sessionId,
      requiredWord: playSkillRequiredWordInOutput,
      blockedPreview: finalText.slice(0, 60),
    });
    finalText = `좋아! 나는 '${playSkillRequiredWordInOutput}' 할게. 이제 '${lastChar}'로 시작하는 말 해줘!`;
  }

  // 10) 없는 기억에 맞장구치는 응답 차단.
  // 아이가 "내가 ~라고 했잖아"라고 단정했는데 그 내용이 기억에 없으면, 케이가
  // 동의하거나 그 낱말을 그대로 받아 말하는 것을 막는다.
  // 프롬프트 지침으로 두 번 시도했으나 두 번 다 뚫렸다(2026-08-17 Dev QA).
  // 기억 못 하는 건 아쉬운 정도지만, 안 한 얘기를 맞다고 하는 건 아이를 속이는 것이다.
  {
    // 아이 발화는 /api/chat/messages 로 **먼저 저장된 뒤** 응답 요청이 간다.
    // 그래서 sameSession 의 마지막 턴이 곧 지금 아이가 한 말이다. 이걸 기억으로
    // 세면 **아이가 방금 지어낸 말이 스스로를 근거로 만들어** 가드가 통째로
    // 무력화된다(2026-08-17 실측: "놀이공원 갔다고 했잖아" → grounded → 통과 →
    // 케이가 "아 맞다, 놀이공원 갔다고 했었지!").
    //
    // 현재 발화와 같은 텍스트만 뺀다. 아이가 정말 같은 말을 두 번 했더라도
    // 앞선 발화 역시 "지금 이 주장"의 근거가 될 수 없으므로 전부 제외한다.
    // "내가 아까 게임하자고 했잖아" 처럼 **다른 문장**으로 앞을 가리키는 경우는
    // 그대로 남아 정상 회상으로 통과한다.
    const currentUtteranceKey = normalizeSameSessionText(input.currentUtterance);
    const knownMemoryTexts = [
      ...memorySnapshot.longTermFacts.map((f) => f.content),
      ...(memorySnapshot.recentEpisode ? [memorySnapshot.recentEpisode.content] : []),
      ...memorySnapshot.sameSession
        .filter((t) => normalizeSameSessionText(t.content) !== currentUtteranceKey)
        .map((t) => t.content),
      ...memorySnapshot.sameDay
        .filter((t) => normalizeSameSessionText(t.content) !== currentUtteranceKey)
        .map((t) => t.content),
    ].filter((t): t is string => typeof t === "string" && t.length > 0);

    const recallVerdict = detectFabricatedRecall(
      input.currentUtterance,
      finalText,
      knownMemoryTexts,
    );
    if (recallVerdict.isFabricated) {
      console.warn("[k-conversation/index] 없는 기억에 맞장구치는 응답을 차단했다", {
        childId: input.childId,
        sessionId: input.sessionId,
        reason: recallVerdict.reason,
        childUtterance: input.currentUtterance.slice(0, 60),
        blockedPreview: finalText.slice(0, 60),
      });
      // 018 §3-10 — 같은 문구를 두 번 쓰지 않는다. 이미 한 번 되물었다면
      // 또 되묻지 않고 지금 들은 말에 이어붙인다.
      finalText = pickFabricatedRecallFallbackText(input.recentKTexts ?? []);
    }
  }

  // 11) 관계 안전 가드 (요청서 013 §3-10).
  // 독점·의존 유도, 부모·현실 친구 대체, 비밀 관계 유도, 사람 사칭을 케이 출력에서 막는다.
  // 미션·자유대화 모두 적용한다 — 페르소나는 두 모드에서 동일해야 한다(§3-9).
  // 프롬프트 지침(RELATIONSHIP_SAFETY_INSTRUCTION)과 이 출력 검사를 함께 둔다.
  {
    const candidateBeforeGuard = finalText;
    const relationshipVerdict = applyRelationshipSafety(finalText, input.recentKTexts ?? [], {
      mode: input.mode,
    });
    if (relationshipVerdict.blocked) {
      console.warn("[k-conversation/index] 관계 안전 위반 응답을 차단했다", {
        childId: input.childId,
        sessionId: input.sessionId,
        violationId: relationshipVerdict.violationId,
        blockedPreview: finalText.slice(0, 60),
      });
      finalText = relationshipVerdict.text;
    }

    // 11-1) 관계 안전 하이브리드 — Risk Gate + Shadow Judge (요청서 012).
    //
    // 정규식이 잡은 건 이미 위에서 막았다. 여기서 보는 것은 "정규식은 통과했지만 의미상
    // 위험할 수 있는 응답"이다. 대부분의 턴은 게이트에서 SAFE 로 끝나 추가 호출이 없다(§3-5).
    // Shadow 이므로 판정 결과로 아이 응답을 바꾸지 않는다(§3-6, §3-23) — Production 은 지금과 동일하다.
    try {
      const deterministicCategory = categoryForRule(relationshipVerdict.violationId);
      const healthBefore = getRelationshipHealth(input.sessionId);
      const gate = assessRelationshipRisk({
        text: candidateBeforeGuard,
        health: healthBefore,
        deterministicViolation: relationshipVerdict.blocked,
      });

      recordCandidate(gate.level, relationshipVerdict.blocked);
      recordRelationshipSignals(
        input.sessionId,
        relationshipVerdict.blocked && deterministicCategory
          ? [deterministicCategory]
          : gate.categories
      );

      let judgeLog: Parameters<typeof logShadowTurn>[0]["judge"];
      if (
        gate.level === "SUSPICIOUS" &&
        !relationshipVerdict.blocked &&
        isRelationshipJudgeShadowEnabled()
      ) {
        const judged = await judgeRelationshipRisk({
          ai: deps.ai,
          candidate: candidateBeforeGuard,
          childUtterance: input.currentUtterance,
          accumulatedCategories: accumulatedRiskCategories(healthBefore),
          gateMarkers: gate.signals.map((signal) => signal.marker),
        });
        recordJudge({
          safeToSend: judged.verdict?.safeToSend ?? null,
          category: judged.verdict?.riskCategory ?? null,
          latencyMs: judged.latencyMs,
          error: judged.error,
        });
        judgeLog = {
          safeToSend: judged.verdict?.safeToSend ?? null,
          category: judged.verdict?.riskCategory ?? null,
          severity: judged.verdict?.severity ?? null,
          confidence: judged.verdict?.confidence ?? null,
          latencyMs: judged.latencyMs,
          error: judged.error,
        };
      }

      logShadowTurn({
        sessionId: input.sessionId,
        mode: input.mode,
        level: gate.level,
        regexViolation: relationshipVerdict.blocked,
        markers: gate.signals.map((signal) => signal.marker),
        judge: judgeLog,
        candidateLength: candidateBeforeGuard.length,
      });
    } catch (error) {
      // 계측이 대화를 막지 않는다.
      console.error("[k-conversation/index] 관계 안전 Shadow 계측 실패:", error);
    }
  }

  return {
    text: finalText,
    action,
    category: "generated",
    boredom,
    memoryTiersUsed: memorySnapshot.tiersUsed,
    tokenIn: generated.tokenIn,
    tokenOut: generated.tokenOut,
    // 019 §3-2 — 폴백 여부를 Adapter 로 그대로 올린다. Engine 은 미션 상태를 모르므로
    // 여기서 문장을 바꾸지 않고 사실만 전달한다.
    generationFallback: generated.fallbackUsed,
    generationFailureType: generated.failureType,
  };
}
