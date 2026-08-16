import assert from "node:assert/strict";
import type { ConversationGoal } from "./goalEngine";
import { test } from "node:test";

import type { ConversationGoal } from "./goalEngine.js";
import {
  buildMissionEntrySnapshot,
  buildUnavailableSnapshot,
  buildV2Progress,
  buildV3Progress,
  normalizeMissionStatus,
  type BuildMissionEntrySnapshotInput,
  type TimeGateInput,
} from "./entryContract.js";

const openTimeGate: TimeGateInput = {
  enabled: true,
  allowedForNewStart: true,
  scheduleEnforced: true,
  reason: null,
  displayKey: null,
};

const beforeOpenTimeGate: TimeGateInput = {
  enabled: true,
  allowedForNewStart: false,
  scheduleEnforced: true,
  reason: "before_open",
  displayKey: "before_open",
};

const closedTimeGate: TimeGateInput = {
  enabled: true,
  allowedForNewStart: false,
  scheduleEnforced: true,
  reason: "closed",
  displayKey: "closed",
};

test("1. v2 진행 3/5 -> entryState: 'resume', progress: { kind: 'valid_answers', current: 3, target: 5 }", () => {
  const v2Progress = buildV2Progress(3, 5);
  assert.deepEqual(v2Progress, {
    kind: "valid_answers",
    current: 3,
    target: 5,
  });

  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-v2-1",
      status: "IN_PROGRESS",
      progress: v2Progress,
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "resume");
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.blockReason, null);
  assert.deepEqual(snapshot.progress, {
    kind: "valid_answers",
    current: 3,
    target: 5,
  });
});

test("2. v3 진행 satisfied=1 -> progress: { kind: 'conversation_goals', current: 1, target: 4 } (Goal 4개면 기준도 4)", () => {
  const goals: ConversationGoal[] = [
    {
      goalId: "goal-1",
      order: 1,
      targetTurnIndex: 1,
      conceptTitle: "Goal 1",
      status: "SATISFIED",
    },
    {
      goalId: "goal-2",
      order: 2,
      targetTurnIndex: 2,
      conceptTitle: "Goal 2",
      status: "PENDING",
    },
    {
      goalId: "goal-3",
      order: 3,
      targetTurnIndex: 3,
      conceptTitle: "Goal 3",
      status: "PENDING",
    },
    {
      goalId: "goal-4",
      order: 4,
      targetTurnIndex: 4,
      conceptTitle: "Goal 4",
      status: "PENDING",
    },
  ];

  const v3Progress = buildV3Progress(goals);
  // Goal이 4개면 완료 기준은 min(5, 4) = 4다. 여기에 상수를 다시 적으면 서버 판정과 어긋난다.
  assert.deepEqual(v3Progress, {
    kind: "conversation_goals",
    current: 1,
    target: 4,
  });

  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-v3-1",
      status: "IN_PROGRESS",
      progress: v3Progress,
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "resume");
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.deepEqual(snapshot.progress, {
    kind: "conversation_goals",
    current: 1,
    target: 4,
  });
});

test("3. COMPLETED -> entryState: 'completed', completed: true, blockReason: 'daily_limit_reached'", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-completed-1",
      status: "COMPLETED",
      progress: {
        kind: "conversation_goals",
        current: 3,
        target: 3,
      },
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "completed");
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.status, "COMPLETED");
  assert.equal(snapshot.blockReason, "daily_limit_reached");
});

test("4. SAFETY_PAUSED -> entryState: 'safety_paused', completed: false, blockReason: 'daily_limit_reached'", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-paused-1",
      status: "SAFETY_PAUSED",
      progress: {
        kind: "conversation_goals",
        current: 1,
        target: 3,
      },
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "safety_paused");
  assert.equal(snapshot.completed, false); // 절대 completed: true가 아님!
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.status, "SAFETY_PAUSED");
  assert.equal(snapshot.blockReason, "daily_limit_reached");
});

test("5. FORCE_ENDED -> entryState: 'force_ended', completed: false, blockReason: 'daily_limit_reached'", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-force-ended-1",
      status: "FORCE_ENDED",
      progress: {
        kind: "conversation_goals",
        current: 2,
        target: 3,
      },
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "force_ended");
  assert.equal(snapshot.completed, false); // 절대 completed: true가 아님!
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.status, "FORCE_ENDED");
  assert.equal(snapshot.blockReason, "daily_limit_reached");
});

test("6. 세션 없음 + 시간창 밖(before_open) -> entryState: 'before_open', canStartNew: false, canEnter: false", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: null,
    timeGate: beforeOpenTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "before_open");
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.status, null);
  assert.equal(snapshot.blockReason, "before_open");
  assert.equal(snapshot.progress, null);
});

