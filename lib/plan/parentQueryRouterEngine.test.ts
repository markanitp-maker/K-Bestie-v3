import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectCrisis,
  detectRedPattern,
  routeParentQuery,
  parseParentQueryCandidateResponse,
  getGreenRuleById,
  type RouterPolicyConfig,
  type GenAILikeClient,
} from "./parentQueryRouterEngine";

process.env.PARENT_QUERY_GREEN_WHITELIST_ENABLED = "true";

function json(obj: unknown) {
  return JSON.stringify(obj);
}

function mockAi(responseText: string, opts?: { shouldThrow?: boolean }): GenAILikeClient & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    models: {
      generateContent: async () => {
        calls++;
        if (opts?.shouldThrow) throw new Error("network error");
        return { text: responseText };
      },
    },
  } as any;
}

// 최소 테스트용 정책(2 Green, 2 Red+fallback) — 실제 학년 데이터는 각 grade{N} 파일에서
// 이 엔진을 재사용해 자체 테스트를 갖는다. 여기서는 엔진 자체의 매개변수화 동작만 검증한다.
const TEST_CONFIG: RouterPolicyConfig = {
  policyVersion: "PQR-TEST-1.0",
  applicableGrade: 4,
  greenRules: [
    { id: "G-01", area: "interest", parentDraftText: "관심사 물어볼까요?", childQuestionText: "관심사 뭐야?" },
    { id: "G-02", area: "school_fun", parentDraftText: "학교 재밌었던 거 물어볼까요?", childQuestionText: "학교 재밌었어?" },
  ],
  redRules: [
    {
      id: "R-02",
      area: "peer_conflict",
      pattern: /누구랑\s*싸웠/,
      coachingText: "친구 갈등은 캐묻지 않아요.",
    },
    { id: "R-09", area: "fallback", pattern: null, coachingText: "허용 목록에 없어요." },
  ],
  greenAreaPromptGuide: "interest, school_fun",
  redAreaPromptGuide: "peer_conflict",
};

test("Crisis 신호가 있으면 LLM 호출 없이 즉시 CRISIS", async () => {
  const ai = mockAi(json({ candidate_route: "GREEN", candidate_area: "interest" }));
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "자살하고 싶다는 얘기를 들었는데 관심사도 궁금해");
  assert.equal(result.route, "CRISIS");
  assert.equal((ai as any).calls, 0);
});

test("Red 결정론 패턴은 LLM 호출 없이 즉시 RED, safeAlternative 정확히 채워짐", async () => {
  const ai = mockAi(json({ candidate_route: "GREEN" }));
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "누구랑 싸웠는지 알아봐");
  assert.equal(result.route, "RED");
  if (result.route === "RED") {
    assert.equal(result.ruleId, "R-02");
    assert.ok(result.safeAlternative);
    assert.equal(result.safeAlternative?.alternativeId, "SA-G4-PEER-01");
    assert.equal(result.safeAlternative?.alternativeArea, "peer_relationship_safe");
  }
  assert.equal((ai as any).calls, 0);
});

test("LLM UNCLEAR → default RED(fallback)", async () => {
  const ai = mockAi(json({ candidate_route: "UNCLEAR", question_count: 1 }));
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "애매한 질문");
  assert.equal(result.route, "RED");
  if (result.route === "RED") assert.equal(result.ruleId, "R-09");
});

test("LLM GREEN + 유효 조건 충족 → GREEN 확정", async () => {
  const ai = mockAi(
    json({ candidate_route: "GREEN", candidate_area: "interest", confidence: 0.9, matched_evidence: ["관심사"], question_count: 1 }),
  );
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "관심사가 뭔지 궁금해");
  assert.equal(result.route, "GREEN");
  if (result.route === "GREEN") {
    assert.equal(result.ruleId, "G-01");
    assert.equal(result.policyVersion, "PQR-TEST-1.0");
  }
});

test("LLM detected_red_area로 특정 RED 규칙에 정확히 매핑(fallback 아님)", async () => {
  const ai = mockAi(
    json({ candidate_route: "RED", detected_red_area: "peer_conflict", confidence: 0.8, detected_risks: ["갈등 캐묻기"], question_count: 1 }),
  );
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "친구랑 뭔가 있었는지 캐물어봐");
  assert.equal(result.route, "RED");
  if (result.route === "RED") assert.equal(result.ruleId, "R-02");
});

