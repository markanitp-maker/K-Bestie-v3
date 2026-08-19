// 요청서 015 2차 — 2026-08-19 13:39~13:48 김서아 Dev QA 로그에서 나온 문제들.
//
// 아이가 겪은 일을 그대로 테스트로 고정한다.

import assert from "node:assert/strict";
import test from "node:test";

import { isCorrectAnswer } from "../chosungGame/answerNormalize";
import { validateNonsenseAnswer } from "../nonsenseQuiz/answerValidator";
import { findDirectlyRequestedSkill } from "./skillRegistry";
import { extractUtteranceSignals } from "../utteranceSignals";
import { resolveGenerationBudget } from "../responseGenerator";

// ── 정답 인식 ────────────────────────────────────────────────

test("015-2: 초성게임 — 아이가 답을 풀어 말해도 정답으로 본다", () => {
  // 실측: "도서관 이라고" 가 오답 처리돼 세션이 안 넘어가고 같은 초성이 다시 나왔다.
  for (const utterance of ["도서관", "도서관 이라고", "그러니까 도서관", "어 도서관 이라고"]) {
    assert.equal(isCorrectAnswer(utterance, "도서관"), true, `오답 처리됨: ${utterance}`);
  }
});

test("015-2: 초성게임 — 어절 경계를 넘는 부분일치는 정답이 아니다", () => {
  // "달력"이 정답 "달"에 걸리면 틀린 답이 정답이 된다.
  assert.equal(isCorrectAnswer("달력", "달"), false);
  assert.equal(isCorrectAnswer("도서", "도서관"), false);
  assert.equal(isCorrectAnswer("모르겠어", "도서관"), false);
});

test("015-2: 넌센스 — 아이가 답을 되풀이해도 정답으로 본다", () => {
  // 실측: 아이가 "마네킹"을 세 번 말했는데 계속 오답 → 힌트 루프에 갇혔다.
  const question = { canonical_answer: "마네킹", accepted_answers: [] } as never;
  for (const utterance of ["마네킹", "그러니까 마네킹 이라고 마네킹", "옷 마네킹", "마네킹이야"]) {
    assert.equal(
      validateNonsenseAnswer(utterance, question).isCorrect,
      true,
      `오답 처리됨: ${utterance}`
    );
  }
  assert.equal(validateNonsenseAnswer("인형", question).isCorrect, false);
});

// ── 놀이 오작동 시작 ──────────────────────────────────────────

test("015-2: 놀이를 평가·설명만 하는 문장에서는 판을 시작하지 않는다", () => {
  // 실측: 아이가 넌센스 퀴즈 총평 중 게임 이름을 나열했는데 끝말잇기가 시작됐다.
  for (const utterance of [
    "로드 코드가 이거를 지금 이 세계 게임 있지 초성 게임 그 다음에 끝말잇기 게임 넌센스 퀴즈 이거 어떤 식으로 아이들과 서로 대화를 하는지",
    "너 끝말잇기 스키를 갖고 있는 거야 리서치 해서 끝말잇기 스키를 좀 학습 해서 들어와야지",
    "끝말잇기 대고 야 다시 분석해서 똑바로 다시 개발 하라고",
  ]) {
    assert.equal(
      findDirectlyRequestedSkill(extractUtteranceSignals(utterance), utterance),
      null,
      `평가 문장인데 놀이가 시작됐다: ${utterance.slice(0, 30)}`
    );
  }
});

test("015-2: 불평과 요청이 한 문장에 오면 요청으로 본다", () => {
  const utterance = "너 초성 게임 못 하니까 초성 게임은 다시 개발 해 개판이야 끝말잇기나 하자";
  const skill = findDirectlyRequestedSkill(extractUtteranceSignals(utterance), utterance);
  assert.equal(skill?.id, "WORD_CHAIN", "요청이 섞였는데 무시했다");
});

test("015-2: 평범한 놀이 요청은 그대로 동작한다(회귀 없음)", () => {
  for (const [utterance, expected] of [
    ["끝말잇기 하자", "WORD_CHAIN"],
    ["초성게임 하자", "CHOSUNG"],
  ] as const) {
    const skill = findDirectlyRequestedSkill(extractUtteranceSignals(utterance), utterance);
    assert.equal(skill?.id, expected, `요청이 안 먹혔다: ${utterance}`);
  }
});

