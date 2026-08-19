// 요청서 015 — 아이가 짜증냈다고 놀이를 꺼버리지 않는다.
//
// 2026-08-19 김서아 Dev 로그:
//   아이: "아 진짜 졸라 짜증나네"                       → 초성게임이 꺼졌다
//   아이: "지금 방금 니 멋대로 KR 놀이가 꺼져버렸어 지금 우리 초성 게임 하고 있었는데
//          갑자기 이렇게 꺼져버리면 어떡하냐"
// 아이가 짜증내는 대상은 대부분 놀이 자체(케이가 못 알아들어서)인데,
// 그 짜증이 놀이를 꺼서 아이를 더 답답하게 만들었다.

import assert from "node:assert/strict";
import test from "node:test";

import { routePlaySkillTurn } from "./skillRouter";
import type { PlaySkill } from "./playSkillTypes";

const makeHarness = () => {
  const calls: string[] = [];
  const skill = {
    id: "chosung",
    displayName: "초성게임",
    proposal: { label: "초성게임" },
    getActiveSession: async () => ({ id: "sess-1" }),
    handleTurn: async () => ({ handled: true, instruction: "[초성게임] 계속" }),
    start: async () => ({ id: "sess-1" }),
    end: async () => {
      calls.push("end");
    },
  } as unknown as PlaySkill;
  return { calls, registry: [skill] as unknown as readonly PlaySkill[] };
};

const baseInput = (signals: Record<string, boolean>, registry: readonly PlaySkill[]) => ({
  db: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  } as never,
  childId: "child-1",
  chatSessionId: "chat-1",
  utterance: "아 진짜 짜증나네",
  signals: signals as never,
  registry,
});

test("015: 부정 감정만으로는 활성 놀이를 끝내지 않는다", async () => {
  const { calls, registry } = makeHarness();
  await routePlaySkillTurn(baseInput({ hasNegativeEmotion: true }, registry));
  assert.ok(!calls.includes("end"), "짜증냈다고 놀이를 꺼버렸다");
});

test("015: 다툼·신체 신호도 놀이를 끝내지 않는다", async () => {
  for (const signal of ["hasConflict", "hasPhysicalNeed"]) {
    const { calls, registry } = makeHarness();
    await routePlaySkillTurn(baseInput({ [signal]: true }, registry));
    assert.ok(!calls.includes("end"), `${signal} 로 놀이가 꺼졌다`);
  }
});

test("015: 아이가 그만하자고 하면 끝낸다", async () => {
  const { calls, registry } = makeHarness();
  await routePlaySkillTurn(baseInput({ hasPlayStop: true }, registry));
  assert.ok(calls.includes("end"), "그만하자고 했는데 안 끝났다");
});

test("015: 아이가 거절해도 끝낸다", async () => {
  const { calls, registry } = makeHarness();
  await routePlaySkillTurn(baseInput({ hasPlayRejection: true }, registry));
  assert.ok(calls.includes("end"), "거절했는데 안 끝났다");
});
