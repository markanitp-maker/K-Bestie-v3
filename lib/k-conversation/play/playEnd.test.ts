import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaySkillModule, PlaySkillEndInput } from "./skillTypes";
import { executeSkillEnd } from "./playEnd";
import { getPendingPlayProposal, setPendingPlayProposal, clearAllPendingProposalsForTest } from "./pendingProposalStore";

function createMockDb(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function createMockSkill(params: {
  id: string;
  displayName: string;
  activeSessionId?: string | null;
  keepSessionAfterEnd?: boolean;
  throwOnEnd?: boolean;
  onEnd?: (input: PlaySkillEndInput) => void;
}): PlaySkillModule {
  let activeId = params.activeSessionId ?? null;

  return {
    id: params.id as any,
    displayName: params.displayName,
    childFacingDescription: `${params.displayName} 설명`,
    proposal: {
      label: params.displayName,
      shortDescription: `${params.displayName} 설명`,
    },
    matchesDirectRequest: () => false,
    getActiveSession: async () => (activeId ? { id: activeId } : null),
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async (input: PlaySkillEndInput) => {
      params.onEnd?.(input);
      if (params.throwOnEnd) {
        throw new Error("Simulated end error");
      }
      if (!params.keepSessionAfterEnd) {
        activeId = null;
      }
    },
  };
}

test("executeSkillEnd: 활성 세션 없음 -> ok:true, ended:false, end() 호출 안 함", async () => {
  clearAllPendingProposalsForTest();
  const db = createMockDb();
  let endCalled = false;

  const mockSkill = createMockSkill({
    id: "CHOSUNG",
    displayName: "초성게임",
    activeSessionId: null,
    onEnd: () => {
      endCalled = true;
    },
  });

  const result = await executeSkillEnd({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    registry: [mockSkill],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ended, false);
  assert.equal(endCalled, false, "활성 스킬이 없으면 end()를 호출하지 않아야 함");
});

test("executeSkillEnd: 활성 세션 있음 -> end() 호출, ok:true, ended:true, proposal 정리", async () => {
  clearAllPendingProposalsForTest();
  const db = createMockDb();
  let receivedEndInput: PlaySkillEndInput | null = null;

  // 제안 상태 미리 설정
  await setPendingPlayProposal({
    chatSessionId: "chat_456",
    childId: "child_123",
    offeredSkills: ["WORD_CHAIN"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  });

  const mockSkill = createMockSkill({
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    activeSessionId: "session_word_chain_999",
    onEnd: (input) => {
      receivedEndInput = input;
    },
  });

  const result = await executeSkillEnd({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    reason: "USER_CLICKED_STOP",
    registry: [mockSkill],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ended, true);
  assert.equal(result.skillId, "WORD_CHAIN");
  assert.ok(receivedEndInput);
  assert.equal(receivedEndInput!.reason, "USER_CLICKED_STOP");
  assert.equal(receivedEndInput!.childId, "child_123");
  assert.equal(receivedEndInput!.chatSessionId, "chat_456");

  // pending proposal이 실제로 지워졌는지 확인 (§3-12)
  const remainingProposal = await getPendingPlayProposal("chat_456");
  assert.equal(remainingProposal, null, "놀이 종료 시 pending proposal이 정리되어야 함");
});

test("executeSkillEnd: Hard Guard - end() 호출 후에도 getActiveSession이 남아있으면 ok:false 반환 (끝난 척 금지)", async () => {
  clearAllPendingProposalsForTest();
  const db = createMockDb();

  // end()가 불려도 세션을 종료하지 않는 고장난 스킬 시뮬레이션
  const brokenSkill = createMockSkill({
    id: "NONSENSE_QUIZ",
    displayName: "넌센스 퀴즈",
    activeSessionId: "session_broken_111",
    keepSessionAfterEnd: true,
  });

  const result = await executeSkillEnd({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    registry: [brokenSkill],
  });

  assert.equal(result.ok, false);
  assert.equal(result.ended, false);
  assert.equal(result.skillId, "NONSENSE_QUIZ");
  assert.match(result.error ?? "", /Active play session still exists/);
});

test("executeSkillEnd: end() 호출 중 예외 발생 시 격리 처리 (ok:false)", async () => {
  clearAllPendingProposalsForTest();
  const db = createMockDb();

  const crashingSkill = createMockSkill({
    id: "CHOSUNG",
    displayName: "초성게임",
    activeSessionId: "session_crash_222",
    throwOnEnd: true,
  });

  const result = await executeSkillEnd({
    db,
    childId: "child_123",
    chatSessionId: "chat_456",
    registry: [crashingSkill],
  });

  assert.equal(result.ok, false);
  assert.equal(result.ended, false);
  assert.equal(result.skillId, "CHOSUNG");
  assert.match(result.error ?? "", /Failed while invoking skill end/);
});