// ── 응답 생성 예산 (내가 만든 회귀) ──────────────────────────

test("015-2: 자유대화 응답 예산이 미션보다 넉넉하다", () => {
  // 019 에서 미션 기준 4.5초를 자유대화에도 적용한 것이 회귀였다.
  // 실측: 자유대화 응답이 매번 4501ms TIMEOUT 으로 끊기고
  // "응, 듣고 있어. 더 얘기해줄래?" 가 아이에게 두 번 나갔다.
  const freeChat = resolveGenerationBudget("FREE_CHAT");
  const mission = resolveGenerationBudget("MISSION");

  assert.ok(
    freeChat.attemptTimeoutMs > 4501,
    `자유대화 시도 timeout 이 실측 실패 지점(4501ms)보다 짧다: ${freeChat.attemptTimeoutMs}`
  );
  assert.ok(freeChat.attemptTimeoutMs <= freeChat.totalBudgetMs);
  // 미션은 앞에 Goal 판정이 또 있으므로 짧게 유지한다.
  assert.ok(mission.attemptTimeoutMs < freeChat.attemptTimeoutMs);
  assert.ok(mission.totalBudgetMs <= 5000);
});

// ── 2차 QA (14:27) 에서 나온 것 ────────────────────────────────

test("015-2b: 답을 군말·인용으로 감싸 말해도 답변 시도로 인식한다", () => {
  // 실측: 정답이 "공놀이" 인 문제에 아이가 "그러니까 공놀이 이라고" 라고 답했는데
  // 답변 시도로 인식되지 않아 정답 대조까지 가지도 못하고 오답 처리됐다.
  for (const utterance of [
    "그러니까 공놀이 이라고",
    "공놀이 이라고",
    "어 도서관 이라고",
    "그러니까 킹콩 이라고 킹콩",
  ]) {
    assert.equal(
      extractUtteranceSignals(utterance).hasChosungAnswerAttempt,
      true,
      `답변 시도로 인식하지 못했다: ${utterance}`
    );
  }
});

test("015-2b: 평범한 대화를 답변 시도로 오인하지 않는다", () => {
  for (const utterance of [
    "오늘 학교에서 친구랑 피구했어",
    "근데 우리 팀이 져서 좀 아쉬웠어",
    "내일은 이기고 싶어",
    "그러니까 오늘 학교에서 피구했어",
    "오늘 급식 맛있었어",
    "그만할래",
    "힌트 줘",
    "초성게임 하자",
  ]) {
    assert.equal(
      extractUtteranceSignals(utterance).hasChosungAnswerAttempt,
      false,
      `대화를 답변 시도로 오인했다: ${utterance}`
    );
  }
});

test("015-2b: '다음 문제 줘' 를 다음 문제 요청으로 인식한다", () => {
  // 실측: 어떤 신호에도 안 걸려 케이가 같은 초성을 다시 제시했다.
  for (const utterance of ["다음 문제 줘", "다른 문제 줘", "문제 바꿔", "패스", "다음거"]) {
    assert.equal(
      extractUtteranceSignals(utterance).hasChosungNextQuestion,
      true,
      `다음 문제 요청을 놓쳤다: ${utterance}`
    );
  }
  // 답변 시도와 겹치지 않아야 한다.
  assert.equal(extractUtteranceSignals("다음 문제 줘").hasChosungAnswerAttempt, false);
});

test("015-2b: 정답 자체가 '다음' 계열이 아니면 다음문제 신호가 오작동하지 않는다", () => {
  for (const utterance of ["공놀이", "도서관", "그러니까 공놀이 이라고"]) {
    assert.equal(extractUtteranceSignals(utterance).hasChosungNextQuestion, false, utterance);
  }
});

