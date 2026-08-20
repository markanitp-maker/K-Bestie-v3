// 2026-08-20 대표님 Dev QA(김서아, 13:13:31) — 끝말잇기가 살아 있는데 케이가
// "그건 아직 잘 기억이 안 나는데" 로 받아 대화가 막혔다. 세션 row 의 ended_at 은
// 13:13:38 이었으니 그 순간 놀이는 분명히 살아 있었다.
//
// 뿌리는 활성 세션 조회가 DB 오류를 삼키고 null 을 돌려준 것이었다. 그러면
// "세션이 없다" 와 "못 읽었다" 가 구별되지 않아, 읽기 실패 한 번에
//   (1) 놀이 스킬이 턴을 처리하지 못하고
//   (2) 자유대화용 기억 회피 문구가 나가고
//   (3) activePlaySkillId 가 null 로 내려가 클라이언트가 놀이 UI 를 닫는다.
//
// 그래서 실패는 삼키지 않고 구별한다. 다만 호출부 대부분은 예전처럼 null 이어야
// 한다 — STT 힌트나 세션 시작 경로에서 던지면 일시적 오류가 500 으로 번진다.

import assert from "node:assert/strict";
import test from "node:test";

import { getActiveWordChainSession } from "../wordChain/sessionManager";
import { getActiveNonsenseSession } from "../nonsenseQuiz/sessionManager";
import { PlaySessionLookupError } from "./skillTypes";
import { WORD_CHAIN_SKILL } from "../wordChain/wordChainSkill";
import { NONSENSE_QUIZ_SKILL } from "../nonsenseQuiz/nonsenseQuizSkill";
import { pickFabricatedRecallFallbackText } from "../memory/fabricatedRecallDetector";
import { resolveActiveSkill } from "./activeSkillCoordinator";
import { routePlaySkillTurn } from "./skillRouter";
import {
  setPendingPlayProposal,
  getPendingPlayProposal,
  clearAllPendingProposalsForTest,
} from "./pendingProposalStore";
import { executeSkillEnd } from "./playEnd";
import { executeSkillSelection } from "./playSelection";
import type { PlaySkillModule } from "./skillTypes";
import { extractUtteranceSignals } from "../utteranceSignals";

/** 놀이와 무관한 평범한 발화의 신호. */
function buildSignals() {
  return extractUtteranceSignals("오늘 뭐 했어?");
}

import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST 체인 중 조회 경로만 흉내내는 최소 스텁 타입. */
interface QueryChainStub {
  select: () => QueryChainStub;
  eq: () => QueryChainStub;
  is: () => QueryChainStub;
  order: () => QueryChainStub;
  limit: () => QueryChainStub;
  maybeSingle: () => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/** maybeSingle 이 돌려줄 값만 바꿔 끼우는 스텁 DB. */
function stubDb(
  maybeSingle: QueryChainStub["maybeSingle"]
): SupabaseClient {
  const chain: QueryChainStub = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle,
  };
  // 스텁은 조회 경로만 구현한다. 테스트가 그 경로만 지나므로 여기서 좁힌다.
  return { from: () => chain } as unknown as SupabaseClient;
}

/** 조회에서 DB 오류를 돌려주는 스텁. */
function failingDb(): SupabaseClient {
  return stubDb(async () => ({
    data: null,
    error: { message: "read timeout" },
  }));
}

/** 활성 세션이 없다고 정상 응답하는 스텁. */
function emptyDb(): SupabaseClient {
  return stubDb(async () => ({ data: null, error: null }));
}

test("기본값은 예전과 같다 — 조회 실패를 삼키고 null 을 준다", async () => {
  // STT 힌트·세션 시작 경로가 이 동작에 의존한다. 여기서 던지면 500 이 된다.
  assert.equal(await getActiveWordChainSession(failingDb(), "c1"), null);
  assert.equal(await getActiveNonsenseSession(failingDb(), "c1"), null);
});

test("throwOnError 를 주면 조회 실패를 던진다", async () => {
  await assert.rejects(
    () => getActiveWordChainSession(failingDb(), "c1", { throwOnError: true }),
    PlaySessionLookupError
  );
  await assert.rejects(
    () => getActiveNonsenseSession(failingDb(), "c1", { throwOnError: true }),
    PlaySessionLookupError
  );
});

