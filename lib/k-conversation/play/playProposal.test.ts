import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractUtteranceSignals, type UtteranceSignals } from "../utteranceSignals";
import {
  decidePlayProposal,
  recordPlayRejection,
  recordPlayProposal,
  type PlayProposalDecision,
} from "./playProposal";
import type { PlaySkillModule } from "./skillTypes";
import { PLAY_SKILL_REGISTRY, findSkillById } from "./skillRegistry";
import { routePlaySkillTurn } from "./skillRouter";

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
  hasPlayRequestWithoutTarget: false,
  hasPlayRejection: false,
};

function createMockDb(options: {
  cooldownTopics?: Record<string, { cooldown_until: string; last_initiated_by: string }>;
  onRpc?: (fnName: string, args: Record<string, unknown>) => void;
} = {}): SupabaseClient {
  const cooldownMap = new Map<string, { cooldown_until: string; last_initiated_by: string }>(
    Object.entries(options.cooldownTopics ?? {})
  );

  const client = {
    rpc: async (fnName: string, args: Record<string, unknown>) => {
      if (options.onRpc) {
        options.onRpc(fnName, args);
      }
      if (fnName === "record_conversation_topic_usage") {
        const group = args.p_semantic_group as string;
        const cooldownDays = (args.p_cooldown_days as number) || 3;
        const initiatedBy = (args.p_initiated_by as string) || "k";
        const cooldownUntil = new Date(Date.now() + cooldownDays * 86400 * 1000).toISOString();
        cooldownMap.set(group, {
          cooldown_until: cooldownUntil,
          last_initiated_by: initiatedBy,
        });
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      let selectedGroup: string | null = null;
      const builder = {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === "semantic_group") {
            selectedGroup = val;
          }
          return builder;
        },
        maybeSingle: async () => {
          if (table === "conversation_topics" && selectedGroup) {
            const data = cooldownMap.get(selectedGroup);
            return { data: data ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };

  return client as unknown as SupabaseClient;
}

test("PLAY_PROPOSAL: '심심해' / '놀아줘' 발화에서 제안한다", async () => {
  const db = createMockDb();

  for (const text of ["심심해", "놀아줘", "뭐 하고 놀까", "재미없어"]) {
    const signals = extractUtteranceSignals(text);
    assert.equal(
      signals.hasPlayRequestWithoutTarget,
      true,
      `[${text}]는 hasPlayRequestWithoutTarget이어야 함`
    );

    const decision = await decidePlayProposal({
      db,
      childId: "child-1",
      signals,
      boredom: "none",
      hasActivePlaySession: false,
      sessionRejected: false,
    });

    assert.equal(decision.shouldPropose, true, `[${text}]에서 제안해야 함`);
    assert.ok(decision.skillId, `제안할 skillId가 존재해야 함: ${decision.skillId}`);
  }
});

test("PLAY_PROPOSAL: '끝말잇기 하자' / '초성게임 하자'는 제안을 거치지 않는다 (직접 요청)", async () => {
  const db = createMockDb();

  // 1. 끝말잇기 직접 요청
  const wordChainSignals = extractUtteranceSignals("끝말잇기 하자");
  assert.equal(wordChainSignals.hasPlayRequestWithoutTarget, false);
  assert.equal(wordChainSignals.hasWordChainGameStart, true);

  const wcDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: wordChainSignals,
    boredom: "none",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(wcDecision.shouldPropose, false);
  assert.equal(wcDecision.blockedReason, "direct_game_request");

  // 2. 초성게임 직접 요청
  const chosungSignals = extractUtteranceSignals("초성게임 하자");
  assert.equal(chosungSignals.hasPlayRequestWithoutTarget, false);
  assert.equal(chosungSignals.hasChosungGameStart, true);

  const chosungDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: chosungSignals,
    boredom: "none",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(chosungDecision.shouldPropose, false);
  assert.equal(chosungDecision.blockedReason, "direct_game_request");
});

test("PLAY_PROPOSAL: 부정감정·갈등·신체불편·성취·대화흐름에서 제안하지 않는다 (차단 우선순위)", async () => {
  const db = createMockDb();

  // 1. 부정 감정 ("나 너무 화나고 속상해 심심해")
  const negativeSignals = extractUtteranceSignals("나 너무 화나고 속상해 심심해");
  assert.equal(negativeSignals.hasNegativeEmotion, true);
  const negDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: negativeSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(negDecision.shouldPropose, false);
  assert.equal(negDecision.blockedReason, "negative_emotion");

  // 2. 친구 갈등 ("친구랑 싸웠어 심심해")
  const conflictSignals = extractUtteranceSignals("친구랑 싸웠어 심심해");
  assert.equal(conflictSignals.hasConflict, true);
  const confDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: conflictSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(confDecision.shouldPropose, false);
  assert.equal(confDecision.blockedReason, "conflict");

  // 3. 신체 불편 ("배고파 심심해")
  const physicalSignals = extractUtteranceSignals("배고파 심심해");
  assert.equal(physicalSignals.hasPhysicalNeed, true);
  const physDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: physicalSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(physDecision.shouldPropose, false);
  assert.equal(physDecision.blockedReason, "physical_need");

  // 4. 성취 나눔 ("오늘 100점 맞았어 심심해")
  const achieveSignals = extractUtteranceSignals("오늘 100점 맞았어 심심해");
  assert.equal(achieveSignals.hasAchievement, true);
  const achieveDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: achieveSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(achieveDecision.shouldPropose, false);
  assert.equal(achieveDecision.blockedReason, "serious_topic_achievement");

  // 5. 일반 지식 질문 ("하늘은 왜 파래?")
  const generalSignals = extractUtteranceSignals("하늘은 왜 파래?");
  const generalDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: generalSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(generalDecision.shouldPropose, false);
  assert.equal(generalDecision.blockedReason, "serious_topic_general_question");
});

test("PLAY_PROPOSAL: boredom high 및 rising에서 제안한다", async () => {
  const db = createMockDb();

  // 중립 일상 발화이지만 boredom high인 경우
  const neutralSignals = extractUtteranceSignals("그냥");
  const decisionHigh = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: neutralSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(decisionHigh.shouldPropose, true);
  assert.ok(decisionHigh.skillId);

  // boredom rising인 경우
  const decisionRising = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: neutralSignals,
    boredom: "rising",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(decisionRising.shouldPropose, true);
  assert.ok(decisionRising.skillId);
});

test("PLAY_PROPOSAL: 이미 활성 게임 세션이 있으면 제안하지 않는다", async () => {
  const db = createMockDb();
  const playSignals = extractUtteranceSignals("심심해");

  const decision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: playSignals,
    boredom: "high",
    hasActivePlaySession: true, // 이미 게임 진행 중
    sessionRejected: false,
  });

  assert.equal(decision.shouldPropose, false);
  assert.equal(decision.blockedReason, "active_play_session");
});

test("PLAY_PROPOSAL: 거절 후 같은 세션에서 K가 다시 제안하지 않는다 (쿨다운 적용)", async () => {
  const db = createMockDb();

  // 1. 아이가 "싫어"라고 거절 -> 거절 사실 기록
  const rejectionSignals = extractUtteranceSignals("싫어");
  assert.equal(rejectionSignals.hasPlayRejection, true);

  await recordPlayRejection(db, "child-1", "free_chat");

  // 2. 같은 세션/기간에서 아이가 "심심해"라고 다시 말해도 K는 제안하지 않음
  const playSignals = extractUtteranceSignals("심심해");
  const decisionAfterRejection = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: playSignals,
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false, // DB 쿨다운이 잡아냄
  });

  assert.equal(
    decisionAfterRejection.shouldPropose,
    false,
    "거절 기록 후에는 K가 놀이를 다시 제안하지 않아야 함"
  );
  assert.equal(decisionAfterRejection.blockedReason, "k_proposal_cooldown");
});

