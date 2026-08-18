import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isKPlayEnabled } from "./playAvailability";
import { executeSkillSelection, buildPlaySkillsCatalogDto } from "./playSelection";
import { routePlaySkillTurn } from "./skillRouter";
import { decidePlayProposal } from "./playProposal";
import { executeSkillEnd } from "./playEnd";
import { detectFakeGameplay, FAKE_GAMEPLAY_FALLBACK_TEXT } from "./fakeGameplayDetector";
import { PLAY_SKILL_REGISTRY } from "./skillRegistry";
import type { PlaySkillModule } from "./skillTypes";
import type { UtteranceSignals } from "../utteranceSignals";

function withEnv(
  envOverrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const originalEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(envOverrides)) {
    originalEnv[key] = process.env[key];
  }

  return (async () => {
    try {
      for (const [key, value] of Object.entries(envOverrides)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await fn();
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  })();
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
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
    delete: () => chain,
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

test("1. isKPlayEnabled: 환경 및 탈출구 플래그 검증", async () => {
  // prod 환경 -> false
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, () => {
    assert.equal(isKPlayEnabled(), false, "prod 환경에서는 기본적으로 비활성화");
  });

  // dev 환경 -> true
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "dev", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, () => {
    assert.equal(isKPlayEnabled(), true, "dev 환경에서는 기본적으로 활성화");
  });

  // 미설정(폴백 dev) -> true
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: undefined, NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, () => {
    assert.equal(isKPlayEnabled(), true, "미설정 시 dev로 폴백되어 활성화");
  });

  // prod + NEXT_PUBLIC_K_PLAY_ENABLED=true -> true
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: "true" }, () => {
    assert.equal(isKPlayEnabled(), true, "prod에서도 탈출구 env가 true면 활성화");
  });

  // prod + TRUE / ' true ' 등 대소문자/공백 허용
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: "TRUE" }, () => {
    assert.equal(isKPlayEnabled(), true, "대문자 TRUE 허용");
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: "  true  " }, () => {
    assert.equal(isKPlayEnabled(), true, "공백 포함 true 허용");
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: "false" }, () => {
    assert.equal(isKPlayEnabled(), false, "false는 비활성화 유지");
  });
});

test("2. 꺼짐 -> executeSkillSelection 이 ok:false 이고 세션을 만들지 않는다", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let startCalled = false;
    const testSkill: PlaySkillModule = {
      id: "CHOSUNG",
      displayName: "초성퀴즈",
      childFacingDescription: "초성 퀴즈",
      proposal: { label: "초성퀴즈", shortDescription: "초성퀴즈 하자" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => null,
      start: async () => {
        startCalled = true;
        return { handled: true };
      },
      handleTurn: async () => ({ handled: false }),
      end: async () => {},
    };

    const result = await executeSkillSelection({
      db: createMockDb(),
      childId: "child-1",
      chatSessionId: "session-1",
      skillId: "CHOSUNG",
      registry: [testSkill],
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "k_play_disabled");
    assert.equal(startCalled, false, "start가 호출되지 않아야 함");
  });
});

test("3. 꺼짐 -> routePlaySkillTurn 이 handled:false (직접 요청 발화로도)", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let startCalled = false;
    let turnCalled = false;
    const testSkill: PlaySkillModule = {
      id: "WORD_CHAIN",
      displayName: "끝말잇기",
      childFacingDescription: "끝말잇기 게임",
      proposal: { label: "끝말잇기", shortDescription: "끝말잇기 하자" },
      matchesDirectRequest: () => true,
      getActiveSession: async () => null,
      start: async () => {
        startCalled = true;
        return { handled: true, instruction: "끝말잇기 시작" };
      },
      handleTurn: async () => {
        turnCalled = true;
        return { handled: true };
      },
      end: async () => {},
    };

    const result = await routePlaySkillTurn({
      db: createMockDb(),
      childId: "child-1",
      chatSessionId: "session-1",
      utterance: "끝말잇기 하자",
      signals: { ...defaultSignals, hasWordChainGameStart: true },
      registry: [testSkill],
    });

    assert.equal(result.handled, false);
    assert.equal(startCalled, false);
    assert.equal(turnCalled, false);
  });
});