test("세션이 정말 없으면 throwOnError 여도 던지지 않고 null 이다", async () => {
  // 실패와 부재를 뒤집어 놓으면 이번엔 반대 방향으로 놀이가 깨진다.
  assert.equal(
    await getActiveWordChainSession(emptyDb(), "c1", { throwOnError: true }),
    null
  );
  assert.equal(
    await getActiveNonsenseSession(emptyDb(), "c1", { throwOnError: true }),
    null
  );
});

test("스킬 모듈도 throwOnError 를 그대로 전달한다", async () => {
  // 스킬 모듈이 한 번 더 삼키면 엔진 프로브는 실패를 볼 수 없다.
  assert.equal(await WORD_CHAIN_SKILL.getActiveSession(failingDb(), "c1"), null);
  await assert.rejects(() =>
    WORD_CHAIN_SKILL.getActiveSession(failingDb(), "c1", { throwOnError: true })
  );

  assert.equal(await NONSENSE_QUIZ_SKILL.getActiveSession(failingDb(), "c1"), null);
  await assert.rejects(() =>
    NONSENSE_QUIZ_SKILL.getActiveSession(failingDb(), "c1", { throwOnError: true })
  );
});

test("놀이 중 대체 문구에는 기억 회피 표현이 없다", () => {
  // 엔진은 hasActivePlaySession || playSessionLookupFailed 로 이 함수를 부른다.
  // 실측 문구("그건 아직 잘 기억이 안 나는데")가 놀이 중에 나가면 벽이 된다.
  const inPlay = pickFabricatedRecallFallbackText([], {
    hasActivePlaySession: true,
  });
  assert.ok(!/기억이 (안 나|잘 안)/.test(inPlay), `놀이 중 문구가 아니다: ${inPlay}`);
});

test("코디네이터는 조회 실패를 lookupFailed 로 알린다", async () => {
  // 여기서 실패를 삼키면 라우터가 "놀이 없음" 으로 보고 활성 턴을 처리하지 않는다.
  const failed = await resolveActiveSkill(failingDb(), "c1");
  assert.equal(failed.skill, null);
  assert.equal(failed.lookupFailed, true, "조회 실패가 드러나야 한다");

  const empty = await resolveActiveSkill(emptyDb(), "c1");
  assert.equal(empty.skill, null);
  assert.equal(empty.lookupFailed, false, "정말 없는 것과 섞이면 안 된다");
});

test("라우터는 조회 실패를 sessionLookupFailed 로 실어 보낸다", async () => {
  const result = await routePlaySkillTurn({
    db: failingDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "오늘 뭐 했어?",
    signals: buildSignals(),
  });
  // 평범한 대화는 자유대화가 받는다. 다만 "놀이 없음" 으로 단정하지는 않는다.
  assert.equal(result.handled, false);
  assert.equal(
    result.sessionLookupFailed,
    true,
    "handled:false 가 '놀이 없음' 으로 읽히면 안 된다"
  );
});

