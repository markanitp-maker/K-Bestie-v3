import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlaySkillModule,
  PlaySkillStartInput,
  PlaySkillTurnInput,
  PlaySkillEndInput,
  PlaySkillTurnResult,
} from "../play/skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { resolveGradePersona } from "../gradePersonas";
import type {
  NonsenseGameSessionRow,
  NonsenseQuestionRow,
} from "./nonsenseQuizTypes";
import {
  fetchAndSelectNonsenseQuestion,
  NONSENSE_GRADE_DIFFICULTY,
} from "./questionSelector";
import {
  getActiveNonsenseSession,
  startNonsenseSession,
  advanceHintLevel,
  finishQuestionRound,
  endNonsenseSession,
} from "./sessionManager";
import {
  classifyChildNonsenseUtterance,
  validateNonsenseAnswer,
} from "./answerValidator";

/**
 * DB에서 questionId로 문제를 단건 조회합니다.
 */
async function fetchQuestionById(
  db: SupabaseClient,
  questionId: string
): Promise<NonsenseQuestionRow | null> {
  try {
    const { data, error } = await db
      .from("nonsense_questions")
      .select("*")
      .eq("id", questionId)
      .maybeSingle();

    if (error || !data) {
      console.error("[fetchQuestionById] error:", error);
      return null;
    }
    return data as NonsenseQuestionRow;
  } catch (err) {
    console.error("[fetchQuestionById] exception:", err);
    return null;
  }
}

/**
 * 힌트 단계에 맞는 프롬프트 지침을 생성합니다.
 * 정답(canonical_answer)은 절대로 포함하지 않으며, Gemini의 정답 추측/스스로 발설 방지 지침을 포함합니다 (§3-2, 결함 2 완화).
 */
function buildHintInstruction(
  question: NonsenseQuestionRow,
  level: 1 | 2,
  wrongAnswer?: string
): string {
  const hintText = level === 1 ? question.hint_1 : question.hint_2;
  const context = wrongAnswer
    ? `아이가 "${wrongAnswer.trim()}"라고 말했지만 정답이 아니야. 아래 [힌트 ${level}]을 건네주며 다시 생각해볼 수 있게 격려해줘.`
    : level === 1
    ? "아이가 힌트를 요청했어. 아래 [힌트 1]을 또래 친구처럼 다정하게 건네줘."
    : "아이가 두 번째 힌트를 요청했어. 아래 [힌트 2]를 친구처럼 다정하게 건네줘.";

  const encourageRule =
    level === 1
      ? "- '힌트 줄 테니 한번 더 생각해봐!'처럼 가볍게 응원해줘."
      : "- '이번엔 맞힐 수 있을 거야!'처럼 격려해줘.";

  return [
    `[넌센스 퀴즈 힌트 ${level}]`,
    context,
    `[문제]: ${question.question}`,
    `[힌트 ${level}]: ${hintText}`,
    "[진행 규칙]:",
    `- [힌트 ${level}] 내용만 건네주고, 정답은 절대 말하지 마.`,
    encourageRule,
    "- 너는 이 문제의 정답을 모르는 상태로 행동해라. 정답을 추측하거나 말하지 마.",
    "- 아이가 스스로 맞히게 두는 것이 이 놀이의 전부야.",
    "- 정답 공개는 시스템이 [정답]을 줄 때만 한다. [정답]이 없으면 절대 답을 말하지 마.",
  ].join("\n");
}

/**
 * 힌트 요청 또는 오답 시 결정론적으로 힌트 단계를 진행하거나 정답을 공개합니다.
 * 힌트가 없는 경우 건너뛰고 정답 공개로 이어지도록 무한 루프를 방지합니다 (§3-10).
 */