test("015-2b: 초성게임 신호 게이트가 모든 처리 분기를 통과시킨다", async () => {
  // 2026-08-19 실측: hasChosungNextQuestion 분기를 만들었는데 게이트 목록에 넣지 않아
  // 동작하지 않았다. 분기가 있는 신호는 게이트도 통과해야 한다.
  const { runChosungTurn } = await import("../chosungGame/gameOrchestrator");
  const base = {
    hasChosungGameStart: false,
    hasChosungAnswerAttempt: false,
    hasChosungHintRequest: false,
    hasChosungAnswerRequest: false,
    hasChosungNextQuestion: false,
  };

  // 신호가 전부 꺼져 있으면 게이트에서 빠져나간다(db 접근 전).
  let dbTouched = false;
  const db = {
    from: () => {
      dbTouched = true;
      throw new Error("db touched");
    },
  } as never;

  await runChosungTurn({ db, childId: "c", chatSessionId: "s", utterance: "안녕", signals: base });
  assert.equal(dbTouched, false, "신호가 없는데 DB 를 건드렸다");

  // 각 신호가 켜지면 게이트를 통과해 DB 조회까지 간다.
  for (const key of [
    "hasChosungGameStart",
    "hasChosungAnswerAttempt",
    "hasChosungHintRequest",
    "hasChosungAnswerRequest",
    "hasChosungNextQuestion",
  ] as const) {
    dbTouched = false;
    await runChosungTurn({
      db,
      childId: "c",
      chatSessionId: "s",
      utterance: "x",
      signals: { ...base, [key]: true },
    });
    assert.equal(dbTouched, true, `${key} 신호가 게이트를 통과하지 못했다`);
  }
});

// ── 15:12 QA (대표님 직접 진행) 에서 나온 것 ──────────────────

test("010: 되묻기 문구는 놀이 중 판정을 가로채면 안 된다 — 문구 자체 확인", async () => {
  // 실측: 케이 응답 47개 중 12개(26%)가 "내가 '○○'라고 들었는데, 이게 맞니?" 였다.
  // 아이가 게임 답을 짧게 말할 때마다 ASR 신뢰도가 낮아 이 경로가 먼저 잡아챘다.
  // respond() 가 놀이 세션이 있으면 이 경로로 빠지지 않도록 고쳤다(index.ts).
  const { buildUnclearAudioRecovery } = await import("@/lib/freechat/unclearAudioRecovery");
  const recovery = buildUnclearAudioRecovery({ childUtterance: "소" });
  assert.ok(recovery.text, "되묻기 문구가 없다");
  assert.ok(recovery.text!.includes("소"));
});

test("010: 가짜 게임 차단 문구가 매번 같지 않다", async () => {
  // 실측: "좋아, 같이 하자! 잠깐만 준비할게." 가 두 번 연속 나왔고 아이가 알아챘다.
  const { pickFakeGameplayRecoveryText } = await import("./fakeGameplayDetector");
  const first = pickFakeGameplayRecoveryText([]);
  const second = pickFakeGameplayRecoveryText([first]);
  assert.notEqual(second, first, "직전과 같은 문구가 또 나왔다");
  const third = pickFakeGameplayRecoveryText([first, second]);
  assert.ok(![first, second].includes(third));
});

test("010: 가짜 게임 차단 문구는 아이에게 선택을 돌려준다", async () => {
  const { pickFakeGameplayRecoveryText } = await import("./fakeGameplayDetector");
  const text = pickFakeGameplayRecoveryText([]);
  assert.ok(/놀이|할래|할까|골라/.test(text), `되묻는 문장이 아니다: ${text}`);
  // 차단해 놓고 게임 콘텐츠를 다시 흘리면 안 된다.
  assert.ok(!/[ㄱ-ㅎ]{2,}/.test(text), "초성이 들어 있다");
});

test("010: 놀이 중 생성 실패 문구가 아이에게 되묻지 않는다", async () => {
  // 실측: 아이가 "이름표" 를 냈는데 "응, 듣고 있어. 더 얘기해줄래?" 가 나갔다.
  // 아이 차례가 이미 끝난 자리에서 다시 말하라고 하면 안 된다(019 와 같은 원칙).
  const { containsMissionForbiddenFallback } = await import("@/lib/mission-v3/missionAdapter");
  // 엔진이 쓰는 놀이용 문구 형태를 그대로 검사한다.
  for (const playName of ["끝말잇기", "초성게임", "넌센스 퀴즈"]) {
    const text = `앗, 잠깐 멈췄네. 미안! 우리 ${playName} 계속하자.`;
    assert.equal(
      containsMissionForbiddenFallback(text),
      false,
      `되묻는 문구가 섞였다: ${text}`
    );
    assert.ok(text.includes(playName), "어떤 놀이인지 안 밝혔다");
    assert.ok(/계속하자/.test(text), "이어가자는 뜻이 없다");
  }
});
