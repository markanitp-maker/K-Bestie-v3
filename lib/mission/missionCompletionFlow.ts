// 미션 완료 종료 플로우 상태기계 — 프레임워크 비의존 순수 모듈(React/WebSocket 세부사항과 분리).
// 5번째 유효 답변이 확정된 순간부터 "완료 문구를 정확히 1회 말하고, 다 끝난 뒤에만 세션을
// 닫는다"까지의 타이밍을 여기서 전담한다. app/child/missions/page.tsx가 실제 DOM/오디오/
// WebSocket 동작을 콜백으로 주입한다.
//
// 상태: active → completing → completed.
// - active→completing: 5번째 유효 답변 확정 시(start()).
// - completing 동안: 케이의 마지막(종료) 발화가 실제로 끝나는 시점(Vertex/AI Studio의
//   serverContent.turnComplete + 브라우저 오디오 재생 큐 비워짐)을 기다린다. 둘 다 확인되면
//   700ms 후에만 세션을 닫는다(꼬리 오디오가 스피커에서 마저 재생되도록).
// - turnComplete/오디오 종료 신호가 8초 안에 오지 않으면(fallback) 완료 문구를 강제로 화면에
//   띄우고 정상 종료한다 — 이 fallback과 정상 경로 모두 completing→completed 전이는 정확히 1회만
//   일어나며, 보상 지급 콜백(onGrantReward)도 정확히 1회만 호출된다(멱등).
// - completing 도중 WebSocket이 스스로 끊기면(서버 오류 등) 정상 종료 대기를 포기하고 즉시
//   완료 문구를 띄운 뒤 완료 처리한다(closeSession은 다시 호출하지 않음 — 이미 끊겼으므로).

export type MissionCompletionState = "active" | "completing" | "completed";

export interface MissionCompletionCallbacks {
  onStateChange: (state: MissionCompletionState) => void;
  /** 완료 문구를 화면(및 필요시 음성)에 강제로 1회 노출 — fallback/외부 종료 경로에서만 쓰인다.
   *  정상 경로에서는 케이 본인의 발화(사전에 주입한 종료 지시를 따른 자연스러운 응답)가 이미
   *  화면에 표시돼 있으므로 별도 호출하지 않는다. */
  onShowCompletionText: () => void;
  /** WebSocket/세션 종료 — 정상 경로와 fallback 경로에서 호출된다. 이미 끊긴 경우(외부 종료)엔
   *  호출하지 않는다. */
  onCloseSession: () => void;
  /** 보상 지급 훅 — 실제 지급은 서버(/api/mission/answer)가 이미 멱등하게 처리했으므로, 여기서는
   *  클라이언트 오케스트레이션 레벨에서 "정확히 1회만 트리거됨"을 보장하는 역할(로깅 등). */
  onGrantReward: () => void;
  /** 전용 종료 발화(Live)가 2.5초 안에 음성으로 시작되지 않았거나(closing_audio_timeout),
   *  오디오 한 번 없이 turnComplete로 끝난 경우(closing_text_only) 정확히 1회 호출 — 미션 화면이
   *  종료 문구를 별도 TTS(/api/voice/tts)로 합성·재생해 "음성 없이 텍스트만" 버그를 막는다.
   *  await되므로 재생이 끝난 뒤에 세션이 닫힌다. */
  onClosingAudioTimeout: () => void | Promise<void>;
  onLog: (event: string, fields?: Record<string, unknown>) => void;
  /** 테스트 용이성을 위한 시간/타이머 주입 — 미지정 시 실제 setTimeout/Date.now 사용. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const CLOSE_DELAY_MS = 700;
const FALLBACK_TIMEOUT_MS = 8000;
// 전용 종료 발화의 음성이 이 시간 안에 시작되지 않으면 별도 TTS 폴백으로 종료 문구를 재생한다.
// (8초 fallback보다 짧다 — 아이가 침묵을 오래 겪지 않도록. 8초는 여전히 최후 안전망으로 유지.)
const CLOSING_AUDIO_TIMEOUT_MS = 2500;

export class MissionCompletionController {
  private state: MissionCompletionState = "active";
  private turnCompleteSeen = false;
  private audioDrained = false;
  private closingAudioStarted = false;
  private fallbackTimer: unknown = null;
  private closingAudioTimer: unknown = null;
  private closeTimer: unknown = null;
  private rewardGranted = false;
  private closingFinished = false;
  private readonly cb: MissionCompletionCallbacks;
  private readonly setTimerFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimerFn: (handle: unknown) => void;

  constructor(cb: MissionCompletionCallbacks) {
    this.cb = cb;
    this.setTimerFn = cb.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimerFn = cb.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  getState(): MissionCompletionState {
    return this.state;
  }

  /** 5번째 유효 답변이 확정된 시점 — 미션 화면에서 그 즉시 1회 호출할 것. 중복 호출은 무시된다
   *  (새로고침 후 동일 이벤트가 다시 들어오는 경우 등 방어). */
  start(options?: { immediateTtsFallback?: boolean }): void {
    if (this.state !== "active") return;
    this.state = "completing";
    this.cb.onStateChange(this.state);
    this.cb.onLog("mission_completion_started");

    if (options?.immediateTtsFallback) {
      void this.runTtsFallback("closing_audio_timeout");
      return;
    }

    this.fallbackTimer = this.setTimerFn(() => this.forceFinish("fallback_timeout"), FALLBACK_TIMEOUT_MS);
    this.closingAudioTimer = this.setTimerFn(() => {
      this.closingAudioTimer = null;
      if (!this.closingAudioStarted && !this.closingFinished) {
        void this.runTtsFallback("closing_audio_timeout");
      }
    }, CLOSING_AUDIO_TIMEOUT_MS);
  }

