import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isKPlayEnabled, isComicBookEnabled } from "./playAvailability";
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

test("1-1. isComicBookEnabled: 환경 및 탈출구 플래그 검증", async () => {
  // prod + 미설정 -> false
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_COMIC_BOOK_ENABLED: undefined }, () => {
    assert.equal(isComicBookEnabled(), false, "prod 환경에서는 기본적으로 비활성화");
  });

  // dev + 미설정 -> true
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "dev", NEXT_PUBLIC_COMIC_BOOK_ENABLED: undefined }, () => {
    assert.equal(isComicBookEnabled(), true, "dev 환경에서는 기본적으로 활성화");
  });

  // target 미설정 + 미설정 -> true
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: undefined, NEXT_PUBLIC_COMIC_BOOK_ENABLED: undefined }, () => {
    assert.equal(isComicBookEnabled(), true, "미설정 시 dev로 폴백되어 활성화");
  });

  // prod + "true" -> true
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_COMIC_BOOK_ENABLED: "true" }, () => {
    assert.equal(isComicBookEnabled(), true, "prod에서도 탈출구 env가 true면 활성화");
  });

  // dev + "false" -> false
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "dev", NEXT_PUBLIC_COMIC_BOOK_ENABLED: "false" }, () => {
    assert.equal(isComicBookEnabled(), false, "dev에서도 false면 비활성화 (긴급 차단)");
  });

  // prod + TRUE / ' true ' 등 대소문자/공백 허용
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_COMIC_BOOK_ENABLED: "TRUE" }, () => {
    assert.equal(isComicBookEnabled(), true, "대문자 TRUE 허용");
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_COMIC_BOOK_ENABLED: "  true  " }, () => {
    assert.equal(isComicBookEnabled(), true, "공백 포함 true 허용");
  });
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "dev", NEXT_PUBLIC_COMIC_BOOK_ENABLED: "  FALSE  " }, () => {
    assert.equal(isComicBookEnabled(), false, "공백 포함 FALSE 비활성화");
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

// --- 010 프로덕션 QA 반려: 놀이 요청 결정론 응답 6종 테스트 ---
import { K_PLAY_DISABLED_TEMPLATES, getPlayDisabledResponse } from "./playAvailability";
import { respond } from "../index";

function createMockDbForIntegration(): SupabaseClient {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    update: () => chain,
    insert: () => chain,
    delete: () => chain,
  };
  return {
    rpc: async () => ({ data: null, error: null }),
    from: () => chain,
  } as unknown as SupabaseClient;
}

test("010-1. 꺼짐 + '초성게임 하자' -> category === 'deterministic', 준비 중 안내 및 초성·낱말·문제 없음", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let aiCalled = false;
    const mockAi = {
      models: {
        generateContent: async () => {
          aiCalled = true;
          return { text: "AI가 생성한 텍스트" };
        },
      },
    } as any;

    const result = await respond(
      {
        mode: "FREE_CHAT",
        currentUtterance: "초성게임 하자",
        childId: "child-1",
        sessionId: "session-1",
      },
      {
        db: createMockDbForIntegration(),
        ai: mockAi,
        modelId: "test-model",
      }
    );

    assert.equal(aiCalled, false, "Gemini 호출 없이 결정론 응답이어야 함");
    assert.equal(result.category, "deterministic");
    assert.equal(result.action, "JUST_LISTEN");
    assert.equal(result.tokenIn, 0);
    assert.equal(result.tokenOut, 0);
    assert.ok(result.text.includes("준비"), "문구에 준비 중 뜻이 포함되어야 함");
    assert.ok(!/[ㄱ-ㅎ]{2,}/.test(result.text), "초성 자음이 없어야 함");
    assert.ok(!result.text.includes("문제"), "문제가 없어야 함");
  });
});

test("010-2. 꺼짐 + '끝말잇기 하자' / '넌센스 퀴즈 하자' / '우리 놀자' -> 모두 결정론 안내 반환", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    const utterances = ["끝말잇기 하자", "넌센스 퀴즈 하자", "우리 놀자"];

    for (const utterance of utterances) {
      let aiCalled = false;
      const mockAi = {
        models: {
          generateContent: async () => {
            aiCalled = true;
            return { text: "AI 응답" };
          },
        },
      } as any;

      const result = await respond(
        {
          mode: "FREE_CHAT",
          currentUtterance: utterance,
          childId: "child-1",
          sessionId: "session-1",
        },
        {
          db: createMockDbForIntegration(),
          ai: mockAi,
          modelId: "test-model",
        }
      );

      assert.equal(aiCalled, false, `${utterance}는 Gemini 호출 없이 결정론 응답이어야 함`);
      assert.equal(result.category, "deterministic");
      assert.equal(result.action, "JUST_LISTEN");
      assert.equal(result.tokenIn, 0);
      assert.ok(result.text.includes("준비"));
    }
  });
});

