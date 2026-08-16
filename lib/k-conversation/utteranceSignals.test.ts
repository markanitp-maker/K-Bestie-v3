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

test("081-A: 게임 이름이 든 불평/질문은 게임 시작으로 오인하지 않는다 (시작 아님 3건)", () => {
  const incidentUtterances = [
    "너 놀이가 초성 게임 밖에 할 줄 아는 게 없어 다른 놀이 몰라",
    "근데 초성 게임만 제한 하고 끝말잇기는 잘 안하지",
    "너 끝말잇기 할 줄 몰라",
  ];

  for (const text of incidentUtterances) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasChosungGameStart,
      false,
      `[${text}]는 초성게임 시작으로 잡히면 안 됨`,
    );
    assert.equal(
      Boolean(signals.hasWordChainGameStart),
      false,
      `[${text}]는 끝말잇기 시작으로 잡히면 안 됨`,
    );
  }
});

test("081-A: 명시적 시작 의도가 있는 발화는 게임 시작으로 인식된다 (시작 맞음 9건)", () => {
  const chosungStarts = [
    "초성게임 하자",
    "초성 퀴즈 내줘",
    "초성으로 놀자",
    "초성게임 하잖아",
    "초성 문제 내봐",
    "초성게임 할 줄 알아? 하자",
  ];
  for (const text of chosungStarts) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasChosungGameStart,
      true,
      `[${text}]는 초성게임 시작이어야 함`,
    );
  }

  const wordChainStarts = [
    "끝말잇기 하자",
    "끝말잇기 할래",
    "끝말잇기 해 봐",
  ];
  for (const text of wordChainStarts) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasWordChainGameStart,
      true,
      `[${text}]는 끝말잇기 시작이어야 함`,
    );
  }
});

test("081-A: 기존 가드 회귀 방지 (비교/거절 발화는 시작 아님 2건)", () => {
  const comparison = extractUtteranceSignals("이거 초성게임보다 재밌다");
  assert.equal(
    comparison.hasChosungGameStart,
    false,
    "이거 초성게임보다 재밌다는 시작이 아니어야 함",
  );

  const rejection = extractUtteranceSignals("초성게임 안 할래");
  assert.equal(
    rejection.hasChosungGameStart,
    false,
    "초성게임 안 할래는 시작이 아니어야 함",
  );
});


/** 081 회귀 고정 세트.
 *
 *  이 게임 시작 판정은 2026-08 한 달 사이 네 번 회귀했다.
 *   1차 활성 세션이 직접 요청을 이기게 만들어 게임 전환 자체가 죽었고,
 *   2차 시작 의도 화이트리스트가 "하잖아"·"해 봐"를 놓쳐 초성게임이 아예 안 열렸고,
 *   3차 블록리스트로 되돌리자 "초성 퀴즈 내줘"·"초성으로 놀자"가 안 먹었고,
 *   4차 능력 표지 가드를 넣자 "못하잖아"가 "하잖아"에 부분일치해 가드가 뚫렸다.
 *
 *  아래 문장들은 전부 **실제 대화 로그이거나 리뷰가 짚어낸 재현 사례**다.
 *  구현을 바꿀 때 이 표를 먼저 통과시켜라. 키워드를 목록에 더 얹는 방식은
 *  이미 세 번 실패했다. */
const PLAY_START_SHOULD_NOT_TRIGGER = [
  // 2026-08-16 Dev 김서아 세션 — 아이가 시킨 적 없는데 게임이 시작된 실제 사고
  "너 놀이가 초성 게임 밖에 할 줄 아는 게 없어 다른 놀이 몰라",
  "근데 초성 게임만 제한 하고 끝말잇기는 잘 안하지",
  "너 끝말잇기 할 줄 몰라",
  // 080에서 고쳤던 비교·거절 (되살아나면 안 됨)
  "이거 초성게임보다 재밌다",
  "초성게임 안 할래",
  "초성게임이 뭐야 알려줘",
  "끝말잇기가 무슨 뜻이야",
  // 081 리뷰 지적 — 부정형이 시작 키워드에 부분일치해 가드가 무력화됐던 사례
  "너 초성게임 잘 못하잖아",
  "너 끝말잇기 안하잖아",
  // 081 리뷰 지적 — 아이가 케이 말을 옮기며 불평하는 인용형
  "너 왜 맨날 초성게임 하자고 해?",
  // 081 2차 리뷰 지적 — 능력 표지의 "해" 계열, 부정형 뒤 시작 키워드, 인용형+잖아
  "초성게임 잘 못해",
  "초성 문제 안 줘?",
  "너 왜 초성게임 하라고 하잖아",
  // 능력·상태 진술 (요청이 아님)
  "초성게임 어떻게 하는지 모르겠어",
  "나 끝말잇기 할 줄 몰라",
  "초성게임 안 해봤어",
];

const PLAY_START_SHOULD_TRIGGER = [
  // 평범한 직접 요청
  "초성게임 하자", "초성 퀴즈 내줘", "초성으로 놀자", "초성게임 하잖아", "초성 문제 내봐",
  "끝말잇기 하자", "끝말잇기 할래", "끝말잇기 해 봐",
  // 능력 표지가 섞여 있어도 시작 의사가 분명하면 시작돼야 한다.
  // 못 잡아서 게임이 안 되는 쪽이, 가끔 잘못 잡히는 쪽보다 훨씬 나쁘다.
  "초성게임 할 줄 알아? 하자",
  "초성게임 어떻게 하는지 모르겠는데 하자",
  "끝말잇기 잘 못하지만 할래",
  "밖에서 초성게임 하자",
  "나 초성게임 잘 모르는데 해보자",
  "끝말잇기 할 줄 몰라도 하고 싶어",
  // 081 리뷰 지적 — 목록에 없어서 정상 요청이 통째로 막혔던 말끝
  "초성게임 잘 모르지만 해볼래",
  "끝말잇기 규칙 모르는데 한번 해볼까",
  "초성퀴즈 잘 모르지만 맞춰볼래",
  "초성게임 규칙 모르니까 문제 줘",
];

const startsAnyGame = (text: string): boolean => {
  const signals = extractUtteranceSignals(text);
  return Boolean(signals.hasChosungGameStart || signals.hasWordChainGameStart);
};

test("081 회귀: 게임 이름이 들어간 불평·질문·인용은 게임을 시작시키지 않는다", () => {
  for (const text of PLAY_START_SHOULD_NOT_TRIGGER) {
    assert.equal(startsAnyGame(text), false, `[${text}]로 게임이 시작되면 안 된다`);
  }
});

test("081 회귀: 시작 의사가 분명한 발화는 능력 표지가 섞여 있어도 시작된다", () => {
  for (const text of PLAY_START_SHOULD_TRIGGER) {
    assert.equal(startsAnyGame(text), true, `[${text}]는 게임을 시작시켜야 한다`);
  }
});
