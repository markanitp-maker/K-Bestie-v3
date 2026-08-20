import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectKNextWord } from "./nextWordSelector";
import { lookupWord, BY_FIRST_SYLLABLE } from "./dictionaryIndex";
import {
  WORD_CHAIN_SKILL,
  type WordChainSessionRow,
  type WordChainRoundRow,
} from "./wordChainSkill";
import { getActiveWordChainSession } from "./sessionManager";
import type { UtteranceSignals } from "../utteranceSignals";
import { deriveWordChainEntry } from "./dictionaryTypes";

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
};

function createMockSupabase(options?: {
  sessions?: WordChainSessionRow[];
  rounds?: WordChainRoundRow[];
}) {
  const sessionsStore: WordChainSessionRow[] = options?.sessions
    ? options.sessions.map((s) => ({ ...s, used_words: [...s.used_words] }))
    : [];
  const roundsStore: WordChainRoundRow[] = options?.rounds
    ? [...options.rounds]
    : [];

  return {
    from(tableName: string) {
      if (tableName === "chat_sessions") {
        return {
          select: () => {
            const builder: any = {
              eq: () => builder,
              maybeSingle: async () => ({
                data: { id: "chat-1", child_id: "child-1" },
                error: null,
              }),
              single: async () => ({
                data: { id: "chat-1", child_id: "child-1" },
                error: null,
              }),
            };
            return builder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "word_chain_game_sessions") {
        return {
          select: () => {
            let filtered = [...sessionsStore];
            const builder: any = {
              eq: (col: string, val: any) => {
                filtered = filtered.filter((r) => (r as any)[col] === val);
                return builder;
              },
              is: (col: string, val: any) => {
                if (val === null) {
                  filtered = filtered.filter((r) => (r as any)[col] === null);
                } else {
                  filtered = filtered.filter((r) => (r as any)[col] === val);
                }
                return builder;
              },
              order: () => builder,
              limit: () => builder,
              single: async () => {
                if (filtered.length === 0) {
                  return { data: null, error: { message: "Row not found" } };
                }
                return { data: filtered[0], error: null };
              },
              maybeSingle: async () => {
                return { data: filtered[0] || null, error: null };
              },
            };
            return builder;
          },
          update: (updates: Partial<WordChainSessionRow>) => {
            let targetId: string | null = null;
            const updateChain: any = {
              eq: (col: string, val: any) => {
                if (col === "id") targetId = val;
                return updateChain;
              },
              is: () => updateChain,
              select: () => ({
                single: async () => {
                  const idx = sessionsStore.findIndex(
                    (s) => !targetId || s.id === targetId
                  );
                  if (idx === -1) {
                    return { data: null, error: { message: "Row not found" } };
                  }
                  sessionsStore[idx] = {
                    ...sessionsStore[idx],
                    ...updates,
                    updated_at: new Date().toISOString(),
                  };
                  return { data: sessionsStore[idx], error: null };
                },
              }),
            };

            updateChain.then = (resolve: any) => {
              const idx = sessionsStore.findIndex(
                (s) => !targetId || s.id === targetId
              );
              if (idx !== -1) {
                sessionsStore[idx] = {
                  ...sessionsStore[idx],
                  ...updates,
                  updated_at: new Date().toISOString(),
                };
              }
              resolve({ error: null });
            };

            return updateChain;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      if (tableName === "word_chain_game_rounds") {
        return {
          insert: (round: Partial<WordChainRoundRow>) => {
            const newRound: WordChainRoundRow = {
              id: `round-${Date.now()}`,
              session_id: round.session_id || "sess-1",
              child_id: round.child_id || "child-1",
              word: round.word || "",
              by: round.by || "CHILD",
              difficulty: round.difficulty || 1,
              result: round.result || "ACCEPTED",
              created_at: new Date().toISOString(),
            };
            roundsStore.push(newRound);
            return { error: null };
          },
          select: () => {
            const builder: any = {
              eq: () => builder,
              order: () => builder,
              limit: async () => ({ data: [], error: null }),
            };
            return builder;
          },
        } as unknown as ReturnType<SupabaseClient["from"]>;
      }

      return {} as unknown as ReturnType<SupabaseClient["from"]>;
    },
  };
}

describe("WordChain Word Reuse & Random Selection (wordReuse.test.ts)", () => {
  it("새 판을 시작해도 직전 판 낱말('임시', '장수풍뎅이')이 다시 선택되지 않는다", async () => {
    // 1. selectKNextWord 레벨 검증: usedWords에 '임시'와 '장수풍뎅이'가 포함된 경우
    const imsi = lookupWord("임시");
    const jsp = lookupWord("장수풍뎅이");
    assert.ok(imsi, "사전에 '임시'가 존재해야 한다");
    assert.ok(jsp, "사전에 '장수풍뎅이'가 존재해야 한다");

    const usedWords = new Set<string>(["임시", "장수풍뎅이"]);

    // '임'으로 끝나는 단어(예: '책임') 다음 K 턴
    const chekIm = deriveWordChainEntry({ word: "책임", difficulty: 2 });
    for (let i = 0; i < 20; i++) {
      const nextWord = selectKNextWord({
        previousWord: chekIm,
        usedWords,
        minDifficulty: 1,
        maxDifficulty: 6,
        random: Math.random,
      });
      if (nextWord) {
        assert.notEqual(
          nextWord.word,
          "임시",
          "usedWords에 등록된 '임시'가 선택되어서는 안 된다"
        );
      }
    }

    // '장'으로 끝나는 단어(예: '도장') 다음 K 턴
    const doJang = lookupWord("도장") ?? deriveWordChainEntry({ word: "도장", difficulty: 1 });
    for (let i = 0; i < 20; i++) {
      const nextWord = selectKNextWord({
        previousWord: doJang,
        usedWords,
        minDifficulty: 1,
        maxDifficulty: 6,
        random: Math.random,
      });
      if (nextWord) {
        assert.notEqual(
          nextWord.word,
          "장수풍뎅이",
          "usedWords에 등록된 '장수풍뎅이'가 선택되어서는 안 된다"
        );
      }
    }

    // 2. WORD_CHAIN_SKILL 새 판 시작 UPDATE 누적 검증
    // 직전 판에서 '임시', '장수풍뎅이'를 썼고 아이가 막다른 단어('하늘')를 내어 K가 막혀 새 판이 시작되는 상황
    const deadEndChildWord = "하늘"; // 사전에 있으며 끝 음절 '늘'로 시작하는 단어가 0개임
    const initialSession: WordChainSessionRow = {
      id: "sess-word-reuse-1",
      child_id: "child-1",
      chat_session_id: "chat-1",
      initiated_by: "K",
      state: "CHILD_TURN",
      current_word: "지하",
      current_difficulty: 1,
      used_words: ["가방", "임시", "장수풍뎅이", "지하"],
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };

    const db = createMockSupabase({ sessions: [initialSession] });

    // 아이가 막다른 단어 '하늘'을 내어 K가 GIVE_UP하고 새 판을 시작하도록 트리거
    const turnResult = await WORD_CHAIN_SKILL.handleTurn({
      db: db as any,
      childId: "child-1",
      chatSessionId: "chat-1",
      gradeRaw: 3,
      utterance: deadEndChildWord,
      signals: defaultSignals,
    });

    assert.equal(turnResult.handled, true);
    assert.equal(turnResult.ended, false);

    // DB에 갱신된 세션의 used_words 확인
    const updatedSession = await getActiveWordChainSession(db as any, "child-1");
    assert.ok(updatedSession, "활성 세션이 유지되어야 한다");
    assert.ok(
      updatedSession.used_words.includes("임시"),
      "새 판 시작 후에도 직전 판의 '임시'가 used_words에 보존되어야 한다"
    );
    assert.ok(
      updatedSession.used_words.includes("장수풍뎅이"),
      "새 판 시작 후에도 직전 판의 '장수풍뎅이'가 used_words에 보존되어야 한다"
    );
    assert.ok(
      updatedSession.used_words.includes("하늘"),
      "새 판 시작 후에도 아이가 낸 '하늘'이 used_words에 보존되어야 한다"
    );
    assert.ok(
      updatedSession.used_words.length >= 6,
      "새 판 시작 시 used_words가 초기화되지 않고 기존 단어들 + 새 첫 단어가 누적되어야 한다"
    );
  });

  it("random 을 고정 주입하면 결과가 결정론적이다 (테스트 가능성 확인)", () => {
    const bag = lookupWord("가방")!;
    const usedWords = new Set<string>(["가방"]);

    // 고정 난수 0.0 주입 시 결과 일관성
    const fixedRandom0 = () => 0.0;
    const res0_1 = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
      random: fixedRandom0,
    });
    const res0_2 = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
      random: fixedRandom0,
    });
    assert.ok(res0_1);
    assert.ok(res0_2);
    assert.equal(res0_1.word, res0_2.word);

    // 고정 난수 0.8 주입 시 결과 일관성
    const fixedRandom8 = () => 0.8;
    const res8_1 = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
      random: fixedRandom8,
    });
    const res8_2 = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
      random: fixedRandom8,
    });
    assert.ok(res8_1);
    assert.ok(res8_2);
    assert.equal(res8_1.word, res8_2.word);
  });

  it("random 값을 바꾸면 다른 낱말이 나온다 (무작위성이 실제로 동작)", () => {
    const bag = lookupWord("가방")!;
    const usedWords = new Set<string>(["가방"]);

    // 상위 후보군 내에서 서로 다른 random 값(0.0 ~ 0.99)을 주입
    const distinctWords = new Set<string>();
    const randomSteps = [0.0, 0.25, 0.5, 0.75, 0.99];

    for (const step of randomSteps) {
      const selected = selectKNextWord({
        previousWord: bag,
        usedWords,
        minDifficulty: 1,
        maxDifficulty: 6,
        random: () => step,
      });
      if (selected) {
        distinctWords.add(selected.word);
      }
    }

    assert.ok(
      distinctWords.size >= 2,
      `상위 후보군에서 무작위 선택 시 서로 다른 낱말이 나와야 합니다 (선택된 단어 수: ${distinctWords.size}, 목록: ${Array.from(distinctWords).join(", ")})`
    );
  });

  it("후보가 1개뿐이면 그것을 낸다", () => {
    const bag = lookupWord("가방")!; // 끝 음절: '방'
    const bangList = BY_FIRST_SYLLABLE.get("방") ?? [];
    assert.ok(bangList.length >= 2, "'방'으로 시작하는 사전 단어가 2개 이상이어야 테스트 구성 가능");

    // 마지막 1개 단어('방학')만 남기고 나머지를 전부 usedWords에 등록
    const onlyChoice = bangList[0];
    const usedWords = new Set<string>(["가방"]);
    for (let i = 1; i < bangList.length; i++) {
      usedWords.add(bangList[i].word);
      usedWords.add(bangList[i].normalizedWord);
    }

    // random에 어떤 값을 주더라도 유일한 후보 1개를 반환해야 함
    const selected = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
      random: Math.random,
    });

    assert.ok(selected, "후보가 1개 있을 때 null이 아니어야 한다");
    assert.equal(selected.normalizedWord, onlyChoice.normalizedWord);
  });

  it("후보가 0개면 null (케이 패배 경로가 유지된다)", () => {
    const bag = lookupWord("가방")!;
    const bangList = BY_FIRST_SYLLABLE.get("방") ?? [];

    // '방'으로 시작하는 모든 사전 단어를 usedWords에 등록
    const usedWords = new Set<string>(["가방"]);
    for (const entry of bangList) {
      usedWords.add(entry.word);
      usedWords.add(entry.normalizedWord);
    }

    const selected = selectKNextWord({
      previousWord: bag,
      usedWords,
      minDifficulty: 1,
      maxDifficulty: 6,
      random: Math.random,
    });

    assert.equal(
      selected,
      null,
      "모든 후보가 소진되었을 때 null을 반환하여 케이 패배/새 판 전환 경로를 유지해야 한다"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 무작위화가 dead-end 회피(§3-18)를 갉아먹지 않는지 지킨다.
// 이 단정이 이 절충의 유일한 회귀 방어선이다 — 없으면 임계치를 조용히 넓혀도
// 아무도 모르고, 케이가 더 자주 막힌다.
// ─────────────────────────────────────────────────────────────────────────────

describe("무작위 선택 안전 임계치", () => {
  /** 어떤 음절에서 random 값을 훑어 나오는 모든 낱말을 모은다. */
  function collectPicks(previousWordText: string) {
    const previousWord = deriveWordChainEntry(lookupWord(previousWordText)!);
    const picks = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const entry = selectKNextWord({
        previousWord,
        usedWords: new Set<string>(),
        minDifficulty: 1,
        maxDifficulty: 5,
        random: () => i / 20,
      });
      if (entry) picks.add(entry.word);
    }
    return { previousWord, picks };
  }

  /** 그 낱말로 이어갈 수 있는 사전 낱말 수(같은 방식의 근사치). */
  function followUpCount(word: string): number {
    const entry = deriveWordChainEntry(lookupWord(word)!);
    const list = BY_FIRST_SYLLABLE.get(entry.lastSyllable);
    return list ? list.length : 0;
  }

  const SAMPLE_WORDS = ["사과", "바나나", "기차", "나무", "가방"];

  it("무작위로 뽑힌 낱말이 1순위보다 크게 나쁘지 않다", () => {
    for (const seed of SAMPLE_WORDS) {
      const { previousWord, picks } = collectPicks(seed);
      if (picks.size <= 1) continue; // 후보가 하나뿐이면 비교할 것이 없다

      const deterministic = selectKNextWord({
        previousWord,
        usedWords: new Set<string>(),
        minDifficulty: 1,
        maxDifficulty: 5,
      });
      assert.ok(deterministic, `1순위가 없다: ${seed}`);

      const bestFollowUps = followUpCount(deterministic!.word);
      for (const word of picks) {
        const got = followUpCount(word);
        // 임계치는 gradeFollowUps 기준이라 여기 근사치와 정확히 같지는 않다.
        // 그래도 "1순위의 절반 밑" 처럼 크게 나쁜 낱말이 섞이면 안 된다.
        assert.ok(
          bestFollowUps === 0 || got >= bestFollowUps * 0.5,
          `${seed} → ${word}: 이어갈 낱말 ${got}개, 1순위는 ${bestFollowUps}개`
        );
      }
    }
  });

  it("무작위를 켜도 케이가 낼 낱말이 사라지지 않는다", () => {
    for (const seed of SAMPLE_WORDS) {
      const { picks } = collectPicks(seed);
      assert.ok(picks.size >= 1, `${seed} 에서 후보가 0개가 됐다`);
    }
  });
});

describe("새 판 저장 실패", () => {
  it("새 판 저장이 실패하면 새 낱말을 제시하지 않는다", async () => {
    // 저장이 실패했는데 새 낱말을 제시하면, 아이는 그 낱말로 이어가는데 케이는
    // 다음 턴에 그걸 모른다 — 아이 눈에는 케이가 방금 한 말을 잊은 것이다.
    //
    // 아이 턴 기록은 성공하고 **새 판 저장만** 실패해야 이 경로에 온다.
    // (아이 턴 기록이 먼저 실패하면 앞단 가드가 잡는다 — 그쪽도 새 낱말을 안 낸다.)
    const now = new Date().toISOString();
    // `시험` 은 사전에서 막다른 낱말(험으로 시작하는 낱말이 없다)이라
    // 케이가 이어갈 수 없어 새 판 경로로 간다.
    const session: Record<string, unknown> = {
      id: "wc-fail-1",
      child_id: "c1",
      chat_session_id: "s1",
      state: "CHILD_TURN",
      current_word: "임시",
      current_difficulty: 2,
      used_words: ["임시"],
      initiated_by: "K",
      started_at: now,
      updated_at: now,
      ended_at: null,
    };

    const chain: Record<string, unknown> = {};
    const failing = { error: { message: "update rejected" } };
    const ok = { error: null };
    let updateCalls = 0;
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: session, error: null }),
      single: async () => ({ data: session, error: null }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: {}, error: null }) }),
      }),
      // 새 판 저장만 실패시킨다.
      //
      // 처음에는 `used_words` 유무로 갈랐는데, 아이 턴 기록 UPDATE 도 같은 필드를
      // 쓴다 — 그래서 앞단 가드가 먼저 걸렸고 이 테스트가 헛돌았다(변이 검사로 발견).
      // 호출 순서로 가른다: 1번째는 아이 턴 기록, 3번째가 새 판 저장이다.
      update: () => {
        updateCalls += 1;
        const res = updateCalls >= 3 ? failing : ok;
        return {
          eq: () => ({
            is: async () => res,
            eq: async () => res,
            select: () => ({ single: async () => ({ data: session, ...res }) }),
          }),
        };
      },
    });
    const db = { from: () => chain } as unknown as SupabaseClient;

    const result = await WORD_CHAIN_SKILL.handleTurn({
      db,
      childId: "c1",
      chatSessionId: "s1",
      gradeRaw: 3,
      utterance: "시험",
      signals: defaultSignals,
    });

    assert.equal(result.handled, true, "케이가 아무 말도 안 하면 안 된다");
    assert.notEqual(result.ended, true, "놀이를 끝내면 안 된다");

    // 새 낱말·다음 음절을 제시하면 안 된다.
    const shown = `${result.deterministicText ?? ""}\n${result.instruction ?? ""}`;
    assert.ok(
      !/이제 ".+"(?:으로|로) 시작하는 단어는\?/.test(shown),
      `저장이 실패했는데 새 낱말을 제시했다: ${shown}`
    );
  });
});