async function progressHintOrRevealAnswer(
  db: SupabaseClient,
  activeSession: NonsenseGameSessionRow,
  question: NonsenseQuestionRow,
  childId: string,
  wrongAnswer?: string
): Promise<PlaySkillTurnResult> {
  const currentHintLevel = activeSession.hint_level;

  // 1차 힌트 제공 가능 여부 확인
  if (currentHintLevel === 0 && question.hint_1) {
    await advanceHintLevel(db, activeSession.id, question.id, childId, 1);
    return {
      handled: true,
      instruction: buildHintInstruction(question, 1, wrongAnswer),
      ended: false,
    };
  }

  // 2차 힌트 제공 가능 여부 확인 (1차가 없어서 레벨 0인 경우에도 2차 힌트가 있으면 2차로 건너뜀)
  if (currentHintLevel < 2 && question.hint_2) {
    await advanceHintLevel(db, activeSession.id, question.id, childId, 2);
    return {
      handled: true,
      instruction: buildHintInstruction(question, 2, wrongAnswer),
      ended: false,
    };
  }

  // 힌트가 모두 소진되었거나 제공할 힌트가 없는 경우 -> 정답 공개 마무리 (세션은 유지하여 다음 문제 진행 가능)
  await finishQuestionRound(db, {
    sessionId: activeSession.id,
    childId,
    questionId: question.id,
    outcome: "ANSWERED_INCORRECT",
    hintCount: currentHintLevel,
    endSession: false,
  });

  const revealContext = wrongAnswer
    ? `아이가 "${wrongAnswer.trim()}"라고 답했지만 아쉽게도 틀렸어. 힌트를 다 썼으니 친구답게 유쾌하게 정답을 알려줘.`
    : "힌트를 다 썼는데도 어려워하고 있어! 친구답게 웃으며 정답과 설명을 유쾌하게 알려줘.";

  return {
    handled: true,
    instruction: [
      "[넌센스 퀴즈 정답 공개]",
      revealContext,
      `[문제]: ${question.question}`,
      `[정답]: ${question.canonical_answer}`,
      question.explanation ? `[설명]: ${question.explanation}` : "",
      "[진행 규칙]:",
      "- 위 [정답]과 [설명]을 친구 말투로 짧고 재미있게 알려주고, '어려웠지? 다음 문제 또 풀어볼래?'라고 격려해줘.",
      "- 아이를 평가하거나 놀리지 마.",
    ].filter(Boolean).join("\n"),
    ended: false,
  };
}

/**
 * 넌센스 퀴즈(NONSENSE_QUIZ) PlaySkill 어댑터 모듈.
 *
 * [Hard Guard (§3-2)]
 * - active session이 없으면 Gemini가 넌센스 문제를 임의로 생성하지 않습니다.
 * - question / hint_1 / hint_2 / explanation은 DB가 유일한 Source of Truth입니다.
 * - [중요] 정답(canonical_answer)은 공개(reveal) 단계 전까지 프롬프트/instruction에 절대로 포함하지 않습니다.
 * - [출제 즉시 이력] 문제를 제시하는 start() 시점에 nonsense_question_history에 PRESENTED를 즉시 기록합니다.
 */
