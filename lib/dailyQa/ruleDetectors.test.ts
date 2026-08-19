import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DailyQaMessage,
  detectLlmFallback,
  detectMissionAbruptEnd,
  detectPardonRepeat,
  detectReactionRepetition,
  detectSttTranscriptAnomaly,
  runRuleDetectors,
} from "./ruleDetectors";
import { FREE_CHAT_FALLBACK_TEXT } from "../k-conversation/responseGenerator";
import { MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY } from "../mission-v3/missionAdapter";

function makeMsg(overrides: Partial<DailyQaMessage>): DailyQaMessage {
  return {
    id: overrides.id ?? "msg-1",
    sessionId: overrides.sessionId ?? "session-1",
    childId: overrides.childId ?? "child-1",
    role: overrides.role ?? "k",
    content: overrides.content ?? "안녕!",
    rawTranscript: overrides.rawTranscript ?? null,
    mode: overrides.mode ?? "free_chat",
    createdAt: overrides.createdAt ?? "2026-08-19T10:00:00.000Z",
  };
}

// ── 1. LLM_FALLBACK ──────────────────────────────────────────────────────────
test("LLM_FALLBACK: 자유대화 폴백 문구와 정확히 일치하면 탐지된다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "m1", role: "k", content: FREE_CHAT_FALLBACK_TEXT }),
  ];
  const detections = detectLlmFallback(messages);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].taxonomyCode, "LLM_FALLBACK");
  assert.equal(detections[0].messageId, "m1");
  assert.equal(detections[0].excerpt, FREE_CHAT_FALLBACK_TEXT);
});

test("LLM_FALLBACK: 미션 폴백 문구와 정확히 일치하면 탐지된다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "m2", role: "k", mode: "mission", content: MISSION_FALLBACK_ACKNOWLEDGEMENT_ONLY }),
  ];
  const detections = detectLlmFallback(messages);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].taxonomyCode, "LLM_FALLBACK");
  assert.equal(detections[0].messageId, "m2");
});

test("LLM_FALLBACK: 폴백 문구와 비슷하지만 다른 정상 응답은 안 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "m3", role: "k", content: "응, 듣고 있어. 오늘 학교에서 무슨 일 있었어?" }),
    makeMsg({ id: "m4", role: "k", content: "그렇구나, 얘기해줘서 고마워! 다음 이야기 해볼까?" }),
    makeMsg({ id: "m5", role: "child", content: FREE_CHAT_FALLBACK_TEXT }), // 아이 발화는 제외
  ];
  const detections = detectLlmFallback(messages);
  assert.equal(detections.length, 0);
});

// ── 2. PARDON_REPEAT ─────────────────────────────────────────────────────────
test("PARDON_REPEAT: 연속 2회 이상 못 알아들었다는 발화가 나오면 탐지된다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "k1",
      role: "k",
      content: "미안해, 잘 안 들렸어. 다시 한 번 말해줄래?",
      createdAt: "2026-08-19T10:00:00.000Z",
    }),
    makeMsg({
      id: "c1",
      role: "child",
      content: "사과",
      createdAt: "2026-08-19T10:00:05.000Z",
    }),
    makeMsg({
      id: "k2",
      role: "k",
      content: '내가 "사과"라고 들었는데, 이게 맞니?',
      createdAt: "2026-08-19T10:00:10.000Z",
    }),
  ];
  const detections = detectPardonRepeat(messages);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].taxonomyCode, "PARDON_REPEAT");
  assert.equal(detections[0].messageId, "k2");
});

test("PARDON_REPEAT: 1회만 나온 경우는 안 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "k1",
      role: "k",
      content: "미안해, 잘 안 들렸어. 다시 한 번 말해줄래?",
      createdAt: "2026-08-19T10:00:00.000Z",
    }),
    makeMsg({
      id: "c1",
      role: "child",
      content: "사과",
      createdAt: "2026-08-19T10:00:05.000Z",
    }),
    makeMsg({
      id: "k2",
      role: "k",
      content: "사과는 빨갛고 맛있지!",
      createdAt: "2026-08-19T10:00:10.000Z",
    }),
  ];
  const detections = detectPardonRepeat(messages);
  assert.equal(detections.length, 0);
});

