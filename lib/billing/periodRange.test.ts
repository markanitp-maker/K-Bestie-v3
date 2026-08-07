import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BillingPeriodError,
  formatKstDate,
  kstDateToUtc,
  prorateMonthlyCost,
  resolveBillingPeriodRange,
} from "./periodRange";

const NOW = new Date("2026-08-08T03:30:00.000Z"); // 2026-08-08 12:30 KST

test("KST 날짜는 UTC 전날 15:00으로 변환한다", () => {
  assert.equal(kstDateToUtc("2026-08-01").toISOString(), "2026-07-31T15:00:00.000Z");
  assert.equal(formatKstDate(new Date("2026-07-31T15:00:00.000Z")), "2026-08-01");
});

test("today/7d/month/last_month가 KST 캘린더 경계를 사용한다", () => {
  const today = resolveBillingPeriodRange({ period: "today", now: NOW });
  assert.equal(today.from.toISOString(), "2026-08-07T15:00:00.000Z");
  assert.equal(today.to.toISOString(), NOW.toISOString());
  assert.equal(today.days, 1);

  const seven = resolveBillingPeriodRange({ period: "7d", now: NOW });
  assert.equal(seven.startDate, "2026-08-02");
  assert.equal(seven.days, 7);

  const month = resolveBillingPeriodRange({ period: "month", now: NOW });
  assert.equal(month.startDate, "2026-08-01");
  assert.equal(month.days, 8);

  const lastMonth = resolveBillingPeriodRange({ period: "last_month", now: NOW });
  assert.equal(lastMonth.from.toISOString(), "2026-06-30T15:00:00.000Z");
  assert.equal(lastMonth.to.toISOString(), "2026-07-31T15:00:00.000Z");
  assert.equal(lastMonth.days, 31);
});

test("custom은 같은 날·월 경계·여러 달·오늘 종료를 처리한다", () => {
  const samePast = resolveBillingPeriodRange({ period: "custom", startDate: "2026-07-31", endDate: "2026-07-31", now: NOW });
  assert.equal(samePast.days, 1);
  assert.equal(samePast.to.toISOString(), "2026-07-31T15:00:00.000Z");

  const multiMonth = resolveBillingPeriodRange({ period: "custom", startDate: "2026-07-15", endDate: "2026-08-05", now: NOW });
  assert.equal(multiMonth.days, 22);

  const throughToday = resolveBillingPeriodRange({ period: "custom", startDate: "2026-08-02", endDate: "2026-08-08", now: NOW });
  assert.equal(throughToday.to.toISOString(), NOW.toISOString());
});

test("월말/연말 경계는 환경 타임존과 무관하다", () => {
  assert.equal(resolveBillingPeriodRange({ period: "7d", now: new Date("2026-09-01T01:00:00Z") }).startDate, "2026-08-26");
  assert.equal(resolveBillingPeriodRange({ period: "7d", now: new Date("2027-01-01T01:00:00Z") }).startDate, "2026-12-26");
});

test("custom 역전·미래·잘못된 날짜는 400용 오류를 낸다", () => {
  assert.throws(() => resolveBillingPeriodRange({ period: "custom", startDate: "2026-08-09", endDate: "2026-08-08", now: NOW }), BillingPeriodError);
  assert.throws(() => resolveBillingPeriodRange({ period: "custom", startDate: "2026-08-08", endDate: "2026-08-09", now: NOW }), BillingPeriodError);
  assert.throws(() => resolveBillingPeriodRange({ period: "custom", startDate: "2026-02-30", endDate: "2026-03-01", now: NOW }), BillingPeriodError);
});

test("고정비는 월별 실제 일수로 일할 계산한다", () => {
  const august = { startDate: "2026-08-01", endDate: "2026-08-31" };
  assert.equal(Math.round(prorateMonthlyCost(31_000, august)), 31_000);
  const boundary = { startDate: "2026-07-31", endDate: "2026-08-01" };
  assert.equal(prorateMonthlyCost(31_000, boundary), 2_000);
  const leap = { startDate: "2028-02-01", endDate: "2028-02-29" };
  assert.equal(Math.round(prorateMonthlyCost(29_000, leap)), 29_000);
});
