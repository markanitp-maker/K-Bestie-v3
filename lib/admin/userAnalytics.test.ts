import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFamilyRepeatRate,
  calculateLast7Distribution,
  calculateLast30AvgActiveDays,
  computeUserAnalytics,
  dedupeActiveDates,
  roundAvg,
  roundRate,
  PARENT_ROLES,
} from "./userAnalytics";

test("같은 날 이벤트 3개 -> 활성일수 1 (KST dedupe)", () => {
  const events = [
    { occurred_at: "2026-08-10T01:00:00Z" }, // 2026-08-10 KST
    { occurred_at: "2026-08-10T05:30:00Z" }, // 2026-08-10 KST
    { occurred_at: "2026-08-10T14:59:00Z" }, // 2026-08-10 KST (23:59 KST)
  ];
  const dates = dedupeActiveDates(events);
  assert.equal(dates.size, 1);
  assert.deepEqual(Array.from(dates), ["2026-08-10"]);
});

test("서로 다른 2일 이벤트 -> 가족 반복사용 해당", () => {
  const familyIds = ["fam-1", "fam-2"];
  const eventsByFamily = new Map([
    [
      "fam-1",
      [
        { occurred_at: "2026-08-10T01:00:00Z" }, // 2026-08-10 KST
        { occurred_at: "2026-08-11T01:00:00Z" }, // 2026-08-11 KST
      ],
    ],
    [
      "fam-2",
      [
        { occurred_at: "2026-08-10T01:00:00Z" },
        { occurred_at: "2026-08-10T05:00:00Z" }, // 같은 날 2개 -> 1일만
      ],
    ],
  ]);

  const result = calculateFamilyRepeatRate(familyIds, eventsByFamily);
  assert.equal(result.count, 1);
  assert.equal(result.total, 2);
  assert.equal(result.rate, 50);
});

test("1일만 활동 -> 가족 반복사용 미해당", () => {
  const familyIds = ["fam-single"];
  const eventsByFamily = new Map([
    [
      "fam-single",
      [
        { occurred_at: "2026-08-10T01:00:00Z" },
        { occurred_at: "2026-08-10T02:00:00Z" },
        { occurred_at: "2026-08-10T03:00:00Z" },
      ],
    ],
  ]);

  const result = calculateFamilyRepeatRate(familyIds, eventsByFamily);
  assert.equal(result.count, 0);
  assert.equal(result.total, 1);
  assert.equal(result.rate, 0);
});

test("분포 버킷 경계 (0, 1, 2-4, 5-7)", () => {
  const todayKst = "2026-08-17";
  // Children with 0, 1, 2, 4, 5, 7 active days in last 7 days (2026-08-11 ~ 2026-08-17)
  const childIds = ["c-0", "c-1", "c-2", "c-4", "c-5", "c-7"];
  const childEventsMap = new Map([
    ["c-0", []],
    ["c-1", [{ occurred_at: "2026-08-17T01:00:00Z" }]],
    [
      "c-2",
      [
        { occurred_at: "2026-08-16T01:00:00Z" },
        { occurred_at: "2026-08-17T01:00:00Z" },
      ],
    ],
    [
      "c-4",
      [
        { occurred_at: "2026-08-12T01:00:00Z" },
        { occurred_at: "2026-08-13T01:00:00Z" },
        { occurred_at: "2026-08-14T01:00:00Z" },
        { occurred_at: "2026-08-15T01:00:00Z" },
      ],
    ],
    [
      "c-5",
      [
        { occurred_at: "2026-08-11T01:00:00Z" },
        { occurred_at: "2026-08-12T01:00:00Z" },
        { occurred_at: "2026-08-13T01:00:00Z" },
        { occurred_at: "2026-08-14T01:00:00Z" },
        { occurred_at: "2026-08-15T01:00:00Z" },
      ],
    ],
    [
      "c-7",
      [
        { occurred_at: "2026-08-11T01:00:00Z" },
        { occurred_at: "2026-08-12T01:00:00Z" },
        { occurred_at: "2026-08-13T01:00:00Z" },
        { occurred_at: "2026-08-14T01:00:00Z" },
        { occurred_at: "2026-08-15T01:00:00Z" },
        { occurred_at: "2026-08-16T01:00:00Z" },
        { occurred_at: "2026-08-17T01:00:00Z" },
      ],
    ],
  ]);

  const distribution = calculateLast7Distribution(childIds, childEventsMap, todayKst);
  assert.equal(distribution.length, 4);

  // 0일: c-0 (1명)
  assert.deepEqual(distribution[0], { bucket: "0", label: "미사용", count: 1, rate: 16.7 });
  // 1일: c-1 (1명)
  assert.deepEqual(distribution[1], { bucket: "1", label: "단발", count: 1, rate: 16.7 });
  // 2~4일: c-2, c-4 (2명)
  assert.deepEqual(distribution[2], { bucket: "2-4", label: "반복사용", count: 2, rate: 33.3 });
  // 5~7일: c-5, c-7 (2명)
  assert.deepEqual(distribution[3], { bucket: "5-7", label: "고활성", count: 2, rate: 33.3 });
});

test("PARENT_ROLES는 owner_parent와 parent를 모두 포함한다", () => {
  assert.ok(PARENT_ROLES.has("owner_parent"));
  assert.ok(PARENT_ROLES.has("parent"));
  assert.ok(!PARENT_ROLES.has("child"));
});

