import type { SupabaseClient } from "@supabase/supabase-js";
import {
  startChosungGameSession,
  getActiveChosungGameSession,
  submitChosungAnswer,
  nextChosungRound,
  updateChosungHintLevel,
  type ChosungGameSessionRow,
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
    hasChosungAnswerRequest?: boolean;
    hasChosungNextQuestion?: boolean;
  };
}

export interface ChosungTurnResult {
  /** 이번 턴이 초성게임으로 처리됐는가. false면 엔진은 평소대로 진행한다. */
  handled: boolean;
  /** responseGenerator에 넘길 지시문. 정답·초성 등 결정론적 사실을 담는다. */
  instruction?: string;
  /** 이번 턴에서 응답에 나타나면 안 되는 정답 단어 (유출 방지 검증용) */
  answerMustNotAppear?: string;
  /**
   * 이번 턴 케이의 응답에 **반드시 들어 있어야 하는** 초성 문자열.
   * 케이가 문제를 낼 때 스킬이 결정론적으로 고른 초성을 모델이 말하지 않고
   * 지어내는 사고(2026-08-18)를 막기 위해 출력을 직접 검증한다.
   */
  requiredChosungInOutput?: string;
}

/**
 * 초성게임 부품과 K 대화 엔진을 연결하는 오케스트레이터.
 * 순수 조합만 수행하며, DB 오류 시 fail-open({ handled: false })하여 일반 대화 흐름을 보존합니다.
 */
/** 힌트 4단계 = 정답 공개(§19). 이 값에 도달하면 답을 알려주고 다음 문제로 넘어간다. */
export const CHOSUNG_REVEAL_HINT_LEVEL = 4;

/** 한 문제에서 이만큼 틀리면 정답을 알려주고 넘어간다. 계속 붙잡으면 아이가 지친다. */
export const CHOSUNG_MAX_WRONG_BEFORE_REVEAL = 3;

/**
 * 정답을 알려주고 다음 문제로 넘어간다.
 *
 * 맞히든 틀리든 아이는 결국 답을 알아야 한다 — 답을 끝까지 감추면 배우는 것도 없고
 * 답답하기만 하다. 라운드는 `revealed`로 기록해 난이도 조절이 이 사실을 반영한다.
 */
async function revealAndAdvance(input: {
  db: SupabaseClient;
  childId: string;
  gradeRaw?: string | number | null;
  session: ChosungGameSessionRow;
  lead: string;
}): Promise<ChosungTurnResult> {
  const { db, childId, gradeRaw, session, lead } = input;
  const answer = session.current_word ?? "";

  await submitChosungAnswer(db, {
    sessionId: session.id,
    childId,
    roundResult: "revealed",
    gradeRaw,
  });

  const nextSession = await nextChosungRound(db, { sessionId: session.id, childId, gradeRaw });
  const nextChosung = nextSession.current_chosung ?? "";

  return {
    handled: true,
    instruction: `[초성게임] ${lead}. 정답은 "${answer}"였어. 정답을 알려주고 아이가 민망하지 않게 격려한 뒤, 다음 문제 초성 "${nextChosung}"를 내줘. 새 문제의 정답은 말하지 마.\n- **문제만 내고 힌트는 주지 마.** 힌트는 아이가 물어보거나 틀렸을 때만 준다.`,
    requiredChosungInOutput: nextChosung || undefined,
  };
}

