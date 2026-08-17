import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBehaviorFunnel,
  buildPipelineFunnel,
} from "./analyticsFunnel";

test("행동 퍼널: 미션 완료는 미션 시작 고유 child 집합 안에서만 계산되며 completionRate <= 100", () => {
  const funnel = buildBehaviorFunnel({
    eligibleUnits: 10,
    loginUnits: 8,
    totalChildren: 5,
    missionStartChildIds: new Set(["c1", "c2", "c3"]),
    // c4는 mission_start에 없는데 completed에 들어온 경우 방어
    missionCompletedChildIds: new Set(["c1", "c2", "c4"]),
    socialChildIds: new Set(["c1", "c5"]),
  });

  const access = funnel.find((s) => s.key === "access")!;
  assert.equal(access.target, 10);
  assert.equal(access.completed, 8);
  assert.equal(access.completionRate, 80);

  const start = funnel.find((s) => s.key === "mission_start")!;
  assert.equal(start.target, 5);
  assert.equal(start.completed, 3);
  assert.equal(start.completionRate, 60);

  const complete = funnel.find((s) => s.key === "mission_complete")!;
  assert.equal(complete.target, 3); // missionStartChildIds.size
  assert.equal(complete.completed, 2); // c1, c2 (c4 excluded because not in start)
  assert.equal(complete.completionRate, 66.7);
  assert(complete.completionRate! <= 100);

  const social = funnel.find((s) => s.key === "social")!;
  assert.equal(social.target, 5);
  assert.equal(social.completed, 2);
  assert.equal(social.completionRate, 40);

  for (const step of funnel) {
    if (step.completionRate != null) {
      assert(step.completionRate <= 100, `${step.key} rate ${step.completionRate} exceeds 100%`);
      assert(step.completed <= step.target, `${step.key} completed ${step.completed} > target ${step.target}`);
    }
  }
});

test("파이프라인 퍼널: 앞 단계 성공 집합 밖의 항목은 뒤 단계 분자에 안 들어가며 100% 초과가 없다", () => {
  // Production 실측과 유사한 상황:
  // collection: 114개 중 107개 수집
  // correction: 전체 대상 110개 성공 중 107개 수집 슬롯 안에서는 105개 성공
  // memory: 100개 성공
  // report: 109개 생성 (수집/보정/메모리 성공 슬롯 안에서는 98개)
  // report_view: 109개 중 40개 열람
  const allTargets = new Set(["s1", "s2", "s3", "s4", "s5"]);
  const rawKeys = new Set(["s1", "s2", "s3"]); // 3개 수집 (s4, s5 미수집)
  // correctionSuccessKeys에 s4(수집 안 됨)가 섞여 있어도 수집 슬롯 안에서만 계산
  const correctionSuccessKeys = new Set(["s1", "s2", "s4"]);
  // memorySuccessKeys에 s4, s5가 섞여 있어도 correction 성공 슬롯 안에서만 계산
  const memorySuccessKeys = new Set(["s1", "s4", "s5"]);
  // reportSuccessKeys에 s2, s3, s4가 섞여 있어도 memory 성공 슬롯 안에서만 계산
  const reportSuccessKeys = new Set(["s1", "s2", "s3", "s4"]);

  const generatedReportIds = new Set(["r1", "r2", "r3"]);
  // viewedReportIds에 과거/타 기간 리포트 r99가 섞여 있어도 생성된 리포트 안에서만 계산
  const viewedReportIds = new Set(["r1", "r2", "r99"]);

  const funnel = buildPipelineFunnel({
    allTargetKeys: allTargets,
    rawKeys,
    correctionSuccessKeys,
    memorySuccessKeys,
    reportSuccessKeys,
    generatedReportIds,
    viewedReportIds,
  });

  const collection = funnel.find((s) => s.key === "collection")!;
  assert.equal(collection.target, 5);
  assert.equal(collection.completed, 3);
  assert.equal(collection.completionRate, 60);

  const correction = funnel.find((s) => s.key === "correction")!;
  assert.equal(correction.target, 3); // rawKeys.size
  assert.equal(correction.completed, 2); // s1, s2 (s4 excluded)
  assert.equal(correction.completionRate, 66.7);
  assert(correction.completionRate! <= 100);

  const memory = funnel.find((s) => s.key === "memory")!;
  assert.equal(memory.target, 2); // correctionCompleted
  assert.equal(memory.completed, 1); // s1 (s4, s5 excluded)
  assert.equal(memory.completionRate, 50);
  assert(memory.completionRate! <= 100);

  const report = funnel.find((s) => s.key === "report")!;
  assert.equal(report.target, 1); // memoryCompleted
  assert.equal(report.completed, 1); // s1
  assert.equal(report.completionRate, 100);
  assert(report.completionRate! <= 100);

  const reportView = funnel.find((s) => s.key === "report_view")!;
  assert.equal(reportView.target, 3); // generatedReportIds.size
  assert.equal(reportView.completed, 2); // r1, r2 (r99 excluded)
  assert.equal(reportView.completionRate, 66.7);
  assert(reportView.completionRate! <= 100);

  for (const step of funnel) {
    if (step.completionRate != null) {
      assert(step.completionRate <= 100, `${step.key} rate ${step.completionRate} exceeds 100%`);
      assert(step.completed <= step.target, `${step.key} completed ${step.completed} > target ${step.target}`);
    }
  }
});
