import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRedPattern } from "./parentQueryRouterEngine";
import * as G1 from "./parentQueryRouterGrade1";
import * as G2 from "./parentQueryRouterGrade2";
import * as G3 from "./parentQueryRouterGrade3";
import * as G4 from "./parentQueryRouterGrade4";
import * as G5 from "./parentQueryRouterGrade5";
import * as G6 from "./parentQueryRouterGrade6";
import { SAFE_ALTERNATIVE_ALLOWED_AREA_MAP } from "./parentQuerySafeAlternatives";

function json(obj: unknown) {
  return JSON.stringify(obj);
}

function mockAi(responseText: string) {
  return {
    models: {
      generateContent: async () => ({ text: responseText }),
    },
  } as any;
}

const GRADES = [
  { name: "grade1", mod: G1, route: G1.routeParentQueryGrade1, greenCount: 7, redCount: 9 },
  { name: "grade2", mod: G2, route: G2.routeParentQueryGrade2, greenCount: 7, redCount: 9 },
  { name: "grade3", mod: G3, route: G3.routeParentQueryGrade3, greenCount: 8, redCount: 9 },
  { name: "grade4", mod: G4, route: G4.routeParentQueryGrade4, greenCount: 8, redCount: 9 },
  { name: "grade5", mod: G5, route: G5.routeParentQueryGrade5, greenCount: 8, redCount: 9 },
  { name: "grade6", mod: G6, route: G6.routeParentQueryGrade6, greenCount: 8, redCount: 9 },
];

for (const g of GRADES) {
  test(`${g.name}: GREEN_RULES/RED_RULES 개수와 fallback 존재`, () => {
    assert.equal(g.mod.GREEN_RULES.length, g.greenCount);
    assert.equal(g.mod.RED_RULES.length, g.redCount);
    const fallback = g.mod.RED_RULES.find((r: any) => r.area === "fallback");
    assert.ok(fallback, `${g.name}에 fallback RED 규칙이 있어야 한다`);
    assert.equal(fallback.pattern, null);
  });

  test(`${g.name}: R-02(peer_conflict) 결정론 패턴 — 누구랑 싸웠는지 알아봐`, () => {
    const config = {
      policyVersion: g.mod.POLICY_VERSION,
      applicableGrade: g.mod.APPLICABLE_GRADE,
      greenRules: g.mod.GREEN_RULES,
      redRules: g.mod.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "누구랑 싸웠는지 알아봐");
    assert.equal(rule?.area, "peer_conflict");
  });

  test(`${g.name}: GREEN 파이프라인 — G-01(interest) 확정`, async () => {
    const ai = mockAi(
      json({
        candidate_route: "GREEN",
        candidate_area: "interest",
        confidence: 0.9,
        matched_evidence: ["관심사"],
        detected_risks: [],
        question_count: 1,
      }),
    );
    const result = await g.route(ai, "fake-model", "요즘 뭐에 관심 있는지 궁금해");
    assert.equal(result.route, "GREEN");
    assert.equal(result.ruleId, "G-01");
  });

  test(`${g.name}: getGreenRuleById로 G-01 조회`, () => {
    const rule = g.mod.getGreenRuleById("G-01");
    assert.equal(rule?.area, "interest");
  });
}