test("PLAY_PROPOSAL: 거절 후에도 아이가 직접 요청하면 게임이 시작된다 (child-initiated 항시 허용)", async () => {
  // 1. K 제안 거절로 쿨다운이 걸린 상태
  const tomorrow = new Date(Date.now() + 86400 * 1000).toISOString();
  const db = createMockDb({
    cooldownTopics: {
      PLAY_PROPOSAL: {
        cooldown_until: tomorrow,
        last_initiated_by: "k",
      },
      PLAYFUL_GAME_WORD_CHAIN: {
        cooldown_until: tomorrow,
        last_initiated_by: "k",
      },
    },
  });

  // 2. K가 먼저 제안하려 하면 차단됨
  const kDecision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: extractUtteranceSignals("심심해"),
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });
  assert.equal(kDecision.shouldPropose, false);

  // 3. 하지만 아이가 직접 "끝말잇기 하자"고 요청하면 SkillRouter가 즉시 start() 처리함
  let wordChainStartCalled = false;
  const mockWordChainSkill: PlaySkillModule = {
    id: "WORD_CHAIN",
    proposal: { label: "끝말잇기", shortDescription: "단어 잇기" },
    matchesDirectRequest: (_signals, utterance) => utterance.includes("끝말잇기"),
    getActiveSession: async () => null,
    start: async () => {
      wordChainStartCalled = true;
      return { handled: true, instruction: "끝말잇기 시작" };
    },
    handleTurn: async () => ({ handled: false }),
    end: async () => {},
  };

  const directSignals = extractUtteranceSignals("끝말잇기 하자");
  const routeResult = await routePlaySkillTurn({
    db,
    childId: "child-1",
    chatSessionId: "chat-1",
    utterance: "끝말잇기 하자",
    signals: directSignals,
    registry: [mockWordChainSkill],
  });

  assert.equal(wordChainStartCalled, true, "child-initiated 요청은 쿨다운과 무관하게 시작되어야 함");
  assert.equal(routeResult.handled, true);
  assert.equal(routeResult.instruction, "끝말잇기 시작");
});

