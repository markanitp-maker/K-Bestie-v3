import assert from "node:assert/strict";
import { test } from "node:test";

import { selectAction, type ActionSelectorInput } from "./actionSelector";
import type { BoredomAssessment } from "./boredomDetection";
import type { ConversationAction } from "./types";
import { extractUtteranceSignals } from "./utteranceSignals";

const defaultBoredom: BoredomAssessment = { level: "low" };

function runSelector(
  text: string,
  overrides: Partial<ActionSelectorInput> = {},
): ConversationAction {
  const signals = extractUtteranceSignals(text);
  return selectAction({
    signals,
    boredom: defaultBoredom,
    hasRecentEpisode: false,
    hasLongTermMemory: false,
    recentActions: [],
    ...overrides,
  });
}

test("초성 게임 시작 발화 → PLAYFUL_GAME_CHOSUNG 선택", () => {
  const startUtterances = [
    "초성게임 하자",
    "초성 퀴즈 내줘",
    "ㅊㅅ게임",
    "초성 맞추기 할래",
    "초성으로 놀자",
    "초성 문제 내봐",
  ];

  for (const text of startUtterances) {
    const action = runSelector(text);
    assert.equal(
      action,
      "PLAYFUL_GAME_CHOSUNG",
      `[${text}]는 PLAYFUL_GAME_CHOSUNG 액션이 선택되어야 함`,
    );
  }
});

test("아이가 속상해하거나 힘들어하는 발화 + 초성게임 언급 → 감정 케어 액션 우선", () => {
  // 1. 친구 갈등 + 초성게임 ("친구랑 싸웠어" -> hasConflict)
  const conflictWithGame = runSelector("친구랑 싸워서 속상해 초성게임 하자");
  assert.equal(
    conflictWithGame,
    "EMPATHY",
    "친구 갈등 및 속상함이 포함된 경우 EMPATHY가 우선되어야 함",
  );

  // 2. 부정 감정 + 초성게임 ("너무 슬퍼" -> hasNegativeEmotion)
  const sadWithGame = runSelector("나 오늘 너무 슬퍼 초성게임 하자");
  assert.equal(
    sadWithGame,
    "EMPATHY",
    "슬픔 등 부정 감정이 포함된 경우 EMPATHY가 우선되어야 함",
  );

  // 3. 신체 상태/불편 + 초성게임 ("배고파" -> hasPhysicalNeed)
  const physicalWithGame = runSelector("배고파 초성게임 하자");
  assert.equal(
    physicalWithGame,
    "EMPATHY",
    "신체적 불편 상태가 포함된 경우 EMPATHY가 우선되어야 함",
  );
});

test("초성게임 무관 발화 → 기존 액션 정상 선택 (회귀 방지)", () => {
  // 성취 -> CELEBRATION (deterministic primary)
  assert.equal(runSelector("오늘 수학 100점 맞았어!"), "CELEBRATION");

  // 갈등 -> EMPATHY (deterministic primary)
  assert.equal(runSelector("친구랑 다퉜어"), "EMPATHY");

  // 부정 감정 -> EMPATHY (deterministic primary)
  assert.equal(runSelector("나 지금 너무 화나"), "EMPATHY");

  // 신체 상태 -> EMPATHY (deterministic primary)
  assert.equal(runSelector("너무 졸려"), "EMPATHY");

  // 일반지식 질문 -> OWN_OPINION (deterministic primary)
  assert.equal(runSelector("하늘은 왜 파래?"), "OWN_OPINION");

  // 기억 회상 질의 (hasMemory=true) -> MEMORY_RECALL
  assert.equal(
    runSelector("전에 내가 말했던 거 기억나?", { hasLongTermMemory: true }),
    "MEMORY_RECALL",
  );

  // 장난/드립 -> JOKE, PLAYFUL_TEASING, IMAGINATION 중 하나
  const playfulAction = runSelector("방귀 뿡!");
  assert.ok(
    ["JOKE", "PLAYFUL_TEASING", "IMAGINATION"].includes(playfulAction),
    `방귀 발화는 장난 계열 액션이어야 함: ${playfulAction}`,
  );

  // 중립 일상 -> FOLLOW_UP, CURIOSITY, JUST_LISTEN 중 하나
  const neutralAction = runSelector("오늘 학교에서 축구했어");
  assert.ok(
    ["FOLLOW_UP", "CURIOSITY", "JUST_LISTEN"].includes(neutralAction),
    `일상 대화는 중립 계열 액션이어야 함: ${neutralAction}`,
  );
});

test("초성게임 시작 요청은 boredom 상승 상태에서도 무시되지 않고 유지됨", () => {
  const highBoredom: BoredomAssessment = { level: "high" };
  const action = runSelector("초성게임 하자", { boredom: highBoredom });
  assert.equal(
    action,
    "PLAYFUL_GAME_CHOSUNG",
    "boredom high 상태여도 초성게임 시작 결정론적 신호가 우선되어야 함",
  );
});

test("최근 액션 반복 방지 및 단일 후보 유지 검증", () => {
  // PLAYFUL_GAME_CHOSUNG은 후보가 단일이므로 직전 액션과 같아도 PLAYFUL_GAME_CHOSUNG 유지
  const repeatChosung = runSelector("초성게임 하자", {
    recentActions: ["PLAYFUL_GAME_CHOSUNG"],
  });
  assert.equal(repeatChosung, "PLAYFUL_GAME_CHOSUNG");

  // 성취는 후보가 [CELEBRATION, CURIOSITY, PLAYFUL_TEASING]이므로 직전이 CELEBRATION이면 회전
  const rotatedAchievement = runSelector("오늘 100점 맞았어!", {
    recentActions: ["CELEBRATION"],
    rand: () => 0, // 첫 번째 대체 후보 선택
  });
  assert.equal(rotatedAchievement, "CURIOSITY");
});
