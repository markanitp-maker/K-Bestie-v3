// MissionCompletionController 단위 테스트 — node:test 내장 러너(npm test).
// 실제 setTimeout 대신 결정론적 가짜 타이머를 주입해 700ms/8000ms 대기를 즉시 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MissionCompletionController } from "./missionCompletionFlow.js";

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
  cleared: boolean;
}

class FakeClock {
  private now = 0;
  private timers: FakeTimer[] = [];
  private nextId = 1;

  setTimer = (fn: () => void, ms: number): unknown => {
    const timer: FakeTimer = { id: this.nextId++, at: this.now + ms, fn, cleared: false };
    this.timers.push(timer);
    return timer;
  };

  clearTimer = (handle: unknown): void => {
    (handle as FakeTimer).cleared = true;
  };

  /** 시간을 ms만큼 전진시키며, 그 사이 도달하는 타이머를 예정 순서대로 실행한다.
   *  타이머 콜백이 새 타이머를 예약해도(체이닝) 같은 advance 호출 안에서 계속 처리한다. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => !t.cleared && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      if (!due.cleared) due.fn();
    }
    this.now = target;
  }
}

function makeController(clock: FakeClock) {
  const events: { event: string; fields?: Record<string, unknown> }[] = [];
  const calls = {
    stateChanges: [] as string[],
    showCompletionText: 0,
    closeSession: 0,
    grantReward: 0,
    closingAudioTimeout: 0,
  };
  const controller = new MissionCompletionController({
    onStateChange: (s) => calls.stateChanges.push(s),
    onShowCompletionText: () => { calls.showCompletionText++; },
    onCloseSession: () => { calls.closeSession++; },
    onGrantReward: () => { calls.grantReward++; },
    onClosingAudioTimeout: () => { calls.closingAudioTimeout++; },
    onLog: (event, fields) => events.push({ event, fields }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { controller, events, calls };
}

// runTtsFallback()은 async라 onClosingAudioTimeout await 이후의 onCloseSession/complete가
// 마이크로태스크로 밀린다 — advance() 직후 이 tick()으로 그 체인을 비워준 뒤 검증한다.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("정상 완료: turnComplete + audioDrained 이후 700ms 뒤에만 종료", () => {
  const clock = new FakeClock();
  const { controller, events, calls } = makeController(clock);

  controller.start();
  assert.equal(controller.getState(), "completing");

  controller.notifyClosingAudioStarted(); // 종료 발화 음성이 시작됨 — 2.5초 폴백 취소
  controller.notifyTurnComplete();
  controller.notifyAudioDrained();

  // 700ms 되기 직전에는 아직 안 닫힘
  clock.advance(699);
  assert.equal(calls.closeSession, 0);
  assert.equal(controller.getState(), "completing");

  clock.advance(1);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(controller.getState(), "completed");

  assert.deepEqual(
    events.map((e) => e.event),
    ["mission_completion_started", "mission_closing_finished", "mission_completed"]
  );
});

test("느린 음성 재생: audioDrained이 한참 늦게 와도(8초 이내) fallback 없이 정상 완료", () => {
  const clock = new FakeClock();
  const { controller, calls, events } = makeController(clock);

  controller.start();
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();

  clock.advance(6000); // 아직 오디오 재생 중
  assert.equal(calls.closeSession, 0);

  controller.notifyAudioDrained(); // 6초 시점에 오디오 재생 종료
  clock.advance(700);

  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(events.filter((e) => e.event === "mission_closing_finished")[0].fields?.reason, "normal");
});

test("중복 이벤트: start/notifyTurnComplete/notifyAudioDrained가 여러 번 와도 1회만 처리", () => {
  const clock = new FakeClock();
  const { controller, calls } = makeController(clock);

  controller.start();
  controller.start(); // 중복
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();
  controller.notifyTurnComplete(); // 중복
  controller.notifyAudioDrained();
  controller.notifyAudioDrained(); // 중복

  clock.advance(700);

  assert.equal(calls.stateChanges.filter((s) => s === "completing").length, 1);
  assert.equal(calls.stateChanges.filter((s) => s === "completed").length, 1);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
});

test("새로고침(재마운트 후 재호출) 시나리오: 완료 이후 start()가 다시 와도 무시", () => {
  const clock = new FakeClock();
  const { controller, calls } = makeController(clock);

  controller.start();
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();
  controller.notifyAudioDrained();
  clock.advance(700);
  assert.equal(controller.getState(), "completed");

  // 새로고침 직후 stale 이벤트가 재전달되는 상황을 흉내
  controller.start();
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();
  controller.notifyAudioDrained();
  clock.advance(1000);

  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(calls.stateChanges.filter((s) => s === "completed").length, 1);
});

test("WebSocket 조기 종료: turnComplete/audioDrained 없이 외부 종료되면 즉시 완료 문구 표시 후 완료 처리", () => {
  const clock = new FakeClock();
  const { controller, calls, events } = makeController(clock);

  controller.start();
  controller.notifySessionClosedExternally();

  assert.equal(calls.showCompletionText, 1);
  assert.equal(calls.closeSession, 0); // 이미 끊긴 세션을 다시 닫지 않음
  assert.equal(calls.grantReward, 1);
  assert.equal(controller.getState(), "completed");
  assert.equal(events.filter((e) => e.event === "mission_closing_finished")[0].fields?.reason, "external_close");

  // fallback 타이머가 이미 취소돼 8초를 더 흘려보내도 추가 호출 없음
  clock.advance(9000);
  assert.equal(calls.showCompletionText, 1);
  assert.equal(calls.grantReward, 1);
});

test("8초 fallback: 음성은 시작됐지만 turnComplete/audioDrained가 끝내 안 오면 강제 완료 문구 표시 후 종료", () => {
  const clock = new FakeClock();
  const { controller, calls, events } = makeController(clock);

  controller.start();
  // 종료 발화 음성이 시작돼 2.5초 폴백은 취소됐지만, 이후 turnComplete/audioDrained가
  // 끝내 오지 않는 상황 — 최후 안전망인 8초 fallback만 발화한다.
  controller.notifyClosingAudioStarted();
  clock.advance(7999);
  assert.equal(calls.showCompletionText, 0);
  assert.equal(calls.closingAudioTimeout, 0); // 2.5초 폴백은 음성 시작으로 취소됨

  clock.advance(1);
  // 8초 시점엔 완료 문구는 즉시 뜨지만, 트레일링 오디오를 위한 700ms 유예 동안은
  // 아직 세션을 끊지 않는다(claude-review 지적: 재생 중이던 오디오를 즉시 자르지 않음).
  assert.equal(calls.showCompletionText, 1);
  assert.equal(calls.closeSession, 0);
  assert.equal(controller.getState(), "completing");

  clock.advance(699);
  assert.equal(calls.closeSession, 0);

  clock.advance(1);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(controller.getState(), "completed");
  assert.equal(events.filter((e) => e.event === "mission_closing_finished")[0].fields?.reason, "fallback_timeout");
});

test("fallback 타이머는 정상 완료 시 취소되어 뒤늦게 발화하지 않는다", () => {
  const clock = new FakeClock();
  const { controller, calls } = makeController(clock);

  controller.start();
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();
  controller.notifyAudioDrained();
  clock.advance(700);
  assert.equal(controller.getState(), "completed");
  assert.equal(calls.showCompletionText, 0); // 정상 경로는 강제 표시 호출 안 함

  clock.advance(8000); // fallback 시각을 훌쩍 지나도
  assert.equal(calls.showCompletionText, 0);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
});

// ── 전용 종료 발화(closing turn) + 2.5초 TTS 폴백 관련 테스트 ─────────────

test("(a) 종료 발화 정상 재생: 음성 시작 → turnComplete → audioDrained → 700ms 정상 완료, TTS 폴백 미호출", async () => {
  const clock = new FakeClock();
  const { controller, calls, events } = makeController(clock);

  controller.start();
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();
  controller.notifyAudioDrained();
  clock.advance(700);
  await tick();

  assert.equal(controller.getState(), "completed");
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(calls.closingAudioTimeout, 0); // 정상 경로 — TTS 폴백 절대 호출 안 됨
  assert.equal(calls.showCompletionText, 0);
  assert.equal(events.filter((e) => e.event === "mission_closing_finished")[0].fields?.reason, "normal");
});

test("(b) turnComplete가 audioDrained보다 먼저 와도, 음성이 이미 시작됐으면 TTS 폴백 안 함", async () => {
  const clock = new FakeClock();
  const { controller, calls } = makeController(clock);

  controller.start();
  controller.notifyClosingAudioStarted(); // 음성 먼저 시작
  clock.advance(300);
  controller.notifyTurnComplete();         // audioDrained 전에 turnComplete 도착
  await tick();

  // 아직 audioDrained가 안 왔으니 completing 유지, TTS 폴백은 트리거되지 않음
  assert.equal(controller.getState(), "completing");
  assert.equal(calls.closingAudioTimeout, 0);
  assert.equal(calls.closeSession, 0);

  controller.notifyAudioDrained();
  clock.advance(700);
  await tick();
  assert.equal(controller.getState(), "completed");
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.closingAudioTimeout, 0);
});

test("(c) 2.5초 동안 오디오도 turnComplete도 없으면 TTS 폴백이 정확히 1회 발화", async () => {
  const clock = new FakeClock();
  const { controller, calls, events } = makeController(clock);

  controller.start();
  clock.advance(2499);
  await tick();
  assert.equal(calls.closingAudioTimeout, 0);

  clock.advance(1); // 2500ms 도달
  await tick();
  assert.equal(calls.closingAudioTimeout, 1);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(controller.getState(), "completed");
  assert.equal(events.filter((e) => e.event === "mission_closing_finished")[0].fields?.reason, "closing_audio_timeout");

  // 8초 fallback 시각을 지나도 추가 호출 없음(멱등)
  clock.advance(6000);
  await tick();
  assert.equal(calls.closingAudioTimeout, 1);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.showCompletionText, 0);
});

test("(d) 오디오 없이 텍스트만으로 turnComplete가 2.5초 전에 오면 즉시 TTS 폴백", async () => {
  const clock = new FakeClock();
  const { controller, calls, events } = makeController(clock);

  controller.start();
  clock.advance(500);
  controller.notifyTurnComplete(); // 음성 한 번 없이 turnComplete — 2.5초 기다리지 않고 즉시 폴백
  await tick();

  assert.equal(calls.closingAudioTimeout, 1);
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.grantReward, 1);
  assert.equal(controller.getState(), "completed");
  assert.equal(events.filter((e) => e.event === "mission_closing_finished")[0].fields?.reason, "closing_text_only");

  // 2.5초/8초 타이머 시각을 지나도 추가 호출 없음
  clock.advance(8000);
  await tick();
  assert.equal(calls.closingAudioTimeout, 1);
  assert.equal(calls.closeSession, 1);
});

test("(e) notifyClosingAudioStarted 중복 호출은 멱등 — 2.5초 폴백만 취소하고 정상 완료", async () => {
  const clock = new FakeClock();
  const { controller, calls } = makeController(clock);

  controller.start();
  controller.notifyClosingAudioStarted();
  controller.notifyClosingAudioStarted(); // 중복
  controller.notifyClosingAudioStarted(); // 중복

  clock.advance(3000); // 2.5초 폴백 시각을 지나도
  await tick();
  assert.equal(calls.closingAudioTimeout, 0); // 취소됐으므로 폴백 미발화

  controller.notifyTurnComplete();
  controller.notifyAudioDrained();
  clock.advance(700);
  await tick();
  assert.equal(controller.getState(), "completed");
  assert.equal(calls.closeSession, 1);
  assert.equal(calls.closingAudioTimeout, 0);
});

test("(f) dispose()는 2.5초 타이머를 발화 없이 정리한다", async () => {
  const clock = new FakeClock();
  const { controller, calls } = makeController(clock);

  controller.start();
  controller.dispose();

  clock.advance(3000); // 2.5초 폴백 시각
  await tick();
  assert.equal(calls.closingAudioTimeout, 0);
  assert.equal(calls.closeSession, 0);

  clock.advance(6000); // 8초 fallback 시각까지
  await tick();
  assert.equal(calls.showCompletionText, 0);
  assert.equal(calls.closeSession, 0);
});

test("즉시 TTS 폴백 경로: immediateTtsFallback 옵션을 사용하는 경우 (deferred Promise 검증)", async () => {
  const clock = new FakeClock();
  const events: { event: string; fields?: Record<string, unknown> }[] = [];
  const calls = {
    stateChanges: [] as string[],
    showCompletionText: 0,
    closeSession: 0,
    grantReward: 0,
    closingAudioTimeout: 0,
  };

  let resolveTtsPromise!: () => void;
  const ttsPromise = new Promise<void>((resolve) => {
    resolveTtsPromise = resolve;
  });

  const controller = new MissionCompletionController({
    onStateChange: (s) => calls.stateChanges.push(s),
    onShowCompletionText: () => { calls.showCompletionText++; },
    onCloseSession: () => { calls.closeSession++; },
    onGrantReward: () => { calls.grantReward++; },
    onClosingAudioTimeout: () => {
      calls.closingAudioTimeout++;
      return ttsPromise;
    },
    onLog: (event, fields) => events.push({ event, fields }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  // start 호출 with immediateTtsFallback
  controller.start({ immediateTtsFallback: true });

  // start 옵션 호출 후 state completing, onClosingAudioTimeout 1회
  assert.equal(controller.getState(), "completing");
  assert.equal(calls.closingAudioTimeout, 1);

  // Promise resolve 전 close 0/completed 전이 0
  await tick();
  assert.equal(calls.closeSession, 0);
  assert.equal(calls.grantReward, 0);
  assert.equal(calls.stateChanges.filter(s => s === "completed").length, 0);

  // start 재호출 및 중복 신호에서도 모두 1회 검증
  controller.start({ immediateTtsFallback: true });
  controller.notifyClosingAudioStarted();
  controller.notifyTurnComplete();
  controller.notifyAudioDrained();

  await tick();
  assert.equal(calls.closingAudioTimeout, 1);
  assert.equal(calls.closeSession, 0);
  assert.equal(calls.grantReward, 0);

  // resolve 후 close 1/completed 1/reward 1
  resolveTtsPromise();
  await tick();

  assert.equal(calls.closeSession, 1);
  assert.equal(controller.getState(), "completed");
  assert.equal(calls.grantReward, 1);
  assert.equal(calls.stateChanges.filter(s => s === "completed").length, 1);

  // 다시 start 호출해도 변화 없어야 함
  controller.start({ immediateTtsFallback: true });
  await tick();
  assert.equal(calls.closingAudioTimeout, 1);
  assert.equal(calls.closeSession, 1);
  assert.equal(controller.getState(), "completed");
  assert.equal(calls.grantReward, 1);
});