test("종료 경로는 조회 실패를 '이미 끝남' 으로 오인하지 않는다", async () => {
  // 실패를 삼키면 활성 스킬이 null 로 와서 ok:true(이미 정리됨) 가 된다.
  // 그러면 아이가 "그만" 이라고 했는데 세션이 남아 다음 턴에 놀이가 되살아난다.
  const failed = await executeSkillEnd({
    db: failingDb(),
    childId: "c1",
    chatSessionId: "s1",
  });
  assert.equal(failed.ok, false, "종료를 확정하지 못했으면 성공이 아니다");
  assert.equal(failed.ended, false);

  // 정말 활성 세션이 없으면 예전처럼 성공(이미 정리됨)이다.
  const empty = await executeSkillEnd({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
  });
  assert.equal(empty.ok, true, "세션이 없는 것은 오류가 아니다");
  assert.equal(empty.ended, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2차 리뷰에서 나온 세 갈래. 모두 "끝난 척" 의 변형이다.
// 조회 실패는 '놀이 없음' 이 아니고, end() 실패는 '종료됨' 이 아니다.
// ─────────────────────────────────────────────────────────────────────────────

/** 방금 갱신된 세션. 시각이 없으면 coordinator 가 stale 로 보고 정리한다. */
function freshSession(id: string) {
  const now = new Date().toISOString();
  return { id, updatedAt: now, startedAt: now };
}

/** 지정한 동작만 바꿔 끼우는 최소 스킬 모듈. */
function stubSkill(overrides: Partial<PlaySkillModule>): PlaySkillModule {
  return {
    id: "CHOSUNG",
    displayName: "초성게임",
    childFacingDescription: "초성 맞히기",
    proposal: { label: "초성", shortDescription: "설명" },
    matchesDirectRequest: () => false,
    getActiveSession: async () => null,
    start: async () => ({ handled: true }),
    handleTurn: async () => ({ handled: true }),
    end: async () => {},
    ...overrides,
  } as unknown as PlaySkillModule;
}

test('"그만" 인데 조회가 실패하면 종료를 확정하지 않는다', async () => {
  // 조회 실패로 activeSkill 이 null 이면 "끝낼 게 없었다" 로 읽힌다. 그러면 엔진이
  // 실패 플래그를 풀고 UI 를 닫는데 세션은 남아, 다음 턴에 놀이가 되살아난다.
  const result = await routePlaySkillTurn({
    db: failingDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "그만",
    signals: extractUtteranceSignals("그만"),
  });
  assert.notEqual(result.ended, true, "끝났다고 단정해선 안 된다");
  assert.equal(result.sessionLookupFailed, true, "상태 미확정을 알려야 한다");
  // 처음 이 테스트는 handled:false 를 단정했다. 그건 결함을 계약으로 고정한 것이었다
  // (리뷰 지적, 2026-08-20) — 아이는 "그만" 이라고 했는데 아무 답도 못 받는다.
  assert.equal(result.handled, true, "아이에게 답을 줘야 한다");
  assert.ok(
    result.deterministicText && result.deterministicText.length > 0,
    "아이용 문구가 있어야 한다"
  );
  assert.ok(
    !/error|fail|session|lookup/i.test(result.deterministicText ?? ""),
    `아이용 문구에 내부 용어가 있다: ${result.deterministicText}`
  );
});

test('"그만" 에서 end() 가 실패하면 ended:true 로 답하지 않는다', async () => {
  // 여기서 ended:true 를 주면 클라이언트는 놀이 UI 를 닫지만 세션은 남는다.
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "그만",
    signals: extractUtteranceSignals("그만"),
    registry: [
      stubSkill({
        getActiveSession: async () => freshSession("sess-1"),
        end: async () => {
          throw new Error("end failed");
        },
      }),
    ],
  });
  assert.notEqual(result.ended, true, "종료 실패인데 끝났다고 답했다");
  assert.equal(result.sessionLookupFailed, true, "상태 미확정을 알려야 한다");
  assert.equal(result.handled, true, "아이에게 답을 줘야 한다");
  assert.ok(
    result.deterministicText && result.deterministicText.length > 0,
    "아이용 문구가 있어야 한다"
  );
});

test("한 스킬을 찾았어도 못 읽은 스킬이 있으면 lookupFailed 를 숨기지 않는다", async () => {
  // 숨기면 executeSkillEnd 가 찾은 하나만 끝내고 "전부 끝났다" 고 답한다.
  const resolution = await resolveActiveSkill(emptyDb(), "c1", {
    registry: [
      stubSkill({ id: "CHOSUNG", getActiveSession: async () => freshSession("sess-1") }),
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
      }),
    ],
  });
  assert.ok(resolution.skill, "찾은 스킬은 그대로 돌려줘야 한다");
  assert.equal(
    resolution.lookupFailed,
    true,
    "못 읽은 스킬이 있으면 전부 확인한 것이 아니다"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3차 리뷰 지적. 여기까지가 "끝난 척" 의 바닥이다.
// 라우터만 고쳐도 소용없었다 — 스킬의 end() 와 그 아래 DB 함수가 오류를 삼켰다.
// ─────────────────────────────────────────────────────────────────────────────

/** UPDATE 는 오류를 돌려주지만 조회는 세션을 찾아 주는 스텁. */
function endFailsDb(sessionId: string): SupabaseClient {
  const now = new Date().toISOString();
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({
      data: { id: sessionId, updated_at: now, started_at: now },
      error: null,
    }),
    // UPDATE 체인의 끝. 종료가 실패한 상황이다.
    update: () => ({
      eq: () => ({
        eq: async () => ({ error: { message: "update rejected" } }),
        then: undefined,
      }),
    }),
  });
  return { from: () => chain } as unknown as SupabaseClient;
}

