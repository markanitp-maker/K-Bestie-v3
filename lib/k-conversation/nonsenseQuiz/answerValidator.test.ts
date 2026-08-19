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

// ── 015: 아이 구어체 답변 정규화 ────────────────────────────────

test("015: 아이가 답 앞에 붙이는 구어 접두사를 걷어낸다", () => {
  // 2026-08-19 김서아 Dev 로그: 아이가 "너는 보드 게임"이라고 답했는데 정답 인정 실패.
  assert.equal(normalizeNonsenseAnswer("너는 보드 게임"), "보드게임");
  assert.equal(normalizeNonsenseAnswer("그건 달력이야"), "달력");
  assert.equal(normalizeNonsenseAnswer("내 생각엔 나이"), "나이");
  assert.equal(normalizeNonsenseAnswer("음 아마 거울"), "거울");
  assert.equal(normalizeNonsenseAnswer("난 몰라"), "몰라");
});

test("015: 접두사와 같은 글자로 시작하는 정답을 훼손하지 않는다", () => {
  // 접두사 뒤에 공백을 요구하지 않으면 "그림"의 "그"를 접두사로 먹는다.
  for (const word of ["그림", "그네", "그림자", "아이스크림", "어린이", "나이", "이불"]) {
    assert.equal(normalizeNonsenseAnswer(word), word, `정답이 깎였다: ${word}`);
  }
});

test("015: 어미를 지운 뒤 한 글자만 남으면 더 짧은 어미를 쓴다", () => {
  // "나이야"에서 "이야"를 지우면 "나"가 되지만 정답은 "나이"다.
  assert.equal(normalizeNonsenseAnswer("나이야"), "나이");
  // 반대로 "달력이야"는 "이야"를 지워야 맞다.
  assert.equal(normalizeNonsenseAnswer("달력이야"), "달력");
  // 진짜 한 글자 정답은 그대로 한 글자로 남는다.
  assert.equal(normalizeNonsenseAnswer("나야"), "나");
});

test("015: 기존 어미 제거가 그대로 동작한다(회귀 없음)", () => {
  assert.equal(normalizeNonsenseAnswer("거울이에요"), "거울");
  assert.equal(normalizeNonsenseAnswer("시계입니다"), "시계");
  assert.equal(normalizeNonsenseAnswer("나이인가"), "나이");
  assert.equal(normalizeNonsenseAnswer("정답은 달력"), "달력");
});

test("015: '~이야'는 받침 유무로 조사인지 낱말인지 가른다", () => {
  // 서술격조사 "이"는 받침 있는 말 뒤에만 붙는다.
  // 달(받침 ㄹ) + 이야 → 조사 → "달"
  assert.equal(normalizeNonsenseAnswer("달이야"), "달");
  assert.equal(normalizeNonsenseAnswer("눈이야"), "눈");
  assert.equal(normalizeNonsenseAnswer("물이야"), "물");
  // 나(받침 없음) + 이야 는 성립하지 않는다 → "이"는 낱말의 일부 → "나이"
  assert.equal(normalizeNonsenseAnswer("나이야"), "나이");
  // 받침 없는 말은 "야"만 붙는다.
  assert.equal(normalizeNonsenseAnswer("나야"), "나");
  assert.equal(normalizeNonsenseAnswer("바다야"), "바다");
});

// ── 010: 다음 문제 요청 인식 ──────────────────────────────────

test("010: '내 봐' 계열을 다음 문제 요청으로 인식한다", () => {
  // 2026-08-19 대표님 QA 실측: "내 봐", "그래 문제 내봐" 가 힌트 요청으로 흘러가
  // 케이가 내지도 않은 문제에 "정답은 4글자 안팎", "첫 글자는 '스'" 라고 답했다.
  const signals = {} as never;
  for (const utterance of [
    "내 봐",
    "문제 내봐",
    "그래 문제 내봐",
    "아무튼 또 내 봐",
    "다음 문제 줘",
    "문제 줘",
  ]) {
    assert.equal(
      classifyChildNonsenseUtterance(utterance, signals),
      "NEXT_QUESTION",
      `다음 문제 요청을 놓쳤다: ${utterance}`
    );
  }
});

test("010: 힌트·정답 요청과 섞이지 않는다", () => {
  const signals = {} as never;
  assert.equal(classifyChildNonsenseUtterance("힌트 줘", signals), "REQUEST_HINT");
  assert.equal(classifyChildNonsenseUtterance("정답 알려줘", signals), "REVEAL_ANSWER");
});

test("010: 정답 발화를 다음 문제 요청으로 오인하지 않는다", () => {
  const signals = {} as never;
  for (const utterance of ["마네킹", "청소기", "컴퓨터", "스마트폰"]) {
    assert.equal(
      classifyChildNonsenseUtterance(utterance, signals),
      "ANSWER_ATTEMPT",
      `정답을 다음 문제 요청으로 오인했다: ${utterance}`
    );
  }
});

// ── 2026-08-19 대표님 Dev QA 회귀 ────────────────────────────
test("맨 긍정 응답은 오답으로 채점하지 않고 다음 문제로 넘긴다", () => {
  // 실측(세션 c4f68596): 케이 "다음 문제 또 풀어볼래?" → 아이 "ㅇㅇ" 가
  // ANSWERED_INCORRECT 로 기록됐다(17:36:47). 아이는 하겠다고 한 것이다.
  for (const utterance of ["ㅇㅇ", "응", "웅", "그래", "좋아", "ㅇㅋ", "오케이", "ㄱㄱ", "응!", "웅웅"]) {
    assert.equal(
      classifyChildNonsenseUtterance(utterance),
      "NEXT_QUESTION",
      `긍정 응답이 답변 시도로 채점된다: ${utterance}`
    );
  }
});

test("긍정처럼 보여도 실제 낱말은 답변 시도로 남긴다", () => {
  // 과잉 적용 방지 — 정답이 될 수 있는 낱말을 긍정으로 삼켜서는 안 된다.
  for (const utterance of ["그림자", "해바라기", "응가", "어항", "네모", "좋아하는 사람"]) {
    assert.notEqual(
      classifyChildNonsenseUtterance(utterance),
      "NEXT_QUESTION",
      `실제 답변이 긍정으로 삼켜진다: ${utterance}`
    );
  }
});
