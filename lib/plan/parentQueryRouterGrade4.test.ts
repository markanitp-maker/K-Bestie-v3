import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectCrisis,
  detectRedPattern,
  routeParentQueryGrade4,
  parseParentQueryCandidateResponse,
  getGreenRuleById,
  GREEN_RULES,
  RED_RULES,
  POLICY_VERSION,
  type GenAILikeClient,
} from "./parentQueryRouterGrade4";

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

// ── §15.1 판정 순서 ─────────────────────────────────────────────────────

test("Crisis 신호가 있으면 LLM 호출 없이 즉시 CRISIS", async () => {
  const ai = mockAi(json({ candidate_route: "GREEN", candidate_area: "interest" }));
  const result = await routeParentQueryGrade4(ai, "fake-model", "우리 애가 자살하고 싶다고 했어요 요즘 좋아하는 것도 물어봐줘");
  assert.equal(result.route, "CRISIS");
  assert.equal((ai as any).calls, 0, "Crisis는 LLM을 호출하지 않아야 한다");
});

test("Red 결정론 패턴이 있으면 LLM 호출 없이 즉시 RED (Green 키워드 동반해도)", async () => {
  const ai = mockAi(json({ candidate_route: "GREEN", candidate_area: "interest" }));
  const result = await routeParentQueryGrade4(ai, "fake-model", "누구랑 싸웠는지 알아봐, 요즘 좋아하는 것도 물어봐줘");
  assert.equal(result.route, "RED");
  if (result.route === "RED") assert.equal(result.ruleId, "R-02");
  assert.equal((ai as any).calls, 0, "Red 결정론 매칭 시 LLM을 호출하지 않아야 한다");
});

test("Green 근거 없음(UNCLEAR) → default Red(R-09)", async () => {
  const ai = mockAi(json({ candidate_route: "UNCLEAR", candidate_area: null, confidence: 0.2, matched_evidence: [], detected_risks: [], question_count: 1 }));
  const result = await routeParentQueryGrade4(ai, "fake-model", "그냥 아무거나 물어봐줘");
  assert.equal(result.route, "RED");
  if (result.route === "RED") assert.equal(result.ruleId, "R-09");
});

test("LLM confidence가 높아도 whitelist 미매칭(area=null) → Red", async () => {
  const ai = mockAi(
    json({ candidate_route: "GREEN", candidate_area: null, confidence: 0.95, matched_evidence: ["뭔가"], detected_risks: [], question_count: 1 }),
  );
  const result = await routeParentQueryGrade4(ai, "fake-model", "애매한 질문");
  assert.equal(result.route, "RED");
});

test("LLM이 GREEN이라 해도 detected_risks가 있으면 Red(방어적 fail-closed)", async () => {
  const ai = mockAi(
    json({
      candidate_route: "GREEN",
      candidate_area: "interest",
      confidence: 0.9,
      matched_evidence: ["관심사"],
      detected_risks: ["원인을 캐묻는 뉘앙스"],
      question_count: 1,
    }),
  );
  const result = await routeParentQueryGrade4(ai, "fake-model", "요즘 뭐 때문에 그렇게 좋아하는지 캐물어봐");
  assert.equal(result.route, "RED");
});

test("LLM이 candidate_route=RED + detected_red_area로 판정하면 해당 area의 RED 규칙으로 매핑(R-06 fallback 아님)", async () => {
  const ai = mockAi(
    json({
      candidate_route: "RED",
      candidate_area: null,
      detected_red_area: "emotion_cause",
      confidence: 0.8,
      matched_evidence: ["원인 캐묻기"],
      detected_risks: ["감정 원인 단정"],
      question_count: 1,
    }),
  );
  // §15.3 "어제 속상해 보였는데 친구 때문인지 캐봐" — 정규식으로는 안 잡히고(느슨한 표현)
  // LLM 시맨틱 판정에 의존하는 대표 케이스. claude-review 재지적 회귀: candidate_area(Green
  // 전용 필드)를 잘못 조회해 항상 R-06으로 떨어지던 버그를 detected_red_area 필드 분리로
  // 고쳤다 — 반드시 R-01(emotion_cause)로 정확히 매핑돼야 하고 fallback이면 안 된다.
  const result = await routeParentQueryGrade4(ai, "fake-model", "어제 속상해 보였는데 친구 때문인지 캐봐");
  assert.equal(result.route, "RED");
  if (result.route === "RED") {
    assert.equal(result.ruleId, "R-01");
    assert.equal(result.area, "emotion_cause");
    assert.notEqual(result.ruleId, "R-06");
  }
});