test("스킬 end() 는 DB 종료 실패를 삼키지 않는다", async () => {
  // 예전에는 endWordChainSession / endNonsenseSession 이 error 를 로그만 찍고
  // 정상 반환했다. 그러면 라우터가 endSucceeded = true 로 보고 "끝났다" 고 답한다.
  // 세션은 남아 있으니 다음 턴에 놀이가 되살아난다.
  await assert.rejects(
    () =>
      WORD_CHAIN_SKILL.end({
        db: endFailsDb("wc-1"),
        childId: "c1",
        chatSessionId: "s1",
        reason: "EXPLICIT_STOP",
      }),
    "끝말잇기 종료 실패가 전파되어야 한다"
  );

  await assert.rejects(
    () =>
      NONSENSE_QUIZ_SKILL.end({
        db: endFailsDb("nq-1"),
        childId: "c1",
        chatSessionId: "s1",
        reason: "EXPLICIT_STOP",
      }),
    "넌센스 종료 실패가 전파되어야 한다"
  );
});

test("executeSkillEnd 는 못 읽은 스킬을 재확인하고, 남아 있으면 성공이라 하지 않는다", async () => {
  // 첫 조회에서 A 는 활성, B 는 실패. A 를 끝내도 B 가 남아 있을 수 있다.
  // 재확인 없이 ok:true 를 주면 "전부 끝났다" 는 거짓말이 된다.
  let bReadAttempts = 0;
  const endedA: string[] = [];

  const skillA = stubSkill({
    id: "CHOSUNG",
    // 끝내면 실제로 사라져야 한다. 안 그러면 하드 가드에서 먼저 걸려
    // 재확인 단계까지 오지 못한다.
    getActiveSession: async () =>
      endedA.length > 0 ? null : freshSession("a-1"),
    end: async () => {
      endedA.push("A");
    },
  });
  const skillB = stubSkill({
    id: "WORD_CHAIN",
    getActiveSession: async () => {
      bReadAttempts += 1;
      // 첫 조회는 실패, 재확인에서는 살아 있는 세션이 드러난다.
      if (bReadAttempts <= 1) throw new Error("read timeout");
      return freshSession("b-1");
    },
    end: async () => {
      throw new Error("B 종료 실패");
    },
  });

  const result = await executeSkillEnd({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    registry: [skillA, skillB],
  });

  assert.deepEqual(endedA, ["A"], "찾은 세션은 끝냈어야 한다");
  assert.ok(bReadAttempts >= 2, "못 읽은 스킬을 다시 확인해야 한다");
  assert.equal(result.ok, false, "남은 세션이 있는데 성공이라 답했다");
  assert.equal(result.ended, false);
});

test('스킬 안의 "그만" 처리도 종료 실패를 끝난 척하지 않는다', async () => {
  // 라우터가 아니라 스킬 내부(handleTurn)에서 "그만" 을 만나는 경로다.
  // 여기서도 예전에는 ended:true 를 그냥 돌려줬다.
  const result = await WORD_CHAIN_SKILL.handleTurn({
    db: endFailsDb("wc-2"),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: 2,
    utterance: "그만",
    signals: extractUtteranceSignals("그만"),
  });

  assert.notEqual(result.ended, true, "종료 실패인데 끝났다고 답했다");
  // 케이는 침묵하지 않는다 — 아이에게 무슨 일인지 말한다.
  assert.ok(
    result.deterministicText && result.deterministicText.length > 0,
    "아이에게 알리는 말이 있어야 한다"
  );
  assert.ok(
    !/error|fail|session/i.test(result.deterministicText ?? ""),
    `아이용 문구에 내부 용어가 있다: ${result.deterministicText}`
  );
});

test("놀이를 바꿀 때 종료가 실패해도 낱말로 채점하지 않는다", async () => {
  // 010 실측: 아이가 "다른 놀이" 를 세 번 말했는데 케이가 그걸 낱말로 처리했다.
  // 전환 중 종료가 실패하면 예전에는 기존 놀이의 handleTurn 으로 되돌아갔다.
  let turnScored = false;
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "넌센스 퀴즈 하자",
    signals: extractUtteranceSignals("넌센스 퀴즈 하자"),
    registry: [
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => freshSession("wc-9"),
        end: async () => {
          throw new Error("end failed");
        },
        handleTurn: async () => {
          turnScored = true;
          return { handled: true, skillId: "WORD_CHAIN" };
        },
      }),
      stubSkill({
        id: "NONSENSE_QUIZ",
        matchesDirectRequest: () => true,
      }),
    ],
  });

  assert.equal(turnScored, false, "전환 요청을 낱말로 채점했다");
  assert.notEqual(result.ended, true);
  assert.ok(
    result.deterministicText && result.deterministicText.length > 0,
    "못 바꿨다고 아이에게 말해야 한다"
  );
});

