import assert from "node:assert/strict";
import { test } from "node:test";

import type { MissionEntrySnapshot } from "./entryContract.js";
import {
  parseMissionEntrySnapshot,
  resolveMissionDestination,
  resolveMissionDisplay,
} from "./clientEntry.js";

const openTimeGate = {
  enabled: true,
  allowedForNewStart: true,
  scheduleEnforced: true,
  reason: null,
};

const closedTimeGate = {
  enabled: true,
  allowedForNewStart: false,
  scheduleEnforced: true,
  reason: "closed" as const,
};

const beforeOpenTimeGate = {
  enabled: true,
  allowedForNewStart: false,
  scheduleEnforced: true,
  reason: "before_open" as const,
};

// ==========================================
// 1. parseMissionEntrySnapshot 정상 snapshot 5종 파싱 성공
// ==========================================

test("1. 정상 start snapshot 파싱 성공", () => {
  const raw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "start",
    canEnter: true,
    canStartNew: true,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: null,
    progress: null,
    timeGate: openTimeGate,
  };

  const parsed = parseMissionEntrySnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.entryState, "start");
  assert.equal(parsed.canEnter, true);
  assert.equal(parsed.canStartNew, true);
  assert.equal(parsed.status, null);
  assert.equal(parsed.completed, false);
  assert.equal(parsed.blockReason, null);
});

test("2. 정상 resume snapshot 파싱 성공 (v3 goals 진행)", () => {
  const raw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "resume",
    canEnter: true,
    canStartNew: false,
    sessionId: "sess-v3-1",
    status: "IN_PROGRESS",
    completed: false,
    blockReason: null,
    progress: {
      kind: "conversation_goals",
      current: 1,
      target: 3,
    },
    timeGate: openTimeGate,
  };

  const parsed = parseMissionEntrySnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.entryState, "resume");
  assert.equal(parsed.canEnter, true);
  assert.equal(parsed.canStartNew, false);
  assert.equal(parsed.sessionId, "sess-v3-1");
  assert.equal(parsed.status, "IN_PROGRESS");
  assert.equal(parsed.completed, false);
  assert.deepEqual(parsed.progress, {
    kind: "conversation_goals",
    current: 1,
    target: 3,
  });
});

test("3. 정상 resume snapshot 파싱 성공 (v2 answers 진행)", () => {
  const raw = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "resume",
    canEnter: true,
    canStartNew: false,
    sessionId: "sess-v2-1",
    status: "IN_PROGRESS",
    completed: false,
    blockReason: null,
    progress: {
      kind: "valid_answers",
      current: 3,
      target: 5,
    },
    timeGate: closedTimeGate, // 진행 중 세션은 closed여도 resume 가능
  };

  const parsed = parseMissionEntrySnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.entryState, "resume");
  assert.equal(parsed.policyVersion, "v2_dual");
  assert.equal(parsed.canEnter, true);
  assert.equal(parsed.completed, false);
  assert.deepEqual(parsed.progress, {
    kind: "valid_answers",
    current: 3,
    target: 5,
  });
});

test("4. 정상 completed snapshot 파싱 성공", () => {
  const raw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "completed",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-completed",
    status: "COMPLETED",
    completed: true,
    blockReason: "daily_limit_reached",
    progress: {
      kind: "conversation_goals",
      current: 3,
      target: 3,
    },
    timeGate: openTimeGate,
  };

  const parsed = parseMissionEntrySnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.entryState, "completed");
  assert.equal(parsed.completed, true);
  assert.equal(parsed.status, "COMPLETED");
  assert.equal(parsed.blockReason, "daily_limit_reached");
  assert.equal(parsed.canEnter, false);
});

test("5. 정상 safety_paused snapshot 파싱 성공", () => {
  const raw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "safety_paused",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-paused",
    status: "SAFETY_PAUSED",
    completed: false,
    blockReason: "daily_limit_reached",
    progress: {
      kind: "conversation_goals",
      current: 1,
      target: 3,
    },
    timeGate: openTimeGate,
  };

  const parsed = parseMissionEntrySnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.entryState, "safety_paused");
  assert.equal(parsed.completed, false);
  assert.equal(parsed.status, "SAFETY_PAUSED");
  assert.equal(parsed.blockReason, "daily_limit_reached");
  assert.equal(parsed.canEnter, false);
});