test("010-3. 꺼짐 + hasGenericPlayAcceptance 만 true ('좋아') -> 결정론 분기를 타지 않는다", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let aiCalled = false;
    const mockAi = {
      models: {
        generateContent: async () => {
          aiCalled = true;
          return { text: "응, 나도 좋아!" };
        },
      },
    } as any;

    const result = await respond(
      {
        mode: "FREE_CHAT",
        currentUtterance: "좋아",
        childId: "child-1",
        sessionId: "session-1",
      },
      {
        db: createMockDbForIntegration(),
        ai: mockAi,
        modelId: "test-model",
      }
    );

    assert.equal(aiCalled, true, "단독 '좋아'는 결정론 놀이 분기를 타지 않고 AI를 호출해야 함");
    assert.notEqual(result.category, "deterministic");
  });
});

test("010-4. 꺼짐 + 놀이와 무관한 발화 -> 평소대로 (분기 안 탐)", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "prod", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let aiCalled = false;
    const mockAi = {
      models: {
        generateContent: async () => {
          aiCalled = true;
          return { text: "축구 정말 재미있었겠다!" };
        },
      },
    } as any;

    const result = await respond(
      {
        mode: "FREE_CHAT",
        currentUtterance: "오늘 학교에서 축구했어",
        childId: "child-1",
        sessionId: "session-1",
      },
      {
        db: createMockDbForIntegration(),
        ai: mockAi,
        modelId: "test-model",
      }
    );

    assert.equal(aiCalled, true, "놀이 무관 발화는 AI 호출로 진행되어야 함");
    assert.notEqual(result.category, "deterministic");
  });
});

test("010-5. 켜짐(dev) + '초성게임 하자' -> 기존대로 게임이 시작된다 (Dev 회귀 방어)", async () => {
  await withEnv({ NEXT_PUBLIC_SUPABASE_TARGET: "dev", NEXT_PUBLIC_K_PLAY_ENABLED: undefined }, async () => {
    let aiCalled = false;
    let capturedInstruction = "";
    const mockAi = {
      models: {
        generateContent: async (args: any) => {
          aiCalled = true;
          capturedInstruction = args.config?.systemInstruction ?? "";
          return { text: "초성게임 시작할게! ㅂㄴㄴ 맞춰봐." };
        },
      },
    } as any;

    const result = await respond(
      {
        mode: "FREE_CHAT",
        currentUtterance: "초성게임 하자",
        childId: "child-1",
        sessionId: "session-1",
      },
      {
        db: createMockDbForIntegration(),
        ai: mockAi,
        modelId: "test-model",
      }
    );

    assert.equal(aiCalled, true, "dev 환경에서는 초성게임 시작 시 AI가 호출되어야 함");
    assert.notEqual(result.category, "deterministic", "dev에서는 결정론 차단 분기를 타지 않아야 함");
    assert.ok(
      capturedInstruction.includes("초성") || capturedInstruction.includes("놀이"),
      "프롬프트에 초성게임 지침이 포함되어야 함"
    );
  });
});

test("010-6. 연속 호출 시 같은 문구만 반복되지 않는다", () => {
  assert.ok(K_PLAY_DISABLED_TEMPLATES.length >= 5, "5개 이상의 템플릿 문구가 있어야 함");

  const history: string[] = [];
  const selectedList: string[] = [];

  for (let i = 0; i < 5; i++) {
    const selected = getPlayDisabledResponse(history);
    assert.ok(!history.includes(selected), `최근 이력에 있는 문구가 반복되지 않아야 함 (선택: ${selected})`);
    history.push(selected);
    selectedList.push(selected);
  }

  const uniqueSelected = new Set(selectedList);
  assert.equal(uniqueSelected.size, 5, "5회 연속 호출 시 5개의 서로 다른 문구가 선택되어야 함");
});