  /** 전용 종료 발화의 음성이 실제로 시작됐을 때(첫 오디오 청크 스케줄 시점) 호출 — 멱등.
   *  2.5초 TTS 폴백 타이머를 취소한다. completing 상태가 아니거나 이미 종료됐으면 무시. */
  notifyClosingAudioStarted(): void {
    if (this.state !== "completing" || this.closingFinished) return;
    if (this.closingAudioStarted) return;
    this.closingAudioStarted = true;
    this.clearClosingAudioTimer();
  }

  /** Vertex Live/AI Studio의 serverContent.turnComplete 수신 시 호출(케이의 종료 발화 턴). */
  notifyTurnComplete(): void {
    if (this.state !== "completing" || this.closingFinished) return;
    this.turnCompleteSeen = true;
    // 종료 턴이 오디오 한 번 없이 끝났다(텍스트만/빈 turnComplete) — 2.5초를 기다리지 않고
    // 즉시 TTS 폴백으로 종료 문구를 음성 재생한다(버그①: 음성 없이 텍스트만 뜨던 경로 차단).
    if (!this.closingAudioStarted) {
      this.clearClosingAudioTimer();
      void this.runTtsFallback("closing_text_only");
      return;
    }
    this.maybeFinishClosing();
  }

  /** 브라우저 오디오 재생 큐가 완전히 비었을 때 호출. */
  notifyAudioDrained(): void {
    if (this.state !== "completing" || this.closingFinished) return;
    this.audioDrained = true;
    this.maybeFinishClosing();
  }

  /** WebSocket이 정상 종료 절차(onCloseSession 호출) 이전에 스스로 끊긴 경우 — 서버 오류,
   *  네트워크 단절 등. completing 상태가 아니면 무시(이미 completed거나 애초에 대상이 아님). */
  notifySessionClosedExternally(): void {
    if (this.state !== "completing" || this.closingFinished) return;
    this.closingFinished = true;
    this.clearFallbackTimer();
    this.cb.onLog("mission_closing_finished", { reason: "external_close" });
    this.cb.onShowCompletionText();
    this.complete();
  }

  /** 컴포넌트 언마운트 시 타이머 정리용. */
  dispose(): void {
    this.clearFallbackTimer();
    this.clearClosingAudioTimer();
    if (this.closeTimer != null) {
      this.clearTimerFn(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private maybeFinishClosing(): void {
    if (this.turnCompleteSeen && this.audioDrained) {
      this.finishClosing("normal");
    }
  }

  private finishClosing(reason: string): void {
    if (this.closingFinished) return;
    this.closingFinished = true;
    this.clearFallbackTimer();
    this.cb.onLog("mission_closing_finished", { reason });

    this.closeTimer = this.setTimerFn(() => {
      this.closeTimer = null;
      this.cb.onCloseSession();
      this.complete();
    }, CLOSE_DELAY_MS);
  }

  /** 종료 발화 음성이 끝내 시작되지 않은 경우(2.5초 타임아웃 또는 오디오 없는 turnComplete)
   *  종료 문구를 별도 TTS로 재생하는 폴백 경로 — finishClosing/forceFinish와 closingFinished
   *  플래그를 공유해 상호 배타적으로 정확히 1회만 실행된다. */
  private async runTtsFallback(reason: string): Promise<void> {
    if (this.closingFinished) return;
    this.closingFinished = true;
    this.clearFallbackTimer();
    this.clearClosingAudioTimer();
    this.cb.onLog("mission_closing_finished", { reason });
    await this.cb.onClosingAudioTimeout();
    this.cb.onCloseSession();
    this.complete();
  }

  /** claude-review 지적(2026-07-28): closingAudioStarted=true인 채로 8초 안에
   *  turnComplete/audioDrained가 둘 다 오지 않는 경우, 종료 발화 오디오가 여전히 재생
   *  중일 수 있다. 예전에는 onCloseSession()을 즉시 실행해 재생 중인 오디오를 그 자리에서
   *  끊어버렸다(teardown()이 스케줄된 오디오 소스를 동기적으로 stop()) — 아이가 케이의
   *  마지막 인사말을 중간에 잘려서 듣고 곧바로 보상 모달을 보게 되는 문제. 정상 경로
   *  (finishClosing)와 동일한 CLOSE_DELAY_MS 유예를 둬 트레일링 오디오가 조금이라도 더
   *  이어지게 한 뒤에만 세션을 끊는다 — 8초 안전망 자체의 존재 이유(무한 대기 방지)는
   *  그대로 유지된다. */
  private forceFinish(reason: string): void {
    this.fallbackTimer = null;
    if (this.closingFinished) return; // 정상 경로가 이미 처리 중/완료 — fallback 무시
    this.closingFinished = true;
    this.cb.onLog("mission_closing_finished", { reason });
    this.cb.onShowCompletionText();

    this.closeTimer = this.setTimerFn(() => {
      this.closeTimer = null;
      this.cb.onCloseSession();
      this.complete();
    }, CLOSE_DELAY_MS);
  }

  private complete(): void {
    if (this.state === "completed") return;
    this.state = "completed";
    this.cb.onStateChange(this.state);
    if (!this.rewardGranted) {
      this.rewardGranted = true;
      this.cb.onGrantReward();
    }
    this.cb.onLog("mission_completed");
  }

  private clearFallbackTimer(): void {
    if (this.fallbackTimer != null) {
      this.clearTimerFn(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private clearClosingAudioTimer(): void {
    if (this.closingAudioTimer != null) {
      this.clearTimerFn(this.closingAudioTimer);
      this.closingAudioTimer = null;
    }
  }
}
