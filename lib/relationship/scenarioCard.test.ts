import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipCalendarStage } from "./calendarStage";
import { resolveGradeStrategy } from "./gradeStrategy";
import {
  buildScenarioCardFragment,
  buildScenarioId,
  buildScenarioKey,
  cleanScenarioCardText,
  RELATIONSHIP_STAGE_CARDS,
  type RelationshipStageKey,
  resolveScenarioCard,
  STAGE_KEY_BY_CALENDAR_STAGE,
} from "./scenarioCard";

const ALL_STAGES: RelationshipCalendarStage[] = ["W1", "W2", "W3", "W4"];
const ALL_GRADES = [1, 2, 3, 4, 5, 6];

test("STAGE_KEY_BY_CALENDAR_STAGE 상수가 W1~W4를 올바른 stageKey로 매핑한다", () => {
  assert.equal(STAGE_KEY_BY_CALENDAR_STAGE.W1, "MEET");
  assert.equal(STAGE_KEY_BY_CALENDAR_STAGE.W2, "REMEMBER");
  assert.equal(STAGE_KEY_BY_CALENDAR_STAGE.W3, "SHARED_HISTORY");
  assert.equal(STAGE_KEY_BY_CALENDAR_STAGE.W4, "VOLUNTARY_RETURN");
});

test("RELATIONSHIP_STAGE_CARDS 4종의 primaryGoal이 §10 명시 목표와 정확히 일치한다", () => {
  assert.equal(RELATIONSHIP_STAGE_CARDS.MEET.primaryGoal, "얘랑 이야기해도 괜찮네.");
  assert.equal(RELATIONSHIP_STAGE_CARDS.REMEMBER.primaryGoal, "케이가 나를 기억하고 있구나.");
  assert.equal(RELATIONSHIP_STAGE_CARDS.SHARED_HISTORY.primaryGoal, "우리 둘이 아는 이야기가 생겼다.");
  assert.equal(RELATIONSHIP_STAGE_CARDS.VOLUNTARY_RETURN.primaryGoal, "오늘 케이한테 이야기하고 싶다.");
});

test("24개 조합(학년 1~6 × W1~W4)이 모두 null이 아닌 카드를 만든다", () => {
  let count = 0;
  for (const grade of ALL_GRADES) {
    for (const effectiveStage of ALL_STAGES) {
      const resolved = resolveScenarioCard({ grade, effectiveStage });
      assert.ok(resolved, `grade=${grade}, effectiveStage=${effectiveStage} 카드가 생성되어야 한다`);
      assert.equal(resolved.grade, grade);
      assert.equal(resolved.stageKey, STAGE_KEY_BY_CALENDAR_STAGE[effectiveStage]);
      assert.equal(resolved.version, "V1");
      count += 1;
    }
  }
  assert.equal(count, 24, "정확히 24개 조합이어야 한다");
});

test("24개 scenarioKey가 전부 유일하다", () => {
  const scenarioKeys = new Set<string>();

  for (const grade of ALL_GRADES) {
    for (const effectiveStage of ALL_STAGES) {
      const resolved = resolveScenarioCard({ grade, effectiveStage });
      assert.ok(resolved);
      assert.equal(scenarioKeys.has(resolved.scenarioKey), false, `scenarioKey ${resolved.scenarioKey}가 중복되지 않아야 한다`);
      scenarioKeys.add(resolved.scenarioKey);
    }
  }

  assert.equal(scenarioKeys.size, 24, "24개의 scenarioKey가 모두 고유해야 한다");
});

test("같은 grade + stage 조합은 항상 같은 version을 반환한다 (active 유일성)", () => {
  for (const grade of ALL_GRADES) {
    for (const effectiveStage of ALL_STAGES) {
      const first = resolveScenarioCard({ grade, effectiveStage });
      const second = resolveScenarioCard({ grade, effectiveStage });

      assert.ok(first);
      assert.ok(second);
      assert.equal(first.version, second.version);
      assert.equal(first.scenarioKey, second.scenarioKey);
      assert.equal(first.stageCard, second.stageCard);
    }
  }
});

