import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoredomAssessment } from "../boredomDetection";
import type { GradePersona } from "../gradePersonas";
import { isTopicOnCooldownForK, recordTopicUsage } from "../semanticTopicHistory";
import type { UtteranceSignals } from "../utteranceSignals";
import { computeNextDifficulty } from "./adaptiveDifficulty";
import { isCorrectAnswer } from "./answerNormalize";
import {
  classifyActiveGameIntent,
  classifyOfferedResponse,
  isChosungStartRequest,
  isStandaloneChosung,
} from "./gameIntent";
import {
  createSession,
  endSession,
  getActiveSession,
  getRecentOutcomes,
  pickNextWord,
  recordRound,
  updateSession,
  type ChosungGameSession,
} from "./gameSession";
import { WORD_POOL } from "./wordPool";

const CHOSUNG_SEMANTIC_GROUP = "PLAYFUL_GAME_CHOSUNG";
const SESSION_TTL_MS = 30 * 60 * 1000;
const GAME_RESPONSE_RULES = [
  "실제 문장은 모두 자연스러운 한국어 반말로 새로 만들어.",
  "아이의 실력을 평가하거나 다른 사람과 비교하거나 창피를 주는 표현은 절대 쓰지 마.",
  "게임을 계속하라고 강요하지 마.",
].join(" ");

export interface ChosungTurnInput {
  childId: string;
  sessionId: string;
  currentUtterance: string;
}

export interface ChosungTurnContext {
  gradePersona: GradePersona;
  signals: UtteranceSignals;
  boredom: BoredomAssessment;
  generate: (args: {
    instruction: string;
    currentUtterance: string;
  }) => Promise<{ text: string; tokenIn: number; tokenOut: number }>;
}

export interface ChosungTurnResult {
  text: string;
  action: "PLAYFUL_GAME_CHOSUNG";
  tokenIn: number;
  tokenOut: number;
}

export interface ProactiveOfferInput {
  currentUtterance: string;
  signals: UtteranceSignals;
  boredom: BoredomAssessment;
}

export const isExpiredOrDifferentChatSession = (
  session: ChosungGameSession,
  chatSessionId: string,
  nowMs: number = Date.now(),
): boolean => session.chatSessionId !== chatSessionId
  || !Number.isFinite(new Date(session.updatedAt).getTime())
  || nowMs - new Date(session.updatedAt).getTime() >= SESSION_TTL_MS;

export const shouldProactivelyOfferChosung = ({
  currentUtterance,
  signals,
  boredom,
}: ProactiveOfferInput): boolean => {
  if (signals.hasConflict || signals.hasNegativeEmotion || signals.hasPhysicalNeed) return false;
  if (signals.hasGeneralKnowledgeQuestion || signals.hasMemoryRecallQuery) return false;

  const hasBoredomSignal = boredom.level === "rising"
    || boredom.level === "high"
    || currentUtterance.includes("심심")
    || signals.hasPlayfulSilly
    || (signals.isVeryShortLowEffort && boredom.signalCount >= 2);
  return hasBoredomSignal;
};

export const buildHintInstruction = (
  session: ChosungGameSession,
  hintLevel: number,
  hintStyle: string,
): string => {
  const word = session.currentWord ?? "";
  const clue = hintLevel === 1
    ? `카테고리는 '${session.currentCategory ?? "일상 단어"}'야.`
    : hintLevel === 2
      ? `정답 '${word}'의 뜻이나 쓰임을 직접 정답을 말하지 않고 설명해.`
      : `정답의 첫 글자는 '${word.at(0) ?? ""}'야. 필요하면 짧은 추가 단서도 하나 줘.`;
  return [
    `초성 '${session.currentChosung ?? ""}' 문제의 ${hintLevel}단계 힌트를 줘.`,
    clue,
    `학년별 힌트 스타일: ${hintStyle}`,
    "'틀렸어'라는 말을 반복하지 말고, 정답을 아직 공개하지 마.",
    GAME_RESPONSE_RULES,
  ].join(" ");
};