test("6. 정상 force_ended snapshot 파싱 성공", () => {
  const raw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "force_ended",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-ended",
    status: "FORCE_ENDED",
    completed: false,
    blockReason: "daily_limit_reached",
    progress: {
      kind: "conversation_goals",
      current: 2,
      target: 3,
    },
    timeGate: openTimeGate,
  };

  const parsed = parseMissionEntrySnapshot(raw);
  assert.ok(parsed);
  assert.equal(parsed.entryState, "force_ended");
  assert.equal(parsed.completed, false);
  assert.equal(parsed.status, "FORCE_ENDED");
  assert.equal(parsed.blockReason, "daily_limit_reached");
  assert.equal(parsed.canEnter, false);
});

test("7. 정상 before_open / closed / unavailable snapshot 파싱 성공", () => {
  const beforeOpenRaw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "before_open",
    canEnter: false,
    canStartNew: false,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: "before_open",
    progress: null,
    timeGate: beforeOpenTimeGate,
  };
  assert.ok(parseMissionEntrySnapshot(beforeOpenRaw));

  const closedRaw = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "closed",
    canEnter: false,
    canStartNew: false,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: "closed",
    progress: null,
    timeGate: closedTimeGate,
  };
  assert.ok(parseMissionEntrySnapshot(closedRaw));

  const unavailableRaw = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "unavailable",
    canEnter: false,
    canStartNew: false,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: "unavailable",
    progress: null,
    timeGate: openTimeGate,
  };
  assert.ok(parseMissionEntrySnapshot(unavailableRaw));
});

// ==========================================
// 2. 계약 위반 3종 및 불일치 조합 fail-closed (거부 -> null)
// ==========================================

test("8. 계약 위반 1: completed:true 인데 status !== 'COMPLETED' -> 거부(null)", () => {
  const invalid = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "completed",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-1",
    status: "IN_PROGRESS", // 불일치
    completed: true,
    blockReason: "daily_limit_reached",
    progress: null,
    timeGate: openTimeGate,
  };
  assert.equal(parseMissionEntrySnapshot(invalid), null);
});

test("9. 계약 위반 2: blockReason:'daily_limit_reached' 인데 status가 비terminal -> 거부(null)", () => {
  const invalid = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "resume",
    canEnter: true,
    canStartNew: false,
    sessionId: "sess-1",
    status: "IN_PROGRESS", // 비terminal
    completed: false,
    blockReason: "daily_limit_reached", // 불일치
    progress: null,
    timeGate: openTimeGate,
  };
  assert.equal(parseMissionEntrySnapshot(invalid), null);
});

test("10. 계약 위반 3: canEnter:true 인데 entryState가 terminal(completed) -> 거부(null)", () => {
  const invalid = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "completed",
    canEnter: true, // 불일치
    canStartNew: false,
    sessionId: "sess-1",
    status: "COMPLETED",
    completed: true,
    blockReason: "daily_limit_reached",
    progress: null,
    timeGate: openTimeGate,
  };
  assert.equal(parseMissionEntrySnapshot(invalid), null);
});

test("11. 추가 불일치: safety_paused 인데 completed:true -> 거부(null)", () => {
  const invalid = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "safety_paused",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-1",
    status: "SAFETY_PAUSED",
    completed: true, // 안전 중단은 절대 완료가 아님!
    blockReason: "daily_limit_reached",
    progress: null,
    timeGate: openTimeGate,
  };
  assert.equal(parseMissionEntrySnapshot(invalid), null);
});

test("12. 추가 불일치: resume 인데 canStartNew:true -> 거부(null)", () => {
  const invalid = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "resume",
    canEnter: true,
    canStartNew: true, // resume는 신규 생성이 아님
    sessionId: "sess-1",
    status: "IN_PROGRESS",
    completed: false,
    blockReason: null,
    progress: null,
    timeGate: openTimeGate,
  };
  assert.equal(parseMissionEntrySnapshot(invalid), null);
});

// ==========================================
// 3. 필수 필드 누락 및 잘못된 타입 -> null
// ==========================================

test("13. null / undefined / 원시 타입 / 배열 -> null", () => {
  assert.equal(parseMissionEntrySnapshot(null), null);
  assert.equal(parseMissionEntrySnapshot(undefined), null);
  assert.equal(parseMissionEntrySnapshot("not-an-object"), null);
  assert.equal(parseMissionEntrySnapshot(123), null);
  assert.equal(parseMissionEntrySnapshot([]), null);
  assert.equal(parseMissionEntrySnapshot({}), null);
});