test("직접 놀이 요청도 조회 실패면 새로 시작하지 않는다", async () => {
  // 모르는 채로 시작하면 못 읽은 세션과 새 세션이 동시에 살아난다.
  let started = false;
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "초성게임 하자",
    signals: extractUtteranceSignals("초성게임 하자"),
    registry: [
      stubSkill({
        id: "CHOSUNG",
        matchesDirectRequest: () => true,
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
        start: async () => {
          started = true;
          return { handled: true, instruction: "시작" };
        },
      }),
    ],
  });

  assert.equal(started, false, "조회를 못 했는데 새 놀이를 시작했다");
  assert.equal(result.sessionLookupFailed, true);
  assert.ok(
    result.deterministicText && result.deterministicText.length > 0,
    "아이에게 답을 줘야 한다"
  );
});

test("모달 놀이 선택도 조회 실패면 새로 시작하지 않는다", async () => {
  let started = false;
  const result = await executeSkillSelection({
    db: failingDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: 3,
    skillId: "CHOSUNG",
    registry: [
      stubSkill({
        id: "CHOSUNG",
        // 조회가 실패하는 상황을 스킬 쪽에서 재현한다.
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
        start: async () => {
          started = true;
          return { handled: true };
        },
      }),
    ],
  });

  assert.equal(started, false, "조회를 못 했는데 새 놀이를 시작했다");
  assert.equal(result.ok, false);
});

test("ended:true 와 미확정을 동시에 내보내지 않는다", async () => {
  // 이 조합이 오면 엔진은 둘 중 하나를 반드시 무시하고, 어느 쪽을 무시해도 틀린다.
  // 그래서 라우터가 그 자리에서 남은 세션을 정리해 상태를 확정한다.
  let bReads = 0;
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "그만",
    signals: extractUtteranceSignals("그만"),
    registry: [
      stubSkill({
        id: "CHOSUNG",
        getActiveSession: async () => freshSession("a-1"),
      }),
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          bReads += 1;
          // 첫 조회만 실패한다. 재확인에서는 정상적으로 "없음" 이 나온다.
          if (bReads <= 1) throw new Error("read timeout");
          return null;
        },
      }),
    ],
  });

  assert.ok(bReads >= 2, "못 읽은 스킬을 다시 확인해야 한다");
  assert.ok(
    !(result.ended === true && result.sessionLookupFailed === true),
    `애매한 조합이 나왔다: ${JSON.stringify(result)}`
  );
  assert.equal(result.ended, true, "확정됐으면 종료 신호를 올려야 한다");
});

test("재확인에서도 못 읽으면 끝났다고 하지 않고 아이에게 말한다", async () => {
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "그만",
    signals: extractUtteranceSignals("그만"),
    registry: [
      stubSkill({
        id: "CHOSUNG",
        getActiveSession: async () => freshSession("a-1"),
      }),
      stubSkill({
        id: "WORD_CHAIN",
        // 계속 못 읽는다.
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
      }),
    ],
  });

  assert.notEqual(result.ended, true, "확정하지 못했는데 끝났다고 했다");
  assert.equal(result.sessionLookupFailed, true);
  assert.ok(
    result.deterministicText && result.deterministicText.length > 0,
    "아이에게 말해야 한다"
  );
});

test("stale·중복 정리가 실패하면 정리됐다고 세지 않는다", async () => {
  // 못 닫은 세션을 cleaned 로 세고 활성 목록에서 빼면, 살아 있는 놀이가 사라진다.
  const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const resolution = await resolveActiveSkill(emptyDb(), "c1", {
    registry: [
      stubSkill({
        id: "CHOSUNG",
        getActiveSession: async () => ({
          id: "stale-1",
          updatedAt: oldTime,
          startedAt: oldTime,
        }),
        end: async () => {
          throw new Error("end failed");
        },
      }),
    ],
  });

  assert.equal(
    resolution.lookupFailed,
    true,
    "정리에 실패했으면 상태를 확정했다고 할 수 없다"
  );
  assert.deepEqual(resolution.cleaned, [], "못 닫은 것을 정리됐다고 세면 안 된다");
});

