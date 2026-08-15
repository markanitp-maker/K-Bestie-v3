import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEffectiveParentQuery,
  extractReportEvidence,
  formatParentKnowledgeContext,
  rankAndDedupeParentEvidence,
  retrieveParentKContext,
  scoreParentEvidence,
  type ParentKnowledgeEvidence,
} from "./parentKnowledgeRetrieval";

test("대시보드는 영역별 최신 유효값을 유지하고 빈 최신값으로 덮지 않는다", () => {
  const rows = [
    { id: "new", business_date: "2026-08-08", dashboard_cards: { emotion_hint: "", study_concerns: "수학 숙제가 부담돼요" } },
    { id: "old", business_date: "2026-08-07", dashboard_cards: { emotion_hint: "야외에서 제일 즐거워해요", study_concerns: "과거 공부 내용" } },
  ];
  const evidence = extractReportEvidence(rows, [], false).filter((item) => item.source === "dashboard");
  assert.deepEqual(evidence.map((item) => [item.area, item.content, item.date]), [
    ["공부 고민", "수학 숙제가 부담돼요", "2026-08-08"],
    ["마음 흐름", "야외에서 제일 즐거워해요", "2026-08-07"],
  ]);
});

test("Care Start에는 상세 전용 필드를 넣지 않고 부모 공개 요약만 사용한다", () => {
  const daily = [{ id: "d1", business_date: "2026-08-08", summary_line: "오늘은 신나는 하루", parent_guide: "상세 부모 가이드", school_academy_life: "상세 학교 정보", dashboard_cards: { peer_friendship: "친구와 즐겁게 놀이" } }];
  const weekly = [{ id: "w1", week_start: "2026-08-03", week_end: "2026-08-09", summary_text: "주간 공개 요약", highlights: ["친구와 협동", "야외 활동"], detail_text: "주간 상세 분석" }];
  const restricted = extractReportEvidence(daily, weekly, false);
  assert.equal(restricted.some((item) => item.source === "detailed_report"), false);
  assert.equal(restricted.some((item) => item.source === "daily_report"), true);
  assert.equal(restricted.some((item) => item.source === "dashboard"), true);
  assert.equal(restricted.some((item) => item.source === "weekly_report"), true);
  assert.equal(restricted.some((item) => item.content === "친구와 협동 · 야외 활동"), true);

  const allowed = extractReportEvidence(daily, weekly, true);
  assert.equal(allowed.some((item) => item.source === "detailed_report" && item.content === "상세 학교 정보"), true);
  assert.equal(allowed.some((item) => item.source === "detailed_report" && item.content === "주간 상세 분석"), true);
});

test("야외·공부·게임 질문은 실제 부모 요약 근거와 관련도로 연결된다", () => {
  const now = new Date("2026-08-08T12:00:00Z");
  assert.ok(scoreParentEvidence("야외에서 노는 걸 좋아해?", { content: "야외에서 제일 즐거워해요", area: "마음 흐름", date: "2026-08-07" }, now) >= 0.16);
  assert.ok(scoreParentEvidence("요즘 공부 때문에 힘들어해?", { content: "수학 숙제에 부담을 느껴요", area: "공부 고민", date: "2026-08-07" }, now) >= 0.16);
  assert.ok(scoreParentEvidence("요즘 무슨 게임 좋아해?", { content: "로블록스 게임을 즐겨 함", area: "관심사", date: "2026-08-01" }, now) >= 0.16);
});

test("후속 질문은 직전 부모-K 주제를 검색어에 유지한다", () => {
  const effective = buildEffectiveParentQuery("원래도 그래?", [
    { role: "user", text: "서현이가 야외에서 노는 걸 좋아해?" },
    { role: "k", text: "최근 리포트에서는 야외 활동을 즐기는 모습이 있었어요." },
  ]);
  assert.match(effective, /야외/);
  assert.match(effective, /원래도 그래/);
  assert.doesNotMatch(effective, /최근 리포트/);
});

test("daily/dashboard 중복은 하나로 합치고 출처·날짜 구조를 보존한다", () => {
  const base = {
    date: "2026-08-07",
    area: "마음 흐름",
    content: "야외에서 제일 즐거워해요",
    relevance: 0,
    confidence: 0.85,
    businessDate: "2026-08-07",
    sourceDate: "2026-08-07",
    temporalMatch: "NONE" as const,
    primary: true,
  };
  const evidence: ParentKnowledgeEvidence[] = [
    { ...base, id: "daily", source: "daily_report" },
    { ...base, id: "dashboard", source: "dashboard" },
    { id: "memory", source: "memory_fact", date: "2026-08-01", area: "interest", content: "로블록스 게임을 즐겨 함", relevance: 0.8, confidence: 0.9, businessDate: null, sourceDate: "2026-08-01", temporalMatch: "NONE", primary: true },
  ];
  const ranked = rankAndDedupeParentEvidence("야외에서 노는 걸 좋아해?", evidence);
  assert.equal(ranked.filter((item) => item.content === base.content).length, 1);
  const context = formatParentKnowledgeContext(ranked);
  assert.match(context, /일일 리포트|부모 대시보드/);
  assert.match(context, /2026-08-07/);
  assert.doesNotMatch(context, /chat_messages|corrected_daily/);
});

