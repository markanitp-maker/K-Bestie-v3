import type { SupabaseClient } from "@supabase/supabase-js";
import {
  startChosungGameSession,
  getActiveChosungGameSession,
  submitChosungAnswer,
  nextChosungRound,
  updateChosungHintLevel,
} from "./gameSessionManager";

export interface ChosungTurnInput {
  db: SupabaseClient;
  childId: string;
  chatSessionId: string;
  gradeRaw?: string | number | null;
  utterance: string;
  signals: {
    hasChosungGameStart: boolean;
    hasChosungAnswerAttempt: boolean;
    hasChosungHintRequest: boolean;
  };
}

export interface ChosungTurnResult {
  /** 이번 턴이 초성게임으로 처리됐는가. false면 엔진은 평소대로 진행한다. */
  handled: boolean;
  /** responseGenerator에 넘길 지시문. 정답·초성 등 결정론적 사실을 담는다. */
  instruction?: string;
}

/**
 * 초성게임 부품과 K 대화 엔진을 연결하는 오케스트레이터.
 * 순수 조합만 수행하며, DB 오류 시 fail-open({ handled: false })하여 일반 대화 흐름을 보존합니다.
 */
export async function runChosungTurn(
  input: ChosungTurnInput
): Promise<ChosungTurnResult> {
  const { db, childId, chatSessionId, gradeRaw, utterance, signals } = input;

  // 초성게임 관련 신호가 전혀 없거나 필수 식별자가 없으면 즉시 일반 대화 진행
  if (
    !signals.hasChosungGameStart &&
    !signals.hasChosungAnswerAttempt &&
    !signals.hasChosungHintRequest
  ) {
    return { handled: false };
  }

  if (!db || !childId || !chatSessionId) {
    return { handled: false };
  }

  try {
    const activeSession = await getActiveChosungGameSession(db, childId);

    // 1. 진행 중 세션이 있고 정답 시도인 경우
    if (activeSession && signals.hasChosungAnswerAttempt) {
      const submitResult = await submitChosungAnswer(db, {
        sessionId: activeSession.id,
        childId,
        userAnswer: utterance,
        gradeRaw,
        hintUsed: activeSession.hint_level,
      });

      if (submitResult.isCorrect) {
        // 정답: 다음 라운드 단어/초성 확보 후 지시문 구성
        const nextSession = await nextChosungRound(db, {
          sessionId: activeSession.id,
          childId,
          gradeRaw,
        });

        const correctWord = activeSession.current_word ?? "";
        const nextChosung = nextSession.current_chosung ?? "";

        return {
          handled: true,
          instruction: `[초성게임] 아이가 정답 "${correctWord}"를 맞혔어. 칭찬하고 다음 문제 초성 "${nextChosung}"를 내줘. 정답 단어는 절대 말하지 마.`,
        };
      } else {
        // 오답: 정답 단어는 지시문에 절대 노출하지 않고 힌트 및 격려 유도
        const currentChosung = activeSession.current_chosung ?? "";
        return {
          handled: true,
          instruction: `[초성게임] 아이 답은 틀렸어. 정답을 말하지 말고 격려하면서 힌트를 줘. 초성은 "${currentChosung}"야.`,
        };
      }
    }

    // 2. 진행 중 세션이 있고 힌트 요청인 경우
    if (activeSession && signals.hasChosungHintRequest) {
      const updatedSession = await updateChosungHintLevel(db, {
        sessionId: activeSession.id,
        childId,
        hintLevel: activeSession.hint_level + 1,
      });

      const currentChosung =
        updatedSession.current_chosung ?? activeSession.current_chosung ?? "";
      const currentCategory =
        updatedSession.current_category ?? activeSession.current_category;
      const categoryHint = currentCategory
        ? `단어의 범주("${currentCategory}")나 `
        : "";

      return {
        handled: true,
        instruction: `[초성게임] 아이가 힌트를 요청했어. 정답 단어를 직접 말하지 말고 ${categoryHint}글자 수, 뜻에 대한 힌트를 줘. 초성은 "${currentChosung}"야.`,
      };
    }

    // 3. 게임 시작 신호
    if (signals.hasChosungGameStart) {
      if (!activeSession) {
        // 새 세션 시작
        const newSession = await startChosungGameSession(db, {
          childId,
          chatSessionId,
          gradeRaw,
          initiatedBy: "CHILD",
        });

        const currentChosung = newSession.current_chosung ?? "";
        return {
          handled: true,
          instruction: `[초성게임] 지금 낸 문제의 초성은 "${currentChosung}"야. 이 초성을 그대로 아이에게 문제로 내줘. 정답 단어는 절대 말하지 마.`,
        };
      } else {
        // 이미 진행 중인 세션이 있는 경우 현재 문제 초성 제시
        const currentChosung = activeSession.current_chosung ?? "";
        return {
          handled: true,
          instruction: `[초성게임] 지금 낸 문제의 초성은 "${currentChosung}"야. 이 초성을 그대로 아이에게 문제로 내줘. 정답 단어는 절대 말하지 마.`,
        };
      }
    }

    return { handled: false };
  } catch (error) {
    console.error("[gameOrchestrator] runChosungTurn error:", error);
    return { handled: false };
  }
}