// ─────────────────────────────────────────────────────────────────────────────
// 새 세션을 만드는 길은 넷이다 — 말로 직접 요청, 같은 놀이 재요청, 제안 수락,
// 모달 선택. 리뷰 라운드마다 하나씩 발견돼서, 이제 문 하나로 막고 넷 다 고정한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 지정한 발화로 라우터를 부르되, 한 스킬의 조회를 계속 실패시킨다. */
async function routeWithUnreadableSkill(utterance: string, extra: PlaySkillModule[] = []) {
  const started: string[] = [];
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance,
    signals: extractUtteranceSignals(utterance),
    registry: [
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
        start: async () => {
          started.push("WORD_CHAIN");
          return { handled: true, instruction: "시작" };
        },
      }),
      ...extra.map((skill) => ({
        ...skill,
        start: async () => {
          started.push(skill.id);
          return { handled: true, instruction: "시작" };
        },
      })),
    ],
  });
  return { result, started };
}

test("조회 실패 상태에서는 말로 직접 요청해도 새 놀이를 시작하지 않는다", async () => {
  const { result, started } = await routeWithUnreadableSkill("초성게임 하자", [
    stubSkill({ id: "CHOSUNG", matchesDirectRequest: () => true }),
  ]);
  assert.deepEqual(started, [], `새 놀이를 시작했다: ${started.join(", ")}`);
  assert.equal(result.sessionLookupFailed, true);
  assert.ok(result.deterministicText, "아이에게 답을 줘야 한다");
});

test("조회 실패 상태에서는 제안 수락으로도 새 놀이를 시작하지 않는다", async () => {
  // 이 경로는 앞선 분기가 잡지 못한다 — start() 문지기만이 막는다.
  // 실제로 pending proposal 을 심어야 여기까지 온다(안 심으면 테스트가 헛돈다).
  clearAllPendingProposalsForTest();
  await setPendingPlayProposal({
    chatSessionId: "s1",
    childId: "c1",
    offeredSkills: ["CHOSUNG"],
    proposedAt: Date.now(),
    initiatedBy: "k",
  });

  const started: string[] = [];
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    // "좋아 하자" 는 수락 신호로 잡히지 않는다(실측). 실제로 잡히는 말을 쓴다.
    utterance: "좋아",
    signals: extractUtteranceSignals("좋아"),
    registry: [
      stubSkill({
        id: "CHOSUNG",
        start: async () => {
          started.push("CHOSUNG");
          return { handled: true, instruction: "시작" };
        },
      }),
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
      }),
    ],
  });

  // 이 테스트가 실제로 고정하는 것은 "새 세션이 생기지 않는다" 하나다.
  // 아이용 문구까지는 단정하지 않는다 — 이 경로는 문지기에 닿기 전에
  // 자유대화로 흘러가고, 케이가 평소처럼 답한다(침묵이 아니다).
  // start() 문지기 자체는 아래 모달 선택 테스트와 직접 요청 테스트가 덮는다.
  assert.deepEqual(started, [], `새 놀이를 시작했다: ${started.join(", ")}`);
  assert.equal(result.sessionLookupFailed, true, "상태 미확정을 알려야 한다");
  clearAllPendingProposalsForTest();
});

test("조회 실패라도 평범한 대화는 가로채지 않는다", async () => {
  // 넓게 막았더니 놀이와 무관한 말에도 케이가 "헷갈려" 라고 답했다. 아이는
  // 학교 얘기를 했을 뿐이다 — 놀이 상태를 모른다고 대화를 끊으면 안 된다.
  const { result, started } = await routeWithUnreadableSkill("오늘 학교에서 밥 맛있었어");
  assert.deepEqual(started, [], "새 놀이를 시작하면 안 된다");
  assert.equal(result.handled, false, "평범한 대화는 자유대화가 받아야 한다");
  assert.equal(result.sessionLookupFailed, true, "상태 미확정은 엔진에 알린다");
});

