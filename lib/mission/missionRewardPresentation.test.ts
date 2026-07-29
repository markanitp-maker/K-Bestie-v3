import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getMissionRewardPresentation,
  shouldShowMissionCompletionModal,
} from "./missionRewardPresentation.js";

test("shows the completion modal even when no new key can be awarded", () => {
  assert.equal(
    shouldShowMissionCompletionModal({
      missionState: "completed",
      completed: true,
      hasClosed: false,
    }),
    true
  );
});

test("does not show the completion modal for a safety pause or a closed session", () => {
  assert.equal(
    shouldShowMissionCompletionModal({
      missionState: "completed",
      completed: false,
      hasClosed: false,
    }),
    false
  );
  assert.equal(
    shouldShowMissionCompletionModal({
      missionState: "completed",
      completed: true,
      hasClosed: true,
    }),
    false
  );
});

test("지급된 보상은 황금열쇠 획득 안내를 표시한다", () => {
  for (const status of ["awarded", "already_earned", "granted"]) {
    assert.deepEqual(getMissionRewardPresentation(status), {
      awarded: true,
      title: "황금열쇠를 받았어요",
      description: "미션을 완료했어요",
    });
  }
});

test("일일 지급 한도여도 완료 안내와 사유를 표시한다", () => {
  assert.deepEqual(getMissionRewardPresentation("daily_limit_reached"), {
    awarded: false,
    title: "오늘 받을 수 있는 황금열쇠를 모두 받았어요",
    description: "미션은 멋지게 완료했어요",
  });
});

test("보유 상한이어도 완료 안내와 사유를 표시한다", () => {
  assert.deepEqual(getMissionRewardPresentation("max_balance_reached"), {
    awarded: false,
    title: "황금열쇠를 가득 모았어요",
    description: "열쇠를 사용하면 다음 미션에서 다시 받을 수 있어요",
  });
});

test("알 수 없는 보상 상태에서도 미션 완료 안내는 숨기지 않는다", () => {
  assert.deepEqual(getMissionRewardPresentation("none"), {
    awarded: false,
    title: "미션을 완료했어요",
    description: "오늘의 이야기를 들려줘서 고마워요",
  });
});