test("detected_red_area가 없으면(null) LLM RED 판정도 fallback(R-09)으로 안전하게 처리", async () => {
  const ai = mockAi(
    json({
      candidate_route: "RED",
      candidate_area: null,
      detected_red_area: null,
      confidence: 0.7,
      matched_evidence: ["애매한 위험 신호"],
      detected_risks: ["분류하기 어려운 위험"],
      question_count: 1,
    }),
  );
  const result = await routeParentQueryGrade4(ai, "fake-model", "뭔가 애매하게 위험해 보이는 질문");
  assert.equal(result.route, "RED");
  if (result.route === "RED") assert.equal(result.ruleId, "R-09");
});

test("detected_red_area에 유효하지 않은 값이 오면 null로 정규화된다", () => {
  const parsed = parseParentQueryCandidateResponse(
    json({ candidate_route: "RED", detected_red_area: "정체불명영역", confidence: 0.8, question_count: 1 }),
  );
  assert.ok(parsed);
  assert.equal(parsed!.detectedRedArea, null);
});

// ── §15.2 Green — 결정론 데이터 테이블 자체의 정합성 ──────────────────────

test("GREEN_RULES 8개 영역이 요청서 표와 정확히 일치", () => {
  const expected: Record<string, string> = {
    "G-01": "interest",
    "G-02": "school_fun",
    "G-03": "subject_like",
    "G-04": "food_pref",
    "G-05": "pride",
    "G-06": "content",
    "G-07": "weekend",
    "G-08": "dream",
  };
  assert.equal(GREEN_RULES.length, 8);
  for (const [id, area] of Object.entries(expected)) {
    const rule = getGreenRuleById(id);
    assert.ok(rule, `${id} 규칙이 존재해야 한다`);
    assert.equal(rule!.area, area);
  }
});

test("Green 확정 시 부모 확인용 문구와 아이 실제 질문이 분리되고, 아이 질문에 부모 개입이 노출되지 않는다", async () => {
  const ai = mockAi(
    json({
      candidate_route: "GREEN",
      candidate_area: "food_pref",
      confidence: 0.92,
      matched_evidence: ["먹고 싶은"],
      detected_risks: [],
      question_count: 1,
    }),
  );
  const result = await routeParentQueryGrade4(ai, "fake-model", "요즘 먹고 싶은 음식이 있는지 물어봐 줘");
  assert.equal(result.route, "GREEN");
  if (result.route === "GREEN") {
    assert.equal(result.ruleId, "G-04");
    assert.notEqual(result.parentDraftText, result.childQuestionText);
    assert.ok(!result.childQuestionText.includes("부모"));
    assert.ok(!result.childQuestionText.includes("엄마가"));
    assert.equal(result.policyVersion, POLICY_VERSION);
  }
});

// ── §15.3 Red 결정론 패턴 — 요청서 예시 문장 직접 매칭 ─────────────────────

test("R-02 결정론 패턴: 누구랑 싸웠는지 알아봐", () => {
  const rule = detectRedPattern("누구랑 싸웠는지 알아봐");
  assert.equal(rule?.id, "R-02");
});

test("R-03 결정론 패턴: 시험 점수가 왜 떨어졌는지 물어봐", () => {
  const rule = detectRedPattern("시험 점수가 왜 떨어졌는지 물어봐");
  assert.equal(rule?.id, "R-03");
});

test("R-04 결정론 패턴: 나한테 숨기는 게 있는지 알아봐", () => {
  const rule = detectRedPattern("나한테 숨기는 게 있는지 알아봐");
  assert.equal(rule?.id, "R-04");
});

test("R-05 결정론 패턴: 엄마를 싫어하는지 물어봐", () => {
  const rule = detectRedPattern("엄마를 싫어하는지 물어봐");
  assert.equal(rule?.id, "R-05");
});

test("R-02 결정론 매칭 시 같은 주제의 승인된 안전 대안만 제공한다", async () => {
  const ai = mockAi(json({ candidate_route: "GREEN", candidate_area: "interest" }));
  const result = await routeParentQueryGrade4(ai, "fake-model", "누구랑 싸웠는지 알아봐");
  assert.equal(result.route, "RED");
  if (result.route === "RED") {
    assert.ok(result.safeAlternative);
    assert.equal(result.safeAlternative?.alternativeId, "SA-G4-PEER-01");
    assert.equal(result.safeAlternative?.requestedArea, "peer_conflict");
    assert.equal(result.safeAlternative?.alternativeArea, "peer_relationship_safe");
    assert.equal(result.safeAlternative?.childQuestionText, "요즘 친구들과 지내는 건 어때?");
    assert.notEqual(result.safeAlternative?.alternativeArea, "school_fun");
  }
});