const generateGameResponse = async (
  ctx: ChosungTurnContext,
  input: ChosungTurnInput,
  instruction: string,
): Promise<ChosungTurnResult> => {
  const generated = await ctx.generate({ instruction, currentUtterance: input.currentUtterance });
  return {
    text: generated.text,
    action: "PLAYFUL_GAME_CHOSUNG",
    tokenIn: generated.tokenIn,
    tokenOut: generated.tokenOut,
  };
};

const requireSession = (
  session: ChosungGameSession | null,
  operation: string,
): ChosungGameSession => {
  if (!session) throw new Error(`${operation} returned no session`);
  return session;
};

const presentProblem = async (
  ctx: ChosungTurnContext,
  input: ChosungTurnInput,
  session: ChosungGameSession,
  leadInstruction: string,
): Promise<ChosungTurnResult> => generateGameResponse(ctx, input, [
  leadInstruction,
  `새 문제의 초성은 '${session.currentChosung ?? ""}', 카테고리는 '${session.currentCategory ?? "일상"}', 난이도는 ${session.currentDifficulty}야.`,
  "정답 단어는 말하지 말고 초성이 화면에 잘 보이도록 자연스럽게 문제를 내.",
  GAME_RESPONSE_RULES,
].join(" "));

const finishExhaustedSession = async (
  db: SupabaseClient,
  ctx: ChosungTurnContext,
  input: ChosungTurnInput,
  session: ChosungGameSession,
): Promise<ChosungTurnResult> => {
  requireSession(await endSession(db, session), "end exhausted session");
  return generateGameResponse(ctx, input, [
    "이번 초성게임에서 낼 수 있는 새 단어를 모두 사용했어. 게임을 자연스럽고 기분 좋게 마무리해.",
    "문제가 부족하다거나 시스템 오류라는 표현은 쓰지 말고, 게임을 더 계속하라고 권하지 마.",
    GAME_RESPONSE_RULES,
  ].join(" "));
};

const advanceDifficultyAndPickWord = async (
  db: SupabaseClient,
  ctx: ChosungTurnContext,
  session: ChosungGameSession,
): Promise<ChosungGameSession | null> => {
  const recentOutcomes = await getRecentOutcomes(db, session.childId, 5);
  const nextDifficulty = computeNextDifficulty({
    currentDifficulty: session.currentDifficulty,
    minDifficulty: ctx.gradePersona.chosungGame.minDifficulty,
    maxDifficulty: ctx.gradePersona.chosungGame.maxDifficulty,
    recentOutcomes,
  });
  const difficultyUpdated = requireSession(await updateSession(db, session, {
    state: "PLAYING_K_ASKS",
    currentDifficulty: nextDifficulty,
    hintLevel: 0,
  }), "difficulty update");
  return pickNextWord(db, session.childId, ctx.gradePersona, difficultyUpdated);
};

const handleChildAsked = async (
  db: SupabaseClient,
  input: ChosungTurnInput,
  ctx: ChosungTurnContext,
  session: ChosungGameSession,
): Promise<ChosungTurnResult> => {
  await recordRound(db, session, "child_asked", 0);
  requireSession(await endSession(db, session), "end child-asked session");
  return generateGameResponse(ctx, input, [
    `아이가 낸 초성은 '${session.currentChosung ?? input.currentUtterance.trim()}'이야.`,
    "친구처럼 답을 하나 추측해서 자연스럽게 말해. 항상 다 맞히는 완벽한 존재처럼 굴지 말고, 애매하면 힌트를 되물어봐도 돼.",
    GAME_RESPONSE_RULES,
  ].join(" "));
};

