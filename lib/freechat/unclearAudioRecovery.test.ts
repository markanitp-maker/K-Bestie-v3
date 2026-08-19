// 요청서 014 — "못 들었어" 반복 대신 들은 대로 되묻는다.

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ECHO_BACK_ATTEMPTS,
  MAX_ECHO_BACK_LENGTH,
  buildUnclearAudioRecovery,
  countConsecutiveUnclearTurns,
  isRepeatedUnclearTurn,
} from "./unclearAudioRecovery";

test("014: 들린 말이 있으면 그대로 되묻는다", () => {
  const result = buildUnclearAudioRecovery({ childUtterance: "죽을개" });
  assert.ok(result.text);
  assert.ok(result.text!.includes("죽을개"), "들은 말을 되돌려주지 않았다");
  assert.ok(result.text!.includes("맞니") || result.text!.includes("맞아"), "확인 질문이 없다");
});

test("014: 되묻는 문장에 '못 들었어' 계열이 들어가지 않는다", () => {
  const result = buildUnclearAudioRecovery({ childUtterance: "초고추장" });
  assert.ok(result.text);
  for (const forbidden of ["못 들었", "안 들렸", "놓쳐"]) {
    assert.ok(!result.text!.includes(forbidden), `무시하는 표현이 남아 있다: ${forbidden}`);
  }
});

test("014: 두 번째부터는 아이가 이미 답했다는 걸 인정한다", () => {
  const first = buildUnclearAudioRecovery({ childUtterance: "기차" });
  const second = buildUnclearAudioRecovery({
    childUtterance: "기차",
    recentKTexts: ["미안, 무슨 말인지 잘 안 들렸어."],
  });
  assert.notEqual(first.text, second.text, "반복인데 같은 문장을 냈다");
  assert.ok(second.text!.includes("미안"), "반복 상황을 인정하지 않았다");
  assert.ok(second.text!.includes("기차"));
});

test("014: 직전 K 발화가 되묻기였어도 반복으로 본다", () => {
  assert.equal(isRepeatedUnclearTurn(['내가 "기차"라고 들었는데, 이게 맞니?']), true);
  assert.equal(isRepeatedUnclearTurn(["미안해, 잘 안 들렸어. 다시 한 번 말해줄래?"]), true);
  assert.equal(isRepeatedUnclearTurn(["오늘 학교 어땠어?"]), false);
  assert.equal(isRepeatedUnclearTurn([]), false);
});

test("014: 아무것도 안 들렸으면 되묻지 않는다(기존 템플릿으로 넘긴다)", () => {
  for (const utterance of ["", "   ", "...", "?!"]) {
    assert.equal(
      buildUnclearAudioRecovery({ childUtterance: utterance }).text,
      null,
      `되물을 게 없는데 되물었다: ${JSON.stringify(utterance)}`
    );
  }
});

test("014: 길게 말한 경우는 통째로 되묻지 않는다", () => {
  // "내가 '오늘 학교에서 어쩌고 저쩌고'라고 들었는데 맞니?" 는 오히려 어색하다.
  const long = "오늘 학교에서 친구랑 놀다가 뭐 했는지 기억이 잘 안 나는데";
  assert.ok(long.length > MAX_ECHO_BACK_LENGTH);
  assert.equal(buildUnclearAudioRecovery({ childUtterance: long }).text, null);
});

test("014: 경계 길이까지는 되묻는다", () => {
  const atLimit = "가".repeat(MAX_ECHO_BACK_LENGTH);
  assert.ok(buildUnclearAudioRecovery({ childUtterance: atLimit }).text);
  const overLimit = "가".repeat(MAX_ECHO_BACK_LENGTH + 1);
  assert.equal(buildUnclearAudioRecovery({ childUtterance: overLimit }).text, null);
});

// ── 리뷰 반려 대응 (2026-08-19) ───────────────────────────────

test("014: '이게 맞아?' 도 반복 판정에 포함된다(핑퐁 방지)", () => {
  // 리뷰 HIGH: 2회차 문구가 정규식에 안 걸려 3회차에 1회차 문구로 되돌아갔다.
  assert.equal(isRepeatedUnclearTurn(['아, 미안! 내가 "기차"라고 들었는데, 이게 맞아?']), true);
  assert.equal(countConsecutiveUnclearTurns([
    "미안해, 잘 안 들렸어. 다시 한 번 말해줄래?",
    '내가 "기차"라고 들었는데, 이게 맞니?',
    '아, 미안! 내가 "기차"라고 들었는데, 이게 맞아?',
  ]), 3);
});

test("014: 알아들은 턴이 끼면 연속 카운트가 끊긴다", () => {
  assert.equal(countConsecutiveUnclearTurns([
    '내가 "기차"라고 들었는데, 이게 맞니?',
    "오, 기차 좋아하는구나! 어떤 기차 좋아해?",
  ]), 0);
});

test("014: 두 번 되물어도 안 통하면 되묻기를 멈추고 화제를 넘긴다", () => {
  const result = buildUnclearAudioRecovery({
    childUtterance: "기차",
    recentKTexts: [
      '내가 "기차"라고 들었는데, 이게 맞니?',
      '아, 미안! 내가 "기차"라고 들었는데, 이게 맞아?',
    ],
  });
  assert.ok(result.text);
  // 무시하지는 않는다 — 들은 말은 그대로 돌려준다.
  assert.ok(result.text!.includes("기차"), "들은 말을 버렸다");
  assert.ok(/다른 얘기|먼저 할까/.test(result.text!), "탈출 경로가 없다");
  assert.equal(MAX_ECHO_BACK_ATTEMPTS, 2);
});

test("014: 되묻기가 3회차에 1회차 문구로 되돌아가지 않는다", () => {
  const texts: string[] = [];
  let recent: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const result = buildUnclearAudioRecovery({ childUtterance: "기차", recentKTexts: recent });
    texts.push(result.text!);
    recent = [...recent, result.text!];
  }
  assert.equal(new Set(texts).size, 3, `같은 문구로 진동했다: ${JSON.stringify(texts)}`);
});
