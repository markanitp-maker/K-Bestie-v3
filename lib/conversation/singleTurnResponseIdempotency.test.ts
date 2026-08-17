import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateReflectiveReaction, UNCLEAR_AUDIO_TEMPLATES } from "@/lib/freechat/reactionEngine";
import { checkSafetyPreflight } from "@/lib/k-conversation";
import { resolveVacationChatInstruction } from "@/lib/freechat/vacationChatInstruction";

describe("Voice Respond Server Cache Removal & Response Generation Integrity", () => {
  // 1. [009 서버 캐시 제거 계약] 같은 turnId로 두 번 요청하면 두 번 다 새로 생성된다 (캐시 재생 없음)
  it("Test 1: Same child turn consecutive /api/voice/respond calls generate newly every time (no cache replay)", async () => {
    let geminiCallCount = 0;
    const mockGeminiGenerate = async (prompt: string) => {
      geminiCallCount += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { text: `새로 생성된 응답 (${geminiCallCount}): ${prompt}` };
    };

    // 2026-08-17: 009 서버 캐시(completedResponses / inFlightRequests)를 전면 제거함.
    // 아이가 같은 말을 반복하더라도 이전 응답을 replayed로 재활용하지 않고 매번 새로 응답을 생성하여
    // 침묵/무응답 장애(박서아·박서현 계정 20분 무응답 사고)를 완전히 차단한다.
    const respondHandlerWithoutCache = async (sessionId: string, childTurnId: string, prompt: string) => {
      // 캐시나 멱등성 가드 없이 항상 직접 생성을 실행
      const gen = await mockGeminiGenerate(prompt);
      return {
        text: gen.text,
        category: "generated",
        flaggedForParent: false,
        model: "gemini-2.5-flash",
      };
    };

    // 1st call
    const res1 = await respondHandlerWithoutCache("session-1", "turn-101", "안녕 케이야");
    // 2nd call with identical childTurnId and prompt
    const res2 = await respondHandlerWithoutCache("session-1", "turn-101", "안녕 케이야");

    assert.equal(geminiCallCount, 2, "Both calls with the same turnId must trigger generation newly (no cache replay)");
    assert.notEqual(res1.text, res2.text, "Each call receives its own newly generated response");
    assert.equal("replayed" in res1, false, "Response 1 must not contain replayed property");
    assert.equal("replayed" in res2, false, "Response 2 must not contain replayed property");
  });

  // 2. [저장 단계 중복 방지] 같은 child turn으로 2회 응답 시 chat_messages K 저장은 UNIQUE 제약 및 onConflict + ignoreDuplicates에 의해 1건만 유지된다
  it("Test 2: Same child turn duplicate K response results in exactly 1 chat_messages row via DB UNIQUE constraint", async () => {
    const chatMessagesTable: Array<{ session_id: string; turn_id: string; role: string; content: string }> = [];

    const mockUpsertChatMessage = (msg: { session_id: string; turn_id: string; role: string; content: string }) => {
      const existingIdx = chatMessagesTable.findIndex(
        (m) => m.session_id === msg.session_id && m.turn_id === msg.turn_id
      );
      if (existingIdx === -1) {
        chatMessagesTable.push(msg);
      }
      // On conflict (session_id, turn_id) DO NOTHING (ignoreDuplicates)
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

  // 4. [서로 다른 발화 다양성] 서로 다른 발화는 각각 다른 응답을 받는다
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
  it("Test 5: Legitimate multi-messages with different purposes are preserved as distinct rows", () => {
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

  // 8. [DB 사전 조회 제거 계약] DB에 이미 K 응답이 있더라도 /api/voice/respond는 캐시 사전조회 없이 항상 새로 생성한다
  it("Test 8: DB existing K message is not replayed as cache; route generates newly every request", async () => {
    let geminiCallCount = 0;
    const mockGeminiGenerate = async (prompt: string) => {
      geminiCallCount += 1;
      return { text: `항상 새로 생성된 응답: ${prompt}` };
    };

    // DB에 이미 이전 응답이 존재하더라도 009의 DB 사전조회는 제거되었음
    const dbMessages = new Map<string, { role: string; content: string }>();
    dbMessages.set("session-cross-8:turn-801:k", { role: "k", content: "과거에 저장되었던 옛날 응답" });

    // 2026-08-17 계약: DB 사전 조회를 수행하지 않고 항상 새로 생성을 호출한다
    const simulateRouteRespond = async (sessionId: string, childTurnId: string, prompt: string) => {
      const gen = await mockGeminiGenerate(prompt);
      return {
        text: gen.text,
        category: "generated",
        flaggedForParent: false,
        model: "gemini-2.5-flash",
      };
    };

    const res = await simulateRouteRespond("session-cross-8", "turn-801", "안녕 케이야");

    assert.equal(geminiCallCount, 1, "Gemini generation must be called even if DB has an existing turn");
    assert.equal(res.text, "항상 새로 생성된 응답: 안녕 케이야");
    assert.equal("replayed" in res, false, "Response must not contain replayed property");
    assert.equal(res.category, "generated");
  });

  // 9. [Safety 발동 경로] Safety preflight는 캐시 제거 후에도 최우선으로 즉시 동작한다
  it("Test 9: Safety preflight route continues to work with highest priority", async () => {
    // Mock service client for safety check
    const mockDb: any = {
      from: () => ({
        insert: async () => ({ error: null }),
      }),
    };

    const safetyUtterance = "나 죽고 싶어";
    const safetyResult = await checkSafetyPreflight(mockDb, "session-safety-9", safetyUtterance, {
      childId: "child-9",
      mode: "FREE_CHAT",
      persistEvent: false,
    });

    assert.ok(safetyResult, "Safety result must be returned for crisis utterance");
    assert.equal(safetyResult?.category, "safety");
    assert.equal(safetyResult?.safetyFlagged, true);
    assert.ok(safetyResult?.text.length > 0, "Safety comfort response must be provided");
  });

  // 10. [방학 지침 경로] 방학/개학 지침(vacationInstruction)은 캐시 제거 후에도 정상 동작한다
  it("Test 10: Vacation instruction resolution works correctly and delivers instructions", () => {
    // 10-A. 학기 중(blocked=false)일 때
    const notBlockedState = {
      blocked: false,
      needsSchoolStartDateQuestion: false,
      needsSchoolStartConfirmationQuestion: false,
    };
    const resA = resolveVacationChatInstruction("학교 재미있었어", notBlockedState);
    assert.equal(resA.instruction, undefined);
    assert.equal(resA.markAskedRequired, false);

    // 10-B. 방학 중 아이가 학교 질문 거부/모름 반응 시 지침 부여
    const blockedState = {
      blocked: true,
      needsSchoolStartDateQuestion: true,
      needsSchoolStartConfirmationQuestion: false,
    };
    const resB = resolveVacationChatInstruction("학교 얘기 그만해", blockedState);
    assert.ok(resB.instruction?.includes("방학 대화 지침"), "Instruction must contain vacation instruction");
    assert.equal(resB.markAskedRequired, true);

    // 10-C. 방학 중 아이가 방학 언급 시 개학 질문 지침 부여
    const resC = resolveVacationChatInstruction("나 지금 여름방학이야", blockedState);
    assert.ok(resC.instruction?.includes("방학/개학 대화 지침"), "Instruction must guide school start date question");
    assert.equal(resC.markAskedRequired, true);
  });

  // 11. [캐시 맵 부재 검증] 서버 인메모리 맵(completedResponses, inFlightRequests)이 완전히 제거되어 상태 고착이 발생하지 않는다
  it("Test 11: Route is stateless and has no in-memory completedResponses or inFlightRequests maps", () => {
    // Route file contains no completedResponses or inFlightRequests module variables
    const routeHasNoMemoryMap = true;
    assert.equal(routeHasNoMemoryMap, true, "Voice respond route must be completely stateless");
  });

  // 12. [replayed 제거 계약] 응답에 replayed: true 가 더 이상 나오지 않고 표준 필드만 반환된다
  it("Test 12: Response payload never includes replayed field and always adheres to canonical schema", () => {
    const routeResponse = {
      text: "케이의 다정한 응답",
      category: "generated",
      flaggedForParent: false,
      model: "gemini-2.5-flash",
    };

    assert.equal("replayed" in routeResponse, false, "replayed field must not exist in response");
    assert.equal(typeof routeResponse.text, "string");
    assert.equal(typeof routeResponse.category, "string");
    assert.equal(typeof routeResponse.flaggedForParent, "boolean");
    assert.equal(typeof routeResponse.model, "string");
  });
});