test("7. 세션 없음 + 시간창 안 -> entryState: 'start', canStartNew: true, canEnter: true", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: null,
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "start");
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.canStartNew, true);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.status, null);
  assert.equal(snapshot.blockReason, null);
  assert.equal(snapshot.progress, null);
});

test("8. IN_PROGRESS + 시간창 밖 (closed) -> entryState: 'resume', canEnter: true (resume가 시간창보다 우선)", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-in-progress-closed-time",
      status: "IN_PROGRESS",
      progress: {
        kind: "conversation_goals",
        current: 1,
        target: 3,
      },
    },
    timeGate: closedTimeGate, // 시간 게이트가 닫혀있어도
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "resume"); // resume가 시간창보다 우선!
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.blockReason, null);
  assert.equal(snapshot.sessionId, "session-in-progress-closed-time");
});

test("9. isMixed (혼합 정책) -> entryState: 'unavailable', canEnter: false, canStartNew: false, blockReason: 'unavailable'", () => {
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    isMixed: true,
    session: null,
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "unavailable");
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.status, null);
  assert.equal(snapshot.blockReason, "unavailable");
  assert.equal(snapshot.progress, null);
});

test("10. 조회 실패 -> buildUnavailableSnapshot: entryState: 'unavailable', canEnter: false, canStartNew: false (낙관 폴백 없음)", () => {
  const snapshot = buildUnavailableSnapshot({
    businessDate: "2026-08-13",
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
  });

  assert.equal(snapshot.entryState, "unavailable");
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.status, null);
  assert.equal(snapshot.blockReason, "unavailable");
  assert.equal(snapshot.progress, null);
});

test("11. normalizeMissionStatus 유틸리티 검증", () => {
  assert.equal(normalizeMissionStatus("COMPLETED"), "COMPLETED");
  assert.equal(normalizeMissionStatus("completed"), "COMPLETED");
  assert.equal(normalizeMissionStatus("SAFETY_PAUSED"), "SAFETY_PAUSED");
  assert.equal(normalizeMissionStatus("safety_paused"), "SAFETY_PAUSED");
  assert.equal(normalizeMissionStatus("FORCE_ENDED"), "FORCE_ENDED");
  assert.equal(normalizeMissionStatus("force_ended"), "FORCE_ENDED");
  assert.equal(normalizeMissionStatus("IN_PROGRESS"), "IN_PROGRESS");
  assert.equal(normalizeMissionStatus("in_progress"), "IN_PROGRESS");
  assert.equal(normalizeMissionStatus(null), null);
  assert.equal(normalizeMissionStatus(undefined), null);
  assert.equal(normalizeMissionStatus("UNKNOWN_STATUS"), null);
});

test("12. V1 완료행 status:null, 5/5 -> entryState: 'completed', completed: true, status: 'COMPLETED'", () => {
  const v2Progress = buildV2Progress(5, 5);
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-v1-completed",
      status: null,
      progress: v2Progress,
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "completed");
  assert.equal(snapshot.completed, true);
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.status, "COMPLETED");
  assert.equal(snapshot.blockReason, "daily_limit_reached");
  assert.deepEqual(snapshot.progress, {
    kind: "valid_answers",
    current: 5,
    target: 5,
  });
});

test("13. V1 진행행 status:null, 3/5 -> entryState: 'resume', progress: { current: 3, target: 5 }", () => {
  const v2Progress = buildV2Progress(3, 5);
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-v1-in-progress",
      status: null,
      progress: v2Progress,
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "resume");
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.status, "IN_PROGRESS");
  assert.equal(snapshot.blockReason, null);
  assert.deepEqual(snapshot.progress, {
    kind: "valid_answers",
    current: 3,
    target: 5,
  });
});

test("14. 해석 불가 status('WEIRD') -> entryState: 'unavailable' (fail-closed, 승격 금지)", () => {
  const v2Progress = buildV2Progress(3, 5);
  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    session: {
      sessionId: "session-weird-status",
      status: "WEIRD",
      progress: v2Progress,
    },
    timeGate: openTimeGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "unavailable");
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.status, null);
  assert.equal(snapshot.blockReason, "unavailable");
});

test("15. timeGate.reason이 null인데 차단 상황(allowedForNewStart: false, reason: null) -> entryState: 'unavailable' (추론 금지 fail-closed)", () => {
  const blockedNoReasonGate: TimeGateInput = {
    enabled: true,
    allowedForNewStart: false,
    scheduleEnforced: true,
    reason: null,
    displayKey: "closed", // displayKey가 있어도 reason이 없으면 추론하지 않음
  };

  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: null,
    timeGate: blockedNoReasonGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "unavailable");
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.status, null);
  assert.equal(snapshot.blockReason, "unavailable");
});

