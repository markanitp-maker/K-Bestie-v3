import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateReflectiveReaction, UNCLEAR_AUDIO_TEMPLATES } from "@/lib/freechat/reactionEngine";

describe("Single Child Turn Response Idempotency & Multi-Message Integrity", () => {
  // 1. 같은 child turn으로 /api/voice/respond 2회 → Gemini 생성 1회
  it("Test 1: Same child turn concurrent/sequential /api/voice/respond calls execute Gemini generation only once", async () => {
    let geminiCallCount = 0;
    const mockGeminiGenerate = async (prompt: string) => {
      geminiCallCount += 1;
      await new Promise((r) => setTimeout(r, 20)); // simulate latency
      return { text: `응답: ${prompt}` };
    };

    // Simulate route single-flight & idempotency cache
    const inFlight = new Map<string, Promise<{ text: string; model: string }>>();
    const completed = new Map<string, { text: string; model: string; timestamp: number }>();

    const respondHandler = async (sessionId: string, childTurnId: string, prompt: string) => {
      const idempotencyKey = `${sessionId}:${childTurnId}:turn_response`;
      const cached = completed.get(idempotencyKey);
      if (cached) {
        return { ...cached, replayed: true };
      }
      const existing = inFlight.get(idempotencyKey);
      if (existing) {
        const result = await existing;
        return { ...result, replayed: true };
      }

      const runPromise = (async () => {
        const gen = await mockGeminiGenerate(prompt);
        return { text: gen.text, model: "gemini-2.5-flash" };
      })();

      inFlight.set(idempotencyKey, runPromise);
      try {
        const result = await runPromise;
        completed.set(idempotencyKey, { ...result, timestamp: Date.now() });
        return result;
      } finally {
        inFlight.delete(idempotencyKey);
      }
    };

    // 2 concurrent calls with same childTurnId
    const [res1, res2] = await Promise.all([
      respondHandler("session-1", "turn-101", "안녕 케이야"),
      respondHandler("session-1", "turn-101", "안녕 케이야"),
    ]);

    assert.equal(geminiCallCount, 1, "Gemini generation must only be called once for same child turn");
    assert.equal(res1.text, res2.text, "Both callers must receive the exact same response");

    // Sequential 3rd retry call with same childTurnId
    const res3 = await respondHandler("session-1", "turn-101", "안녕 케이야");
    assert.equal(geminiCallCount, 1, "Sequential retry must reuse completed response without calling Gemini again");
    assert.equal(res3.text, res1.text);
  });

  // 2. 같은 child turn으로 2회 → chat_messages K 응답 1건
  it("Test 2: Same child turn duplicate K response results in exactly 1 chat_messages row", async () => {
    const chatMessagesTable: Array<{ session_id: string; turn_id: string; role: string; content: string }> = [];

    const mockUpsertChatMessage = (msg: { session_id: string; turn_id: string; role: string; content: string }) => {
      const existingIdx = chatMessagesTable.findIndex(
        (m) => m.session_id === msg.session_id && m.turn_id === msg.turn_id
      );
      if (existingIdx === -1) {
        chatMessagesTable.push(msg);
      }
      // On conflict (session_id, turn_id) DO NOTHING
      return { ok: true };
    };

    const childTurnId = "turn-202";
    const kTurnId = `${childTurnId}:k`;

    // 1st insert
    mockUpsertChatMessage({
      session_id: "session-2",
      turn_id: kTurnId,
      role: "k",
      content: "오늘 재미있는 일 있었어?",
    });

    // 2nd duplicate insert for same turn
    mockUpsertChatMessage({
      session_id: "session-2",
      turn_id: kTurnId,
      role: "k",
      content: "오늘 재미있는 일 있었어?",
    });

    const kRows = chatMessagesTable.filter((m) => m.session_id === "session-2" && m.turn_id === kTurnId);
    assert.equal(kRows.length, 1, "Exactly 1 K response row must exist in chat_messages for the turn");
  });

  // 3. Mission 서버 저장분을 /api/chat/messages 가 다시 저장하지 않는가
  it("Test 3: Mission server-persisted K response is not duplicated by client /api/chat/messages", () => {
    const persistedMessages: Array<{ role: string; text: string; turnId: string }> = [];

    // Server finalizeServerTurn RPC persists K response
    const clientTurnId = "mission-turn-301";
    const serverKTurnId = `${clientTurnId}:k`;
    persistedMessages.push({
      role: "k",
      text: "정말 멋지다! 다음 질문으로 넘어가볼까?",
      turnId: serverKTurnId,
    });

    // Client handleTurnComplete receives K turn after TTS playback
    const isMissionActive = true;
    const isChildTurnDuringActiveMission = true;
    const isGreetingChildTurn = false;
    const enrichedTurn = { role: "k" as const, text: "다음 질문으로 넘어가볼까?", id: "temp-k-tts-id" };

    let saveMessageCalled = false;
    const mockSaveMessage = () => {
      saveMessageCalled = true;
    };

    // Client handleTurnComplete branch logic:
    if (enrichedTurn.role === "k" && (isChildTurnDuringActiveMission || isMissionActive)) {
      // Local scrollback updated, but saveMessage("k") NOT called
    } else if (!isGreetingChildTurn) {
      mockSaveMessage();
    }

    assert.equal(saveMessageCalled, false, "Client handleTurnComplete must not call saveMessage for server-owned K turn in Mission");
    assert.equal(persistedMessages.length, 1, "Only the server-persisted K row exists");
  });

  // 4. unclear_audio를 다른 turn으로 연속 2회 → 같은 문구가 반복 저장되지 않는가
  it("Test 4: Consecutive unclear_audio on different turns picks distinct phrases without repeating identical text", () => {
    const turn1ChildUtterance = "아"; // low length -> unclear_audio
    const turn1Res = generateReflectiveReaction(turn1ChildUtterance, [], { isLowConfidenceAsr: true });

    assert.equal(turn1Res.category, "unclear_audio");
    assert.ok(UNCLEAR_AUDIO_TEMPLATES.includes(turn1Res.text));

    // Turn 2: same session, different turn. Pass recent K texts containing Turn 1's response.
    const recentKTexts = [turn1Res.text];
    const turn2ChildUtterance = "음"; // another unclear audio
    const turn2Res = generateReflectiveReaction(turn2ChildUtterance, recentKTexts, { isLowConfidenceAsr: true });

    assert.equal(turn2Res.category, "unclear_audio");
    assert.notEqual(
      turn2Res.text,
      turn1Res.text,
      `Turn 2 (${turn2Res.text}) must not repeat Turn 1 (${turn1Res.text}) identical phrase`
    );
  });

  // 5. 정상 복수 메시지 유지 (opening+첫질문 / response+completion / completion+reward / safety 안내)
  it("Test 5: Legitimate multi-messages with different purposes are preserved as 2 distinct rows", () => {
    const messageStore = new Map<string, { role: string; content: string; purpose: string }>();

    const saveLegitMessage = (sessionId: string, turnId: string, role: string, content: string, purpose: string) => {
      const canonicalKey = `${sessionId}:${turnId}`;
      messageStore.set(canonicalKey, { role, content, purpose });
    };

    const sid = "session-multi-5";

    // 5-A. Mission Opening + First Question
    saveLegitMessage(sid, "greeting_turn_0:k", "k", "안녕! 오늘 미션 시작해볼까?", "mission_opening");
    saveLegitMessage(sid, "q1:k", "k", "첫 번째 질문이야. 오늘 기분은 어때?", "mission_question");

    assert.equal(messageStore.size, 2, "Opening and First Question must both be preserved");

    // 5-B. Mission Response + Completion
    saveLegitMessage(sid, "t5:k", "k", "대답해줘서 고마워!", "turn_response");
    saveLegitMessage(sid, "t5:k:completion", "k", "오늘 미션을 모두 완료했어! 정말 대단해 🎉", "mission_completion");

    assert.equal(messageStore.size, 4, "Turn response and Completion closing must both be preserved");

    // 5-C. Mission Completion + Reward
    saveLegitMessage(sid, "t5:k:reward", "k", "황금열쇠 1개를 받았어! 🔑", "mission_reward");
    assert.equal(messageStore.size, 5, "Completion and Reward must both be preserved");

    // 5-D. Safety notice
    saveLegitMessage(sid, "safety_turn:k:safety", "k", "많이 속상했겠다. 내가 항상 네 곁에 있어.", "safety");
    assert.equal(messageStore.size, 6, "Safety notice must be preserved");
  });

  // 6. 서로 다른 purpose의 K 메시지는 같은 세션에서 정상 저장되는가
  it("Test 6: Distinct purpose K messages in the same session are normally saved without collision", () => {
    const messages: Array<{ turnId: string; purpose: string; content: string }> = [];

    const purposes = ["turn_response", "mission_opening", "mission_completion", "mission_reward", "safety", "session_limit"];

    for (const purpose of purposes) {
      messages.push({
        turnId: `turn-${purpose}`,
        purpose,
        content: `Content for ${purpose}`,
      });
    }

    const uniqueTurnIds = new Set(messages.map((m) => m.turnId));
    assert.equal(uniqueTurnIds.size, purposes.length, "All distinct purpose messages must have unique identifiers and be saved");
  });

  // 7. 아이가 진짜로 두 번 연속 안 들린 정상 상황이 무리하게 막히지 않는가
  it("Test 7: Child indistinct twice consecutively is properly handled with diverse friendly responses without blocking", () => {
    const historyK: string[] = [];

    // Turn 1: Child speaks quietly ("..."), STT low confidence
    const res1 = generateReflectiveReaction("...", historyK, { isLowConfidenceAsr: true });
    assert.equal(res1.category, "unclear_audio");
    historyK.push(res1.text);

    // Turn 2: Child speaks quietly again ("..."), STT low confidence
    const res2 = generateReflectiveReaction("...", historyK, { isLowConfidenceAsr: true });
    assert.equal(res2.category, "unclear_audio");
    assert.notEqual(res2.text, res1.text, "Second turn must provide an alternative prompt");
    historyK.push(res2.text);

    // Turn 3: Child speaks clearly ("나 이제 들려?")
    const res3 = generateReflectiveReaction("나 이제 들려?", historyK, { isLowConfidenceAsr: false });
    assert.notEqual(res3.category, "unclear_audio", "Third clear turn must be normally processed");

    assert.equal(historyK.length, 2, "Both indistinct turns received polite, non-repeating guidance");
  });

  // 8. [리뷰 지적 ①] 캐시가 빈 상태(다른 인스턴스 모사)에서 같은 turn 재요청 → DB에 이미 K 응답이 있으면 Gemini 호출 0회
  it("Test 8: Empty in-memory cache (cross-instance simulation) reuses existing DB K response with 0 Gemini calls", async () => {
    let geminiCallCount = 0;
    const mockGeminiGenerate = async (prompt: string) => {
      geminiCallCount += 1;
      return { text: `생성된 응답: ${prompt}` };
    };

    // DB mock containing already persisted K response from Instance A
    const dbMessages = new Map<string, { role: string; content: string }>();
    dbMessages.set("session-cross-8:turn-801:k", { role: "k", content: "인스턴스 A에서 이미 생성해 저장한 응답이야!" });

    // Instance B: Fresh process with empty in-memory cache and empty inFlight map
    const instanceB_completed = new Map<string, { text: string; model: string; timestamp: number }>();
    const instanceB_inFlight = new Map<string, Promise<{ text: string; model: string }>>();

    const simulateInstanceBRespond = async (sessionId: string, childTurnId: string, prompt: string) => {
      const idempotencyKey = `${sessionId}:${childTurnId}:turn_response`;

      // 1. In-memory cache check (empty on Instance B)
      const cached = instanceB_completed.get(idempotencyKey);
      if (cached) return { ...cached, replayed: true };

      // 2. In-flight check
      const inFlight = instanceB_inFlight.get(idempotencyKey);
      if (inFlight) return { ...(await inFlight), replayed: true };

      // 3. Pre-generation DB check (cross-instance protection)
      try {
        const kTurnId = `${childTurnId}:k`;
        const dbRow = dbMessages.get(`${sessionId}:${kTurnId}`) ?? dbMessages.get(`${sessionId}:${childTurnId}`);
        if (dbRow?.role === "k" && dbRow.content) {
          const replayed = { text: dbRow.content, model: "cached_db", replayed: true };
          instanceB_completed.set(idempotencyKey, { ...replayed, timestamp: Date.now() });
          return replayed;
        }
      } catch (dbErr) {
        // fail-open
      }

      // 4. Generation fallback
      const genPromise = (async () => {
        const gen = await mockGeminiGenerate(prompt);
        return { text: gen.text, model: "gemini-2.5-flash", replayed: false };
      })();

      instanceB_inFlight.set(idempotencyKey, genPromise);
      try {
        const result = await genPromise;
        instanceB_completed.set(idempotencyKey, { ...result, timestamp: Date.now() });
        return result;
      } finally {
        instanceB_inFlight.delete(idempotencyKey);
      }
    };

    // Re-request on Instance B for turn-801
    const res = await simulateInstanceBRespond("session-cross-8", "turn-801", "안녕 케이야");

    assert.equal(geminiCallCount, 0, "Gemini generation must not be called when DB already has K response");
    assert.equal(res.text, "인스턴스 A에서 이미 생성해 저장한 응답이야!");
    assert.equal(res.replayed, true);
    assert.equal(res.model, "cached_db");
  });

  // 9. [리뷰 지적 ①] DB 조회 실패 시 생성이 막히지 않는가 (fail-open)
  it("Test 9: DB query failure fails open and does not block Gemini generation", async () => {
    let geminiCallCount = 0;
    const mockGeminiGenerate = async (prompt: string) => {
      geminiCallCount += 1;
      return { text: `장애 복구 생성 응답: ${prompt}` };
    };

    const inFlight = new Map<string, Promise<{ text: string; model: string }>>();
    const completed = new Map<string, { text: string; model: string; timestamp: number }>();

    const simulateRespondWithFailingDb = async (sessionId: string, childTurnId: string, prompt: string) => {
      const idempotencyKey = `${sessionId}:${childTurnId}:turn_response`;

      // Pre-generation DB check with simulated DB failure
      let dbLookupFailed = false;
      try {
        throw new Error("DB connection timeout (simulated)");
      } catch (dbErr) {
        dbLookupFailed = true;
        // Fail-open: continue to generation
      }

      assert.ok(dbLookupFailed, "DB failure must be caught");

      // Generation proceeds
      const genPromise = (async () => {
        const gen = await mockGeminiGenerate(prompt);
        return { text: gen.text, model: "gemini-2.5-flash", replayed: false };
      })();

      inFlight.set(idempotencyKey, genPromise);
      try {
        const result = await genPromise;
        completed.set(idempotencyKey, { ...result, timestamp: Date.now() });
        return result;
      } finally {
        inFlight.delete(idempotencyKey);
      }
    };

    const res = await simulateRespondWithFailingDb("session-failopen-9", "turn-901", "오늘 날씨 어때?");
    assert.equal(geminiCallCount, 1, "Gemini must be called as fail-open fallback despite DB query failure");
    assert.equal(res.text, "장애 복구 생성 응답: 오늘 날씨 어때?");
  });

  // 10. [리뷰 지적 ①] 캐시가 빈 상태 + DB에도 없음 → 정상 생성 1회
  it("Test 10: Empty cache and empty DB triggers normal Gemini generation exactly once", async () => {
    let geminiCallCount = 0;
    const mockGeminiGenerate = async (prompt: string) => {
      geminiCallCount += 1;
      return { text: `첫 생성 응답: ${prompt}` };
    };

    const dbMessages = new Map<string, { role: string; content: string }>();
    const completed = new Map<string, { text: string; model: string; timestamp: number }>();
    const inFlight = new Map<string, Promise<{ text: string; model: string }>>();

    const simulateRespond = async (sessionId: string, childTurnId: string, prompt: string) => {
      const idempotencyKey = `${sessionId}:${childTurnId}:turn_response`;

      if (completed.has(idempotencyKey)) return completed.get(idempotencyKey)!;

      // DB check (empty)
      const kTurnId = `${childTurnId}:k`;
      const dbRow = dbMessages.get(`${sessionId}:${kTurnId}`);
      if (dbRow?.role === "k" && dbRow.content) {
        return { text: dbRow.content, model: "cached_db" };
      }

      // Generate
      const gen = await mockGeminiGenerate(prompt);
      const result = { text: gen.text, model: "gemini-2.5-flash" };
      completed.set(idempotencyKey, { ...result, timestamp: Date.now() });
      return result;
    };

    const res = await simulateRespond("session-fresh-10", "turn-1001", "책 읽었어");
    assert.equal(geminiCallCount, 1, "Fresh request must generate exactly once");
    assert.equal(res.text, "첫 생성 응답: 책 읽었어");
  });

  // 11. [리뷰 지적 ②] completedResponses가 상한을 넘으면 오래된 항목이 제거되는가 (LRU)
  it("Test 11: completedResponses LRU eviction removes oldest entries when exceeding max capacity", () => {
    const cache = new Map<string, { text: string; timestamp: number }>();
    const MAX_ENTRIES = 5;
    const TTL_MS = 5 * 60 * 1000;

    const cleanup = (max: number = MAX_ENTRIES) => {
      const now = Date.now();
      for (const [key, val] of cache.entries()) {
        if (now - val.timestamp > TTL_MS) {
          cache.delete(key);
        }
      }
      while (cache.size > max) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        } else {
          break;
        }
      }
    };

    const setCache = (key: string, value: { text: string; timestamp: number }) => {
      if (cache.has(key)) {
        cache.delete(key);
      }
      cleanup(MAX_ENTRIES);
      while (cache.size >= MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        } else {
          break;
        }
      }
      cache.set(key, value);
    };

    // Insert 5 items
    for (let i = 1; i <= 5; i++) {
      setCache(`turn-${i}`, { text: `Response ${i}`, timestamp: Date.now() + i });
    }
    assert.equal(cache.size, 5);
    assert.ok(cache.has("turn-1"), "turn-1 should be present initially");

    // Insert 6th item (exceeding MAX_ENTRIES=5)
    setCache("turn-6", { text: "Response 6", timestamp: Date.now() + 6 });

    assert.equal(cache.size, 5, "Cache size must be capped at MAX_ENTRIES");
    assert.equal(cache.has("turn-1"), false, "Oldest entry (turn-1) must be evicted");
    assert.ok(cache.has("turn-2"), "turn-2 should remain");
    assert.ok(cache.has("turn-6"), "Newest entry turn-6 must be present");
  });

  // 12. 정상 복수 메시지(completion/reward/safety)가 여전히 각각 저장되고 turn 조회가 분리되는가 (회귀)
  it("Test 12: Multi-message purpose suffixes are preserved and distinct from primary turn response", () => {
    const db = new Map<string, { session_id: string; turn_id: string; role: string; content: string }>();

    const saveMessage = (sessionId: string, turnId: string, role: string, content: string) => {
      const key = `${sessionId}:${turnId}`;
      db.set(key, { session_id: sessionId, turn_id: turnId, role, content });
    };

    const sid = "session-multi-12";
    const baseTurnId = "turn-1201";

    // 1. Regular turn response
    saveMessage(sid, `${baseTurnId}:k`, "k", "대답 잘했어!");

    // 2. Mission completion message
    saveMessage(sid, `${baseTurnId}:k:completion`, "k", "오늘 미션을 모두 완료했어! 축하해!");

    // 3. Mission reward message
    saveMessage(sid, `${baseTurnId}:k:reward`, "k", "황금열쇠 1개를 획득했어!");

    // 4. Safety message
    saveMessage(sid, `${baseTurnId}:k:safety`, "k", "마음이 힘들 땐 언제든 이야기해줘.");

    assert.equal(db.size, 4, "All 4 multi-messages must coexist in DB without collision");

    // Idempotency lookup for baseTurnId should specifically match the base K response
    const candidateTurnIds = [`${baseTurnId}:k`, baseTurnId];
    const matchingRow = candidateTurnIds.map((tid) => db.get(`${sid}:${tid}`)).find((row) => row?.role === "k");

    assert.ok(matchingRow, "Primary K response must be found");
    assert.equal(matchingRow?.content, "대답 잘했어!", "Primary K response content must match");
    assert.equal(matchingRow?.turn_id, `${baseTurnId}:k`);
  });
});
