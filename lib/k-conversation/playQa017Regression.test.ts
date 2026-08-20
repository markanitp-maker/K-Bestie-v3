import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChosungRepeatResult } from "./chosungGame/gameOrchestrator";
import { CHOSUNG_SKILL } from "./play/chosungSkill";
import { WORD_POOL } from "./chosungGame/wordPool";
import { WORD_CHAIN_DICTIONARY } from "./wordChain/dictionaryIndex";
import { extractUtteranceSignals } from "./utteranceSignals";

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
