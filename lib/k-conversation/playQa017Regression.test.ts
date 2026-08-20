import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChosungRepeatResult } from "./chosungGame/gameOrchestrator";
import { CHOSUNG_SKILL } from "./play/chosungSkill";
import { WORD_POOL } from "./chosungGame/wordPool";
import { WORD_CHAIN_DICTIONARY } from "./wordChain/dictionaryIndex";
import { extractUtteranceSignals } from "./utteranceSignals";
import { classifyChildNonsenseUtterance } from "./nonsenseQuiz/answerValidator";

test("017 실측 4문장 분류", () => {
  const complaint = extractUtteranceSignals('이어서 진행해. 내가 "그만" 이라고 안 했는데, 왜 멋데로 종료하니? ...');
  const condition = extractUtteranceSignals('아이가 "그만" 할 때까지, 계속 문제 내라고 했자나. 왜 계속 어기니?');
  const go = extractUtteranceSignals("ㄱㄱ");
  const repeat = extractUtteranceSignals("초성 뭐였지?");
  assert.equal(complaint.hasPlayStop, false);
  assert.equal(condition.hasPlayStop, false);
  assert.equal(go.hasPlayContinue, true);
  assert.equal(repeat.hasChosungRepeatQuestion, true);
  assert.equal(repeat.hasGeneralKnowledgeQuestion, true);
});

test("인용·부정·조건·전언은 비종료이고 직접 종료 명령은 유지", () => {
  for (const text of ["그만 안 했는데", "그만이라고 안 했어", "그만한다고 안 했잖아", '"그만" 할 때까지', "그만이라고 하면", "그만이라고 했을 때", "그만 하기 전까지", "그만 하라고 했잖아"]) {
    assert.equal(extractUtteranceSignals(text).hasPlayStop, false, text);
  }
  // 앵커를 문장 끝에 딱 붙였더니 아이 말투를 놓쳤다(실측 2026-08-20):
  // "그만 하고 싶어", "안 할래 이제" 가 종료로 안 잡혔다. 꼬리말을 허용해 고쳤다.
  for (const text of [
    "그만", "그만할래", "이제 그만하자", "그만해", "안 할래",
    "그만 하고 싶어", "안 할래 이제", "그만!!", "그만ㅋㅋ", "그만 좀", "이제 그만할래요",
  ]) {
    assert.equal(extractUtteranceSignals(text).hasPlayStop, true, text);
  }
});

test("진행 지시는 문장 전체 일치만 허용", () => {
  for (const text of ["ㄱㄱ", "ㄱㄱㅆ", "고고", "가자", "계속", "계속해", "진행", "진행해", "이어서", "이어서 해", "다음", "다음 문제", "또", "또 해"]) {
    assert.equal(extractUtteranceSignals(text).hasPlayContinue, true, text);
  }
  for (const text of ["계속기", "가자미", "다시마"]) {
    assert.equal(extractUtteranceSignals(text).hasPlayContinue, false, text);
  }
});

test("끝말잇기 사전과 초성 낱말 풀 종료 오탐 0건", () => {
  assert.equal(WORD_CHAIN_DICTIONARY.filter(({ word }) => extractUtteranceSignals(word).hasPlayStop).length, 0);
  assert.equal(WORD_POOL.filter(({ word }) => extractUtteranceSignals(word).hasPlayStop).length, 0);
});

test("초성 재질문은 초성만 반복하고 정답 유출 가드를 설정", () => {
  const result = buildChosungRepeatResult({ current_chosung: "ㄱㅊ", current_word: "공책" });
  assert.equal(result.deterministicText, '아까 초성은 "ㄱㅊ" 이야!');
  assert.equal(result.deterministicText?.includes("공책"), false);
  assert.equal(result.answerMustNotAppear, "공책");
});

test("초성 재질문 응답이 어댑터를 지나 실제로 전달된다", async () => {
  // 내부 빌더만 검사하면 어댑터가 결과를 버려도 통과한다 — 실제로 그랬다.
  // `chosungSkill.handleTurn` 이 `deterministicText` 를 버리는 바람에
  // 결정론 문장이 사라지고 LLM 이 정답 "공책" 을 말했다(2026-08-20 실측).
  const now = new Date().toISOString();
  const session = {
    id: "cs-1",
    child_id: "c1",
    chat_session_id: "s1",
    current_chosung: "ㄱㅊ",
    current_word: "공책",
    hint_level: 1,
    wrong_count: 0,
    state: "WAITING_FOR_ANSWER",
    started_at: now,
    updated_at: now,
    ended_at: null,
  };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: session, error: null }),
    update: () => ({ eq: () => ({ eq: async () => ({ error: null }), error: null }) }),
    insert: async () => ({ error: null }),
  });
  const db = { from: () => chain } as unknown as Parameters<
    typeof CHOSUNG_SKILL.handleTurn
  >[0]["db"];

  const result = await CHOSUNG_SKILL.handleTurn({
    db,
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: 3,
    utterance: "초성 뭐였지?",
    signals: extractUtteranceSignals("초성 뭐였지?"),
  });

  assert.ok(
    result.deterministicText,
    "어댑터가 결정론 문장을 버리면 LLM 이 다시 답을 지어낸다"
  );
  assert.equal(result.deterministicText?.includes("공책"), false, "정답이 새면 안 된다");
  assert.ok(result.deterministicText?.includes("ㄱㅊ"), "초성은 다시 알려줘야 한다");
  assert.equal(result.answerMustNotAppear, "공책", "유출 가드도 함께 걸려야 한다");
});

