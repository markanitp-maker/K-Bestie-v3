import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRedPattern } from "./parentQueryRouterEngine";
import * as G1 from "./parentQueryRouterGrade1";
import * as G2 from "./parentQueryRouterGrade2";
import * as G3 from "./parentQueryRouterGrade3";
import * as G5 from "./parentQueryRouterGrade5";
import * as G6 from "./parentQueryRouterGrade6";

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
  { name: "grade1", mod: G1, greenCount: 7, redCount: 6, hasSensitive: false },
  { name: "grade2", mod: G2, greenCount: 7, redCount: 6, hasSensitive: false },
  { name: "grade3", mod: G3, greenCount: 8, redCount: 6, hasSensitive: false },
  { name: "grade5", mod: G5, greenCount: 8, redCount: 9, hasSensitive: true },
  { name: "grade6", mod: G6, greenCount: 8, redCount: 9, hasSensitive: true },
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
    const routeFn = Object.values(g.mod).find(
      (v) => typeof v === "function" && (v as any).name?.startsWith("routeParentQueryGrade"),
    ) as any;
    const result = await routeFn(ai, "fake-model", "요즘 뭐에 관심 있는지 궁금해");
    assert.equal(result.route, "GREEN");
    assert.equal(result.ruleId, "G-01");
  });

  test(`${g.name}: getGreenRuleById로 G-01 조회`, () => {
    const rule = g.mod.getGreenRuleById("G-01");
    assert.equal(rule?.area, "interest");
  });
}

// grade5/6 전용: 외모·이성·SNS 강한 Red 게이트 결정론 패턴 확인
for (const g of [G5, G6] as const) {
  test(`${(g as any).POLICY_VERSION}: R-06(appearance_body) 결정론 패턴 — 살쪘는지 물어봐`, () => {
    const config = {
      policyVersion: g.POLICY_VERSION,
      applicableGrade: g.APPLICABLE_GRADE,
      greenRules: g.GREEN_RULES,
      redRules: g.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "살쪘는지 물어봐줘");
    assert.equal(rule?.area, "appearance_body");
  });

  test(`${(g as any).POLICY_VERSION}: R-07(romance) 결정론 패턴 — 남자친구 있는지 물어봐`, () => {
    const config = {
      policyVersion: g.POLICY_VERSION,
      applicableGrade: g.APPLICABLE_GRADE,
      greenRules: g.GREEN_RULES,
      redRules: g.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "남자친구 있는지 물어봐");
    assert.equal(rule?.area, "romance");
  });

  test(`${(g as any).POLICY_VERSION}: 무해한 식사 질문("오늘 얼마나 먹었는지")은 R-06 과차단하지 않음(claude-review 재지적 회귀)`, () => {
    const config = {
      policyVersion: g.POLICY_VERSION,
      applicableGrade: g.APPLICABLE_GRADE,
      greenRules: g.GREEN_RULES,
      redRules: g.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "오늘 얼마나 먹었는지 물어봐줘");
    assert.equal(rule, null, "체중/다이어트 맥락 없이는 결정론 RED로 즉시 확정되면 안 된다");
  });

  test(`${(g as any).POLICY_VERSION}: 체중 맥락이 함께 있는 식사량 질문은 여전히 R-06으로 차단`, () => {
    const config = {
      policyVersion: g.POLICY_VERSION,
      applicableGrade: g.APPLICABLE_GRADE,
      greenRules: g.GREEN_RULES,
      redRules: g.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "살 안 찌려면 얼마나 먹는지 확인해봐");
    assert.equal(rule?.area, "appearance_body");
  });

  test(`${(g as any).POLICY_VERSION}: R-08(sns_control) 결정론 패턴 — 인스타 누구랑 연락하는지`, () => {
    const config = {
      policyVersion: g.POLICY_VERSION,
      applicableGrade: g.APPLICABLE_GRADE,
      greenRules: g.GREEN_RULES,
      redRules: g.RED_RULES,
      greenAreaPromptGuide: "",
      redAreaPromptGuide: "",
    };
    const rule = detectRedPattern(config as any, "인스타로 누구랑 연락하는지 물어봐");
    assert.equal(rule?.area, "sns_control");
  });
}

test("모든 학년의 policy_version이 서로 다르다", () => {
  const versions = [G1.POLICY_VERSION, G2.POLICY_VERSION, G3.POLICY_VERSION, G5.POLICY_VERSION, G6.POLICY_VERSION];
  assert.equal(new Set(versions).size, versions.length);
});
