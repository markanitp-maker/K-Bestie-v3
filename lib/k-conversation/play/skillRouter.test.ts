import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordKPlayEventInput, KPlayEventName } from "./kPlayAnalytics";
import type { PlaySkillModule } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";
import { routePlaySkillTurn } from "./skillRouter";

let capturedEvents: { eventName: KPlayEventName; input: RecordKPlayEventInput }[] = [];

const mockRecordEvent = (eventName: KPlayEventName, input: RecordKPlayEventInput) => {
  capturedEvents.push({ eventName, input });
};

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
  hasChosungAnswerRequest: false,
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
    recordEvent: mockRecordEvent,
  });

  assert.equal(result.handled, true);
  await flushMicrotasks();

  assert.equal(capturedEvents.length, 1);
  const event = capturedEvents[0];
  assert.equal(event.eventName, "k_play_start", "이벤트명은 k_play_start 여야 한다");
  assert.equal(event.input.skillId, "WORD_CHAIN", "skillId 에 스킬 id 가 담겨야 한다");
  assert.equal(event.input.route, "utterance", "route 는 utterance 여야 한다");
  assert.equal(event.input.childId, "child-100");
  assert.equal(event.input.chatSessionId, "session-200");
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
    recordEvent: mockRecordEvent,
  });

  assert.equal(result.handled, false);
  await flushMicrotasks();

  assert.equal(capturedEvents.length, 0, "start()가 실패한 경우 계측 이벤트가 기록되지 않아야 한다");
});