test("effectiveStage가 null이거나 학년이 불명/범위 밖이면 null을 반환한다 (추측 금지)", () => {
  // effectiveStage가 null인 경우
  assert.equal(resolveScenarioCard({ grade: 3, effectiveStage: null }), null);

  // grade가 null/undefined/빈값/범위 밖인 경우
  assert.equal(resolveScenarioCard({ grade: null, effectiveStage: "W2" }), null);
  assert.equal(resolveScenarioCard({ grade: undefined, effectiveStage: "W2" }), null);
  assert.equal(resolveScenarioCard({ grade: "", effectiveStage: "W2" }), null);
  assert.equal(resolveScenarioCard({ grade: "고1", effectiveStage: "W2" }), null);
  assert.equal(resolveScenarioCard({ grade: 0, effectiveStage: "W2" }), null);
  assert.equal(resolveScenarioCard({ grade: 8, effectiveStage: "W2" }), null);
  assert.equal(resolveScenarioCard({ grade: "유치원", effectiveStage: "W2" }), null);

  // 둘 다 null인 경우
  assert.equal(resolveScenarioCard({ grade: null, effectiveStage: null }), null);
});

test("중1(7 또는 '중1') 입력 시 scenarioKey가 G6_... 로 클램프되고 G7은 나오지 않는다", () => {
  const resolvedFromNumber7 = resolveScenarioCard({ grade: 7, effectiveStage: "W2" });
  assert.ok(resolvedFromNumber7);
  assert.equal(resolvedFromNumber7.grade, 6);
  assert.equal(resolvedFromNumber7.scenarioKey, "G6_REMEMBER_V1");
  assert.equal(resolvedFromNumber7.scenarioKey.startsWith("G7_"), false);

  const resolvedFromStringJung1 = resolveScenarioCard({ grade: "중1", effectiveStage: "W3" });
  assert.ok(resolvedFromStringJung1);
  assert.equal(resolvedFromStringJung1.grade, 6);
  assert.equal(resolvedFromStringJung1.scenarioKey, "G6_SHARED_HISTORY_V1");

  const resolvedFromStringJungHakGyo = resolveScenarioCard({ grade: "중학교 1학년", effectiveStage: "W1" });
  assert.ok(resolvedFromStringJungHakGyo);
  assert.equal(resolvedFromStringJungHakGyo.grade, 6);
  assert.equal(resolvedFromStringJungHakGyo.scenarioKey, "G6_MEET_V1");
});

test("grade strategy 데이터가 복제되지 않고 동일 참조(===)로 유지된다", () => {
  for (const grade of ALL_GRADES) {
    const expectedGradeStrategy = resolveGradeStrategy(grade);
    assert.ok(expectedGradeStrategy);

    for (const effectiveStage of ALL_STAGES) {
      const resolved = resolveScenarioCard({ grade, effectiveStage });
      assert.ok(resolved);
      // 동일 객체 참조(===) 검증
      assert.equal(resolved.gradeStrategy, expectedGradeStrategy);
    }
  }
});

test("stageCard 데이터가 RELATIONSHIP_STAGE_CARDS의 해당 stage 객체와 동일 참조(===)다", () => {
  for (const stage of ALL_STAGES) {
    const stageKey = STAGE_KEY_BY_CALENDAR_STAGE[stage];
    const expectedStageCard = RELATIONSHIP_STAGE_CARDS[stageKey];

    for (const grade of ALL_GRADES) {
      const resolved = resolveScenarioCard({ grade, effectiveStage: stage });
      assert.ok(resolved);
      assert.equal(resolved.stageCard, expectedStageCard);
    }
  }
});

test("buildScenarioKey가 올바른 형식의 키를 생성한다", () => {
  assert.equal(buildScenarioKey(3, "REMEMBER", "V1"), "G3_REMEMBER_V1");
  assert.equal(buildScenarioKey(1, "MEET", "V2"), "G1_MEET_V2");
  assert.equal(buildScenarioKey(6, "VOLUNTARY_RETURN", "V1"), "G6_VOLUNTARY_RETURN_V1");
});