test("PARDON_REPEAT: 3회 연속 발화도 구간당 1건으로만 집계된다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "k1", role: "k", content: "미안해, 잘 안 들렸어. 다시 한 번 말해줄래?", createdAt: "2026-08-19T10:00:00.000Z" }),
    makeMsg({ id: "k2", role: "k", content: '내가 "사과"라고 들었는데, 이게 맞니?', createdAt: "2026-08-19T10:00:05.000Z" }),
    makeMsg({ id: "k3", role: "k", content: "잘 못 알아들었어. 다시 얘기해줘.", createdAt: "2026-08-19T10:00:10.000Z" }),
  ];
  const detections = detectPardonRepeat(messages);
  assert.equal(detections.length, 1);
});

// ── 3. STT_TRANSCRIPT_ANOMALY ────────────────────────────────────────────────
test("STT_TRANSCRIPT_ANOMALY: 한글 자모 발화(ㅍ, ㅠㅠ, ㅇㅈㄹ)는 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "c1", role: "child", content: "ㅍ" }),
    makeMsg({ id: "c2", role: "child", content: "ㅠㅠ" }),
    makeMsg({ id: "c3", role: "child", content: "ㅇㅈㄹ" }),
  ];
  const detections = detectSttTranscriptAnomaly(messages);
  assert.equal(detections.length, 3);
  assert.equal(detections[0].messageId, "c1");
  assert.equal(detections[1].messageId, "c2");
  assert.equal(detections[2].messageId, "c3");
});

test("STT_TRANSCRIPT_ANOMALY: ㅋㅋ, ㅎㅎ, ㅇㅇ 등 일상 축약은 안 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "c1", role: "child", content: "ㅋㅋ" }),
    makeMsg({ id: "c2", role: "child", content: "ㅋㅋㅋ" }),
    makeMsg({ id: "c3", role: "child", content: "ㅎㅎ" }),
    makeMsg({ id: "c4", role: "child", content: "ㅇㅇ" }),
    makeMsg({ id: "c5", role: "child", content: "ㅋㅋㅋ ㅎㅎㅎ" }),
    makeMsg({ id: "c6", role: "child", content: "응" }),
    makeMsg({ id: "c7", role: "child", content: "네!" }),
  ];
  const detections = detectSttTranscriptAnomaly(messages);
  assert.equal(detections.length, 0);
});

test("STT_TRANSCRIPT_ANOMALY: 음성 보정으로 길이가 절반 이하로 줄어든 경우 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "c1",
      role: "child",
      rawTranscript: "오늘 학교에서 친구들이랑 축구하고 놀았어", // 25자
      content: "놀았어", // 3자 (<= 12.5)
    }),
  ];
  const detections = detectSttTranscriptAnomaly(messages);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].messageId, "c1");
});

test("STT_TRANSCRIPT_ANOMALY: 정상 보정(길이 절반 초과 유지)은 안 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "c1",
      role: "child",
      rawTranscript: "오늘 학교에서 놀았어", // 11자
      content: "학교에서 놀았어", // 8자 (> 5.5)
    }),
    makeMsg({
      id: "c2",
      role: "child",
      rawTranscript: null,
      content: "오늘 학교에서 놀았어",
    }),
  ];
  const detections = detectSttTranscriptAnomaly(messages);
  assert.equal(detections.length, 0);
});

// ── 4. REACTION_REPETITION ───────────────────────────────────────────────────
test("REACTION_REPETITION: K가 같은 공감 문구로 연속 2턴 이상 시작하면 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "k1",
      role: "k",
      content: "그랬구나! 오늘 정말 신났겠다.",
      createdAt: "2026-08-19T10:00:00.000Z",
    }),
    makeMsg({
      id: "c1",
      role: "child",
      content: "응",
      createdAt: "2026-08-19T10:00:05.000Z",
    }),
    makeMsg({
      id: "k2",
      role: "k",
      content: "그랬구나~ 친구랑 같이 해서 더 좋았네.",
      createdAt: "2026-08-19T10:00:10.000Z",
    }),
  ];
  const detections = detectReactionRepetition(messages);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].taxonomyCode, "REACTION_REPETITION");
  assert.equal(detections[0].messageId, "k2");
});