test("모든 source는 동일한 검증 childId만 조회하고 형제자매 ID를 섞지 않는다", async () => {
  const requestedChildIds: string[] = [];
  const result = await retrieveParentKContext({} as any, {
    childId: "child-a",
    query: "야외에서 노는 걸 좋아해?",
    allowDetailedReports: true,
  }, {
    loadDaily: async (_db, childId) => {
      requestedChildIds.push(childId);
      return { rows: [{ id: "d1", child_id: childId, business_date: "2026-08-07", dashboard_cards: { emotion_hint: "야외에서 제일 즐거워해요" } }], error: null };
    },
    loadWeekly: async (_db, childId) => {
      requestedChildIds.push(childId);
      return { rows: [], error: null };
    },
    searchMemory: async (_db, childId) => {
      requestedChildIds.push(childId);
      return { status: "no_data" };
    },
  });
  assert.deepEqual(requestedChildIds, ["child-a", "child-a", "child-a"]);
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.evidence.every((item) => item.id.includes("child-b") === false), true);
});

test("EXACT_DATE는 daily loader에 target date를 전달하고 다른 날짜 memory를 primary에서 제외한다", async () => {
  const requestedKinds: string[] = [];
  const result = await retrieveParentKContext({} as any, {
    childId: "child-a",
    query: "어제 뭐 했어?",
    allowDetailedReports: false,
    now: new Date("2026-08-10T03:00:00.000Z"),
  }, {
    loadDaily: async (_db, _childId, temporal) => {
      requestedKinds.push(`daily:${temporal.kind}:${temporal.targetDate}`);
      return { rows: [{ id: "d1", business_date: "2026-08-09", summary_line: "놀이터에서 즐겁게 놀았어요" }], error: null };
    },
    loadWeekly: async (_db, _childId, temporal) => {
      requestedKinds.push(`weekly:${temporal.kind}`);
      return { rows: [], error: null };
    },
    searchMemory: async () => ({
      status: "ok",
      facts: [{ factId: "m1", factType: "interest", content: "8월 1일에는 게임을 했어요", confidence: 1, importance: 1, sourceDate: "2026-08-01", sourceCount: 1, similarity: 0.99 }],
    }),
  });

  assert.deepEqual(requestedKinds, ["daily:EXACT_DATE:2026-08-09", "weekly:EXACT_DATE"]);
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.evidence.every((item) => item.date.includes("2026-08-09")), true);
    assert.equal(result.evidence.some((item) => item.source === "memory_fact"), false);
    assert.equal(result.temporal.targetDate, "2026-08-09");
  }
});

test("EXACT_DATE primary 조회 실패는 다른 source가 있어도 SYSTEM error로 보존한다", async () => {
  const result = await retrieveParentKContext({} as any, {
    childId: "child-a",
    query: "8월 9일 뭐 했어?",
    allowDetailedReports: false,
    now: new Date("2026-08-10T03:00:00.000Z"),
  }, {
    loadDaily: async () => ({ rows: [], error: "daily unavailable" }),
    loadWeekly: async () => ({ rows: [], error: null }),
    searchMemory: async () => ({
      status: "ok",
      facts: [{ factId: "m1", factType: "interest", content: "게임을 했어요", confidence: 1, importance: 1, sourceDate: "2026-08-09", sourceCount: 1, similarity: 0.99 }],
    }),
  });
  assert.equal(result.status, "error");
});

test("EXACT_DATE daily 조회가 정상 0건이면 optional memory 장애와 무관하게 NO_DATA다", async () => {
  const result = await retrieveParentKContext({} as any, {
    childId: "child-a",
    query: "8월 9일 뭐 했어?",
    allowDetailedReports: false,
    now: new Date("2026-08-10T03:00:00.000Z"),
  }, {
    loadDaily: async () => ({ rows: [], error: null }),
    loadWeekly: async () => ({ rows: [], error: null }),
    searchMemory: async () => ({ status: "error", reason: "embedding unavailable" }),
  });
  assert.equal(result.status, "no_data");
});