test("14. 필수 필드(policyVersion, businessDate, entryState 등) 누락 및 오류 -> null", () => {
  const base = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "start",
    canEnter: true,
    canStartNew: true,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: null,
    progress: null,
    timeGate: openTimeGate,
  };

  assert.equal(parseMissionEntrySnapshot({ ...base, policyVersion: "v1_invalid" }), null);
  assert.equal(parseMissionEntrySnapshot({ ...base, businessDate: "" }), null);
  assert.equal(parseMissionEntrySnapshot({ ...base, entryState: "invalid_state" }), null);
  assert.equal(parseMissionEntrySnapshot({ ...base, canEnter: "true" as unknown as boolean }), null);
  assert.equal(parseMissionEntrySnapshot({ ...base, timeGate: null }), null);
  assert.equal(parseMissionEntrySnapshot({ ...base, progress: { kind: "invalid", current: 0, target: 1 } }), null);
});

// ==========================================
// 4. resolveMissionDestination 목적지 분기 검증
// ==========================================

test("15. v3 정책 + start / resume -> v3 목적지", () => {
  const startSnapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "start",
    canEnter: true,
    canStartNew: true,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: null,
    progress: null,
    timeGate: openTimeGate,
  };
  assert.deepEqual(resolveMissionDestination(startSnapshot), {
    kind: "v3",
    entryState: "start",
  });

  const resumeSnapshot: MissionEntrySnapshot = {
    ...startSnapshot,
    entryState: "resume",
    canStartNew: false,
    sessionId: "sess-v3",
    status: "IN_PROGRESS",
  };
  assert.deepEqual(resolveMissionDestination(resumeSnapshot), {
    kind: "v3",
    entryState: "resume",
  });
});

test("16. v2 정책 + start / resume -> v2 목적지", () => {
  const startSnapshot: MissionEntrySnapshot = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "start",
    canEnter: true,
    canStartNew: true,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: null,
    progress: null,
    timeGate: openTimeGate,
  };
  assert.deepEqual(resolveMissionDestination(startSnapshot), {
    kind: "v2",
    entryState: "start",
  });

  const resumeSnapshot: MissionEntrySnapshot = {
    ...startSnapshot,
    entryState: "resume",
    canStartNew: false,
    sessionId: "sess-v2",
    status: "IN_PROGRESS",
  };
  assert.deepEqual(resolveMissionDestination(resumeSnapshot), {
    kind: "v2",
    entryState: "resume",
  });
});

test("17. terminal / 시간차단 / unavailable -> blocked 목적지 + 사유", () => {
  const base: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "completed",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-1",
    status: "COMPLETED",
    completed: true,
    blockReason: "daily_limit_reached",
    progress: null,
    timeGate: openTimeGate,
  };

  assert.deepEqual(resolveMissionDestination(base), {
    kind: "blocked",
    reason: "completed",
    entryState: "completed",
  });

  assert.deepEqual(
    resolveMissionDestination({
      ...base,
      entryState: "safety_paused",
      status: "SAFETY_PAUSED",
      completed: false,
    }),
    {
      kind: "blocked",
      reason: "safety_paused",
      entryState: "safety_paused",
    },
  );

  assert.deepEqual(
    resolveMissionDestination({
      ...base,
      entryState: "force_ended",
      status: "FORCE_ENDED",
      completed: false,
    }),
    {
      kind: "blocked",
      reason: "force_ended",
      entryState: "force_ended",
    },
  );

  assert.deepEqual(
    resolveMissionDestination({
      ...base,
      entryState: "before_open",
      status: null,
      completed: false,
      blockReason: "before_open",
    }),
    {
      kind: "blocked",
      reason: "before_open",
      entryState: "before_open",
    },
  );

  assert.deepEqual(
    resolveMissionDestination({
      ...base,
      entryState: "closed",
      status: null,
      completed: false,
      blockReason: "closed",
    }),
    {
      kind: "blocked",
      reason: "closed",
      entryState: "closed",
    },
  );

  assert.deepEqual(resolveMissionDestination(null), {
    kind: "blocked",
    reason: "unavailable",
    entryState: "unavailable",
  });
});

// ==========================================
// 5. resolveMissionDisplay UI 문구 및 배지 검증
// ==========================================

test("18. completed: 제목 '미션 완료', 설명, 말풍선, 배지 '완료'", () => {
  const snapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "completed",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-1",
    status: "COMPLETED",
    completed: true,
    blockReason: "daily_limit_reached",
    progress: null,
    timeGate: openTimeGate,
  };

  const display = resolveMissionDisplay(snapshot);
  assert.equal(display.title, "미션 완료");
  assert.equal(display.description, "오늘의 미션을 모두 완료했어요");
  assert.equal(display.bubble, "오늘의 미션을 모두 완료했어!");
  assert.equal(display.badge, "완료");
});