test("REACTION_REPETITION: 서로 다른 공감 문구가 이어지면 안 잡힌다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "k1",
      role: "k",
      content: "그랬구나! 오늘 뭐 했어?",
      createdAt: "2026-08-19T10:00:00.000Z",
    }),
    makeMsg({
      id: "c1",
      role: "child",
      content: "그림 그렸어",
      createdAt: "2026-08-19T10:00:05.000Z",
    }),
    makeMsg({
      id: "k2",
      role: "k",
      content: "좋았겠다! 내일도 그림 그릴 거야?",
      createdAt: "2026-08-19T10:00:10.000Z",
    }),
    makeMsg({
      id: "c2",
      role: "child",
      content: "응",
      createdAt: "2026-08-19T10:00:15.000Z",
    }),
    makeMsg({
      id: "k3",
      role: "k",
      content: "재밌었겠다! 무슨 그림이야?",
      createdAt: "2026-08-19T10:00:20.000Z",
    }),
  ];
  const detections = detectReactionRepetition(messages);
  assert.equal(detections.length, 0);
});

// ── 5. MISSION_ABRUPT_END ────────────────────────────────────────────────────
test("MISSION_ABRUPT_END: 미션 마지막이 아이 발화이고 5분 이상 경과했으면 잡힌다", () => {
  const windowEnd = "2026-08-19T10:30:00.000Z";
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "m1",
      sessionId: "s-mission-1",
      mode: "mission",
      role: "k",
      content: "오늘 기분 어때?",
      createdAt: "2026-08-19T10:00:00.000Z",
    }),
    makeMsg({
      id: "m2",
      sessionId: "s-mission-1",
      mode: "mission",
      role: "child",
      content: "좋아!",
      createdAt: "2026-08-19T10:05:00.000Z", // 25분 전 (5분 초과)
    }),
  ];
  const detections = detectMissionAbruptEnd(messages, windowEnd);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].taxonomyCode, "MISSION_ABRUPT_END");
  assert.equal(detections[0].messageId, "m2");
});

test("MISSION_ABRUPT_END: window 끝 5분 이내 세션은 아직 진행 중일 수 있으므로 안 잡힌다", () => {
  const windowEnd = "2026-08-19T10:30:00.000Z";
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "m1",
      sessionId: "s-mission-2",
      mode: "mission",
      role: "child",
      content: "지금 답하는 중이야",
      createdAt: "2026-08-19T10:28:00.000Z", // 2분 전 (5분 이내)
    }),
  ];
  const detections = detectMissionAbruptEnd(messages, windowEnd);
  assert.equal(detections.length, 0);
});

test("MISSION_ABRUPT_END: 자유대화 세션은 안 잡힌다", () => {
  const windowEnd = "2026-08-19T10:30:00.000Z";
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "m1",
      sessionId: "s-freechat-1",
      mode: "free_chat",
      role: "child",
      content: "나 배고파",
      createdAt: "2026-08-19T10:00:00.000Z", // 30분 전
    }),
  ];
  const detections = detectMissionAbruptEnd(messages, windowEnd);
  assert.equal(detections.length, 0);
});

test("MISSION_ABRUPT_END: 미션 마지막이 K 발화이면 안 잡힌다", () => {
  const windowEnd = "2026-08-19T10:30:00.000Z";
  const messages: DailyQaMessage[] = [
    makeMsg({
      id: "m1",
      sessionId: "s-mission-3",
      mode: "mission",
      role: "k",
      content: "오늘 미션 완료!",
      createdAt: "2026-08-19T10:00:00.000Z",
    }),
  ];
  const detections = detectMissionAbruptEnd(messages, windowEnd);
  assert.equal(detections.length, 0);
});