export async function runChosungTurn(
  input: ChosungTurnInput
): Promise<ChosungTurnResult> {
  const { db, childId, chatSessionId, gradeRaw, utterance, signals } = input;

  // 초성게임 관련 신호가 전혀 없거나 필수 식별자가 없으면 즉시 일반 대화 진행.
  // 새 신호를 추가할 때 이 목록에도 넣어야 한다 — 아래 분기만 만들면 여기서 먼저 빠져나간다
  // (2026-08-19 실측: hasChosungNextQuestion 분기를 만들었는데 이 목록에 없어 동작하지 않았다).
  if (
    !signals.hasChosungGameStart &&
    !signals.hasChosungAnswerAttempt &&
    !signals.hasChosungHintRequest &&
    !signals.hasChosungAnswerRequest &&
    !signals.hasChosungNextQuestion
  ) {
    return { handled: false };
  }

  if (!db || !childId || !chatSessionId) {
    return { handled: false };
  }

  try {
    const activeSession = await getActiveChosungGameSession(db, childId);

    // 0. 진행 중 세션이 있고 아이가 다음 문제를 달라고 한 경우(015 2차).
    //
    // 실측: "다음 문제 줘" 가 어떤 신호에도 안 걸려 케이가 같은 초성을 다시 제시하고
    // "다음 문제 계속 해보자"라고만 했다. 아이 입장에서는 요청이 무시된 것이다.
    // 정답을 알려주고 다음 라운드로 넘긴다 — 못 맞힌 문제를 그냥 덮으면 아이는 배우지 못한다.
    if (activeSession && signals.hasChosungNextQuestion) {
      return revealAndAdvance({
        db,
        childId,
        gradeRaw,
        session: activeSession,
        lead: "다음 문제로 넘어가자",
      });
    }

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
          instruction: `[초성게임] 아이가 정답 "${correctWord}"를 맞혔어. 칭찬하고 다음 문제 초성 "${nextChosung}"를 내줘. 정답 단어는 절대 말하지 마.\n- **문제만 내고 힌트는 주지 마.** 힌트는 아이가 물어보거나 틀렸을 때만 준다.`,
          requiredChosungInOutput: nextChosung || undefined,
        };
      } else {
        // 오답. 몇 번까지는 힌트로 붙잡아 주되, 계속 못 맞히면 정답을 알려주고
        // 다음 문제로 넘어간다(§19 힌트 4단계 = 정답 공개). 답을 끝까지 감추면
        // 아이는 답답하기만 하고 배우는 것도 없다.
        const wrongCount = (activeSession.hint_level ?? 0) + 1;
        await updateChosungHintLevel(db, {
          sessionId: activeSession.id,
          childId,
          hintLevel: wrongCount,
        });

        if (wrongCount >= CHOSUNG_MAX_WRONG_BEFORE_REVEAL) {
          return revealAndAdvance({
            db,
            childId,
            gradeRaw,
            session: activeSession,
            lead: "아이가 여러 번 시도했지만 못 맞혔어",
          });
        }

        const currentWord = activeSession.current_word ?? "";
        const currentChosung = activeSession.current_chosung ?? "";
        return {
          handled: true,
          instruction: `[초성게임] 아이 답은 틀렸어.\n[정답]: ${currentWord}\n- **[정답] 낱말을 절대 입 밖에 내지 마.** 아직 정답은 말하지 말고 격려하면서 힌트를 줘.\n- [정답]에 실제로 들어맞는 힌트만 줘. 다른 낱말을 지어내지 마.\n- **글자 수를 알려주지 마.** "3글자" 같은 말은 힌트가 아니다.\n- 초성은 "${currentChosung}"야. 이 초성에 맞는 낱말의 힌트만 줘.`,
          // 오답·힌트 턴은 **문제를 내는 턴이 아니다.** 여기서 초성 반복을 강제하면
          // 케이의 진짜 힌트("미술 시간에 쓰는 거야")가 "자, 다시 낼게! 초성은 …"
          // 대체 문구로 통째로 날아간다(2026-08-18 Dev QA 실측: 아이가 힌트를
          // 요청했는데 문제만 다시 읽어줬다). 이 턴의 방어는 정답 유출
          // (answerMustNotAppear) 로 충분하다.
          answerMustNotAppear: currentWord || undefined,
        };
      }
    }

    // 1-b. 진행 중 세션이 있고 답 공개 요청인 경우 ("답이 뭐야", "정답 알려줘" 등)
    if (activeSession && signals.hasChosungAnswerRequest) {
      return revealAndAdvance({
        db,
        childId,
        gradeRaw,
        session: activeSession,
        lead: "아이가 정답을 알려달라고 했어",
      });
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
      const nextHintLevel = updatedSession.hint_level ?? activeSession.hint_level + 1;

      // 힌트 4단계는 정답 공개다(§19). 계속 힌트만 주면 아이는 답을 영영 못 듣고
      // 답답하기만 하다. 알려주고 다음 문제로 넘어가는 것이 게임의 정상 흐름이다.
      if (nextHintLevel >= CHOSUNG_REVEAL_HINT_LEVEL) {
        return revealAndAdvance({
          db,
          childId,
          gradeRaw,
          session: activeSession,
          lead: "아이가 계속 어려워해",
        });
      }

      const currentWord =
        updatedSession.current_word ?? activeSession.current_word ?? "";
      return {
        handled: true,
        instruction: `[초성게임] 아이가 힌트를 요청했어.\n[정답]: ${currentWord}\n- **[정답] 낱말을 절대 입 밖에 내지 마.** 아이가 스스로 맞혀야 해.\n- [정답]에 실제로 들어맞는 힌트만 줘. 다른 낱말을 지어내지 마.\n- 초성은 "${currentChosung}"야. ${categoryHint}뜻이나 쓰임새로 힌트를 줘.\n- **글자 수를 알려주지 마.** "3글자" 같은 말은 힌트가 아니라 답을 좁혀 주는 것이다.\n- 초성에 실제로 맞는 낱말의 힌트만 줘. 초성과 안 맞는 다른 낱말을 설명하면 안 된다.`,
        // 오답·힌트 턴은 **문제를 내는 턴이 아니다.** 여기서 초성 반복을 강제하면
        // 케이의 진짜 힌트("미술 시간에 쓰는 거야")가 "자, 다시 낼게! 초성은 …"
        // 대체 문구로 통째로 날아간다(2026-08-18 Dev QA 실측: 아이가 힌트를
        // 요청했는데 문제만 다시 읽어줬다). 이 턴의 방어는 정답 유출
        // (answerMustNotAppear) 로 충분하다.
        answerMustNotAppear: currentWord || undefined,
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
          instruction: `[초성게임] 지금 낸 문제의 초성은 "${currentChosung}"야. 이 초성을 그대로 아이에게 문제로 내줘. 정답 단어는 절대 말하지 마.\n- **문제만 내고 힌트는 주지 마.** 힌트는 아이가 물어보거나 틀렸을 때만 준다.`,
          requiredChosungInOutput: currentChosung || undefined,
        };
      } else {
        // 이미 진행 중인 세션이 있는 경우 현재 문제 초성 제시
        const currentChosung = activeSession.current_chosung ?? "";
        return {
          handled: true,
          instruction: `[초성게임] 지금 낸 문제의 초성은 "${currentChosung}"야. 이 초성을 그대로 아이에게 문제로 내줘. 정답 단어는 절대 말하지 마.\n- **문제만 내고 힌트는 주지 마.** 힌트는 아이가 물어보거나 틀렸을 때만 준다.`,
          requiredChosungInOutput: currentChosung || undefined,
        };
      }
    }

    return { handled: false };
  } catch (error) {
    console.error("[gameOrchestrator] runChosungTurn error:", error);
    return { handled: false };
  }
}
