import assert from "node:assert/strict";
import { test } from "node:test";
import type { NonsenseQuestionRow } from "./nonsenseQuizTypes";
import {
  normalizeNonsenseAnswer,
  classifyChildNonsenseUtterance,
  validateNonsenseAnswer,
} from "./answerValidator";
import type { UtteranceSignals } from "../utteranceSignals";

const mockQuestion: NonsenseQuestionRow = {
  id: "NQ0001",
  concept_key: "nq-0001-풋사과",
  question: "사과가 웃으면?",
  canonical_answer: "풋사과",
  accepted_answers: ["풋사과", "풋 사과"],
  hint_1: "정답은 3글자예요.",
  hint_2: "‘풋’으로 시작해요.",
  explanation: "웃음을 ‘풋’하고 터뜨리는 사과입니다.",
  category: "FOOD",
  pun_type: "WORD_COMBINATION",
  difficulty: 1,
  min_grade: 1,
  max_grade: 4,
  status: "ACTIVE",
  child_safe: true,
};

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

test("AnswerValidator: 텍스트 정규화 (공백, 문장부호, 조사, 접두사 제거)", () => {
  assert.equal(normalizeNonsenseAnswer("풋사과"), "풋사과");
  assert.equal(normalizeNonsenseAnswer("  풋사과!  "), "풋사과");
  assert.equal(normalizeNonsenseAnswer("정답: 풋사과"), "풋사과");
  assert.equal(normalizeNonsenseAnswer("답은 풋사과야"), "풋사과");
  assert.equal(normalizeNonsenseAnswer("혹시 풋사과예요?"), "풋사과");
  assert.equal(normalizeNonsenseAnswer("풋 사과인가"), "풋사과");
});

test("AnswerValidator: 정답 일치 판정 (정확 일치, 띄어쓰기, 조사 변형)", () => {
  // 정확 일치
  const res1 = validateNonsenseAnswer("풋사과", mockQuestion);
  assert.equal(res1.isCorrect, true);

  // 띄어쓰기 포함
  const res2 = validateNonsenseAnswer("풋 사과", mockQuestion);
  assert.equal(res2.isCorrect, true);

  // 어미 포함
  const res3 = validateNonsenseAnswer("풋사과야!", mockQuestion);
  assert.equal(res3.isCorrect, true);

  // 접두사 포함
  const res4 = validateNonsenseAnswer("정답은 풋사과", mockQuestion);
  assert.equal(res4.isCorrect, true);
});

test("AnswerValidator: 오답 판정", () => {
  const res1 = validateNonsenseAnswer("바나나", mockQuestion);
  assert.equal(res1.isCorrect, false);

  const res2 = validateNonsenseAnswer("사과", mockQuestion);
  assert.equal(res2.isCorrect, false);

  const res3 = validateNonsenseAnswer("빨간사과", mockQuestion);
  assert.equal(res3.isCorrect, false);
});

test("AnswerValidator: accepted_answers 별칭 인정 검증", () => {
  const qWithAliases: NonsenseQuestionRow = {
    ...mockQuestion,
    canonical_answer: "자원봉사자",
    accepted_answers: ["자원봉사자", "봉사자", "자원봉사"],
  };

  assert.equal(validateNonsenseAnswer("자원봉사자", qWithAliases).isCorrect, true);
  assert.equal(validateNonsenseAnswer("봉사자", qWithAliases).isCorrect, true);
  assert.equal(validateNonsenseAnswer("자원봉사", qWithAliases).isCorrect, true);
  assert.equal(validateNonsenseAnswer("사자", qWithAliases).isCorrect, false);
});

test("AnswerValidator: 발화 의도 분류 (STOP, HINT, REVEAL, TOPIC_SHIFT, ATTEMPT)", () => {
  // STOP
  assert.equal(classifyChildNonsenseUtterance("그만할래"), "STOP");
  assert.equal(classifyChildNonsenseUtterance("그만하자"), "STOP");
  assert.equal(classifyChildNonsenseUtterance("안 해"), "STOP");

  // REVEAL_ANSWER
  assert.equal(classifyChildNonsenseUtterance("정답 알려줘"), "REVEAL_ANSWER");
  assert.equal(classifyChildNonsenseUtterance("답 뭐야"), "REVEAL_ANSWER");
  assert.equal(classifyChildNonsenseUtterance("포기"), "REVEAL_ANSWER");
  assert.equal(classifyChildNonsenseUtterance("패스"), "REVEAL_ANSWER");

  // REQUEST_HINT
  assert.equal(classifyChildNonsenseUtterance("힌트 줘"), "REQUEST_HINT");
  assert.equal(classifyChildNonsenseUtterance("모르겠어"), "REQUEST_HINT");
  assert.equal(classifyChildNonsenseUtterance("너무 어려워"), "REQUEST_HINT");

  // TOPIC_SHIFT (감정 / 안전 / 일상)
  assert.equal(
    classifyChildNonsenseUtterance("오늘 친구랑 싸웠어", {
      ...defaultSignals,
      hasConflict: true,
    }),
    "TOPIC_SHIFT"
  );
  assert.equal(
    classifyChildNonsenseUtterance("나 지금 배고파", {
      ...defaultSignals,
      hasPhysicalNeed: true,
    }),
    "TOPIC_SHIFT"
  );
  assert.equal(
    classifyChildNonsenseUtterance("나 너무 속상해", {
      ...defaultSignals,
      hasNegativeEmotion: true,
    }),
    "TOPIC_SHIFT"
  );

  // ANSWER_ATTEMPT
  assert.equal(classifyChildNonsenseUtterance("풋사과"), "ANSWER_ATTEMPT");
  assert.equal(classifyChildNonsenseUtterance("사과인가?"), "ANSWER_ATTEMPT");
});