// ── 6. runRuleDetectors 통합 실행 ───────────────────────────────────────────
test("runRuleDetectors: 5종 detector가 모두 정상 동작하고 비순서 메시지도 세션별 시간순 정렬된다", () => {
  const windowEnd = "2026-08-19T12:00:00.000Z";
  const messages: DailyQaMessage[] = [
    // Session 1: LLM Fallback (K)
    makeMsg({ id: "s1-1", sessionId: "s1", role: "k", content: FREE_CHAT_FALLBACK_TEXT, createdAt: "2026-08-19T10:00:00.000Z" }),
    // Session 2: STT Anomaly (Child)
    makeMsg({ id: "s2-1", sessionId: "s2", role: "child", content: "ㅠㅠ", createdAt: "2026-08-19T10:01:00.000Z" }),
    // Session 3: Pardon Repeat (순서 섞임)
    makeMsg({ id: "s3-2", sessionId: "s3", role: "k", content: "잘 못 알아들었어. 다시 얘기해줘.", createdAt: "2026-08-19T10:05:00.000Z" }),
    makeMsg({ id: "s3-1", sessionId: "s3", role: "k", content: "미안해, 잘 안 들렸어. 다시 한 번 말해줄래?", createdAt: "2026-08-19T10:02:00.000Z" }),
    // Session 4: Reaction Repetition
    makeMsg({ id: "s4-1", sessionId: "s4", role: "k", content: "좋았겠다! 오늘 최고네", createdAt: "2026-08-19T10:10:00.000Z" }),
    makeMsg({ id: "s4-2", sessionId: "s4", role: "k", content: "좋았겠다~ 내일도 가자", createdAt: "2026-08-19T10:11:00.000Z" }),
    // Session 5: Mission Abrupt End
    // "응 알겠어" 는 정상 종료 인사라 이제 제외된다(리뷰 지적 반영). 실제 내용 발화로 둔다.
    makeMsg({ id: "s5-1", sessionId: "s5", mode: "mission", role: "child", content: "민준이랑 축구했어", createdAt: "2026-08-19T10:20:00.000Z" }),
  ];

  const detections = runRuleDetectors(messages, windowEnd);
  assert.equal(detections.length, 5);

  const codes = detections.map((d) => d.taxonomyCode).sort();
  assert.deepEqual(codes, [
    "LLM_FALLBACK",
    "MISSION_ABRUPT_END",
    "PARDON_REPEAT",
    "REACTION_REPETITION",
    "STT_TRANSCRIPT_ANOMALY",
  ]);
});

// ── 2026-08-19 리뷰 지적 반영: 오탐 회귀 고정 ──────────────────
test("PARDON_REPEAT: 평범한 대화가 못 알아들음으로 잡히지 않는다", () => {
  // 리뷰 지적(MAJOR): "들었는데"·"놓쳐" 조각 매칭이 정상 대화를 잡았다.
  // 이 결과는 관리자 화면에 "오늘의 문제" 로 뜬다 — 오탐은 운영자 시간을 빼앗는다.
  const messages: DailyQaMessage[] = [
    makeMsg({ id: "k1", role: "k", content: "친구 이야기 잘 들었는데 그래서 어떻게 됐어?", createdAt: "2026-08-19T10:00:00.000Z" }),
    makeMsg({ id: "k2", role: "k", content: "그 기회를 놓쳐서 아쉬웠겠다.", createdAt: "2026-08-19T10:00:10.000Z" }),
  ];
  assert.deepEqual(detectPardonRepeat(messages), []);
});

test("MISSION_ABRUPT_END: 아이가 인사만 남기고 끝난 세션은 갑작스러운 종료가 아니다", () => {
  // 리뷰 지적(MINOR): 케이가 마무리하고 아이가 "응 바이" 한 것은 정상 종료다.
  const base = { mode: "mission" as const, sessionId: "s1" };
  for (const farewell of ["응 바이", "ㅇㅇ", "알겠어", "잘 자", "고마워"]) {
    const messages: DailyQaMessage[] = [
      makeMsg({ ...base, id: "k1", role: "k", content: "오늘 얘기 재밌었어. 잘 자!", createdAt: "2026-08-19T10:00:00.000Z" }),
      makeMsg({ ...base, id: "c1", role: "child", content: farewell, createdAt: "2026-08-19T10:00:10.000Z" }),
    ];
    assert.deepEqual(
      detectMissionAbruptEnd(messages, "2026-08-19T12:00:00.000Z"),
      [],
      `정상 종료가 갑작스러운 종료로 잡힌다: ${farewell}`
    );
  }
});

test("MISSION_ABRUPT_END: 아이가 실제 내용을 말한 뒤 케이 응답이 없으면 잡는다", () => {
  const messages: DailyQaMessage[] = [
    makeMsg({ mode: "mission", id: "k1", role: "k", content: "오늘 뭐 했어?", createdAt: "2026-08-19T10:00:00.000Z" }),
    makeMsg({ mode: "mission", id: "c1", role: "child", content: "민준이랑 축구했어", createdAt: "2026-08-19T10:00:10.000Z" }),
  ];
  const detections = detectMissionAbruptEnd(messages, "2026-08-19T12:00:00.000Z");
  assert.equal(detections.length, 1);
  assert.equal(detections[0].taxonomyCode, "MISSION_ABRUPT_END");
});
