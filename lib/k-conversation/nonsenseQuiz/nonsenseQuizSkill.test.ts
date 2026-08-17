import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NONSENSE_QUIZ_SKILL,
} from "./nonsenseQuizSkill";
import type {
  NonsenseGameSessionRow,
  NonsenseQuestionHistoryRow,
  NonsenseQuestionRow,
} from "./nonsenseQuizTypes";
import type { UtteranceSignals } from "../utteranceSignals";

const defaultSignals: UtteranceSignals = {
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
  hasPlayRequestWithoutTarget: false,
  hasPlayRejection: false,
};

const mockQuestion: NonsenseQuestionRow = {
  id: "NQ0001",
  concept_key: "nq-0001-풋사과",
  question: "사과가 웃으면?",
  canonical_answer: "풋사과",
  accepted_answers: ["풋사과", "풋 사과"],
  hint_1: "정답은 3글자예요.",
  hint_2: "‘풋’으로 시작해요.",
  explanation: "웃음을 풋 터뜨리는 사과입니다.",
  category: "FOOD",
  pun_type: "WORD_COMBINATION",
  difficulty: 1,
  min_grade: 1,
  max_grade: 4,
  status: "ACTIVE",
  child_safe: true,
};

function createMockDb(initialQuestions: NonsenseQuestionRow[] = [mockQuestion]): {
  db: SupabaseClient;
  questions: NonsenseQuestionRow[];
  sessions: NonsenseGameSessionRow[];
  histories: NonsenseQuestionHistoryRow[];
} {
  const questions = [...initialQuestions];
  const sessions: NonsenseGameSessionRow[] = [];
  const histories: NonsenseQuestionHistoryRow[] = [];

  const db = {
    from: (table: string) => {
      if (table === "nonsense_questions") {
        return {
          select: () => {
            const builder = {
              eq: (col: string, val: any) => {
                if (col === "id") {
                  return {
                    maybeSingle: async () => ({
                      data: questions.find((q) => q.id === val) || null,
                      error: null,
                    }),
                  };
                }
                return builder;
              },
              lte: () => builder,
              gte: () => builder,
              then: (resolve: any) => resolve({ data: questions, error: null }),
            };
            return builder;
          },
        };
      }
      if (table === "nonsense_game_sessions") {
        return {
          select: () => ({
            eq: (col: string, val: any) => ({
              is: (col2: string, val2: any) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const found = sessions.find(
                        (s) => s.child_id === val && (val2 === null ? s.ended_at === null : true)
                      );
                      return { data: found || null, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
          insert: (data: any) => ({
            select: () => ({
              single: async () => {
                const row = { id: `session-${sessions.length + 1}`, ...data };
                sessions.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (updates: any) => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => {
                for (const s of sessions) {
                  if (s[col as keyof NonsenseGameSessionRow] === val && s[col2 as keyof NonsenseGameSessionRow] === val2) {
                    Object.assign(s, updates);
                  }
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
        };
      }
      if (table === "nonsense_question_history") {
        return {
          select: () => ({
            eq: (col: string, val: any) =>
              Promise.resolve({ data: histories.filter((h) => h.child_id === val), error: null }),
          }),
          insert: (data: any) => {
            const row = { id: `history-${histories.length + 1}`, ...data };
            histories.push(row);
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
              then: (resolve: any) => resolve({ data: [row], error: null }),
            };
          },
          update: (updates: any) => ({
            eq: (col: string, val: any) => ({
              eq: (col2: string, val2: any) => ({
                eq: (col3: string, val3: any) => {
                  for (const h of histories) {
                    if (
                      (h as any)[col] === val &&
                      (h as any)[col2] === val2 &&
                      (h as any)[col3] === val3
                    ) {
                      Object.assign(h, updates);
                    }
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            }),
          }),
        };
      }
      return {};
    },
  } as unknown as SupabaseClient;

  return { db, questions, sessions, histories };
}

test("NonsenseQuizSkill: matchesDirectRequest는 signals.hasNonsenseGameStart만 신뢰한다 (가드 우회 방지)", () => {
  const falseSignals: UtteranceSignals = {
    ...defaultSignals,
    hasNonsenseGameStart: false,
  };
  // signals.hasNonsenseGameStart === false 이면 인용 발화나 시작 키워드가 있어도 false
  assert.equal(
    NONSENSE_QUIZ_SKILL.matchesDirectRequest(falseSignals, "친구가 수수께끼 하자고 했어"),
    false,
    "hasNonsenseGameStart가 false면 '친구가 수수께끼 하자고 했어'로 false를 반환해야 함"
  );
  assert.equal(
    NONSENSE_QUIZ_SKILL.matchesDirectRequest(falseSignals, "수수께끼 하자"),
    false,
    "hasNonsenseGameStart가 false면 '수수께끼 하자'로도 false를 반환해야 함"
  );

  const trueSignals: UtteranceSignals = {
    ...defaultSignals,
    hasNonsenseGameStart: true,
  };
  assert.equal(
    NONSENSE_QUIZ_SKILL.matchesDirectRequest(trueSignals, "수수께끼 하자"),
    true
  );
});

test("NonsenseQuizSkill: start() 실행 시 PRESENTED 이력이 기록되고 정답은 instruction에 절대 포함되지 않는다 (Hard Guard)", async () => {
  const { db, sessions, histories } = createMockDb([mockQuestion]);

  const result = await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  assert.equal(result.handled, true);
  assert.equal(result.ended, false);
  assert.ok(result.instruction);

  // 문제 본문 포함 확인
  assert.ok(result.instruction.includes(mockQuestion.question));

  // [Hard Guard]: 정답 canonical_answer는 프롬프트에 절대 누출되지 않음
  assert.equal(result.instruction.includes(mockQuestion.canonical_answer), false);
  assert.equal(result.instruction.includes("웃음을 풋"), false); // explanation도 누출 안 됨

  // DB 상태 검증
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].state, "WAITING_FOR_ANSWER");
  assert.equal(sessions[0].current_question_id, "NQ0001");

  assert.equal(histories.length, 1);
  assert.equal(histories[0].outcome, "PRESENTED");
  assert.equal(histories[0].question_id, "NQ0001");
});

test("NonsenseQuizSkill: 후보 문제 0건일 때 임의 생성 없이 자연스럽게 종료", async () => {
  const { db } = createMockDb([]); // 후보 0건

  const result = await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  assert.equal(result.handled, true);
  assert.equal(result.ended, true);
  assert.ok(result.instruction?.includes("새로운 넌센스 퀴즈 문제가 다 떨어졌어"));
  assert.ok(result.instruction?.includes("절대로 문제를 임의로 만들어내지 마"));
});

test("NonsenseQuizSkill: handleTurn 정답 시 정답/설명 포함 및 세션 유지(다음 문제 출제 준비)", async () => {
  const { db } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "풋사과야!",
    signals: defaultSignals,
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, false);
  assert.ok(turnResult.instruction?.includes("정답 맞힘"));
  assert.ok(turnResult.instruction?.includes(mockQuestion.canonical_answer));
  assert.ok(turnResult.instruction?.includes(mockQuestion.explanation!));
});

test("NonsenseQuizSkill: handleTurn 오답 시 힌트 제공 및 정답 미누출 (Hard Guard)", async () => {
  const { db, sessions } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "바나나",
    signals: defaultSignals,
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, false);
  assert.ok(turnResult.instruction?.includes(mockQuestion.hint_1!));
  assert.equal(sessions[0].hint_level, 1);
  assert.equal(turnResult.instruction?.includes(mockQuestion.canonical_answer), false);
});

test("NonsenseQuizSkill [결함 1/2]: hint_level=0에서 오답 시 advanceHintLevel(1) 호출, hint_1 원문 포함, canonical_answer 미포함, 금지 지침 포함", async () => {
  const { db, sessions } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  assert.equal(sessions[0].hint_level, 0);

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답1",
    signals: defaultSignals,
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, false);
  assert.equal(sessions[0].hint_level, 1);
  assert.ok(turnResult.instruction?.includes(`[힌트 1]: ${mockQuestion.hint_1}`));
  assert.equal(turnResult.instruction?.includes(mockQuestion.canonical_answer), false);
  assert.ok(turnResult.instruction?.includes("너는 이 문제의 정답을 모르는 상태로 행동해라"));
  assert.ok(turnResult.instruction?.includes("아이가 스스로 맞히게 두는 것이 이 놀이의 전부야"));
  assert.ok(turnResult.instruction?.includes("정답 공개는 시스템이 [정답]을 줄 때만 한다"));
});

test("NonsenseQuizSkill [결함 1/2]: hint_level=1에서 오답 시 advanceHintLevel(2) 호출, hint_2 원문 포함, canonical_answer 미포함", async () => {
  const { db, sessions } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  // 1차 오답으로 hint_level=1 도달
  await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답1",
    signals: defaultSignals,
  });
  assert.equal(sessions[0].hint_level, 1);

  // 2차 오답
  const turnResult2 = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답2",
    signals: defaultSignals,
  });

  assert.equal(turnResult2.handled, true);
  assert.equal(turnResult2.ended, false);
  assert.equal(sessions[0].hint_level, 2);
  assert.ok(turnResult2.instruction?.includes(`[힌트 2]: ${mockQuestion.hint_2}`));
  assert.equal(turnResult2.instruction?.includes(mockQuestion.canonical_answer), false);
  assert.ok(turnResult2.instruction?.includes("너는 이 문제의 정답을 모르는 상태로 행동해라"));
});

test("NonsenseQuizSkill [결함 1]: hint_level=2에서 오답 시 정답 공개 및 ended: true", async () => {
  const { db, histories } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  // 1차 오답 -> level 1
  await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답1",
    signals: defaultSignals,
  });

  // 2차 오답 -> level 2
  await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답2",
    signals: defaultSignals,
  });

  // 3차 오답 (hint_level=2에서 오답)
  const turnResult3 = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답3",
    signals: defaultSignals,
  });

  assert.equal(turnResult3.handled, true);
  assert.equal(turnResult3.ended, false);
  assert.ok(turnResult3.instruction?.includes("[넌센스 퀴즈 정답 공개]"));
  assert.ok(turnResult3.instruction?.includes(`[정답]: ${mockQuestion.canonical_answer}`));
  assert.ok(turnResult3.instruction?.includes(`[설명]: ${mockQuestion.explanation}`));
  assert.equal(histories[0].outcome, "ANSWERED_INCORRECT");
  assert.equal(histories[0].hint_count, 2);
});

