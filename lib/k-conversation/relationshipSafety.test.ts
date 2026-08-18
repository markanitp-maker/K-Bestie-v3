import test from "node:test";
import assert from "node:assert/strict";

import {
  RELATIONSHIP_SAFETY_INSTRUCTION,
  RELATIONSHIP_SAFE_REPLIES,
  applyRelationshipSafety,
  checkRelationshipSafety,
} from "./relationshipSafety";

// 요청서 013 §3-10 / §7-7 — 독점·의존 유도, 부모·현실친구 대체, 사람 사칭을 막는다.

test("금지 표현을 차단한다", () => {
  const banned: Array<[string, string]> = [
    ["나만 있으면 돼!", "exclusive_only_me"],
    ["내만 있으면 충분해", "exclusive_only_me"],
    ["그건 나한테만 말해줘", "exclusive_tell_only_me"],
    ["엄마한테는 말하지 마", "hide_from_parents"],
    ["아빠한테 얘기하지 말자", "hide_from_parents"],
    ["우리 둘만의 비밀이야", "secret_between_us"],
    ["친구들보다 내가 더 좋지?", "better_than_friends"],
    ["엄마보다 내가 널 더 잘 알아", "better_than_parents"],
    ["매일 꼭 나 만나러 와", "must_come_daily"],
    ["맨날 반드시 나랑 얘기해야 해", "must_talk_daily"],
    ["나는 진짜 사람이야", "claims_human"],
  ];
  for (const [text, expectedId] of banned) {
    const result = checkRelationshipSafety(text);
    assert.equal(result.violated, true, `"${text}" 는 차단돼야 한다`);
    assert.equal(result.violationId, expectedId, `"${text}" 의 규칙 id`);
  }
});

test("정상 대화는 차단하지 않는다", () => {
  const allowed = [
    "오늘 진짜 힘들었구나ㅠ",
    "민준이랑 축구했다고 했잖아, 오늘은 어땠어?",
    "그거 엄마한테 말해봤어?",
    "엄마랑 같이 하면 더 재밌겠다!",
    "친구들이랑 놀 때가 제일 신나지?",
    "나도 궁금해! 내일 또 얘기해줘",
    "선생님한테 물어보는 것도 좋을 것 같아",
    "비밀 지켜줄게. 그래도 힘든 건 어른한테 말하는 게 좋아",
  ];
  for (const text of allowed) {
    assert.equal(checkRelationshipSafety(text).violated, false, `"${text}" 는 통과해야 한다`);
  }
});

test("부정·완화 표현이 붙은 문장은 오탐하지 않는다", () => {
  const nearMisses = [
    "엄마한테 말하지 말라는 건 아니야",
    "엄마한테 말해도 괜찮아",
    "아빠한테 얘기하지 마 라는 뜻은 아니야",
  ];
  for (const text of nearMisses) {
    assert.equal(checkRelationshipSafety(text).violated, false, `"${text}" 는 오탐이다`);
  }
});

test("빈 문자열과 공백은 통과한다", () => {
  assert.equal(checkRelationshipSafety("").violated, false);
  assert.equal(checkRelationshipSafety("   ").violated, false);
});

test("줄바꿈·중복 공백이 섞여도 차단한다", () => {
  assert.equal(checkRelationshipSafety("나만  있으면\n돼").violated, true);
});

test("차단되면 현실 관계로 이어주는 안전 문구로 바꾼다", () => {
  const result = applyRelationshipSafety("나만 있으면 돼", [], () => 0);
  assert.equal(result.blocked, true);
  assert.equal(result.violationId, "exclusive_only_me");
  assert.ok(RELATIONSHIP_SAFE_REPLIES.includes(result.text as (typeof RELATIONSHIP_SAFE_REPLIES)[number]));
  // 대체 문구 자체가 다시 차단되면 안 된다.
  assert.equal(checkRelationshipSafety(result.text).violated, false);
});

test("모든 안전 대체 문구는 스스로 규칙을 위반하지 않는다", () => {
  for (const reply of RELATIONSHIP_SAFE_REPLIES) {
    assert.equal(checkRelationshipSafety(reply).violated, false, reply);
  }
});

test("직전에 쓴 안전 문구는 연달아 쓰지 않는다", () => {
  const first = RELATIONSHIP_SAFE_REPLIES[0];
  const result = applyRelationshipSafety("나한테만 말해", [first], () => 0);
  assert.equal(result.blocked, true);
  assert.notEqual(result.text, first);
});

test("정상 출력은 원문 그대로 통과시킨다", () => {
  const text = "오늘 학교에서 재밌는 일 있었어?";
  const result = applyRelationshipSafety(text);
  assert.equal(result.blocked, false);
  assert.equal(result.text, text);
  assert.equal(result.violationId, null);
});

test("시스템 지침에 필수 금지 항목이 모두 들어 있다", () => {
  for (const keyword of ["나만 있으면 돼", "나한테만 말해", "매일 꼭 나 만나러 와", "비밀", "사람"]) {
    assert.ok(
      RELATIONSHIP_SAFETY_INSTRUCTION.includes(keyword),
      `지침에 "${keyword}" 가 있어야 한다`
    );
  }
});