test("19. safety_paused 및 force_ended: 완료 배지가 붙지 않음 (badge: null)", () => {
  const pausedSnapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "safety_paused",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-1",
    status: "SAFETY_PAUSED",
    completed: false,
    blockReason: "daily_limit_reached",
    progress: { kind: "conversation_goals", current: 1, target: 3 },
    timeGate: openTimeGate,
  };

  const pausedDisplay = resolveMissionDisplay(pausedSnapshot);
  assert.equal(pausedDisplay.title, "미션 잠시 쉬기");
  assert.equal(pausedDisplay.description, "안전을 위해 오늘 미션을 잠시 쉬어요");
  assert.equal(pausedDisplay.bubble, "오늘은 미션을 잠시 쉬어 갈게.");
  assert.equal(pausedDisplay.badge, null); // 절대 완료 배지나 진행 배지 붙지 않음

  const endedSnapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "force_ended",
    canEnter: false,
    canStartNew: false,
    sessionId: "sess-1",
    status: "FORCE_ENDED",
    completed: false,
    blockReason: "daily_limit_reached",
    progress: { kind: "conversation_goals", current: 2, target: 3 },
    timeGate: openTimeGate,
  };

  const endedDisplay = resolveMissionDisplay(endedSnapshot);
  assert.equal(endedDisplay.title, "오늘 미션 종료");
  assert.equal(endedDisplay.description, "오늘 미션은 여기까지예요");
  assert.equal(endedDisplay.bubble, "오늘 미션은 여기까지야. 내일 다시 만나자!");
  assert.equal(endedDisplay.badge, null); // 절대 완료 배지나 진행 배지 붙지 않음
});

test("20. resume: progress.kind가 valid_answers든 conversation_goals든 동일한 '${current}/${target}' 형식 배지", () => {
  const v2ResumeSnapshot: MissionEntrySnapshot = {
    policyVersion: "v2_dual",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "resume",
    canEnter: true,
    canStartNew: false,
    sessionId: "sess-v2",
    status: "IN_PROGRESS",
    completed: false,
    blockReason: null,
    progress: {
      kind: "valid_answers",
      current: 3,
      target: 10,
    },
    timeGate: openTimeGate,
  };

  const v2Display = resolveMissionDisplay(v2ResumeSnapshot);
  assert.equal(v2Display.title, "미션 계속하기");
  assert.equal(v2Display.description, "진행 중인 미션을 이어서 해요");
  assert.equal(v2Display.badge, "3/10");

  const v3ResumeSnapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: "2026-08-13T09:00:00+09:00",
    businessDate: "2026-08-13",
    entryState: "resume",
    canEnter: true,
    canStartNew: false,
    sessionId: "sess-v3",
    status: "IN_PROGRESS",
    completed: false,
    blockReason: null,
    progress: {
      kind: "conversation_goals",
      current: 2,
      target: 3,
    },
    timeGate: openTimeGate,
  };

  const v3Display = resolveMissionDisplay(v3ResumeSnapshot);
  assert.equal(v3Display.title, "미션 계속하기");
  assert.equal(v3Display.description, "진행 중인 미션을 이어서 해요");
  assert.equal(v3Display.badge, "2/3");
});

test("21. before_open, closed, unavailable, null snapshot 표시 문구 검증", () => {
  const beforeOpenSnapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "before_open",
    canEnter: false,
    canStartNew: false,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: "before_open",
    progress: null,
    timeGate: beforeOpenTimeGate,
  };
  const boDisplay = resolveMissionDisplay(beforeOpenSnapshot);
  assert.equal(boDisplay.bubble, "아직 미션 시간이 아니야.");
  assert.equal(boDisplay.badge, null);

  const closedSnapshot: MissionEntrySnapshot = {
    policyVersion: "v3_single_daily",
    effectiveAt: null,
    businessDate: "2026-08-13",
    entryState: "closed",
    canEnter: false,
    canStartNew: false,
    sessionId: null,
    status: null,
    completed: false,
    blockReason: "closed",
    progress: null,
    timeGate: closedTimeGate,
  };
  const closedDisplay = resolveMissionDisplay(closedSnapshot);
  assert.equal(closedDisplay.bubble, "오늘 미션 시간이 끝났어.");
  assert.equal(closedDisplay.badge, null);

  const unavailDisplay = resolveMissionDisplay(null);
  assert.equal(unavailDisplay.description, "미션 상태를 확인하지 못했어요.");
  assert.equal(unavailDisplay.bubble, "미션 상태를 확인하지 못했어요.");
  assert.equal(unavailDisplay.badge, null);
});