test("buildScenarioId가 버전 접미사 없이 G<grade>_<STAGE> 형식의 ID를 생성한다 (§23)", () => {
  assert.equal(buildScenarioId(3, "REMEMBER"), "G3_REMEMBER");
  assert.equal(buildScenarioId(1, "MEET"), "G1_MEET");
  assert.equal(buildScenarioId(6, "VOLUNTARY_RETURN"), "G6_VOLUNTARY_RETURN");
  assert.equal(buildScenarioId(4, "SHARED_HISTORY"), "G4_SHARED_HISTORY");
  assert.equal(buildScenarioId(3, "REMEMBER").includes("_V"), false);
});

test("문자열 학년('초3', '3학년')도 올바른 scenarioKey를 반환한다", () => {
  const fromText1 = resolveScenarioCard({ grade: "초3", effectiveStage: "W2" });
  const fromText2 = resolveScenarioCard({ grade: "3학년", effectiveStage: "W2" });
  const fromNumber = resolveScenarioCard({ grade: 3, effectiveStage: "W2" });

  assert.ok(fromNumber);
  assert.deepEqual(fromText1, fromNumber);
  assert.deepEqual(fromText2, fromNumber);
  assert.equal(fromText1?.scenarioKey, "G3_REMEMBER_V1");
});

test("buildScenarioCardFragment — 출력에 단계 목표·전략·표현 방식·금지사항이 포함된다", () => {
  const card = resolveScenarioCard({ grade: 3, effectiveStage: "W2" });
  assert.ok(card);

  const fragment = buildScenarioCardFragment(card, "W2");
  assert.match(fragment, /\[관계 시나리오 - REMEMBER \(W2\)\]/);
  assert.match(fragment, /단계 목표: 케이가 나를 기억하고 있구나\./);
  assert.match(fragment, /전략: 현재 대화 맥락과 직접 관련된 기억을 자연스럽게 연결하여 공감대를 넓힌다\./);
  assert.match(fragment, /표현 방식: 아이의 현재 말에 먼저 공감한 뒤 관련된 기억을 자연스럽게 연결/);
  assert.match(fragment, /피해야 할 것: 현재 감정·상황을 무시하고 억지로 기억 끼워넣기, 가짜 기억 지어내기/);
});

test("buildScenarioCardFragment — expectedEvents 값이 절대 포함되지 않는다", () => {
  for (const grade of ALL_GRADES) {
    for (const effectiveStage of ALL_STAGES) {
      const card = resolveScenarioCard({ grade, effectiveStage });
      assert.ok(card);
      assert.ok(card.stageCard.expectedEvents.length > 0);

      const fragmentWithStage = buildScenarioCardFragment(card, effectiveStage);
      const fragmentWithoutStage = buildScenarioCardFragment(card);

      for (const eventName of card.stageCard.expectedEvents) {
        assert.equal(
          fragmentWithStage.includes(eventName),
          false,
          `expectedEvent '${eventName}' must not appear in fragment with stage`,
        );
        assert.equal(
          fragmentWithoutStage.includes(eventName),
          false,
          `expectedEvent '${eventName}' must not appear in fragment without stage`,
        );
      }
    }
  }
});

test("buildScenarioCardFragment — effectiveStage 유무에 따라 라벨이 올바르게 포맷된다", () => {
  const card = resolveScenarioCard({ grade: 4, effectiveStage: "W1" });
  assert.ok(card);

  const withStage = buildScenarioCardFragment(card, "W1");
  assert.match(withStage, /\[관계 시나리오 - MEET \(W1\)\]/);

  const withoutStage = buildScenarioCardFragment(card, null);
  assert.match(withoutStage, /\[관계 시나리오 - MEET\]/);
  assert.equal(withoutStage.includes("(W1)"), false);

  const withUndefined = buildScenarioCardFragment(card, undefined);
  assert.match(withUndefined, /\[관계 시나리오 - MEET\]/);
});

test("cleanScenarioCardText — 비정상 문자 제거 및 최대 길이 제한이 정상 작동한다", () => {
  assert.equal(cleanScenarioCardText("안녕\u0000하세요   친구", 100), "안녕 하세요 친구");
  assert.equal(cleanScenarioCardText("가".repeat(200), 50), "가".repeat(50));
  assert.equal(cleanScenarioCardText(null, 100), "");
  assert.equal(cleanScenarioCardText(undefined, 100), "");
});