test("다중 질문 감지 시 MULTI_QUESTION_SELECT, 자동 선택 없음", async () => {
  const ai = mockAi(
    json({
      candidate_route: "GREEN",
      candidate_area: "interest",
      confidence: 0.9,
      matched_evidence: ["관심사"],
      question_count: 2,
      additional_candidate_areas: ["school_fun"],
    }),
  );
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "관심사랑 학교 재밌었던 거 둘 다 물어봐줘");
  assert.equal(result.route, "MULTI_QUESTION_SELECT");
  if (result.route === "MULTI_QUESTION_SELECT") {
    assert.equal(result.candidates.length, 2);
  }
});

test("fallback 규칙이 없는 잘못된 정책 설정은 GENERATION_FAILED로 안전하게 실패", async () => {
  const badConfig: RouterPolicyConfig = { ...TEST_CONFIG, redRules: [TEST_CONFIG.redRules[0]] };
  const ai = mockAi(json({ candidate_route: "GREEN" }));
  const result = await routeParentQuery(badConfig, ai, "fake-model", "아무 질문");
  assert.equal(result.route, "GENERATION_FAILED");
});

test("LLM 호출 실패 → GENERATION_FAILED", async () => {
  const ai = mockAi("", { shouldThrow: true });
  const result = await routeParentQuery(TEST_CONFIG, ai, "fake-model", "아무 질문");
  assert.equal(result.route, "GENERATION_FAILED");
});

test("getGreenRuleById — 정상 조회 및 미존재 시 null", () => {
  assert.equal(getGreenRuleById(TEST_CONFIG, "G-01")?.childQuestionText, "관심사 뭐야?");
  assert.equal(getGreenRuleById(TEST_CONFIG, "G-99"), null);
});

test("parseParentQueryCandidateResponse — area는 config별로 화이트리스트 검증", () => {
  const parsed = parseParentQueryCandidateResponse(TEST_CONFIG, json({ candidate_route: "GREEN", candidate_area: "dream" }));
  assert.ok(parsed);
  assert.equal(parsed!.candidateArea, null, "dream은 TEST_CONFIG의 Green 영역에 없으므로 null");
});

test("허용 목록 OFF: 미매칭 일반 질문은 차단하지 않고 중립 재작성으로 넘긴다", async () => {
  const ai = mockAi(json({ candidate_route: "UNCLEAR", candidate_area: null, detected_risks: [], question_count: 1 }));
  const result = await routeParentQuery(
    TEST_CONFIG,
    ai,
    "fake-model",
    "케이랑 이야기하는 게 좋은지 물어봐줘",
    { greenWhitelistEnabled: false },
  );
  assert.equal(result.route, "NEUTRAL_REWRITE");
});

test("허용 목록 OFF: 기존 허용 주말 질문도 주제를 바꾸지 않고 중립 재작성으로 넘긴다", async () => {
  const ai = mockAi(json({
    candidate_route: "GREEN",
    candidate_area: "interest",
    confidence: 0.95,
    matched_evidence: ["이번 주말"],
    detected_risks: [],
    question_count: 1,
  }));
  const result = await routeParentQuery(
    TEST_CONFIG,
    ai,
    "fake-model",
    "이번 주말에 뭐 하고 싶은지 물어봐줘",
    { greenWhitelistEnabled: false },
  );
  assert.equal(result.route, "NEUTRAL_REWRITE");
});

test("허용 목록 OFF: Crisis/Red는 기존 순서로 계속 차단한다", async () => {
  const crisisAi = mockAi("");
  const crisis = await routeParentQuery(
    TEST_CONFIG,
    crisisAi,
    "fake-model",
    "죽고 싶다는 말을 했는지 물어봐줘",
    { greenWhitelistEnabled: false },
  );
  assert.equal(crisis.route, "CRISIS");
  assert.equal(crisisAi.calls, 0);

  const redAi = mockAi("");
  const red = await routeParentQuery(
    TEST_CONFIG,
    redAi,
    "fake-model",
    "누구랑 싸웠는지 알아봐",
    { greenWhitelistEnabled: false },
  );
  assert.equal(red.route, "RED");
  assert.equal(redAi.calls, 0);
});
