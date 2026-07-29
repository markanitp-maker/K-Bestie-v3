export type MissionRewardPresentation = {
  awarded: boolean;
  title: string;
  description: string;
};

export function shouldShowMissionCompletionModal({
  missionState,
  completed,
  hasClosed,
}: {
  missionState: string;
  completed: boolean;
  hasClosed: boolean;
}): boolean {
  return missionState === "completed" && completed && !hasClosed;
}

const AWARDED_STATUSES = new Set([
  "awarded",
  "already_earned",
  "granted",
]);

export function getMissionRewardPresentation(
  rewardStatus: string
): MissionRewardPresentation {
  if (AWARDED_STATUSES.has(rewardStatus)) {
    return {
      awarded: true,
      title: "황금열쇠를 받았어요",
      description: "미션을 완료했어요",
    };
  }

  if (rewardStatus === "daily_limit_reached") {
    return {
      awarded: false,
      title: "오늘 받을 수 있는 황금열쇠를 모두 받았어요",
      description: "미션은 멋지게 완료했어요",
    };
  }

  if (rewardStatus === "max_balance_reached") {
    return {
      awarded: false,
      title: "황금열쇠를 가득 모았어요",
      description: "열쇠를 사용하면 다음 미션에서 다시 받을 수 있어요",
    };
  }

  return {
    awarded: false,
    title: "미션을 완료했어요",
    description: "오늘의 이야기를 들려줘서 고마워요",
  };
}
