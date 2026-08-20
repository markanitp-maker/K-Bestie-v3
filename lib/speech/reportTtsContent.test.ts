import { buildStandaloneWeeklyReportTtsContent } from "./reportTtsContent";
import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyReportTtsContent, buildWeeklyReportTtsContent } from "./reportTtsContent";

test("report TTS content: 실제 숨김 판정으로 placeholder 상세 섹션을 제외한다", () => {
  const content = buildDailyReportTtsContent({ school_academy_life: "학교에서 발표했어요.", peer_friendship: "데이터 부족", emotion_hint: "이 항목은 확인할 대화가 충분하지 않아요." }, 2, false);
  assert.deepEqual(content, ["상세 리포트", "학교·학원 생활", "학교에서 발표했어요."]);
});

test("report TTS content: restricted이면 일간 탭 2·3 콘텐츠를 산출하지 않는다", () => {
  const report = { parent_guide: "유료 가이드", school_academy_life: "유료 상세" };
  assert.deepEqual(buildDailyReportTtsContent(report, 2, true), []);
  assert.deepEqual(buildDailyReportTtsContent(report, 3, true), []);
});

test("report TTS content: restricted이면 주간 탭 2·3 콘텐츠를 산출하지 않는다", () => {
  const report = { detail_text: "유료 상세", parent_guide: "유료 가이드" };
  assert.deepEqual(buildWeeklyReportTtsContent(report, 2, true), []);
  assert.deepEqual(buildWeeklyReportTtsContent(report, 3, true), []);
});

test("단독 주간: 잠금이면 상세·가이드를 낭독하지 않는다", () => {
  const report = {
    summary_text: "이번 주는 친구 이야기가 많았어요",
    weekend_activity_recommendation: "함께 도서관에 가 보세요",
    detail_text: "학교 생활이 안정적이었어요",
    parent_guide: "부모님께 드리는 가이드",
    detail_dashboard_cards: { school_life: "발표를 잘했어요" },
  } as unknown as Parameters<typeof buildStandaloneWeeklyReportTtsContent>[0];

  const locked = buildStandaloneWeeklyReportTtsContent(report, true);
  const joined = locked.join(" | ");
  assert.ok(!joined.includes("학교 생활이 안정적이었어요"), `잠긴 상세를 낭독했다: ${joined}`);
  assert.ok(!joined.includes("부모님께 드리는 가이드"), `잠긴 가이드를 낭독했다: ${joined}`);
  assert.ok(!joined.includes("발표를 잘했어요"), `잠긴 대시보드 카드를 낭독했다: ${joined}`);

  // 잠금이 아니면 전부 낭독한다.
  const open = buildStandaloneWeeklyReportTtsContent(report, false).join(" | ");
  assert.ok(open.includes("학교 생활이 안정적이었어요"));
  assert.ok(open.includes("부모님께 드리는 가이드"));
});

test("단독 주간: 낭독 범위가 화면과 일치한다 — 주말 활동 추천", () => {
  // `app/parent/report/weekly/[id]/page.tsx` 는 주말 활동 추천을 **잠금 분기 밖**에서
  // 렌더한다(L126). 화면에 보이는 것만 읽는다는 원칙(지시서 §2.3)에 따라 낭독도 포함한다.
  //
  // 다만 그 화면의 잠금 안내문은 "Care Start 에서는 주간 요약만 제공돼요" 라고 말한다.
  // 화면과 안내문이 어긋나 있다 — 034 범위 밖(기존 요금제 화면 결함)이라 여기서 고치지 않고
  // 낭독을 화면에 맞춘다. 화면이 고쳐지면 이 테스트도 함께 바꿔야 한다.
  const report = {
    summary_text: "이번 주 요약",
    weekend_activity_recommendation: "함께 도서관에 가 보세요",
  } as unknown as Parameters<typeof buildStandaloneWeeklyReportTtsContent>[0];

  const locked = buildStandaloneWeeklyReportTtsContent(report, true).join(" | ");
  assert.ok(
    locked.includes("함께 도서관에 가 보세요"),
    `화면에는 보이는데 낭독에서 빠졌다: ${locked}`
  );
});

test("단독 주간: 빈 값은 낭독 목록에 넣지 않는다", () => {
  const report = {
    summary_text: "이번 주 요약",
    weekend_activity_recommendation: "",
    detail_text: "   ",
  } as unknown as Parameters<typeof buildStandaloneWeeklyReportTtsContent>[0];

  const content = buildStandaloneWeeklyReportTtsContent(report, false);
  assert.ok(!content.includes("주말 활동 추천"), "빈 값에 제목만 읽었다");
  assert.ok(!content.includes("이번 주 상세 분석"), "공백만 있는 값에 제목만 읽었다");
  assert.ok(content.includes("이번 주 요약"));
});