test("4. 꺼짐 -> buildPlaySkillsCatalogDto 가 빈 목록", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, () => {
    const catalog = buildPlaySkillsCatalogDto(PLAY_SKILL_REGISTRY);
    assert.deepEqual(catalog.skills, []);
    assert.equal(catalog.activeSkillId, null);
  });
});

test("5. 꺼짐 -> decidePlayProposal 이 제안하지 않음", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    const decision = await decidePlayProposal({
      db: createMockDb(),
      childId: "child-1",
      signals: { ...defaultSignals, hasPlayRequestWithoutTarget: true },
      boredom: "high",
      hasActivePlaySession: false,
      sessionRejected: false,
    });

    assert.equal(decision.shouldPropose, false);
    assert.equal(decision.blockedReason, "k_play_disabled");
  });
});

test("6. 꺼짐 + 케이가 게임 진행 응답 -> detectFakeGameplay 로 차단된다", () => {
  // 케이가 환각으로 초성 퀴즈 문제를 내거나 끝말잇기를 진행하는 발화
  const fakeUtterance = "좋아! 초성 퀴즈를 시작할게. 문제는 'ㅂㄴㄴ'야! 맞춰봐.";
  const verdict = detectFakeGameplay(fakeUtterance);
  assert.equal(verdict.isFake, true);
  assert.ok(verdict.kinds.includes("CHOSUNG") || verdict.kinds.includes("QUIZ"));
});

test("7. 켜짐(dev) -> 위 전부 기존대로 동작한다 (Dev 회귀 방어)", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "dev", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    // 1) isKPlayEnabled
    assert.equal(isKPlayEnabled(), true);

    // 2) buildPlaySkillsCatalogDto
    const catalog = buildPlaySkillsCatalogDto(PLAY_SKILL_REGISTRY);
    assert.ok(catalog.skills.length >= 3);
    assert.ok(catalog.skills.some((s) => s.id === "CHOSUNG"));

    // 3) decidePlayProposal
    const decision = await decidePlayProposal({
      db: createMockDb(),
      childId: "child-1",
      signals: { ...defaultSignals, hasPlayRequestWithoutTarget: true },
      boredom: "high",
      hasActivePlaySession: false,
      sessionRejected: false,
    });
    assert.equal(decision.shouldPropose, true);
    assert.ok(decision.skillId);

    // 4) routePlaySkillTurn
    let startCalled = false;
    const testSkill: PlaySkillModule = {
      id: "WORD_CHAIN",
      displayName: "끝말잇기",
      childFacingDescription: "끝말잇기 게임",
      proposal: { label: "끝말잇기", shortDescription: "끝말잇기 하자" },
      matchesDirectRequest: () => true,
      getActiveSession: async () => null,
      start: async () => {
        startCalled = true;
        return { handled: true, instruction: "끝말잇기 시작" };
      },
      handleTurn: async () => ({ handled: false }),
      end: async () => {},
    };

    const routeResult = await routePlaySkillTurn({
      db: createMockDb(),
      childId: "child-1",
      chatSessionId: "session-1",
      utterance: "끝말잇기 하자",
      signals: { ...defaultSignals, hasWordChainGameStart: true },
      registry: [testSkill],
    });
    assert.equal(routeResult.handled, true);
    assert.equal(startCalled, true);
  });
});

test("8. executeSkillEnd 는 꺼져 있어도 동작한다", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let endCalled = false;
    let sessionCount = 1;
    const testSkill: PlaySkillModule = {
      id: "CHOSUNG",
      displayName: "초성퀴즈",
      childFacingDescription: "초성 퀴즈",
      proposal: { label: "초성퀴즈", shortDescription: "초성퀴즈 하자" },
      matchesDirectRequest: () => false,
      getActiveSession: async () => {
        if (sessionCount > 0) {
          return { id: "active-session-1" } as never;
        }
        return null;
      },
      start: async () => ({ handled: true }),
      handleTurn: async () => ({ handled: false }),
      end: async () => {
        endCalled = true;
        sessionCount = 0;
      },
    };

    const result = await executeSkillEnd({
      db: createMockDb(),
      childId: "child-1",
      chatSessionId: "session-1",
      registry: [testSkill],
    });

    assert.equal(result.ok, true);
    assert.equal(result.ended, true);
    assert.equal(endCalled, true, "꺼져 있어도 executeSkillEnd 는 정상 호출되어야 한다");
  });
});
