import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NonsenseQuestionRow,
  NonsenseQuestionHistoryRow,
} from "./nonsenseQuizTypes";
import {
  selectNonsenseQuestion,
  NONSENSE_COOLDOWN_MS,
} from "./questionSelector";

function createMockQuestion(overrides: Partial<NonsenseQuestionRow> = {}): NonsenseQuestionRow {
  return {
    id: overrides.id || "NQ_TEST_1",
    concept_key: overrides.concept_key || `concept_${overrides.id || "1"}`,
    question: overrides.question || "세상에서 가장 착한 사자는?",
    canonical_answer: overrides.canonical_answer || "자원봉사자",
    accepted_answers: overrides.accepted_answers || ["자원봉사자"],
    hint_1: overrides.hint_1 || "남을 돕는 사람이에요.",
    hint_2: overrides.hint_2 || "‘자원’으로 시작해요.",
    explanation: overrides.explanation || "봉사자 말장난입니다.",
    category: overrides.category || "GENERAL",
    pun_type: overrides.pun_type || "HOMOPHONE",
    difficulty: overrides.difficulty ?? 2,
    min_grade: overrides.min_grade ?? 1,
    max_grade: overrides.max_grade ?? 6,
    status: overrides.status || "ACTIVE",
    child_safe: overrides.child_safe ?? true,
    ...overrides,
  };
}

test("QuestionSelector: 학년 범위 밖 문제 완전 제외 검증", () => {
  const q1 = createMockQuestion({ id: "Q_G1_G2", min_grade: 1, max_grade: 2 });
  const q2 = createMockQuestion({ id: "Q_G3_G4", min_grade: 3, max_grade: 4 });
  const q3 = createMockQuestion({ id: "Q_G5_G6", min_grade: 5, max_grade: 6 });

  const candidates = [q1, q2, q3];

  // 1학년 아이 -> Q_G1_G2만 후보
  const selectedG1 = selectNonsenseQuestion({
    candidates,
    history: [],
    childGrade: 1,
  });
  assert.equal(selectedG1?.id, "Q_G1_G2");

  // 3학년 아이 -> Q_G3_G4만 후보
  const selectedG3 = selectNonsenseQuestion({
    candidates,
    history: [],
    childGrade: 3,
  });
  assert.equal(selectedG3?.id, "Q_G3_G4");

  // 6학년 아이 -> Q_G5_G6만 후보
  const selectedG6 = selectNonsenseQuestion({
    candidates,
    history: [],
    childGrade: 6,
  });
  assert.equal(selectedG6?.id, "Q_G5_G6");
});

test("QuestionSelector: status가 ACTIVE가 아니거나 child_safe=false인 문제 제외", () => {
  const qReview = createMockQuestion({ id: "Q_REVIEW", status: "REVIEW", min_grade: 1, max_grade: 6 });
  const qRejected = createMockQuestion({ id: "Q_REJECTED", status: "REJECTED", min_grade: 1, max_grade: 6 });
  const qUnsafe = createMockQuestion({ id: "Q_UNSAFE", status: "ACTIVE", child_safe: false, min_grade: 1, max_grade: 6 });
  const qActive = createMockQuestion({ id: "Q_ACTIVE", status: "ACTIVE", child_safe: true, min_grade: 1, max_grade: 6 });

  const selected = selectNonsenseQuestion({
    candidates: [qReview, qRejected, qUnsafe, qActive],
    history: [],
    childGrade: 3,
  });

  assert.equal(selected?.id, "Q_ACTIVE");
});