test("끝말잇기도 공통 종료 신호를 받는다", () => {
  // 끝말잇기만 로컬 정규식을 써서 "그만 하고 싶어" 를 놓치고 있었다.
  // 신호 자체가 true 인지 먼저 고정한다(스킬 연결은 위 신호를 쓴다).
  for (const text of ["그만 하고 싶어", "안 할래 이제"]) {
    assert.equal(extractUtteranceSignals(text).hasPlayStop, true, text);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-20 18:48 QA — 아이가 새 문제를 달라고 했는데 그만하자는 말로 오해했다.
// ─────────────────────────────────────────────────────────────────────────────

test("실측: '맨날 똑같은 질문이니? 다른거 없어?' 는 진행 지시다", () => {
  // 실측 사고:
  //   18:48:44 아이  맨날 똑같은 질문이니? 다른거 없어?
  //   18:48:47 케이  ... 그럼 우리 초성게임은 그만하고 다른 거 할까?
  //   18:49:10 아이  헐… 누가 그만하래? 새로운 문제를 내라는거지
  //
  // 발화 전체 일치만 보면 긴 문장을 놓친다. 여러 낱말로 된 구절은 사전 낱말이
  // 될 수 없으므로 **문장 끝에 오면** 잡는다(문장 어디서나 잡으면 화제 전환을 삼킨다).
  const long = extractUtteranceSignals("맨날 똑같은 질문이니? 다른거 없어?");
  assert.equal(long.hasPlayContinue, true, "긴 문장 안의 요청을 놓쳤다");
  assert.equal(long.hasPlayStop, false, "그만하자는 말이 아니다");

  for (const text of [
    "다른거 없어?",
    "새로운 문제 없어?",
    "딴 거 없나",
    "다른 문제 내줘",
    "새로운 질문 해줘",
  ]) {
    assert.equal(extractUtteranceSignals(text).hasPlayContinue, true, text);
  }
});

test("진행 지시 구절이 아이의 화제 전환을 삼키지 않는다", () => {
  // 처음에는 문장 어디서나 잡았는데, 그러면 아이가 다른 얘기를 꺼내는 말까지
  // "다음 문제 달라" 로 읽는다(리뷰 지적). 아이는 배고프다고 한 것이다.
  for (const text of [
    "다른 거 없어? 배고파",
    "새로운 질문 있어? 숙제가 뭐야?",
    "다른 거 없어? 엄마가 불러",
    "새로운 문제 없어? 화장실 갈래",
  ]) {
    assert.equal(
      extractUtteranceSignals(text).hasPlayContinue,
      false,
      `화제 전환을 진행 지시로 삼켰다: ${text}`
    );
  }

  // 문장 끝에 오면 여전히 진행 지시다.
  assert.equal(
    extractUtteranceSignals("맨날 똑같은 질문이니? 다른거 없어?").hasPlayContinue,
    true
  );

  // 아이는 재촉할 때 같은 말을 덧붙인다. 그건 여전히 같은 요청이다.
  for (const text of [
    "다른거 없어? 다른거!",
    "다른거 없어? 빨리",
    "새로운 문제 없어? 좀!",
    "다른 문제 내줘 빨리",
  ]) {
    assert.equal(extractUtteranceSignals(text).hasPlayContinue, true, text);
  }
});

test("진행 지시 구절이 사전 낱말을 삼키지 않는다", () => {
  // 끝말잇기에서 아이 낱말이 진행 지시로 먹히면 그 턴이 통째로 사라진다.
  const swallowed = [
    ...WORD_CHAIN_DICTIONARY.filter(({ word }) => extractUtteranceSignals(word).hasPlayContinue),
    ...WORD_POOL.filter(({ word }) => extractUtteranceSignals(word).hasPlayContinue),
  ].map(({ word }) => word);
  assert.deepEqual(swallowed, [], `진행 지시로 삼킨 낱말: ${swallowed.join(", ")}`);
});

test("실측: '정답이 뭐야?' 는 넌센스에서 정답 공개 요청이다", () => {
  // 실측 사고: 아이가 정답을 물었는데 일반 질문으로 흘러 넌센스 세션이 닫혔다.
  //   18:53:34 아이  정답이 뭐야?   → K 무응답, 세션 종료 18:53:44
  //   18:54:35 아이  헐… 왜 갑자기 "넌센스퀴즈" 종료 됬냐?
  for (const text of ["정답이 뭐야?", "답이 뭐야", "정답 뭐야", "답 알려줘"]) {
    assert.equal(
      classifyChildNonsenseUtterance(text, extractUtteranceSignals(text)),
      "REVEAL_ANSWER",
      text
    );
  }
});
