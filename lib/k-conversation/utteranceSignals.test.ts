import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimateSemanticGroup,
  extractUtteranceSignals,
} from "./utteranceSignals";

test("초성 게임 시작 요청 긍정 케이스 7종 (표기 변형 포함)", () => {
  const startUtterances = [
    "초성게임 하자",
    "초성 놀이 하고 싶어",
    "ㅊㅅ게임",
    "초성 퀴즈 내줘",
    "초성 맞추기 할래",
    "ㅊㅅ 퀴즈 하자",
    "초성으로 놀자",
  ];

  for (const text of startUtterances) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasChosungGameStart,
      true,
      `[${text}]는 초성게임 시작 신호로 인식되어야 함`,
    );
    assert.equal(
      signals.hasChosungAnswerAttempt,
      false,
      `[${text}]는 시작 요청이므로 답변 시도가 아니어야 함`,
    );
    assert.equal(
      estimateSemanticGroup(signals),
      "PLAYFUL_GAME_CHOSUNG",
      `[${text}]는 PLAYFUL_GAME_CHOSUNG semantic_group이어야 함`,
    );
  }
});

test("초성 게임 힌트 요청 긍정 케이스 5종", () => {
  const hintUtterances = [
    "힌트 줘",
    "모르겠어",
    "너무 어려워",
    "못 맞추겠어",
    "힌트 좀 알려줘",
  ];

  for (const text of hintUtterances) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasChosungHintRequest,
      true,
      `[${text}]는 힌트 요청 신호로 인식되어야 함`,
    );
    assert.equal(
      signals.hasChosungAnswerAttempt,
      false,
      `[${text}]는 힌트 요청이므로 답변 시도가 아니어야 함`,
    );
  }
});

test("초성 게임 답변 시도 긍정 케이스 5종", () => {
  const answerUtterances = [
    "사과",
    "정답 바나나",
    "혹시 호랑이?",
    "피카츄인가",
    "비행기 맞아?",
  ];

  for (const text of answerUtterances) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasChosungAnswerAttempt,
      true,
      `[${text}]는 답변 시도 신호로 인식되어야 함`,
    );
    assert.equal(
      signals.hasChosungGameStart,
      false,
      `[${text}]는 시작 요청이 아니어야 함`,
    );
  }
});

test("초성 게임 오탐 방지 케이스 7종 (과잉 매칭 방지)", () => {
  // 1. 다른 게임/놀이 요청
  const gameOther = extractUtteranceSignals("게임하자");
  assert.equal(gameOther.hasChosungGameStart, false);
  assert.equal(gameOther.hasChosungAnswerAttempt, false);

  // 2. 초성 개념/정의 질문
  const chosungDef = extractUtteranceSignals("초성이 뭐야?");
  assert.equal(chosungDef.hasChosungGameStart, false);
  assert.equal(chosungDef.hasChosungAnswerAttempt, false);

  // 3. 초성 게임 거부 발화
  const chosungReject = extractUtteranceSignals("초성게임 안 할래");
  assert.equal(chosungReject.hasChosungGameStart, false);
  assert.equal(chosungReject.hasChosungAnswerAttempt, false);

  // 4. 힌트 거부/불필요 발화
  const hintReject = extractUtteranceSignals("힌트 필요 없어");
  assert.equal(hintReject.hasChosungHintRequest, false);

  // 5. 일반 일상 대화
  const dailyChat = extractUtteranceSignals("오늘 학교에서 축구했어");
  assert.equal(dailyChat.hasChosungGameStart, false);
  assert.equal(dailyChat.hasChosungAnswerAttempt, false);
  assert.equal(dailyChat.hasChosungHintRequest, false);

  // 6. 감정/신체 상태 발화
  const physicalNeed = extractUtteranceSignals("배고파");
  assert.equal(physicalNeed.hasChosungGameStart, false);
  assert.equal(physicalNeed.hasChosungAnswerAttempt, false);
  assert.equal(physicalNeed.hasPhysicalNeed, true);

  // 7. 인사
  const greeting = extractUtteranceSignals("안녕 케이야");
  assert.equal(greeting.hasChosungGameStart, false);
  assert.equal(greeting.hasChosungAnswerAttempt, false);
});

test("기존 신호 추출 기능 무결성 유지", () => {
  const achievement = extractUtteranceSignals("오늘 수학 100점 맞았어!");
  assert.equal(achievement.hasAchievement, true);
  assert.equal(achievement.hasChosungGameStart, false);

  const conflict = extractUtteranceSignals("친구랑 싸웠어");
  assert.equal(conflict.hasConflict, true);
  assert.equal(conflict.hasChosungGameStart, false);

  const playful = extractUtteranceSignals("방귀 뿡!");
  assert.equal(playful.hasPlayfulSilly, true);
  assert.equal(playful.hasChosungGameStart, false);
});

test("hasPlayRequestWithoutTarget: 게임 미지정 놀이 요청 긍정/부정 케이스", () => {
  // 긍정 케이스
  const positives = [
    "심심해",
    "놀아줘",
    "뭐 하고 놀까",
    "재미없어",
    "나랑 놀자",
    "게임하자",
    "놀이하자",
    "너무 지루해",
    "놀고 싶어",
  ];
  for (const text of positives) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasPlayRequestWithoutTarget,
      true,
      `[${text}]는 hasPlayRequestWithoutTarget === true 이어야 함`
    );
    assert.equal(
      estimateSemanticGroup(signals),
      "PLAY_PROPOSAL",
      `[${text}]의 semantic_group은 PLAY_PROPOSAL이어야 함`
    );
  }

  // 부정 케이스: 특정 게임 지목, 부정어, 무관 발화
  const negatives = [
    "끝말잇기 하자", // 특정 게임 지목
    "초성게임 하자", // 특정 게임 지목
    "스무고개 하자", // 특정 게임 지목
    "안 놀아", // 놀이 거부
    "놀기 싫어", // 놀이 거부
    "오늘 100점 맞았어", // 성취
    "친구랑 싸웠어", // 갈등
  ];
  for (const text of negatives) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasPlayRequestWithoutTarget,
      false,
      `[${text}]는 hasPlayRequestWithoutTarget === false 이어야 함`
    );
  }
});

test("hasPlayRejection: 단독 거절 긍정 케이스 및 복합 문장 부정 케이스", () => {
  // 긍정 케이스 (단독 부정/거절)
  const rejections = [
    "싫어",
    "안 할래",
    "하기 싫어",
    "됐어",
    "그건 싫어",
    "아니 안 할래",
    "별로",
    "안 놀래",
  ];
  for (const text of rejections) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasPlayRejection,
      true,
      `[${text}]는 hasPlayRejection === true 이어야 함`
    );
  }

  // 부정 케이스: 대안 제시, 특정 게임 요청 등 (거절로 잡으면 안 됨)
  const nonRejections = [
    "초성게임은 싫고 끝말잇기 할래", // 특정 게임으로 전환
    "싫은데 딴 거 할래", // 다른 놀이 요청
    "끝말잇기 하자",
    "초성게임 하자",
    "나 지금 슬퍼",
    "배고파",
  ];
  for (const text of nonRejections) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasPlayRejection,
      false,
      `[${text}]는 hasPlayRejection === false 이어야 함`
    );
  }
});
