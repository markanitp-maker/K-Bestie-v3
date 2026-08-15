import assert from "node:assert/strict";
import test from "node:test";
import {
  childStatuses,
  computeStreak,
  paginate,
  parentStatuses,
  percentage,
} from "./retentionPeopleAnalytics";

test("미도래 리텐션과 별개로 초기 사용자는 이탈 실패로 분류하지 않는다", () => {
  assert.deepEqual(childStatuses({
    today: "2026-08-14",
    firstMeaningfulUseAt: "2026-08-13",
    lastActivityAt: "2026-08-13T10:00:00Z",
    activeDaysLast7: 1,
    reportGeneratedCount: 0,
    reportViewedCount: 0,
  }), ["initial"]);
});

test("3일 이상 활동이 없고 리포트도 미열람이면 두 주의 상태를 함께 반환한다", () => {
  assert.deepEqual(childStatuses({
    today: "2026-08-14",
    firstMeaningfulUseAt: "2026-08-01",
    lastActivityAt: "2026-08-11T10:00:00+09:00",
    activeDaysLast7: 1,
    reportGeneratedCount: 3,
    reportViewedCount: 0,
  }), ["churn_risk", "parent_unread"]);
});

test("연속 사용일과 비율은 설명 가능한 값으로 계산한다", () => {
  assert.equal(computeStreak(["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"], "2026-08-14"), 4);
  assert.equal(percentage(5, 6), 83.3);
  assert.equal(percentage(0, 0), null);
});

test("부모 상태와 페이지 크기 allowlist를 고정한다", () => {
  assert.deepEqual(parentStatuses({ reportGeneratedCount: 3, reportViewedCount: 0, reportViewRate: 0 }), ["report_unread"]);
  assert.deepEqual(parentStatuses({ reportGeneratedCount: 3, reportViewedCount: 1, reportViewRate: 33.3 }), ["low_engagement"]);
  assert.deepEqual(parentStatuses({ reportGeneratedCount: 3, reportViewedCount: 3, reportViewRate: 100 }), ["active"]);
  assert.deepEqual(paginate([1, 2, 3], 9, 13), { rows: [1, 2, 3], page: 1, pageSize: 25, total: 3, totalPages: 1 });
});