test('"그만" 이 통했으면 다른 놀이가 미확정이어도 끝났다고 말해 준다', async () => {
  // 하던 놀이는 실제로 끝났는데 "정리하는 데 문제가 생겼어" 라고만 하면
  // 아이는 그만하기가 안 된 줄 안다.
  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "그만",
    signals: extractUtteranceSignals("그만"),
    registry: [
      stubSkill({ id: "CHOSUNG", getActiveSession: async () => freshSession("a-1") }),
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
      }),
    ],
  });

  assert.ok(result.deterministicText, "아이에게 말해야 한다");
  assert.ok(
    /끝냈어/.test(result.deterministicText ?? ""),
    `하던 놀이가 끝났다는 말이 없다: ${result.deterministicText}`
  );
});

test("재조회에서 숨은 세션이 드러나면 새 놀이를 시작하지 않는다", async () => {
  // 리뷰가 꼽은 최악 시나리오: A 활성 + B 숨음 → C 전환 → A 종료 →
  // 재조회에서 B 발견 → 그런데 문지기가 C 를 시작해 B/C 동시 활성.
  // 처음 문지기는 lookupFailed 만 봤기 때문에 이 구멍이 있었다.
  let bReads = 0;
  const started: string[] = [];

  const result = await routePlaySkillTurn({
    db: emptyDb(),
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "넌센스 퀴즈 하자",
    signals: extractUtteranceSignals("넌센스 퀴즈 하자"),
    registry: [
      // B — 첫 조회는 실패하고, 재조회에서는 살아 있는 세션이 드러난다.
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          bReads += 1;
          if (bReads <= 1) throw new Error("read timeout");
          return freshSession("b-1");
        },
      }),
      // C — 아이가 새로 하자고 한 놀이.
      stubSkill({
        id: "NONSENSE_QUIZ",
        matchesDirectRequest: () => true,
        start: async () => {
          started.push("NONSENSE_QUIZ");
          return { handled: true, instruction: "시작" };
        },
      }),
    ],
  });

  assert.ok(bReads >= 2, "재조회가 일어나야 한다");
  assert.deepEqual(started, [], "숨은 세션이 있는데 새 놀이를 시작했다");
  assert.equal(result.handled, true, "아이에게 답을 줘야 한다");
  assert.ok(result.deterministicText, "아이용 안내가 버려지면 안 된다");
});

test("놀이 이름을 직접 말해 수락했는데 차단되면 제안을 지우지 않는다", async () => {
  // 제안을 먼저 지우면, 차단된 아이는 다시 수락할 방법이 없다.
  //
  // 스텁 DB 로는 제안 보존을 직접 확인할 수 없다 — getPendingPlayProposal 이
  // DB 조회 성공(데이터 없음)을 보고 메모리 항목까지 지우기 때문이다(부활 방지).
  // 그래서 여기서는 **라우터가 clearPendingPlayProposal 을 부르지 않는다**는 것을
  // 직접 확인한다.
  const clearedSessions: string[] = [];
  const db = stubDb(async () => ({ data: null, error: null })) as unknown as {
    from: (t: string) => unknown;
  };
  const spyDb = {
    from: (table: string) => {
      const chain = db.from(table) as Record<string, unknown>;
      return {
        ...chain,
        update: (patch: Record<string, unknown>) => {
          if ("pending_play_proposal" in patch && patch.pending_play_proposal === null) {
            clearedSessions.push("cleared");
          }
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  } as unknown as SupabaseClient;

  const started: string[] = [];
  const result = await routePlaySkillTurn({
    db: spyDb,
    childId: "c1",
    chatSessionId: "s1",
    gradeRaw: "초3",
    utterance: "넌센스 퀴즈 하자",
    signals: extractUtteranceSignals("넌센스 퀴즈 하자"),
    registry: [
      stubSkill({
        id: "WORD_CHAIN",
        getActiveSession: async () => {
          throw new Error("read timeout");
        },
      }),
      stubSkill({
        id: "NONSENSE_QUIZ",
        matchesDirectRequest: () => true,
        start: async () => {
          started.push("NONSENSE_QUIZ");
          return { handled: true, instruction: "시작" };
        },
      }),
    ],
  });

  assert.deepEqual(started, [], "차단됐는데 새 놀이를 시작했다");
  assert.ok(result.deterministicText, "아이에게 답을 줘야 한다");
  assert.deepEqual(clearedSessions, [], "차단됐는데 제안을 지웠다");
});