const handleNoActiveSession = async (
  db: SupabaseClient,
  input: ChosungTurnInput,
  ctx: ChosungTurnContext,
): Promise<ChosungTurnResult | null> => {
  if (isStandaloneChosung(input.currentUtterance)) {
    const session = requireSession(await createSession(db, {
      childId: input.childId,
      chatSessionId: input.sessionId,
      state: "PLAYING_CHILD_ASKS",
      initiatedBy: "CHILD",
      currentDifficulty: ctx.gradePersona.chosungGame.baseDifficulty,
      currentChosung: input.currentUtterance.trim(),
    }), "create child-asked session");
    return handleChildAsked(db, input, ctx, session);
  }

  if (isChosungStartRequest(input.currentUtterance)) {
    const offered = requireSession(await createSession(db, {
      childId: input.childId,
      chatSessionId: input.sessionId,
      state: "OFFERED",
      initiatedBy: "CHILD",
      currentDifficulty: ctx.gradePersona.chosungGame.baseDifficulty,
    }), "create child-started session");
    const playing = await pickNextWord(db, input.childId, ctx.gradePersona, offered);
    if (!playing) return finishExhaustedSession(db, ctx, input, offered);
    return presentProblem(ctx, input, playing, "아이의 초성게임 요청을 반갑게 받아들이고 K가 바로 첫 문제를 내.");
  }

  if (!shouldProactivelyOfferChosung({
    currentUtterance: input.currentUtterance,
    signals: ctx.signals,
    boredom: ctx.boredom,
  })) return null;

  if (await isTopicOnCooldownForK(db, input.childId, CHOSUNG_SEMANTIC_GROUP)) return null;

  requireSession(await createSession(db, {
    childId: input.childId,
    chatSessionId: input.sessionId,
    state: "OFFERED",
    initiatedBy: "K",
    currentDifficulty: ctx.gradePersona.chosungGame.baseDifficulty,
  }), "create K-offered session");
  await recordTopicUsage(db, input.childId, CHOSUNG_SEMANTIC_GROUP, "free_chat", "k");
  return generateGameResponse(ctx, input, [
    "아이가 지루해하거나 장난스럽게 놀고 싶어 하는 흐름이야. 초성게임을 같이 할지 자연스럽게 한 번만 제안해.",
    "아직 문제는 내지 말고 아이의 선택을 기다려.",
    GAME_RESPONSE_RULES,
  ].join(" "));
};

const handleOfferedSession = async (
  db: SupabaseClient,
  input: ChosungTurnInput,
  ctx: ChosungTurnContext,
  session: ChosungGameSession,
): Promise<ChosungTurnResult | null> => {
  if (classifyOfferedResponse(input.currentUtterance) !== "accept") {
    requireSession(await endSession(db, session), "end declined session");
    return null;
  }

  const playing = await pickNextWord(db, input.childId, ctx.gradePersona, session);
  if (!playing) return finishExhaustedSession(db, ctx, input, session);
  return presentProblem(ctx, input, playing, "아이가 제안을 받아들였어. 기쁘게 반응하고 첫 문제를 바로 내.");
};

const handleReveal = async (
  db: SupabaseClient,
  input: ChosungTurnInput,
  ctx: ChosungTurnContext,
  session: ChosungGameSession,
): Promise<ChosungTurnResult> => {
  const revealedWord = session.currentWord ?? "";
  await recordRound(db, session, "revealed", session.hintLevel);
  const nextSession = await advanceDifficultyAndPickWord(db, ctx, session);
  if (!nextSession) return finishExhaustedSession(db, ctx, input, session);
  return presentProblem(ctx, input, nextSession, [
    `방금 문제의 정답 '${revealedWord}'을 자연스럽고 부담 없이 알려줘.`,
    "포기하거나 몰랐던 것을 평가하지 말고 곧바로 다음 문제로 이어가.",
  ].join(" "));
};

