import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestedSkill, wantsRestart } from "./skillRequestResolution";

// 요청서 014 — 2026-08-18 23:55 Dev 실측 로그(김서아)에서 드러난 문제를 고정한다.

const CANDIDATES = [
  { skill: "CHOSUNG", aliases: ["초성게임", "초성 게임", "초성"] },
  { skill: "WORD_CHAIN", aliases: ["끝말잇기", "끝말 잇기", "끝말"] },
  { skill: "NONSENSE_QUIZ", aliases: ["넌센스퀴즈", "넌센스 퀴즈", "넌센스", "수수께끼"] },
] as const;

test("실측 사례: 초성게임을 불만하며 끝말잇기를 요청하면 끝말잇기다", () => {
  const resolved = resolveRequestedSkill(
    "너 초성 게임 못 하니까 초성 게임은 다시 개발 해 개판이야 끝말잇기나 하자",
    CANDIDATES
  );
  assert.equal(resolved?.skill, "WORD_CHAIN");
});

test("실측 사례: 다시 지적할 때도 끝말잇기로 해석한다", () => {
  const resolved = resolveRequestedSkill(
    "아니 내가 뭐라 그랬어 초성 게임 너 개판이니까 다시 개발 하라고 나는 지금 끝말잇기 하자 그랬잖아",
    CANDIDATES
  );
  assert.equal(resolved?.skill, "WORD_CHAIN");
});

test("요청 동사에 붙은 놀이를 고른다", () => {
  assert.equal(
    resolveRequestedSkill("넌센스 퀴즈 말고 초성게임 하자", CANDIDATES)?.skill,
    "CHOSUNG"
  );
  assert.equal(
    resolveRequestedSkill("초성게임 말고 넌센스 퀴즈 할래", CANDIDATES)?.skill,
    "NONSENSE_QUIZ"
  );
});

test("요청 동사가 없으면 나중에 언급된 놀이를 고른다", () => {
  const resolved = resolveRequestedSkill("초성게임, 끝말잇기", CANDIDATES);
  assert.equal(resolved?.skill, "WORD_CHAIN");
  assert.equal(resolved?.reason, "last_mention");
});

test("후보가 하나면 그대로 고른다", () => {
  const resolved = resolveRequestedSkill("초성게임 하자", [CANDIDATES[0]]);
  assert.equal(resolved?.skill, "CHOSUNG");
  assert.equal(resolved?.reason, "only_match");
});

test("빈 발화·후보 없음은 null", () => {
  assert.equal(resolveRequestedSkill("", CANDIDATES), null);
  assert.equal(resolveRequestedSkill("   ", CANDIDATES), null);
  assert.equal(resolveRequestedSkill("초성게임 하자", []), null);
});

test("전부 불만 맥락이면 그중에서라도 위치 규칙으로 고른다", () => {
  // 되묻기 판단은 상위 로직 몫이다. 여기서 null 을 돌려주면 놀이가 통째로 멈춘다.
  const resolved = resolveRequestedSkill("초성게임도 개판이고 끝말잇기도 개판이야", CANDIDATES);
  assert.ok(resolved);
  assert.equal(resolved?.skill, "WORD_CHAIN");
});

test("이름이 문장에 없어도(다른 신호로 매칭된 경우) 후보로 남는다", () => {
  const resolved = resolveRequestedSkill("그거 하자", [
    { skill: "CHOSUNG", aliases: ["초성게임"] },
    { skill: "WORD_CHAIN", aliases: ["끝말잇기"] },
  ]);
  assert.ok(resolved);
});

test("판을 새로 시작하자는 요청을 알아본다", () => {
  for (const text of ["다시 시작하자", "처음부터 하자", "새로 시작", "리셋해줘"]) {
    assert.equal(wantsRestart(text), true, text);
  }
  for (const text of ["끝말잇기 하자", "차표", "그만하자"]) {
    assert.equal(wantsRestart(text), false, text);
  }
});
