// K Conversation Engine — 단일 진입점 (071 전체 계약).
// Adapter(자유대화/미션)는 이 respond() 하나만 호출한다. Engine 내부 어떤 모듈도
// adapterContext의 존재/내용으로 분기하지 않는다 — Goal/Completion/parent_questions는
// Adapter가 스스로 처리하고, adapterInstruction(불투명 문자열)만 responseGenerator에
// 그대로 전달된다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationAction, EngineInput, EngineOutput } from "./types";
import { pickReaction } from "./safety";
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
    const { error } = await db.from("safety_events").insert({
      session_id: input.sessionId,
      subcategory,
      child_text: input.currentUtterance,
      child_id: input.childId || null,
      // Legacy and v3 mission RPCs already classify engine-originated safety
      // events as QUESTION_ENGINE; keep the shared engine on that taxonomy.
      source: "QUESTION_ENGINE",
    });
    if (error) {
      console.error("[k-conversation/index] safety_events insert failed", error.message);
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
  if (currentUtteranceAlreadyInSession === true && turns.length > 0) {
    const lastTurn = turns[turns.length - 1];
    if (
      lastTurn.role === "child" &&
      normalizeSameSessionText(lastTurn.content) === normalizeSameSessionText(currentUtterance)
    ) {
      turns = turns.slice(0, -1);
    }
  }
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
    const reflective = generateReflectiveReaction(input.currentUtterance, [], { isLowConfidenceAsr });
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
      : { givenName: null, peerPersona: { hasGrade: false, realGrade: null, gradeLabel: "학년 정보 확인 전", peerAge: null } };
  const gradePersona = resolveGradePersona(coreCtx.peerPersona.realGrade ?? coreCtx.peerPersona.gradeLabel);

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

  // 6) Action 선택 — 방향만 결정, 고정 문구 아님.
  const action = selectAction({
    signals,
    boredom,
    hasRecentEpisode: Boolean(memorySnapshot.recentEpisode),
    hasLongTermMemory: memorySnapshot.longTermFacts.length > 0,
    recentActions: deps.recentActions ?? [],
  });

  // 7) 응답 생성 — Gemini 자연생성, 30자/물음표 hard guard 없음.
  const recentHistory = filterRecentHistory(
    memorySnapshot.sameSession,
    input.currentUtterance,
    input.currentUtteranceAlreadyInSession,
  );
  const generated = await generateResponse({
    ai: deps.ai,
    modelId: deps.modelId,
    input: {
      mode: input.mode,
      action,
      corePersonaFragment,
      gradePersonaFragment,
      memoryFragment,
      currentUtterance: input.currentUtterance,
      recentHistory,
      adapterInstruction: deps.adapterInstruction,
      isGeneralKnowledgeQuestion: signals.hasGeneralKnowledgeQuestion,
    },
  });

  // 8) Semantic Topic History 기록. codex-rv 3차 지적 반영: "매 턴 K 응답도 무조건
  // initiatedBy='k'로 기록"하면 K가 그냥 아이 주제에 맞춰 대답한 것까지 "K가 먼저 꺼낸
  // 주제"로 오염되고, 같은 semantic_group 행에 child/k 기록이 동시에 경합해 last_initiated_by가
  // 완료 순서에 따라 흔들린다. TOPIC_SHIFT는 정의상 "K가 의도적으로 다른 주제로 넘어가는"
  // 유일한 Action이므로, K-initiated 기록은 이때만 남긴다 — 나머지 Action은 전부 아이가
  // 꺼낸 주제에 반응하는 것이므로 child 기록만으로 충분하고, 대부분 서로 다른
  // semantic_group을 가리켜 행 경합도 자연히 사라진다.
  const topicMode = input.mode === "MISSION" ? "mission" : "free_chat";
  await recordTopicUsage(deps.db, input.childId, semanticGroup, topicMode, "child");
  if (action === "TOPIC_SHIFT") {
    const kResponseSemanticGroup = estimateSemanticGroup(extractUtteranceSignals(generated.text));
    if (kResponseSemanticGroup !== semanticGroup) {
      await recordTopicUsage(deps.db, input.childId, kResponseSemanticGroup, topicMode, "k");
    }
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
