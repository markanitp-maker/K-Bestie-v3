// 013 §3-12 — 클라이언트에 내려보내는 activePlaySkillId 는 "이 턴이 끝난 뒤" 상태여야 한다.
//
// 2026-08-20 Dev 실측: 아이가 "끝말잇기 하자" 라고 입력한 턴의 응답 payload 가
// `activePlaySkillId: null` 이었는데 케이는 "좋아, 내가 먼저 시작할게. 새우!" 라고
// 게임을 시작했다. 엔진이 턴 **시작** 시점의 getActiveSession 결과를 그대로 내려보내서,
// 아직 세션이 없던 시작 턴에는 null 이 나갔다. 클라이언트는 그 값으로 키보드 강제를
// 켜므로, 시작 턴에는 강제가 걸리지 않고 한 턴 늦었다.

import assert from "node:assert/strict";
import test from "node:test";

import { resolveActiveSkillAfterTurn } from "./activeSkillAfterTurn";

test("013: 이 턴에 게임이 새로 시작되면 시작한 스킬을 내려보낸다", () => {
  const result = resolveActiveSkillAfterTurn({
    before: undefined, // 턴 시작 시점에는 세션이 없었다
    turnResult: { handled: true, ended: false, skillId: "WORD_CHAIN" },
  });

  assert.equal(result.activePlaySkillId, "WORD_CHAIN");
  assert.equal(result.hasActivePlaySession, true);
});

test("013: 이 턴에 게임이 끝났으면 활성 스킬은 없다", () => {
  const result = resolveActiveSkillAfterTurn({
    before: "WORD_CHAIN",
    turnResult: { handled: true, ended: true, skillId: "WORD_CHAIN" },
  });

  assert.equal(result.activePlaySkillId, undefined);
  assert.equal(result.hasActivePlaySession, false);
});

test("013: 종료가 시작보다 우선한다 — 한 턴에 켜고 끈 경우", () => {
  // 놀이 전환 요청처럼 스킬이 처리하면서 세션을 닫는 경우가 있다.
  const result = resolveActiveSkillAfterTurn({
    before: undefined,
    turnResult: { handled: true, ended: true, skillId: "NONSENSE_QUIZ" },
  });

  assert.equal(result.activePlaySkillId, undefined);
  assert.equal(result.hasActivePlaySession, false);
});

test("013: 진행 중인 게임의 평범한 턴은 그대로 유지된다", () => {
  const result = resolveActiveSkillAfterTurn({
    before: "CHOSUNG",
    turnResult: { handled: true, ended: false, skillId: "CHOSUNG" },
  });

  assert.equal(result.activePlaySkillId, "CHOSUNG");
  assert.equal(result.hasActivePlaySession, true);
});

test("013: 스킬이 처리하지 않은 턴은 턴 시작 상태를 그대로 둔다", () => {
  const active = resolveActiveSkillAfterTurn({
    before: "WORD_CHAIN",
    turnResult: { handled: false, ended: false },
  });
  assert.equal(active.activePlaySkillId, "WORD_CHAIN");
  assert.equal(active.hasActivePlaySession, true);

  const idle = resolveActiveSkillAfterTurn({
    before: undefined,
    turnResult: { handled: false, ended: false },
  });
  assert.equal(idle.activePlaySkillId, undefined);
  assert.equal(idle.hasActivePlaySession, false);
});

test("013: skillId 없이 handled 만 온 턴은 상태를 바꾸지 않는다", () => {
  const result = resolveActiveSkillAfterTurn({
    before: undefined,
    turnResult: { handled: true, ended: false },
  });

  assert.equal(result.activePlaySkillId, undefined);
  assert.equal(result.hasActivePlaySession, false);
});

test("013: 놀이 경로를 아예 타지 않은 턴(미션 등)은 턴 시작 상태를 그대로 둔다", () => {
  const result = resolveActiveSkillAfterTurn({ before: "CHOSUNG", turnResult: null });

  assert.equal(result.activePlaySkillId, "CHOSUNG");
  assert.equal(result.hasActivePlaySession, true);
});