test("NonsenseQuizSkill [결함 1]: 1단계/2단계 힌트 instruction에 canonical_answer가 절대 들어있지 않다", async () => {
  const { db } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  // 1단계 오답
  const r1 = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답1",
    signals: defaultSignals,
  });
  assert.equal(r1.instruction?.includes(mockQuestion.canonical_answer), false);

  // 2단계 오답
  const r2 = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오답2",
    signals: defaultSignals,
  });
  assert.equal(r2.instruction?.includes(mockQuestion.canonical_answer), false);
});

test("NonsenseQuizSkill [결함 1]: hint_1, hint_2가 없는 문제에서 오답 시 무한 루프 없이 정답 공개로 진행", async () => {
  const noHintQuestion: NonsenseQuestionRow = {
    ...mockQuestion,
    id: "NQ_NO_HINT",
    hint_1: null,
    hint_2: null,
  };
  const { db, histories } = createMockDb([noHintQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "틀린답",
    signals: defaultSignals,
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, false);
  assert.ok(turnResult.instruction?.includes("[넌센스 퀴즈 정답 공개]"));
  assert.ok(turnResult.instruction?.includes(`[정답]: ${noHintQuestion.canonical_answer}`));
  assert.equal(histories[0].outcome, "ANSWERED_INCORRECT");
});

test("NonsenseQuizSkill: handleTurn 힌트 요청 시 힌트 제공 및 정답 미누출", async () => {
  const { db } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "힌트 줘",
    signals: defaultSignals,
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, false);
  assert.ok(turnResult.instruction?.includes(mockQuestion.hint_1!));
  assert.equal(turnResult.instruction?.includes(mockQuestion.canonical_answer), false);
});