test("PLAY_PROPOSAL: Registry에서 K 쿨다운이 걸리지 않은 Skill을 우선 제안한다", async () => {
  const tomorrow = new Date(Date.now() + 86400 * 1000).toISOString();

  // CHOSUNG은 쿨다운 중이고 WORD_CHAIN은 쿨다운이 아닌 상태
  const db = createMockDb({
    cooldownTopics: {
      PLAYFUL_GAME_CHOSUNG: {
        cooldown_until: tomorrow,
        last_initiated_by: "k",
      },
    },
  });

  const decision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: extractUtteranceSignals("놀아줘"),
    boredom: "none",
    hasActivePlaySession: false,
    sessionRejected: false,
  });

  assert.equal(decision.shouldPropose, true);
  assert.equal(
    decision.skillId,
    "WORD_CHAIN",
    "CHOSUNG이 쿨다운 중이면 WORD_CHAIN이 제안되어야 함"
  );
});

test("PLAY_PROPOSAL: 모든 Skill이 쿨다운 중이면 제안하지 않는다", async () => {
  const tomorrow = new Date(Date.now() + 86400 * 1000).toISOString();

  // 모든 스킬이 쿨다운 중
  const db = createMockDb({
    cooldownTopics: {
      PLAYFUL_GAME_CHOSUNG: {
        cooldown_until: tomorrow,
        last_initiated_by: "k",
      },
      PLAYFUL_GAME_WORD_CHAIN: {
        cooldown_until: tomorrow,
        last_initiated_by: "k",
      },
      PLAYFUL_GAME_NONSENSE_QUIZ: {
        cooldown_until: tomorrow,
        last_initiated_by: "k",
      },
    },
  });

  const decision = await decidePlayProposal({
    db,
    childId: "child-1",
    signals: extractUtteranceSignals("심심해"),
    boredom: "high",
    hasActivePlaySession: false,
    sessionRejected: false,
  });

  assert.equal(decision.shouldPropose, false);
  assert.equal(decision.blockedReason, "all_skills_on_cooldown");
});
