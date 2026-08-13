import { test } from "node:test";
import assert from "node:assert/strict";
import { getKstBusinessDate, getMissionPhase, isSameKstBusinessDate } from "./missionUtils";

test("getMissionPhase: scheduleEnforced=false는 missionType에만 의존한 고정값을 반환한다(round1_day)", () => {
  assert.equal(getMissionPhase("round1_day", false, false), 1);
});

test("getMissionPhase: scheduleEnforced=false는 missionType에만 의존한 고정값을 반환한다(round2_night)", () => {
  assert.equal(getMissionPhase("round2_night", false, false), 2);
});

test("getMissionPhase: scheduleEnforced=false에서는 common도 null을 반환하지 않는다", () => {
  const result = getMissionPhase("common", false, false);
  assert.notEqual(result, null);
});

test("getMissionPhase: scheduleEnforced 기본값(true)은 기존 동작을 그대로 유지한다(시그니처 하위호환)", () => {
  // 실제 시각과 무관하게, 인자 3개짜리 호출과 인자 1개짜리 호출이 동일한 결과를 내야 한다.
  const withDefault = getMissionPhase("round1_day");
  const explicitEnforced = getMissionPhase("round1_day", false, true);
  assert.equal(withDefault, explicitEnforced);
});

// 대표님 지시 시나리오: DEV KST 00:01 / 09:00 / 12:59 / 23:59 각각에서
// start(scheduleEnforced=false)는 24시간 성공한다.
const KST_CLOCK_CASES: Array<{ label: string; hour: number; minute: number }> = [
  { label: "00:01", hour: 0, minute: 1 },
  { label: "09:00", hour: 9, minute: 0 },
  { label: "12:59", hour: 12, minute: 59 },
  { label: "23:59", hour: 23, minute: 59 },
];

function withMockedKstClock<T>(hour: number, minute: number, fn: () => T): T {
  // getMissionPhase는 date-fns-tz의 toZonedTime(new Date(), "Asia/Seoul")로 "지금"을 구한다.
  // UTC 시스템 시계를 흉내내려면 실제 UTC Date를 만들어 전역 Date 생성자를 모킹한다.
  const utcHour = (hour - 9 + 24) % 24; // KST = UTC+9
  const fixedUtc = new Date(Date.UTC(2026, 7, 11, utcHour, minute, 0));
  const OriginalDate = Date;
  // @ts-expect-error 테스트 전용 전역 Date 모킹
  global.Date = class extends OriginalDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(fixedUtc.getTime());
      } else {
        // @ts-expect-error
        super(...args);
      }
    }
    static now() {
      return fixedUtc.getTime();
    }
  } as DateConstructor;
  try {
    return fn();
  } finally {
    global.Date = OriginalDate;
  }
}

for (const { label, hour, minute } of KST_CLOCK_CASES) {
  test(`getMissionPhase: DEV(scheduleEnforced=false) KST ${label}에서 round1_day/round2_night 모두 null 아님(403 없음)`, () => {
    withMockedKstClock(hour, minute, () => {
      assert.notEqual(getMissionPhase("round1_day", false, false), null);
      assert.notEqual(getMissionPhase("round2_night", false, false), null);
      assert.notEqual(getMissionPhase("common", false, false), null);
    });
  });
}

test("getMissionPhase: Production 08:59는 신규 시작 차단", () => {
  withMockedKstClock(8, 59, () => {
    assert.equal(getMissionPhase("round1_day", false, true), null);
    assert.equal(getMissionPhase("round2_night", false, true), null);
  });
});

test("getMissionPhase: Production 09:00부터 legacy round를 단일 창 안에서 허용", () => {
  withMockedKstClock(9, 0, () => {
    assert.equal(getMissionPhase("round1_day", false, true), 1);
    assert.equal(getMissionPhase("round2_night", false, true), 2);
    assert.equal(getMissionPhase("common", false, true), 2);
  });
});

test("getMissionPhase: Production 23:49 허용, 23:50 신규 시작 차단", () => {
  withMockedKstClock(23, 49, () => {
    assert.equal(getMissionPhase("round2_night", false, true), 2);
  });
  withMockedKstClock(23, 50, () => {
    assert.equal(getMissionPhase("round1_day", false, true), null);
    assert.equal(getMissionPhase("round2_night", false, true), null);
  });
});

test("KST business_date는 UTC 날짜가 달라도 서울 자정 기준으로 계산한다", () => {
  assert.equal(getKstBusinessDate(new Date("2026-08-12T14:59:59.000Z")), "2026-08-12");
  assert.equal(getKstBusinessDate(new Date("2026-08-12T15:00:00.000Z")), "2026-08-13");
});

test("같은 KST business_date의 진행 세션은 신규 시작 마감 뒤에도 이어하기 대상이다", () => {
  assert.equal(
    isSameKstBusinessDate("2026-08-12T00:00:00.000Z", new Date("2026-08-12T14:50:00.000Z")),
    true,
  );
  assert.equal(
    isSameKstBusinessDate("2026-08-12T00:00:00.000Z", new Date("2026-08-12T15:00:00.000Z")),
    false,
  );
});