test("NonsenseQuizSkill: handleTurn 정답 공개 요청 시 정답 공개 및 다음 문제 준비", async () => {
  const { db } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "정답 알려줘",
    signals: defaultSignals,
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, false);
  assert.ok(turnResult.instruction?.includes("정답 공개"));
  assert.ok(turnResult.instruction?.includes(mockQuestion.canonical_answer));
});

test("NonsenseQuizSkill: Topic Shift 발생 시 오답 처리 없이 세션 종료 및 handled: false", async () => {
  const { db, histories } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "오늘 친구랑 싸웠어",
    signals: {
      ...defaultSignals,
      hasConflict: true,
    },
  });

  // 게임을 강제하지 않고 일반 대화로 복귀
  assert.equal(turnResult.handled, false);
  assert.equal(histories[0].outcome, "TOPIC_SHIFT");
});

test("NonsenseQuizSkill: 그만 요청 시 세션 종료 및 ended: true", async () => {
  const { db, histories } = createMockDb([mockQuestion]);

  await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });

  const turnResult = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "그만할래",
    signals: {
      ...defaultSignals,
      hasPlayStop: true,
    },
  });

  assert.equal(turnResult.handled, true);
  assert.equal(turnResult.ended, true);
  assert.ok(turnResult.instruction?.includes("그만하자고 했어"));
  assert.equal(histories[0].outcome, "SKIPPED");
});