test("16. displayKey가 'between_rounds'여도 entryState는 reason('before_open')을 따르며 displayKey로 정책이 변하지 않음", () => {
  const betweenRoundsGate: TimeGateInput = {
    enabled: true,
    allowedForNewStart: false,
    scheduleEnforced: false,
    reason: "before_open",
    displayKey: "between_rounds",
  };

  const input: BuildMissionEntrySnapshotInput = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    session: null,
    timeGate: betweenRoundsGate,
  };

  const snapshot = buildMissionEntrySnapshot(input);
  assert.equal(snapshot.entryState, "before_open");
  assert.equal(snapshot.blockReason, "before_open");
  assert.equal(snapshot.canEnter, false);
  assert.equal(snapshot.canStartNew, false);
  assert.equal(snapshot.completed, false);
});

test("17. timeGate.enabled 및 scheduleEnforced가 스냅샷에 충실하게 반영된다 (상수 입력 및 기대값 검증)", () => {
  // Case A: enabled: true, scheduleEnforced: true
  const inputEnforced: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: null,
    timeGate: {
      enabled: true,
      allowedForNewStart: true,
      scheduleEnforced: true,
      reason: null,
      displayKey: null,
    },
  };

  const snapshotEnforced = buildMissionEntrySnapshot(inputEnforced);
  assert.equal(snapshotEnforced.timeGate.enabled, true);
  assert.equal(snapshotEnforced.timeGate.scheduleEnforced, true);

  // Case B: enabled: false, scheduleEnforced: false
  const inputDisabled: BuildMissionEntrySnapshotInput = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    session: null,
    timeGate: {
      enabled: false,
      allowedForNewStart: true,
      scheduleEnforced: false,
      reason: null,
      displayKey: null,
    },
  };

  const snapshotDisabled = buildMissionEntrySnapshot(inputDisabled);
  assert.equal(snapshotDisabled.timeGate.enabled, false);
  assert.equal(snapshotDisabled.timeGate.scheduleEnforced, false);
});

test("18. 낮 완료 행 + 밤 진행 행이 함께 있을 때 현재 라운드(round2_night)에 맞춰 밤 세션을 선택", () => {
  const sessions = [
    {
      id: "session-day-completed",
      started_at: "2026-08-13T11:00:00+09:00",
      mission_progress: {
        session_id: "session-day-completed",
        status: "COMPLETED",
        valid_answer_count: 10,
        required_valid_count: 10,
        round_type: "round1_day",
      },
    },
    {
      id: "session-night-in-progress",
      started_at: "2026-08-13T19:00:00+09:00",
      mission_progress: {
        session_id: "session-night-in-progress",
        status: "IN_PROGRESS",
        valid_answer_count: 3,
        required_valid_count: 10,
        round_type: "round2_night",
      },
    },
  ];

  const currentRound = "round2_night";
  // v2 route selection logic: filter by round_type === currentRound, order by started_at DESC
  const matched = sessions
    .filter((s) => s.mission_progress.round_type === currentRound)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];

  assert.ok(matched);
  assert.equal(matched.id, "session-night-in-progress");

  const snapshot = buildMissionEntrySnapshot({
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    session: {
      sessionId: matched.id,
      status: matched.mission_progress.status,
      progress: buildV2Progress(
        matched.mission_progress.valid_answer_count,
        matched.mission_progress.required_valid_count,
      ),
    },
    timeGate: openTimeGate,
  });

  assert.equal(snapshot.entryState, "resume");
  assert.equal(snapshot.canEnter, true);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.sessionId, "session-night-in-progress");
});

test("진행률 목표치는 서버 완료 기준과 같은 계산을 쓴다", () => {
  // 2026-08-16 안서현 Production: Goal 10개 중 4개 달성인데 화면이 4/3으로 보여
  // "이미 넘었는데 왜 안 끝나지"가 됐다. 서버는 LEAST(5, 총 Goal 수)=5를 요구한다.
  const make = (count: number, satisfied: number): ConversationGoal[] =>
    Array.from({ length: count }, (_, index) => ({
      goalId: `goal-${index + 1}`,
      missionSessionId: "session-1",
      childId: "child-1",
      goalOrder: index + 1,
      semanticGroup: "SCHOOL_EXPERIENCE",
      priority: "P3" as const,
      status: (index < satisfied ? "SATISFIED" : "PENDING") as ConversationGoal["status"],
      evidenceSource: null,
      sourceTurnId: null,
      confidence: null,
      satisfiedAt: null,
      parentQuestionId: null,
    }));

  assert.deepEqual(buildV3Progress(make(10, 4)), {
    kind: "conversation_goals",
    current: 4,
    target: 5,
  });
  // Goal이 기준보다 적으면 목표치도 그만큼만 요구한다.
  assert.equal(buildV3Progress(make(3, 1)).target, 3);
  assert.equal(buildV3Progress(make(7, 7)).current, 7);
  assert.equal(buildV3Progress(make(7, 7)).target, 5);
});
