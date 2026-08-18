import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BehaviorEventInput } from "@/lib/analytics/logBehaviorEvent";
import type { PlaySkillModule } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";

let routePlaySkillTurn: typeof import("./skillRouter").routePlaySkillTurn;

let capturedEvents: BehaviorEventInput[] = [];
let mockLogBehaviorEvent = async (input: BehaviorEventInput) => {
  capturedEvents.push(input);
  return "inserted" as const;
};

mock.module("@/lib/analytics/logBehaviorEvent", {
  exports: {
    logBehaviorEvent: (input: BehaviorEventInput) => mockLogBehaviorEvent(input),
  },
});

test.before(async () => {
  const mod = await import("./skillRouter");
  routePlaySkillTurn = mod.routePlaySkillTurn;
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const defaultSignals: UtteranceSignals = {
  hasAchievement: false,
  hasConflict: false,
  hasPlayfulSilly: false,
  hasImaginative: false,
  hasMemoryRecallQuery: false,
  hasGeneralKnowledgeQuestion: false,
  hasNegativeEmotion: false,
  hasPositiveEmotion: false,
  hasPhysicalNeed: false,
  isVeryShortLowEffort: false,
  hasChosungGameStart: false,
  hasChosungAnswerAttempt: false,
  hasChosungHintRequest: false,
  hasWordChainGameStart: false,
  hasNonsenseGameStart: false,
  hasNonsenseAnswerAttempt: false,
  hasNonsenseHintRequest: false,
  hasPlayRequestWithoutTarget: false,
  hasGenericPlayAcceptance: false,
  hasPlayRejection: false,
  hasPlayStop: false,
};

function createMockDb(): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    single: () => Promise.resolve({ data: { family_id: "fam-777" }, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
    delete: () => chain,
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

test("7. 말로 시작한 경로 계측: 아이가 '끝말잇기 하자'로 시작하면 k_play_start 가 기록된다", async () => {
  capturedEvents = [];
  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기 게임",
    proposal: { label: "끝말잇기", shortDescription: "끝말잇기 하자!" },
    matchesDirectRequest: (_signals, utterance) => utterance.includes("끝말잇기"),
    getActiveSession: async () => null,
    start: async () => ({
      handled: true,
      instruction: "[끝말잇기] 시작합니다.",
    }),
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-100",
    chatSessionId: "session-200",
    gradeRaw: 3,
    utterance: "끝말잇기 하자",
    signals: { ...defaultSignals, hasWordChainGameStart: true },
    registry: [mockWordChainSkill],
  });

  assert.equal(result.handled, true);
  await flushMicrotasks();

  assert.equal(capturedEvents.length, 1);
  const event = capturedEvents[0];
  assert.equal(event.eventName, "k_play_start", "이벤트명은 k_play_start 여야 한다");
  assert.notEqual(event.eventName, "play_start", "게임참여 지표 play_start 와 달라야 한다");
  assert.equal(event.eventKey, "WORD_CHAIN", "eventKey 에 스킬 id 가 담겨야 한다");
  assert.equal(event.feature, "freechat", "feature 는 freechat 이어야 한다");
  assert.equal(event.route, "utterance", "route 는 utterance 여야 한다");
  assert.equal(event.childId, "child-100");
  assert.equal(event.sessionId, "session-200");
  assert.equal(event.familyId, "fam-777");
  assert.equal(event.playType, undefined, "playType 은 비워져 있어야 한다 (CHECK 제약 방어)");
});

test("8. 미시작 방어: start() 가 실패해(handled:false) 게임이 시작되지 않으면 기록하지 않는다", async () => {
  capturedEvents = [];
  const mockFailingSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    displayName: "끝말잇기",
    childFacingDescription: "끝말잇기 게임",
    proposal: { label: "끝말잇기", shortDescription: "끝말잇기 하자!" },
    matchesDirectRequest: (_signals, utterance) => utterance.includes("끝말잇기"),
    getActiveSession: async () => null,
    start: async () => ({
      handled: false,
    }),
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const result = await routePlaySkillTurn({
    db: createMockDb(),
    childId: "child-100",
    chatSessionId: "session-200",
    gradeRaw: 3,
    utterance: "끝말잇기 하자",
    signals: { ...defaultSignals, hasWordChainGameStart: true },
    registry: [mockFailingSkill],
  });

  assert.equal(result.handled, false);
  await flushMicrotasks();

  assert.equal(capturedEvents.length, 0, "start()가 실패한 경우 계측 이벤트가 기록되지 않아야 한다");
});