test("QuestionSelector: 180일 이내 출제된 문제는 완전 제외 (쿨다운 검증)", () => {
  const now = Date.now();
  const q1 = createMockQuestion({ id: "Q1" });
  const q2 = createMockQuestion({ id: "Q2" });

  // Q1은 30일 전에 출제됨 (180일 이내)
  const history: NonsenseQuestionHistoryRow[] = [
    {
      id: "H1",
      child_id: "CHILD_1",
      question_id: "Q1",
      outcome: "PRESENTED",
      presented_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
  ];

  const selected = selectNonsenseQuestion({
    candidates: [q1, q2],
    history,
    childGrade: 3,
    now,
  });

  // Q1은 제외되고 Q2만 선택되어야 함
  assert.equal(selected?.id, "Q2");
});

test("QuestionSelector: 180일 경계 조건 (179일 전 제외, 181일 전 재활용 가능)", () => {
  const now = Date.now();
  const q179 = createMockQuestion({ id: "Q_179" });
  const q181 = createMockQuestion({ id: "Q_181" });

  const history: NonsenseQuestionHistoryRow[] = [
    {
      id: "H_179",
      child_id: "CHILD_1",
      question_id: "Q_179",
      outcome: "PRESENTED",
      presented_at: new Date(now - 179 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
    {
      id: "H_181",
      child_id: "CHILD_1",
      question_id: "Q_181",
      outcome: "PRESENTED",
      presented_at: new Date(now - 181 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
  ];

  // Q_179는 제외, Q_181은 180일 경과하여 recycle 가능
  const selected = selectNonsenseQuestion({
    candidates: [q179, q181],
    history,
    childGrade: 3,
    now,
  });

  assert.equal(selected?.id, "Q_181");
});

test("QuestionSelector: NEW 문제가 있으면 180일 경과 문제보다 항상 최우선 선택", () => {
  const now = Date.now();
  const qRecycled = createMockQuestion({ id: "Q_OLD_RECYCLED" });
  const qNew = createMockQuestion({ id: "Q_BRAND_NEW" });

  // Q_OLD_RECYCLED는 200일 전 출제됨
  const history: NonsenseQuestionHistoryRow[] = [
    {
      id: "H1",
      child_id: "CHILD_1",
      question_id: "Q_OLD_RECYCLED",
      outcome: "PRESENTED",
      presented_at: new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
  ];

  const selected = selectNonsenseQuestion({
    candidates: [qRecycled, qNew],
    history,
    childGrade: 3,
    now,
  });

  // NEW 문제가 우선 선택되어야 함
  assert.equal(selected?.id, "Q_BRAND_NEW");
});

test("QuestionSelector: NEW 문제가 소진되면 180일 초과 문제 중 가장 오래된 순(oldest-first)으로 재활용", () => {
  const now = Date.now();
  const q200DaysAgo = createMockQuestion({ id: "Q_200_DAYS" });
  const q300DaysAgo = createMockQuestion({ id: "Q_300_DAYS" });

  const history: NonsenseQuestionHistoryRow[] = [
    {
      id: "H1",
      child_id: "CHILD_1",
      question_id: "Q_200_DAYS",
      outcome: "PRESENTED",
      presented_at: new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
    {
      id: "H2",
      child_id: "CHILD_1",
      question_id: "Q_300_DAYS",
      outcome: "PRESENTED",
      presented_at: new Date(now - 300 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
  ];

  const selected = selectNonsenseQuestion({
    candidates: [q200DaysAgo, q300DaysAgo],
    history,
    childGrade: 3,
    now,
  });

  // 300일 전 출제된 문제가 200일 전 문제보다 더 오래되었으므로 우선 선택
  assert.equal(selected?.id, "Q_300_DAYS");
});

test("QuestionSelector: 후보가 0건이면 null 반환 (임의 문제 생성 방지)", () => {
  const now = Date.now();
  const q1 = createMockQuestion({ id: "Q1", min_grade: 5, max_grade: 6 });

  // 1학년 아이에게 5~6학년 문제만 있는 경우 -> 후보 0건
  const selected = selectNonsenseQuestion({
    candidates: [q1],
    history: [],
    childGrade: 1,
    now,
  });

  assert.equal(selected, null);
});

test("QuestionSelector: 모든 후보가 180일 이내에 출제되었으면 억지 출제 없이 null 반환", () => {
  const now = Date.now();
  const q1 = createMockQuestion({ id: "Q1" });

  const history: NonsenseQuestionHistoryRow[] = [
    {
      id: "H1",
      child_id: "CHILD_1",
      question_id: "Q1",
      outcome: "PRESENTED",
      presented_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      hint_count: 0,
    },
  ];

  const selected = selectNonsenseQuestion({
    candidates: [q1],
    history,
    childGrade: 3,
    now,
  });

  assert.equal(selected, null);
});

test("QuestionSelector: 직전 문제의 pun_type과 다른 pun_type 우선 선택", () => {
  const qHomo = createMockQuestion({ id: "Q_HOMOPHONE", pun_type: "HOMOPHONE" });
  const qComb = createMockQuestion({ id: "Q_COMBINATION", pun_type: "WORD_COMBINATION" });

  const selected = selectNonsenseQuestion({
    candidates: [qHomo, qComb],
    history: [],
    childGrade: 3,
    recentPunTypes: ["HOMOPHONE"],
  });

  assert.equal(selected?.id, "Q_COMBINATION");
});