test("computeUserAnalytics 전체 집계 계약 및 지표 정합성", () => {
  const now = new Date("2026-08-17T03:00:00+09:00");
  const todayKst = "2026-08-17";

  const families = [
    { id: "fam-1", created_at: "2026-08-01T00:00:00Z" },
    { id: "fam-2", created_at: "2026-08-01T00:00:00Z" },
    { id: "fam-test", created_at: "2026-08-01T00:00:00Z" },
  ];
  const familyMembers = [
    { id: "m-1", family_id: "fam-1", user_id: "p-1", role: "owner_parent", created_at: "2026-08-01T00:00:00Z" },
    { id: "m-2", family_id: "fam-1", user_id: "p-2", role: "parent", created_at: "2026-08-01T00:00:00Z" },
    { id: "m-3", family_id: "fam-2", user_id: "p-3", role: "owner_parent", created_at: "2026-08-01T00:00:00Z" },
    { id: "m-test", family_id: "fam-test", user_id: "p-test", role: "owner_parent", is_internal_test: true, created_at: "2026-08-01T00:00:00Z" },
  ];
  const parents = [
    { id: "p-1", name: "부모1", created_at: "2026-08-01T00:00:00Z" },
    { id: "p-2", name: "부모2", created_at: "2026-08-01T00:00:00Z" },
    { id: "p-3", name: "부모3", created_at: "2026-08-01T00:00:00Z" },
    { id: "p-test", name: "테스트부모", created_at: "2026-08-01T00:00:00Z" },
  ];
  const children = [
    { id: "c-1", family_id: "fam-1", name: "아이1", created_at: "2026-08-01T00:00:00Z" },
    { id: "c-2", family_id: "fam-2", name: "아이2", created_at: "2026-08-01T00:00:00Z" },
    { id: "c-test", family_id: "fam-test", name: "테스트아이", is_internal_test: true, created_at: "2026-08-01T00:00:00Z" },
  ];

  const behaviorEvents = [
    { id: "e-1", event_name: "mission_start", actor_type: "child", child_id: "c-1", family_id: "fam-1", occurred_at: "2026-08-16T01:00:00Z" },
    { id: "e-2", event_name: "freechat_start", actor_type: "child", child_id: "c-1", family_id: "fam-1", occurred_at: "2026-08-17T01:00:00Z" },
    { id: "e-3", event_name: "parent_report_view", actor_type: "parent", actor_id: "p-1", family_id: "fam-1", occurred_at: "2026-08-17T02:00:00Z" },
    { id: "e-4", event_name: "mission_start", actor_type: "child", child_id: "c-2", family_id: "fam-2", occurred_at: "2026-08-17T01:00:00Z" },
  ];

  const dailyReports = [
    { id: "rep-1", family_id: "fam-1", child_id: "c-1", created_at: "2026-08-17T00:00:00Z" },
  ];
  const reportViews = [
    { id: "rv-1", report_id: "rep-1", viewer_id: "p-1", viewed_at: "2026-08-17T02:00:00Z" },
  ];
  const missionProgress = [
    { session_id: "s-1", child_id: "c-1", status: "COMPLETED", business_date: "2026-08-16" },
    { session_id: "s-2", child_id: "c-2", status: "IN_PROGRESS", business_date: "2026-08-17" },
  ];

  const result = computeUserAnalytics({
    families,
    familyMembers,
    parents,
    children,
    dailyReports,
    reportViews,
    missionProgress,
    behaviorEvents,
    testFamilyIds: new Set(["fam-test"]),
    includeTestAccounts: false,
    selectedFromDateStr: "2026-08-11",
    selectedToDateStr: "2026-08-17",
    now,
  });

  // signup
  assert.equal(result.signup.totalFamilies, 2);
  assert.equal(result.signup.totalParents, 3);
  assert.equal(result.signup.totalChildren, 2);
  assert.equal(result.signup.activeChildren.count, 2);
  assert.equal(result.signup.activeChildren.rate, 100);

  // usage
  assert.equal(result.usage.mission.count, 2);
  assert.equal(result.usage.freechat.count, 1);
  assert.equal(result.usage.play.count, 0);
  assert.equal(result.usage.missionCompletionRate.count, 1);
  assert.equal(result.usage.missionCompletionRate.total, 2);
  assert.equal(result.usage.missionCompletionRate.rate, 50);
  assert.equal(result.usage.reportGenerated.count, 1);
  assert.equal(result.usage.reportGenerated.rate, 50);
  assert.equal(result.usage.parentViewed.count, 1);
  assert.equal(result.usage.parentViewed.rate, 33.3);
  assert.equal(result.usage.reportViewTotal, 1);
  assert.equal(result.usage.reportViewAvgPerViewer, 1);

  // repeat
  assert.equal(result.repeat.familyRepeatRate.count, 1); // fam-1 has events on 2026-08-16 and 2026-08-17
  assert.equal(result.repeat.familyRepeatRate.total, 2);
  assert.equal(result.repeat.familyRepeatRate.rate, 50);

  // users drilldown
  assert.equal(result.users.children.length, 2);
  assert.equal(result.users.parents.length, 3);
  const child1 = result.users.children.find((c) => c.id === "c-1")!;
  assert.equal(child1.last7ActiveDays, 2);
  assert.equal(child1.missionCount, 1);
  assert.equal(child1.freechatCount, 1);
  assert.equal(child1.reportCount, 1);
});