export const NONSENSE_QUIZ_SKILL: PlaySkillModule = {
  id: "NONSENSE_QUIZ",
  displayName: "넌센스 퀴즈",
  childFacingDescription: "알쏭달쏭 재미있는 수수께끼를 맞히는 퀴즈 놀이",
  proposal: {
    label: "넌센스 퀴즈",
    shortDescription: "재미있고 엉뚱한 수수께끼를 맞히는 퀴즈 놀이",
  },

  matchesDirectRequest(signals: UtteranceSignals, utterance: string): boolean {
    return Boolean(signals?.hasNonsenseGameStart);
  },

  async getActiveSession(
    db: SupabaseClient,
    childId: string
  ): Promise<{ id: string; updatedAt?: string | null; startedAt?: string | null } | null> {
    if (!db || !childId) return null;
    try {
      const session = await getActiveNonsenseSession(db, childId);
      return session
        ? {
            id: session.id,
            updatedAt: session.updated_at,
            startedAt: session.started_at,
          }
        : null;
    } catch (err) {
      console.error("[nonsenseQuizSkill] getActiveSession error:", err);
      return null;
    }
  },

  async start(input: PlaySkillStartInput): Promise<PlaySkillTurnResult> {
    try {
      const { db, childId, chatSessionId, gradeRaw } = input;
      if (!db || !childId || !chatSessionId) {
        return { handled: false };
      }

      // 1. 이미 진행 중인 활성 세션이 있는지 확인 (§3-13)
      const existingSession = await getActiveNonsenseSession(db, childId);
      if (existingSession && existingSession.current_question_id) {
        const existingQuestion = await fetchQuestionById(db, existingSession.current_question_id);
        if (existingQuestion) {
          return {
            handled: true,
            instruction: [
              "[넌센스 퀴즈 진행 지침]",
              `이미 진행 중인 퀴즈가 있어! 아이에게 문제를 다시 한번 상기시켜줘.`,
              `[문제]: ${existingQuestion.question}`,
              "[진행 규칙]:",
              "- 위 [문제] 원문을 그대로 말해줘. 다른 문제를 지어내지 마.",
              "- 절대 정답을 먼저 말하지 마.",
              "- 너는 이 문제의 정답을 모르는 상태로 행동해라. 정답을 추측하거나 말하지 마.",
              "- 아이가 스스로 맞히게 두는 것이 이 놀이의 전부야.",
              "- 정답 공개는 시스템이 [정답]을 줄 때만 한다. [정답]이 없으면 절대 답을 말하지 마.",
            ].join("\n"),
            ended: false,
          };
        }
      }

      // 2. 학년 파악 및 DB에서 180일 쿨다운/신규 우선 문제 선택 (§3-4, §3-6, §3-7)
      const persona = resolveGradePersona(gradeRaw);
      const childGrade = persona?.grade ?? 3;
      const diffRange = NONSENSE_GRADE_DIFFICULTY[childGrade] ?? { min: 2, max: 4 };

      const selectedQuestion = await fetchAndSelectNonsenseQuestion(
        db,
        childId,
        childGrade,
        {
          currentDifficulty: diffRange.min,
          seed: chatSessionId,
        }
      );

      // 3. 후보 0건 처리 (§3-7) — 임의 문제 생성 금지, 자연스러운 안내 후 자유대화 복귀
      if (!selectedQuestion) {
        return {
          handled: true,
          instruction: [
            "[넌센스 퀴즈 안내]",
            "지금 당장 아이 학년에 맞게 낼 수 있는 새로운 넌센스 퀴즈 문제가 다 떨어졌어.",
            "아이에게 '와, 네가 문제를 정말 많이 풀어서 지금 낼 수 있는 새로운 수수께끼가 다 떨어졌어! 다음에 또 재미있는 문제 준비해올게. 다른 이야기나 다른 놀이 할까?'라고 친구답게 다정하게 안내해줘.",
            "절대로 문제를 임의로 만들어내지 마.",
          ].join("\n"),
          ended: true,
        };
      }

      // 4. 신규 세션 생성 및 PRESENTED 출제 이력 원자적 기록 (§3-5)
      await startNonsenseSession(db, {
        childId,
        chatSessionId,
        question: selectedQuestion,
        initialDifficulty: selectedQuestion.difficulty,
        initiatedBy: "K",
      });

      // 5. 프롬프트 지침 생성 (정답 canonical_answer는 절대 포함하지 않음!)
      const instruction = [
        "[넌센스 퀴즈 진행 지침]",
        "케이가 넌센스 퀴즈 문제를 낼 차례야! 아래의 [문제] 텍스트를 절대로 바꾸지 말고 그대로 아이에게 내줘.",
        `[문제]: ${selectedQuestion.question}`,
        "[진행 규칙]:",
        "- 위 [문제]에 적힌 문제를 정확히 그대로 말해줘. 다른 문제를 지어내거나 내용을 바꾸지 마.",
        "- 절대 정답이나 힌트를 먼저 말하지 마.",
        "- 너는 이 문제의 정답을 모르는 상태로 행동해라. 정답을 추측하거나 말하지 마.",
        "- 아이가 스스로 맞히게 두는 것이 이 놀이의 전부야.",
        "- 정답 공개는 시스템이 [정답]을 줄 때만 한다. [정답]이 없으면 절대 답을 말하지 마.",
        "- 또래 친구처럼 신나고 재미있게 문제를 내줘.",
      ].join("\n");

      return {
        handled: true,
        instruction,
        ended: false,
      };
    } catch (err) {
      console.error("[nonsenseQuizSkill] start error:", err);
      return { handled: false };
    }
  },

  async handleTurn(input: PlaySkillTurnInput): Promise<PlaySkillTurnResult> {
    try {
      const { db, childId, utterance, signals } = input;
      if (!db || !childId) {
        return { handled: false };
      }

      // 1. 활성 세션 조회 (Hard Guard: 없으면 handled: false)
      const activeSession = await getActiveNonsenseSession(db, childId);
      if (!activeSession || !activeSession.current_question_id) {
        return { handled: false };
      }

      // 2. 현재 문제 로드
      const question = await fetchQuestionById(db, activeSession.current_question_id);
      if (!question) {
        await endNonsenseSession(db, activeSession.id, childId, "QUESTION_NOT_FOUND");
        return { handled: false };
      }

      // 3. 발화 의도 분류 (§3-9, §3-15)
      const intent = classifyChildNonsenseUtterance(utterance, signals);

      // 3-A. 명시적 중단 ("그만", "안 할래")
      if (intent === "STOP") {
        await finishQuestionRound(db, {
          sessionId: activeSession.id,
          childId,
          questionId: question.id,
          outcome: "SKIPPED",
          hintCount: activeSession.hint_level,
          endSession: true,
        });

        return {
          handled: true,
          instruction: [
            "[넌센스 퀴즈]",
            "아이가 퀴즈를 그만하자고 했어. 아쉬워하지 말고 즐겁게 잘 놀았다고 다정하게 격려하며 일반 대화로 돌아가.",
          ].join("\n"),
          ended: true,
        };
      }

      // 3-B. Topic Shift / 감정 / 안전 이슈 ("오늘 친구랑 싸웠어", "속상해") (§3-15)
      if (intent === "TOPIC_SHIFT") {
        // 오답 처리하지 않고 세션을 종료하여 일반 대화로 안전하게 인계
        await endNonsenseSession(db, activeSession.id, childId, "TOPIC_SHIFT");
        return { handled: false };
      }

      // 3-C. 직전 라운드가 완료(ROUND_RESULT)된 상태이거나, 아이가 다음 문제를 요청한 경우 새 문제 이어서 출제
      if (activeSession.state === "ROUND_RESULT" || intent === "NEXT_QUESTION") {
        const persona = resolveGradePersona(input.gradeRaw);
        const childGrade = persona?.grade ?? 3;
        const diffRange = NONSENSE_GRADE_DIFFICULTY[childGrade] ?? { min: 2, max: 4 };
        const recentIds = Array.isArray(activeSession.recent_question_ids)
          ? activeSession.recent_question_ids
          : [];

        const nextQuestion = await fetchAndSelectNonsenseQuestion(
          db,
          childId,
          childGrade,
          {
            currentDifficulty: activeSession.current_difficulty || diffRange.min,
            // 방금 낸 문제는 제시 시점에 PRESENTED 로 기록되므로 180일 이력 필터가
            // 이미 걸러낸다. 별도 제외 목록을 넘길 필요가 없다.
            seed: activeSession.chat_session_id,
          }
        );

        if (!nextQuestion) {
          await endNonsenseSession(db, activeSession.id, childId, "NO_MORE_QUESTIONS");
          return {
            handled: true,
            instruction: [
              "[넌센스 퀴즈 안내]",
              "준비된 수수께끼를 다 풀어서 더 이상 낼 새로운 문제가 없어! 아이에게 문제를 정말 많이 맞혔다고 칭찬해주고 다른 이야기를 하자고 다정하게 안내해줘.",
              "절대로 문제를 임의로 만들어내지 마.",
            ].join("\n"),
            ended: true,
          };
        }

        const nowStr = new Date().toISOString();
        const updatedRecentIds = [...recentIds, nextQuestion.id];

        await db
          .from("nonsense_game_sessions")
          .update({
            current_question_id: nextQuestion.id,
            current_difficulty: nextQuestion.difficulty,
            hint_level: 0,
            state: "WAITING_FOR_ANSWER",
            recent_question_ids: updatedRecentIds,
            updated_at: nowStr,
          })
          .eq("id", activeSession.id)
          .eq("child_id", childId);

        await db.from("nonsense_question_history").insert({
          child_id: childId,
          question_id: nextQuestion.id,
          chat_session_id: activeSession.chat_session_id,
          game_session_id: activeSession.id,
          outcome: "PRESENTED",
          presented_at: nowStr,
          hint_count: 0,
          created_at: nowStr,
          updated_at: nowStr,
        });

        return {
          handled: true,
          instruction: [
            "[넌센스 퀴즈 진행 지침]",
            "케이가 다음 넌센스 퀴즈 문제를 낼 차례야! 아래의 [문제] 텍스트를 절대로 바꾸지 말고 그대로 아이에게 내줘.",
            `[문제]: ${nextQuestion.question}`,
            "[진행 규칙]:",
            "- 위 [문제]에 적힌 문제를 정확히 그대로 말해줘. 다른 문제를 지어내거나 내용을 바꾸지 마.",
            "- 절대 정답이나 힌트를 먼저 말하지 마.",
            "- 너는 이 문제의 정답을 모르는 상태로 행동해라. 정답을 추측하거나 말하지 마.",
            "- 아이가 스스로 맞히게 두는 것이 이 놀이의 전부야.",
            "- 정답 공개는 시스템이 [정답]을 줄 때만 한다. [정답]이 없으면 절대 답을 말하지 마.",
            "- 또래 친구처럼 신나고 재미있게 문제를 내줘.",
          ].join("\n"),
          ended: false,
        };
      }

      // 3-D. 정답 바로 공개 요청 / 포기 ("정답 알려줘", "답 뭐야", "포기") (§3-10)
      if (intent === "REVEAL_ANSWER") {
        await finishQuestionRound(db, {
          sessionId: activeSession.id,
          childId,
          questionId: question.id,
          outcome: "ANSWERED_INCORRECT",
          hintCount: activeSession.hint_level,
          endSession: false,
        });

        // 공개 단계에서만 정답과 설명 포함!
        return {
          handled: true,
          instruction: [
            "[넌센스 퀴즈 정답 공개]",
            "아이가 정답을 알려달라고 했어! 또래 친구처럼 유쾌하고 재미있게 정답과 설명을 알려줘.",
            `[문제]: ${question.question}`,
            `[정답]: ${question.canonical_answer}`,
            question.explanation ? `[설명]: ${question.explanation}` : "",
            "[진행 규칙]:",
            "- 위 [정답]과 [설명]의 내용을 벗어나지 않고 친구 말투로 짧고 재미있게 알려줘.",
            "- 아이를 놀리거나 평가하지 말고, '재밌지? 다음 문제 또 풀어볼래?'처럼 신나게 이어가.",
          ].filter(Boolean).join("\n"),
          ended: false,
        };
      }

      // 3-E. 힌트 요청 ("힌트 줘", "모르겠어") (§3-10)
      if (intent === "REQUEST_HINT") {
        return await progressHintOrRevealAnswer(
          db,
          activeSession,
          question,
          childId
        );
      }

      // 3-F. 정답 시도 (ANSWER_ATTEMPT) (§3-9)
      const validation = validateNonsenseAnswer(utterance, question);

      if (validation.isCorrect) {
        // 정답 맞힘 -> outcome: ANSWERED_CORRECT, 세션은 유지하여 다음 문제 진행 가능
        await finishQuestionRound(db, {
          sessionId: activeSession.id,
          childId,
          questionId: question.id,
          outcome: "ANSWERED_CORRECT",
          hintCount: activeSession.hint_level,
          endSession: false,
        });

        return {
          handled: true,
          instruction: [
            "[넌센스 퀴즈 정답 맞힘]",
            `와! 아이가 정답("${question.canonical_answer}")을 멋지게 맞혔어!`,
            question.explanation ? `[설명]: ${question.explanation}` : "",
            "[진행 규칙]:",
            "- 친구로서 신나고 유쾌하게 칭찬해줘. 교사처럼 '정답입니다'라고 딱딱하게 말하지 마.",
            "- [설명]이 있으면 가볍게 덧붙여줘.",
            "- '대단해! 다음 문제 또 풀어볼래, 아니면 다른 이야기 할래?'라고 자연스럽게 이어가.",
          ].filter(Boolean).join("\n"),
          ended: false,
        };
      } else {
        // 오답 -> 결정론적으로 힌트 단계 진행 (1차 -> 2차 -> 소진 시 정답 공개)
        return await progressHintOrRevealAnswer(
          db,
          activeSession,
          question,
          childId,
          utterance
        );
      }
    } catch (err) {
      console.error("[nonsenseQuizSkill] handleTurn error:", err);
      return { handled: false };
    }
  },

  async end(input: PlaySkillEndInput): Promise<void> {
    try {
      if (!input.db || !input.childId) return;
      const active = await getActiveNonsenseSession(input.db, input.childId);
      if (active) {
        await endNonsenseSession(input.db, active.id, input.childId, input.reason);
      }
    } catch (err) {
      console.error("[nonsenseQuizSkill] end error:", err);
    }
  },
};