const handleKAskedSession = async (
  db: SupabaseClient,
  input: ChosungTurnInput,
  ctx: ChosungTurnContext,
  session: ChosungGameSession,
): Promise<ChosungTurnResult | null> => {
  if (!session.currentWord) {
    requireSession(await endSession(db, session), "end invalid K-asked session");
    return null;
  }

  const intent = classifyActiveGameIntent(input.currentUtterance, ctx.signals);
  if (intent === "strong_non_game") {
    requireSession(await endSession(db, session), "end session for topic shift");
    return null;
  }

  if (intent === "stop") {
    await recordRound(db, session, "skip", session.hintLevel);
    requireSession(await endSession(db, session), "end stopped session");
    return generateGameResponse(ctx, input, [
      "아이가 초성게임을 그만하고 싶어 해. 아쉬움을 강요하지 말고 친구처럼 바로 수긍해.",
      "새 문제나 다른 게임을 곧바로 권하지 마.",
      GAME_RESPONSE_RULES,
    ].join(" "));
  }

  if (intent === "reveal") return handleReveal(db, input, ctx, session);

  if (intent === "hint") {
    const nextHintLevel = Math.min(4, session.hintLevel + 1);
    if (nextHintLevel >= 4) {
      const hintUpdated = requireSession(await updateSession(db, session, {
        state: "HINT",
        hintLevel: nextHintLevel,
      }), "update final hint");
      return handleReveal(db, input, ctx, hintUpdated);
    }
    const hintSession = requireSession(await updateSession(db, session, {
      state: "HINT",
      hintLevel: nextHintLevel,
    }), "update hint");
    return generateGameResponse(
      ctx,
      input,
      buildHintInstruction(hintSession, nextHintLevel, ctx.gradePersona.chosungGame.hintStyle),
    );
  }

  const wordEntry = WORD_POOL.find((entry) => entry.word === session.currentWord);
  if (isCorrectAnswer(input.currentUtterance, session.currentWord, wordEntry?.acceptedAnswers)) {
    const correctWord = session.currentWord;
    await recordRound(db, session, "correct", session.hintLevel);
    const nextSession = await advanceDifficultyAndPickWord(db, ctx, session);
    if (!nextSession) return finishExhaustedSession(db, ctx, input, session);
    return presentProblem(ctx, input, nextSession, [
      `아이가 방금 '${correctWord}'을 맞혔어. 친구처럼 자연스럽게 축하해.`,
      "연속 정답이어도 같은 칭찬 문구를 반복하지 말고 매번 다른 표현을 써.",
      "과장된 실력 평가나 다른 아이와의 비교 없이 바로 다음 문제로 이어가.",
    ].join(" "));
  }

  return generateGameResponse(ctx, input, [
    `아이가 초성 '${session.currentChosung ?? ""}' 문제에 답을 시도했지만 결정론 판정상 정답은 아니야.`,
    "정답을 공개하지 말고 아이가 다시 시도할 수 있게 짧고 자연스럽게 기다려.",
    "'틀렸어'를 반복하거나 실력을 평가하거나 비교하거나 창피를 주는 표현은 절대 쓰지 마.",
    GAME_RESPONSE_RULES,
  ].join(" "));
};

export const handleChosungTurn = async (
  db: SupabaseClient,
  input: ChosungTurnInput,
  ctx: ChosungTurnContext,
): Promise<ChosungTurnResult | null> => {
  try {
    let activeSession = await getActiveSession(db, input.childId);
    if (activeSession && isExpiredOrDifferentChatSession(activeSession, input.sessionId)) {
      requireSession(await endSession(db, activeSession), "end stale session");
      activeSession = null;
    }
    if (!activeSession) return await handleNoActiveSession(db, input, ctx);
    if (activeSession.state === "OFFERED") {
      return await handleOfferedSession(db, input, ctx, activeSession);
    }
    if (activeSession.state === "PLAYING_CHILD_ASKS") {
      return await handleChildAsked(db, input, ctx, activeSession);
    }
    if (
      activeSession.state === "PLAYING_K_ASKS"
      || activeSession.state === "WAITING_FOR_ANSWER"
      || activeSession.state === "HINT"
    ) {
      return await handleKAskedSession(db, input, ctx, activeSession);
    }

    requireSession(await endSession(db, activeSession), "end unsupported session state");
    return null;
  } catch (error) {
    console.error("[k-conversation/chosungGame/gameEngine] turn failed open", (error as Error).message);
    return null;
  }
};