// 전 학년: 동일 주제 안전 대안과 민감 영역 fail-closed를 결정론적으로 검증한다.
for (const g of GRADES) {
  test(`${g.name}: 친구 갈등은 peer_relationship_safe 외 대안을 만들지 않는다`, async () => {
    const result = await g.route(mockAi(""), "fake-model", "어제 누구랑 싸웠니?");
    assert.equal(result.route, "RED");
    if (result.route !== "RED") return;
    assert.equal(result.area, "peer_conflict");
    assert.equal(result.safeAlternative?.requestedArea, "peer_conflict");
    assert.equal(result.safeAlternative?.alternativeArea, "peer_relationship_safe");
    assert.equal(result.safeAlternative?.childQuestionText, "요즘 친구들과 지내는 건 어때?");
    assert.notEqual(result.safeAlternative?.alternativeArea, "school_fun");
  });

  test(`${g.name}: 감정 전제는 emotion_event_safe로만 완화한다`, async () => {
    const result = await g.route(mockAi(""), "fake-model", "어제 속상한 일 있었어?");
    assert.equal(result.route, "RED");
    if (result.route !== "RED") return;
    assert.equal(result.area, "emotion_cause");
    assert.equal(result.safeAlternative?.alternativeArea, "emotion_event_safe");
    assert.equal(result.safeAlternative?.childQuestionText, "어제 기억에 남는 일 있었어?");
    assert.notEqual(result.safeAlternative?.alternativeArea, "school_fun");
  });

  for (const fixture of [
    { text: "나한테 숨기는 게 있는지 물어봐줘", area: "secret" },
    { text: "요즘 살쪘는지 물어봐줘", area: "appearance_body" },
    { text: "누구 좋아하는지 물어봐줘", area: "romance" },
    { text: "SNS에서 누구랑 대화하는지 알아봐줘", area: "sns_control" },
  ]) {
    test(`${g.name}: ${fixture.area}는 대안 없이 차단한다`, async () => {
      const result = await g.route(mockAi(""), "fake-model", fixture.text);
      assert.equal(result.route, "RED");
      if (result.route !== "RED") return;
      assert.equal(result.area, fixture.area);
      assert.equal(result.safeAlternative, null);
    });
  }

  test(`${g.name}: 허용 대안 area gate를 항상 만족한다`, async () => {
    for (const text of ["어제 누구랑 싸웠니?", "어제 속상한 일 있었어?", "시험 점수가 왜 떨어졌는지 물어봐"] as const) {
      const result = await g.route(mockAi(""), "fake-model", text);
      assert.equal(result.route, "RED");
      if (result.route !== "RED" || !result.safeAlternative) continue;
      assert.ok(
        (SAFE_ALTERNATIVE_ALLOWED_AREA_MAP[result.area] ?? []).includes(result.safeAlternative.alternativeArea),
        `${result.area} -> ${result.safeAlternative.alternativeArea}는 허용된 동일 주제 매핑이어야 한다`,
      );
      assert.equal(result.safeAlternative.expertReviewStatus, "APPROVED");
      assert.equal(result.safeAlternative.productionEnabled, true);
    }
  });

  test(`${g.name}: 정상 weekend Green은 기존 영역을 유지한다`, async () => {
    const result = await g.route(
      mockAi(json({
        candidate_route: "GREEN",
        candidate_area: "weekend",
        confidence: 0.95,
        matched_evidence: ["이번 주말"],
        detected_risks: [],
        question_count: 1,
      })),
      "fake-model",
      "이번 주말에 뭐 하고 싶은지 물어봐줘",
    );
    assert.equal(result.route, "GREEN");
    if (result.route === "GREEN") assert.equal(result.area, "weekend");
  });

  test(`${g.name}: R-06(appearance_body) 결정론 패턴 — 살쪘는지 물어봐`, () => {
    const config = {
      policyVersion: g.mod.POLICY_VERSION,
      applicableGrade: g.mod.APPLICABLE_GRADE,
      greenRules: g.mod.GREEN_RULES,
      redRules: g.mod.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "살쪘는지 물어봐줘");
    assert.equal(rule?.area, "appearance_body");
  });

  test(`${g.name}: R-07(romance) 결정론 패턴 — 남자친구 있는지 물어봐`, () => {
    const config = {
      policyVersion: g.mod.POLICY_VERSION,
      applicableGrade: g.mod.APPLICABLE_GRADE,
      greenRules: g.mod.GREEN_RULES,
      redRules: g.mod.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "남자친구 있는지 물어봐");
    assert.equal(rule?.area, "romance");
  });

  test(`${g.name}: 무해한 식사 질문("오늘 얼마나 먹었는지")은 R-06 과차단하지 않음`, () => {
    const config = {
      policyVersion: g.mod.POLICY_VERSION,
      applicableGrade: g.mod.APPLICABLE_GRADE,
      greenRules: g.mod.GREEN_RULES,
      redRules: g.mod.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "오늘 얼마나 먹었는지 물어봐줘");
    assert.equal(rule, null, "체중/다이어트 맥락 없이는 결정론 RED로 즉시 확정되면 안 된다");
  });

  test(`${g.name}: 체중 맥락이 함께 있는 식사량 질문은 여전히 R-06으로 차단`, () => {
    const config = {
      policyVersion: g.mod.POLICY_VERSION,
      applicableGrade: g.mod.APPLICABLE_GRADE,
      greenRules: g.mod.GREEN_RULES,
      redRules: g.mod.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "살 안 찌려면 얼마나 먹는지 확인해봐");
    assert.equal(rule?.area, "appearance_body");
  });

  test(`${g.name}: R-08(sns_control) 결정론 패턴 — 인스타 누구랑 연락하는지`, () => {
    const config = {
      policyVersion: g.mod.POLICY_VERSION,
      applicableGrade: g.mod.APPLICABLE_GRADE,
      greenRules: g.mod.GREEN_RULES,
      redRules: g.mod.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "인스타로 누구랑 연락하는지 물어봐");
    assert.equal(rule?.area, "sns_control");
  });
}

test("모든 학년의 policy_version이 서로 다르다", () => {
  const versions = [G1.POLICY_VERSION, G2.POLICY_VERSION, G3.POLICY_VERSION, G4.POLICY_VERSION, G5.POLICY_VERSION, G6.POLICY_VERSION];
  assert.equal(new Set(versions).size, versions.length);
});
