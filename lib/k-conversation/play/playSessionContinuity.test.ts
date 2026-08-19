// 요청서 015 — 놀이는 아이가 그만하자고 할 때까지 이어진다.
//
// 2026-08-19 김서아 Dev 로그에서 아이가 반복해서 요구한 것:
//   "케이 놀이 선택 했으면 케이 놀이 끝날 때까지는 놀이에만 집중해"
//   "지금 방금 니 멋대로 KR 놀이가 꺼져버렸어"

import assert from "node:assert/strict";
import test from "node:test";

import { buildSystemInstruction, type ResponseGeneratorInput } from "../responseGenerator";

const baseInput: ResponseGeneratorInput = {
  mode: "FREE_CHAT",
  action: "FOLLOW_UP",
  corePersonaFragment: "[K Core Persona]",
  gradePersonaFragment: "[Grade Persona]",
  memoryFragment: "[Memory]",
  currentUtterance: "아 진짜 짜증나네",
  recentHistory: [],
};

test("015: 놀이가 켜져 있는데 스킬이 처리 못 한 턴에는 놀이로 돌아오라고 지시한다", () => {
  const prompt = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: true,
    playSkillHandled: false,
    activePlaySkillName: "초성게임",
  });

  assert.ok(prompt.includes("[놀이 이어가기 지침]"), "놀이 이어가기 지침이 없다");
  assert.ok(prompt.includes("초성게임"), "진행 중인 놀이 이름이 없다");
  assert.ok(/그만하자고 하기 전에는 놀이를 끝내지 마/.test(prompt), "임의 종료 금지가 없다");
  assert.ok(/다른 놀이로 바꾸자고 먼저 제안하지 마/.test(prompt), "무단 전환 금지가 없다");
  assert.ok(/새 화제로 대화를 넓히지 마/.test(prompt), "화제 이탈 금지가 없다");
  // 아이 말을 무시하라는 뜻이 되면 안 된다.
  assert.ok(/짧은 반응 한 문장/.test(prompt), "아이 말에 반응하라는 지시가 없다");
  // Dev QA 에서 케이가 공감만 하고 놀이로 안 돌아왔다. 끝맺음을 강제한다.
  assert.ok(/반드시 이 부분으로 끝나야 해/.test(prompt), "놀이 복귀 끝맺음 강제가 없다");
});

test("015: 놀이 이어가기 턴에도 케이가 문제를 지어내지는 않는다", () => {
  const prompt = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: true,
    playSkillHandled: false,
    activePlaySkillName: "끝말잇기",
  });
  assert.ok(/문제·정답·힌트·제시 단어를 지어내지는 마/.test(prompt), "환각 방지 지침이 빠졌다");
});

test("015: 놀이가 꺼져 있으면 기존 금지 지침이 그대로 나온다(회귀 없음)", () => {
  const prompt = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: false,
    playSkillHandled: false,
  });
  assert.ok(prompt.includes("[놀이 진행 금지 지침]"));
  assert.ok(!prompt.includes("[놀이 이어가기 지침]"));
});

test("015: 스킬이 이번 턴을 처리했으면 진행 규칙이 그대로 나온다(회귀 없음)", () => {
  const prompt = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: true,
    playSkillHandled: true,
  });
  assert.ok(prompt.includes("[놀이 진행 규칙]"));
  assert.ok(!prompt.includes("[놀이 이어가기 지침]"));
});

test("015: 미션 중에는 놀이 이어가기 지침이 나오지 않는다", () => {
  const prompt = buildSystemInstruction({
    ...baseInput,
    mode: "MISSION",
    hasActivePlaySession: true,
    playSkillHandled: false,
  });
  assert.ok(prompt.includes("[미션 중 놀이 진행 및 제안 절대 금지]"));
  assert.ok(!prompt.includes("[놀이 이어가기 지침]"));
});

test("015: 놀이 중에는 '하고 싶은 이야기를 하도록 함께해' 지침이 나오지 않는다", () => {
  // 이 문장이 남아 있으면 "놀이로 돌아와라"와 정면으로 부딪힌다.
  // Dev QA 실측: 아이가 급식 얘기를 하자 케이가 급식으로 따라가고 게임에 안 돌아왔다.
  const playing = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: true,
    playSkillHandled: false,
    activePlaySkillName: "초성게임",
  });
  assert.ok(
    !playing.includes("아이가 하고 싶은 이야기를 하도록 그냥 함께해"),
    "놀이 중인데 화제를 따라가라는 지침이 남아 있다"
  );
  assert.ok(playing.includes("놀이에서 벗어나지 않게 잡아줘"), "놀이 모드 지침이 없다");
});

test("015: 놀이 중이 아니면 자유대화 기본 지침이 그대로다(회귀 없음)", () => {
  const normal = buildSystemInstruction({ ...baseInput, hasActivePlaySession: false });
  assert.ok(normal.includes("아이가 하고 싶은 이야기를 하도록 그냥 함께해"));
  assert.ok(!normal.includes("놀이에서 벗어나지 않게 잡아줘"));
});

test("015: 스킬이 처리한 턴에도 놀이 모드 지침이 적용된다", () => {
  const handled = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: true,
    playSkillHandled: true,
  });
  assert.ok(!handled.includes("아이가 하고 싶은 이야기를 하도록 그냥 함께해"));
});

test("015: 케이가 먼저 '그만할까?'라고 묻지 않도록 지시한다", () => {
  // Dev QA 실측: 아이가 짜증내자 케이가 "그럼 우리 초성게임은 여기서 그만할까?"라고
  // 먼저 물었다. 아이는 그만하자고 한 적이 없다.
  const prompt = buildSystemInstruction({
    ...baseInput,
    hasActivePlaySession: true,
    playSkillHandled: false,
    activePlaySkillName: "초성게임",
  });
  assert.ok(/네가 먼저 놀이를 접자고 묻지 마/.test(prompt), "선제 종료 제안 금지가 없다");
});