test("RED_RULES 9개 전부 존재하고 민감 영역에는 임의 대안 규칙이 없다", () => {
  assert.equal(RED_RULES.length, 9);
  for (const id of ["R-04", "R-05", "R-06", "R-07", "R-08", "R-09"]) {
    assert.ok(RED_RULES.some((rule) => rule.id === id));
  }
});

// ── §15.4 다중 질문 ─────────────────────────────────────────────────────

test("Green 2개 이상 감지 시 자동 등록 대신 선택 UI(MULTI_QUESTION_SELECT)", async () => {
  const ai = mockAi(
    json({
      candidate_route: "GREEN",
      candidate_area: "interest",
      confidence: 0.9,
      matched_evidence: ["뭘 좋아하는지"],
      detected_risks: [],
      question_count: 3,
      additional_candidate_areas: ["school_fun", "weekend"],
    }),
  );
  const result = await routeParentQueryGrade4(
    ai,
    "fake-model",
    "요즘 뭘 좋아하는지, 학교에서 재밌는 건 뭔지, 주말에 뭐 하고 싶은지 물어봐 줘",
  );
  assert.equal(result.route, "MULTI_QUESTION_SELECT");
  if (result.route === "MULTI_QUESTION_SELECT") {
    assert.equal(result.questionCount, 3);
    assert.equal(result.candidates.length, 3);
    assert.deepEqual(
      result.candidates.map((c) => c.ruleId),
      ["G-01", "G-02", "G-07"],
    );
  }
});

test("Green+Red 혼재 다중 질문 → 결정론 Red 패턴이 먼저 걸리면 Red(선택 UI로 가지 않음)", async () => {
  const ai = mockAi(json({ candidate_route: "GREEN", candidate_area: "interest", confidence: 0.9, question_count: 2 }));
  const result = await routeParentQueryGrade4(ai, "fake-model", "누구랑 싸웠는지랑 좋아하는 것도 물어봐 줘");
  assert.equal(result.route, "RED");
  assert.equal((ai as any).calls, 0);
});

// ── 생성 실패 안전망 ──────────────────────────────────────────────────────

test("LLM 호출 자체가 실패하면 GENERATION_FAILED(BLOCKED로 오분류하지 않음)", async () => {
  const ai = mockAi("", { shouldThrow: true });
  const result = await routeParentQueryGrade4(ai, "fake-model", "아무 질문");
  assert.equal(result.route, "GENERATION_FAILED");
});

test("LLM 응답이 스키마를 어기면 GENERATION_FAILED", async () => {
  const ai = mockAi("이건 JSON이 아니에요");
  const result = await routeParentQueryGrade4(ai, "fake-model", "아무 질문");
  assert.equal(result.route, "GENERATION_FAILED");
});

test("parseParentQueryCandidateResponse — 정상 파싱", () => {
  const parsed = parseParentQueryCandidateResponse(
    json({ candidate_route: "GREEN", candidate_area: "dream", confidence: 0.88, matched_evidence: ["장래희망"], detected_risks: [], question_count: 1 }),
  );
  assert.ok(parsed);
  assert.equal(parsed!.candidateArea, "dream");
});

test("parseParentQueryCandidateResponse — 유효하지 않은 area는 null로 정규화", () => {
  const parsed = parseParentQueryCandidateResponse(
    json({ candidate_route: "GREEN", candidate_area: "정체불명영역", confidence: 0.9, question_count: 1 }),
  );
  assert.ok(parsed);
  assert.equal(parsed!.candidateArea, null);
});

test("4학년 허용 목록 OFF: 미매칭 질문은 기존 기본 차단 대신 중립 재작성으로 넘긴다", async () => {
  const ai = mockAi(json({
    candidate_route: "UNCLEAR",
    candidate_area: null,
    detected_red_area: null,
    confidence: 0.8,
    matched_evidence: ["케이와 대화"],
    detected_risks: [],
    question_count: 1,
  }));
  const result = await routeParentQueryGrade4(
    ai,
    "fake-model",
    "케이랑 이야기하는 게 좋은지 물어봐줘",
    { greenWhitelistEnabled: false },
  );
  assert.equal(result.route, "NEUTRAL_REWRITE");
});
