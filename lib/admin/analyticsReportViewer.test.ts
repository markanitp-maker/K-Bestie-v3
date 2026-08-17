import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateParentReportViews,
  REPORT_VIEWER_TRACKING_START_DATE,
} from "./retentionPeopleAnalytics";

test("계측 시작일 상수는 2026-08-18로 정의되어 있다", () => {
  assert.equal(REPORT_VIEWER_TRACKING_START_DATE, "2026-08-18");
});

test("viewer_id가 서로 다른 두 부모의 열람이 각각 독립적으로 집계된다", () => {
  const reportViews = [
    { report_id: "rep-1", viewed_at: "2026-08-18T10:00:00.000Z", viewer_id: "parent-mom" },
    { report_id: "rep-2", viewed_at: "2026-08-18T11:00:00.000Z", viewer_id: "parent-mom" },
    { report_id: "rep-2", viewed_at: "2026-08-18T12:00:00.000Z", viewer_id: "parent-dad" },
  ];
  const familyReports = new Set(["rep-1", "rep-2", "rep-3"]);

  const momResult = aggregateParentReportViews(reportViews, "parent-mom", familyReports);
  assert.equal(momResult.viewedCount, 2);
  assert.equal(momResult.latestViewedAt, "2026-08-18T11:00:00.000Z");

  const dadResult = aggregateParentReportViews(reportViews, "parent-dad", familyReports);
  assert.equal(dadResult.viewedCount, 1);
  assert.equal(dadResult.latestViewedAt, "2026-08-18T12:00:00.000Z");

  const otherResult = aggregateParentReportViews(reportViews, "parent-other", familyReports);
  assert.equal(otherResult.viewedCount, 0);
  assert.equal(otherResult.latestViewedAt, null);
});

test("viewer_id IS NULL 행은 부모별 집계에 들어가지 않는다 (소급 추정 금지)", () => {
  const reportViews = [
    { report_id: "rep-legacy-1", viewed_at: "2026-08-17T09:00:00.000Z", viewer_id: null },
    { report_id: "rep-legacy-2", viewed_at: "2026-08-17T10:00:00.000Z", viewer_id: undefined },
    { report_id: "rep-new-1", viewed_at: "2026-08-18T09:00:00.000Z", viewer_id: "parent-mom" },
  ];
  const familyReports = new Set(["rep-legacy-1", "rep-legacy-2", "rep-new-1"]);

  const momResult = aggregateParentReportViews(reportViews, "parent-mom", familyReports);
  assert.equal(momResult.viewedCount, 1);
  assert.equal(momResult.latestViewedAt, "2026-08-18T09:00:00.000Z");

  const dadResult = aggregateParentReportViews(reportViews, "parent-dad", familyReports);
  assert.equal(dadResult.viewedCount, 0);
  assert.equal(dadResult.latestViewedAt, null);
});

test("같은 부모가 같은 리포트를 두 번 봐도 고유 report_id 1개로 센다", () => {
  const reportViews = [
    { report_id: "rep-1", viewed_at: "2026-08-18T08:00:00.000Z", viewer_id: "parent-mom" },
    { report_id: "rep-1", viewed_at: "2026-08-18T15:30:00.000Z", viewer_id: "parent-mom" },
  ];
  const familyReports = new Set(["rep-1"]);

  const momResult = aggregateParentReportViews(reportViews, "parent-mom", familyReports);
  assert.equal(momResult.viewedCount, 1);
  assert.equal(momResult.latestViewedAt, "2026-08-18T15:30:00.000Z");
});

test("가족 리포트 목록에 없는 타 가족 리포트 열람은 familyReportIds 전달 시 제외된다", () => {
  const reportViews = [
    { report_id: "rep-family-a", viewed_at: "2026-08-18T10:00:00.000Z", viewer_id: "parent-mom" },
    { report_id: "rep-family-b", viewed_at: "2026-08-18T11:00:00.000Z", viewer_id: "parent-mom" },
  ];
  const familyReports = new Set(["rep-family-a"]);

  const result = aggregateParentReportViews(reportViews, "parent-mom", familyReports);
  assert.equal(result.viewedCount, 1);
  assert.equal(result.latestViewedAt, "2026-08-18T10:00:00.000Z");
});