test("NonsenseQuizSkill: 정답 후 '다음 문제' 요청 시 새 문제가 연속으로 출제된다", async () => {
  const question2: NonsenseQuestionRow = {
    ...mockQuestion,
    id: "NQ002",
    question: "세상에서 가장 가난한 왕은?",
    canonical_answer: "옹달샘",
  };
  const { db, sessions, histories } = createMockDb([mockQuestion, question2]);

  // 1. 퀴즈 시작 -> 1번 문제 출제
  const startResult = await NONSENSE_QUIZ_SKILL.start({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "넌센스 퀴즈 하자",
    signals: defaultSignals,
  });
  assert.equal(startResult.handled, true);
  assert.ok(startResult.instruction?.includes(mockQuestion.question));

  // 2. 1번 문제 정답 맞힘 -> 세션은 ROUND_RESULT 상태로 유지
  const turn1 = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "풋사과",
    signals: defaultSignals,
  });
  assert.equal(turn1.handled, true);
  assert.equal(turn1.ended, false);
  assert.ok(turn1.instruction?.includes("풋사과"));

  // 3. 아이가 '다음 문제 또 내라고' 발화 -> 2번 문제가 출제됨!
  const turn2 = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "다음 문제 또 내라고",
    signals: defaultSignals,
  });
  assert.equal(turn2.handled, true);
  assert.equal(turn2.ended, false);
  assert.ok(turn2.instruction?.includes(question2.question));
  assert.equal(sessions[0].current_question_id, "NQ002");
  assert.equal(histories.length, 2);
  assert.equal(histories[1].question_id, "NQ002");
  assert.equal(histories[1].outcome, "PRESENTED");

  // 4. 2번 문제 정답 맞힌 후 '그만' 요청 -> 세션 종료
  await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "옹달샘",
    signals: defaultSignals,
  });

  const turnStop = await NONSENSE_QUIZ_SKILL.handleTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    gradeRaw: 2,
    utterance: "그만",
    signals: { ...defaultSignals, hasPlayStop: true },
  });
  assert.equal(turnStop.handled, true);
  assert.equal(turnStop.ended, true);
});
