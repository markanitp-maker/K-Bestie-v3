"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Window after endTurn() (recognition.stop() requested) for Chrome/Edge to
// deliver the final SpeechRecognition result before falling back to GCP.
// 3000ms chosen from existing STT round-trip telemetry in this codebase
// (GCP recognize calls typically settle within 1-2s; Browser's own stop->final
// handoff is normally near-instant) — 3s gives real network jitter headroom
// without stalling a turn noticeably longer than the pre-A1 GCP-only path.
export const DEFAULT_BROWSER_STT_FINAL_TIMEOUT_MS = 3000;
export const STT_SILENCE_MS_TO_FINALIZE = 900;
export const STT_RMS_SILENCE_THRESHOLD = 0.012;
export const STT_MAX_UTTERANCE_MS = 10000;

const STT_PROCESSOR_BUFFER_SIZE = 2048;
const STT_SAMPLE_RATE = 16000;
const STT_CHANNEL_COUNT = 1;
const STT_CHUNK_DURATION_MS = 128;

export type SttRouterState =
  | "IDLE"
  | "LISTENING"
  | "BROWSER_PROCESSING"
  | "BROWSER_SUCCESS"
  | "GCP_FALLBACK"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type SttFailureReason =
  | "browser_and_gcp_failed"
  | "unsupported_and_gcp_failed";

export interface SttRouterMeta {
  provider: "browser" | "gcp";
  browserSupported: boolean;
  fallbackTriggered: boolean;
  browserLatencyMs?: number;
  fallbackLatencyMs?: number;
  totalLatencyMs: number;
  confidence?: number;
  // 이 턴이 실제로 startTurn() 시점에 할당받은 turnId — 호출부가 turnSeqRef류의
  // 값을 별도로 "예측"하지 않고 이 값을 그대로 쓰도록 한다(중복 turnId 재사용 방지).
  childTurnId: string;
}

export interface SttRouterOptions {
  sessionId: string;
  childTurnId: string;
  language?: string;
  timeoutMs?: number;
  onFinalTranscript: (transcript: string, meta: SttRouterMeta) => void;
  onFailure: (reason: SttFailureReason) => void;
}

export interface SttRouter {
  state: SttRouterState;
  startTurn(): void;
  endTurn(): void;
  cancel(): void;
}

export interface SttRouterMetrics {
  mode: "mission" | "free_chat";
  input_mode: "auto" | "manual";
  platform: "iOS" | "Android" | "Desktop";
  browser: string;
  browser_stt_supported: boolean;
  browser_stt_success: boolean;
  browser_stt_empty: boolean;
  browser_stt_error: boolean;
  browser_stt_timeout: boolean;
  fallback_triggered: boolean;
  gcp_fallback_success: boolean;
  gcp_fallback_error: boolean;
  browser_latency_ms?: number;
  fallback_latency_ms?: number;
  total_stt_latency_ms: number;
  stt_provider_final?: "browser" | "gcp";
}

interface SpeechRecognitionAlternativeLike {
  transcript?: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  error?: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

interface GcpSttResult {
  text: string;
  confidence?: number;
  failureReason?: "network" | "http_error" | "aborted";
}

interface TurnContext {
  sessionId: string;
  childTurnId: string;
  conversationMode?: string;
  mode: "mission" | "free_chat";
  inputMode: "auto" | "manual";
  platform: "iOS" | "Android" | "Desktop";
  browser: string;
}

export interface SttRouterControllerOptions extends SttRouterOptions {
  browserPrimaryEnabled: boolean;
  gcpFallbackEnabled: boolean;
  getTurnContext?: () => TurnContext;
  isBrowserSupported?: () => boolean;
  createRecognition?: () => SpeechRecognitionLike | null;
  callGcp?: (audioBase64: string, context: TurnContext, signal: AbortSignal) => Promise<GcpSttResult>;
  emitMetrics?: (metrics: SttRouterMetrics) => void;
  onStateChange?: (state: SttRouterState) => void;
  onInterimTranscript?: (transcript: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const encodePCM16Base64 = (chunks: Uint8Array[]): string => {
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  let binary = "";
  for (let index = 0; index < merged.length; index += 1) {
    binary += String.fromCharCode(merged[index]);
  }
  return btoa(binary);
};

const getRecognitionConstructor = (): SpeechRecognitionConstructorLike | null => {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
};

const defaultCreateRecognition = (): SpeechRecognitionLike | null => {
  const Recognition = getRecognitionConstructor();
  return Recognition ? new Recognition() : null;
};

const detectPlatform = (): "iOS" | "Android" | "Desktop" => {
  if (typeof navigator === "undefined") return "Desktop";
  const userAgent = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  return "Desktop";
};

const detectBrowser = (): string => {
  if (typeof navigator === "undefined") return "unknown";
  const userAgent = navigator.userAgent;
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/CriOS|Chrome/i.test(userAgent)) return "Chrome";
  if (/FxiOS|Firefox/i.test(userAgent)) return "Firefox";
  if (/Safari/i.test(userAgent)) return "Safari";
  return "Other";
};

const detectMode = (): "mission" | "free_chat" => {
  if (typeof window === "undefined") return "mission";
  return /^\/(child\/)?chat(?:\/|$)/.test(window.location.pathname) ? "free_chat" : "mission";
};

const defaultTurnContext = (options: SttRouterOptions): TurnContext => ({
  sessionId: options.sessionId,
  childTurnId: options.childTurnId,
  mode: detectMode(),
  inputMode: "auto",
  platform: detectPlatform(),
  browser: detectBrowser(),
});

const defaultCallGcp = async (
  audioBase64: string,
  context: TurnContext,
  signal: AbortSignal,
): Promise<GcpSttResult> => {
  try {
    const response = await fetch("/api/mission/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        sessionId: context.sessionId,
        childTurnId: context.childTurnId,
        conversationMode: context.conversationMode,
      }),
      signal,
    });
    if (signal.aborted) return { text: "", failureReason: "aborted" };
    if (!response.ok) {
      console.error("[STT Router] GCP fallback HTTP error:", response.status);
      return { text: "", failureReason: "http_error" };
    }
    const data = await response.json() as { transcript?: unknown; confidence?: unknown };
    return {
      text: typeof data.transcript === "string" ? data.transcript.trim() : "",
      confidence: typeof data.confidence === "number" ? data.confidence : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { text: "", failureReason: "aborted" };
    }
    console.error("[STT Router] GCP fallback network error");
    return { text: "", failureReason: "network" };
  }
};

export class SttRouterController implements SttRouter {
  public state: SttRouterState = "IDLE";

  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly callGcp: NonNullable<SttRouterControllerOptions["callGcp"]>;
  private readonly emitMetrics: NonNullable<SttRouterControllerOptions["emitMetrics"]>;
  private readonly isBrowserSupported: () => boolean;
  private readonly createRecognition: () => SpeechRecognitionLike | null;
  private readonly options: SttRouterControllerOptions;

  private routerTurnId = 0;
  private turnStartedAt = 0;
  private browserEndedAt = 0;
  private browserSupported = false;
  private browserFailed = false;
  private browserEmpty = false;
  private browserTimedOut = false;
  private fallbackTriggered = false;
  private terminalDelivered = false;
  // Keyed by SpeechRecognitionEvent.resultIndex — but that index is only
  // stable *within one recognition session*, not across the whole turn. Some
  // engines (Android Chrome) end recognition per-segment even with
  // continuous=true, forcing a mid-turn restart (see startRecognition()); the
  // restarted session's resultIndex starts back at 0. committedSegments holds
  // everything confirmed by sessions that have already ended; finalSegments
  // holds only the *current* session's segments (redelivery-idempotent within
  // that session — iOS Safari-class engines resend the cumulative array from
  // index 0 on every event, which is what index-keyed writes protect against).
  private committedSegments: string[] = [];
  private finalSegments: string[] = [];
  private pendingBrowserTranscript = "";
  private pendingBrowserConfidence: number | undefined;
  private pcmChunks: Uint8Array[] = [];
  private recognition: SpeechRecognitionLike | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackAbortController: AbortController | null = null;
  private turnContext: TurnContext;

  public constructor(options: SttRouterControllerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.callGcp = options.callGcp ?? defaultCallGcp;
    this.emitMetrics = options.emitMetrics ?? ((metrics) => console.info("[STT Router Metrics]", metrics));
    this.isBrowserSupported = options.isBrowserSupported ?? (() => getRecognitionConstructor() !== null);
    this.createRecognition = options.createRecognition ?? defaultCreateRecognition;
    this.turnContext = defaultTurnContext(options);
  }

  public get bufferedByteLength(): number {
    return this.pcmChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  // 현재(진행 중인) 턴이 startTurn()에서 할당받은 turnId. 다음 턴은 이 턴이
  // LISTENING/BROWSER_PROCESSING/GCP_FALLBACK을 완전히 벗어나야만 startTurn()으로
  // 새로 진입할 수 있으므로(§startTurn 가드), 이 getter는 호출 시점에 항상 "현재
  // 진행 중인 바로 그 턴"의 turnId를 정확히 반환한다.
  public get currentChildTurnId(): string {
    return this.turnContext.childTurnId;
  }

  public startTurn(): void {
    if (this.state === "LISTENING" || this.state === "BROWSER_PROCESSING" || this.state === "GCP_FALLBACK") {
      return;
    }

    this.releaseTurnResources(true);
    this.routerTurnId += 1;
    this.turnStartedAt = this.now();
    this.browserEndedAt = 0;
    this.browserFailed = false;
    this.browserEmpty = false;
    this.browserTimedOut = false;
    this.fallbackTriggered = false;
    this.terminalDelivered = false;
    this.committedSegments = [];
    this.finalSegments = [];
    this.pendingBrowserTranscript = "";
    this.pendingBrowserConfidence = undefined;
    this.turnContext = this.options.getTurnContext?.() ?? defaultTurnContext(this.options);
    this.browserSupported = this.isBrowserSupported();
    this.transition("LISTENING");

    if (!this.options.browserPrimaryEnabled) return;
    if (!this.browserSupported) {
      this.browserFailed = true;
      return;
    }

    this.startRecognition(this.routerTurnId);
  }

  // Shared by startTurn() and handleBrowserEnd()'s mid-turn restart — some
  // engines (Android Chrome) end recognition per-segment even with
  // continuous=true, so a fresh recognizer must be able to pick up where the
  // last one left off without losing what the previous session already
  // confirmed. Flushing finalSegments into committedSegments and releasing
  // the old recognizer's handlers is a no-op on the very first call from
  // startTurn() (both are already empty/null at that point), so this method
  // needs no separate "is this a restart" branch.
  private startRecognition(turnId: number): void {
    if (this.finalSegments.length > 0) {
      this.committedSegments.push(...this.finalSegments.filter(Boolean));
      this.finalSegments = [];
    }
    this.releaseRecognition(false);
    try {
      const recognition = this.createRecognition();
      if (!recognition) {
        this.browserSupported = false;
        this.browserFailed = true;
        return;
      }
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.options.language ?? "ko-KR";
      recognition.onresult = (event) => this.handleBrowserResult(turnId, event);
      recognition.onerror = () => this.handleBrowserError(turnId);
      recognition.onend = () => this.handleBrowserEnd(turnId);
      this.recognition = recognition;
      recognition.start();
    } catch {
      this.browserFailed = true;
      this.releaseRecognition(true);
    }
  }

  public appendPcm(chunk: Uint8Array): void {
    if (this.state !== "LISTENING") return;
    this.pcmChunks.push(chunk);
  }

  public endTurn(): void {
    if (this.state !== "LISTENING") return;
    this.browserEndedAt = this.now();

    if (!this.options.browserPrimaryEnabled) {
      void this.startGcpFallback(this.routerTurnId);
      return;
    }

    if (!this.browserSupported || this.browserFailed) {
      void this.startGcpFallback(this.routerTurnId);
      return;
    }

    this.transition("BROWSER_PROCESSING");
    if (this.pendingBrowserTranscript) {
      this.completeWithBrowser(this.routerTurnId);
      return;
    }

    const turnId = this.routerTurnId;
    this.finalTimer = this.setTimer(() => {
      if (turnId !== this.routerTurnId || this.state !== "BROWSER_PROCESSING") return;
      this.browserTimedOut = true;
      void this.startGcpFallback(turnId);
    }, this.options.timeoutMs ?? DEFAULT_BROWSER_STT_FINAL_TIMEOUT_MS);

    try {
      this.recognition?.stop();
    } catch {
      this.browserFailed = true;
      void this.startGcpFallback(turnId);
    }
  }

  public cancel(): void {
    this.routerTurnId += 1;
    this.terminalDelivered = true;
    this.transition("CANCELLED");
    this.releaseTurnResources(true);
    this.options.onInterimTranscript?.("");
  }

  public dispose(): void {
    this.cancel();
  }

  private handleBrowserResult(turnId: number, event: SpeechRecognitionEventLike): void {
    if (turnId !== this.routerTurnId || this.terminalDelivered || this.state === "GCP_FALLBACK") return;

    let interimTranscript = "";
    let sawNewFinalText = false;
    let sawBlankFinal = false;
    let finalConfidence: number | undefined;
    // event.resultIndex is an absolute position within the utterance per
    // spec, so writing into finalSegments[index] is naturally idempotent —
    // an engine that redelivers the same index (rather than only new
    // segments) overwrites in place instead of duplicating via concatenation.
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result?.[0];
      const text = typeof alternative?.transcript === "string" ? alternative.transcript : "";
      if (result?.isFinal) {
        const trimmed = text.trim();
        if (trimmed) {
          if (this.finalSegments[index] !== trimmed) sawNewFinalText = true;
          this.finalSegments[index] = trimmed;
          if (typeof alternative?.confidence === "number") finalConfidence = alternative.confidence;
        } else if (text.length > 0) {
          sawBlankFinal = true;
        }
      } else {
        interimTranscript += text;
      }
    }

    if (sawNewFinalText) {
      this.pendingBrowserTranscript = [...this.committedSegments, ...this.finalSegments.filter(Boolean)]
        .join(" ");
      this.pendingBrowserConfidence = finalConfidence ?? this.pendingBrowserConfidence;
      this.options.onInterimTranscript?.(this.pendingBrowserTranscript);
      if (this.state === "BROWSER_PROCESSING") this.completeWithBrowser(turnId);
      return;
    }

    if (sawBlankFinal) this.browserEmpty = true;
    const trimmedInterim = interimTranscript.trim();
    if (trimmedInterim) this.options.onInterimTranscript?.(trimmedInterim);
  }

  private handleBrowserError(turnId: number): void {
    if (turnId !== this.routerTurnId || this.terminalDelivered || this.state === "GCP_FALLBACK") return;
    this.browserFailed = true;
    if (this.state === "BROWSER_PROCESSING") void this.startGcpFallback(turnId);
  }

  private handleBrowserEnd(turnId: number): void {
    if (turnId !== this.routerTurnId || this.terminalDelivered || this.state === "GCP_FALLBACK") return;

    if (this.state === "LISTENING" && !this.browserFailed) {
      // Some engines (Android Chrome) end recognition per-segment even with
      // continuous=true, well before the caller's endTurn() is invoked.
      // Restarting keeps capturing the rest of the utterance instead of
      // leaving a dead recognizer object until endTurn() forces a premature
      // "Browser success" off of whatever was captured so far.
      //
      // Gated on !browserFailed: once that flag is set, endTurn() always goes
      // to GCP fallback regardless of any further restart (see endTurn()'s
      // `!this.browserSupported || this.browserFailed` check), so a restart
      // buys nothing. Conditions that fail immediately on start() (mic
      // permission revoked, audio-capture) would otherwise error -> end ->
      // restart -> error -> end ... with no turn-count cap, spinning the
      // event loop for as long as LISTENING lasts (the whole button-hold in
      // manual mode).
      this.startRecognition(turnId);
      return;
    }

    if (this.pendingBrowserTranscript) {
      if (this.state === "BROWSER_PROCESSING") this.completeWithBrowser(turnId);
      return;
    }
    this.browserFailed = true;
    this.browserEmpty = true;
    if (this.state === "BROWSER_PROCESSING") void this.startGcpFallback(turnId);
  }

  private completeWithBrowser(turnId: number): void {
    if (turnId !== this.routerTurnId || this.terminalDelivered || !this.pendingBrowserTranscript) return;
    const now = this.now();
    const browserLatencyMs = now - this.turnStartedAt;
    const transcript = this.pendingBrowserTranscript;
    const confidence = this.pendingBrowserConfidence;
    this.transition("BROWSER_SUCCESS");
    this.terminalDelivered = true;
    this.releaseTurnResources(true);
    this.transition("COMPLETED");
    this.options.onInterimTranscript?.("");
    this.options.onFinalTranscript(transcript, {
      provider: "browser",
      browserSupported: this.browserSupported,
      fallbackTriggered: false,
      browserLatencyMs,
      totalLatencyMs: browserLatencyMs,
      confidence,
      childTurnId: this.turnContext.childTurnId,
    });
    this.emitTurnMetrics({
      browserSuccess: true,
      gcpSuccess: false,
      gcpError: false,
      provider: "browser",
      browserLatencyMs,
    });
  }

  private async startGcpFallback(turnId: number): Promise<void> {
    if (turnId !== this.routerTurnId || this.terminalDelivered || this.state === "GCP_FALLBACK") return;
    this.clearFinalTimer();
    this.releaseRecognition(true);

    const shouldCallGcp = !this.options.browserPrimaryEnabled || this.options.gcpFallbackEnabled;
    this.fallbackTriggered = this.options.browserPrimaryEnabled;
    if (!shouldCallGcp) {
      this.failTurn(turnId, false);
      return;
    }

    this.transition("GCP_FALLBACK");
    const fallbackStartedAt = this.now();
    const audioBase64 = encodePCM16Base64(this.pcmChunks);
    const abortController = new AbortController();
    this.fallbackAbortController = abortController;
    let result: GcpSttResult;
    try {
      result = await this.callGcp(audioBase64, this.turnContext, abortController.signal);
    } catch {
      console.error("[STT Router] GCP fallback client error");
      result = { text: "", failureReason: "network" };
    }
    if (turnId !== this.routerTurnId || this.terminalDelivered || abortController.signal.aborted) return;

    const text = result.text.trim();
    const fallbackLatencyMs = this.now() - fallbackStartedAt;
    const browserLatencyMs = this.options.browserPrimaryEnabled
      ? (this.browserEndedAt || fallbackStartedAt) - this.turnStartedAt
      : undefined;
    if (!text) {
      this.failTurn(turnId, true, fallbackLatencyMs, browserLatencyMs);
      return;
    }

    const totalLatencyMs = this.now() - this.turnStartedAt;
    this.terminalDelivered = true;
    this.releaseTurnResources(false);
    this.transition("COMPLETED");
    this.options.onInterimTranscript?.("");
    this.options.onFinalTranscript(text, {
      provider: "gcp",
      browserSupported: this.browserSupported,
      fallbackTriggered: this.fallbackTriggered,
      browserLatencyMs,
      fallbackLatencyMs,
      totalLatencyMs,
      confidence: result.confidence,
      childTurnId: this.turnContext.childTurnId,
    });
    this.emitTurnMetrics({
      browserSuccess: false,
      gcpSuccess: true,
      gcpError: false,
      provider: "gcp",
      browserLatencyMs,
      fallbackLatencyMs,
    });
  }

  private failTurn(
    turnId: number,
    gcpError: boolean,
    fallbackLatencyMs?: number,
    browserLatencyMs = this.options.browserPrimaryEnabled ? this.now() - this.turnStartedAt : undefined,
  ): void {
    if (turnId !== this.routerTurnId || this.terminalDelivered) return;
    this.terminalDelivered = true;
    // A turn where Browser primary was never attempted (flag off, i.e. the
    // Production GCP-only path) is not a "browser failure" even if the
    // browser happens to support SpeechRecognition — it was simply not used.
    const failureReason: SttFailureReason = this.options.browserPrimaryEnabled && this.browserSupported
      ? "browser_and_gcp_failed"
      : "unsupported_and_gcp_failed";
    this.releaseTurnResources(true);
    this.transition("FAILED");
    this.options.onInterimTranscript?.("");
    this.options.onFailure(failureReason);
    this.emitTurnMetrics({
      browserSuccess: false,
      gcpSuccess: false,
      gcpError,
      browserLatencyMs,
      fallbackLatencyMs,
    });
  }

  private emitTurnMetrics(result: {
    browserSuccess: boolean;
    gcpSuccess: boolean;
    gcpError: boolean;
    provider?: "browser" | "gcp";
    browserLatencyMs?: number;
    fallbackLatencyMs?: number;
  }): void {
    this.emitMetrics({
      mode: this.turnContext.mode,
      input_mode: this.turnContext.inputMode,
      platform: this.turnContext.platform,
      browser: this.turnContext.browser,
      browser_stt_supported: this.browserSupported,
      browser_stt_success: result.browserSuccess,
      browser_stt_empty: this.browserEmpty,
      browser_stt_error: this.browserFailed,
      browser_stt_timeout: this.browserTimedOut,
      fallback_triggered: this.fallbackTriggered,
      gcp_fallback_success: result.gcpSuccess,
      gcp_fallback_error: result.gcpError,
      browser_latency_ms: result.browserLatencyMs,
      fallback_latency_ms: result.fallbackLatencyMs,
      total_stt_latency_ms: this.now() - this.turnStartedAt,
      stt_provider_final: result.provider,
    });
  }

  private transition(state: SttRouterState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private clearFinalTimer(): void {
    if (this.finalTimer === null) return;
    this.clearTimer(this.finalTimer);
    this.finalTimer = null;
  }

  private releaseRecognition(abort: boolean): void {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    if (abort) {
      try {
        recognition.abort();
      } catch {
        // Recognition may already be stopped.
      }
    }
  }

  private releaseTurnResources(abortFallback: boolean): void {
    this.clearFinalTimer();
    this.releaseRecognition(true);
    if (abortFallback) this.fallbackAbortController?.abort();
    this.fallbackAbortController = null;
    this.pcmChunks = [];
  }
}

interface UseSttRouterInternalOptions extends SttRouterOptions {
  getSessionId?: () => string;
  getChildTurnId?: () => string;
  getInputMode?: () => "auto" | "manual";
  conversationMode?: string;
  onSpeechBegin?: (childTurnId: string) => void;
  onSpeechEnd?: (childTurnId: string) => void;
  onEmptyAudio?: () => void;
}

interface UseSttRouterResult extends SttRouter {
  // Read-only check for "is there a real captured turn to finalize" —
  // callers that need to react to that (e.g. gating turn-end telemetry) must
  // check this BEFORE calling endTurn(), not after: a Browser-success
  // completion is synchronous and can advance caller-side turn counters as
  // part of endTurn() itself, so checking post-hoc would already see the
  // next turn's state.
  isTurnActive(): boolean;
  interimTranscript: string;
  startCapture(): Promise<void>;
  stopCapture(): void;
  setMicEnabled(enabled: boolean): void;
  setInputMode(mode: "auto" | "manual"): void;
  setCaptureBlocked(blocked: boolean): void;
  // 현재 진행 중인 턴의 turnId를 동기적으로 조회한다 — manualFinalize처럼
  // onSpeechEnd 콜백 밖에서 "지금 이 턴"의 id가 필요한 호출부용.
  getCurrentChildTurnId(): string;
}

export const useSttRouter = (options: UseSttRouterInternalOptions): UseSttRouterResult => {
  const [state, setState] = useState<SttRouterState>("IDLE");
  const [interimTranscript, setInterimTranscript] = useState("");
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const inputModeRef = useRef<"auto" | "manual">("auto");
  const micEnabledRef = useRef(true);
  const captureBlockedRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const silenceMsRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const controllerRef = useRef<SttRouterController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new SttRouterController({
      sessionId: options.sessionId,
      childTurnId: options.childTurnId,
      language: options.language,
      timeoutMs: options.timeoutMs,
      browserPrimaryEnabled: process.env.BROWSER_STT_PRIMARY_ENABLED === "true",
      gcpFallbackEnabled: process.env.GCP_STT_FALLBACK_ENABLED === "true",
      getTurnContext: () => ({
        sessionId: optionsRef.current.getSessionId?.() ?? optionsRef.current.sessionId,
        childTurnId: optionsRef.current.getChildTurnId?.() ?? optionsRef.current.childTurnId,
        conversationMode: optionsRef.current.conversationMode,
        mode: detectMode(),
        inputMode: optionsRef.current.getInputMode?.() ?? inputModeRef.current,
        platform: detectPlatform(),
        browser: detectBrowser(),
      }),
      onFinalTranscript: (transcript, meta) => optionsRef.current.onFinalTranscript(transcript, meta),
      onFailure: (reason) => optionsRef.current.onFailure(reason),
      onStateChange: setState,
      onInterimTranscript: setInterimTranscript,
    });
  }

  const resetVad = useCallback(() => {
    speechDetectedRef.current = false;
    silenceMsRef.current = 0;
    speechStartedAtRef.current = 0;
  }, []);

  const startTurn = useCallback(() => {
    controllerRef.current?.startTurn();
    resetVad();
  }, [resetVad]);

  const isTurnActive = useCallback((): boolean => {
    return controllerRef.current?.state === "LISTENING";
  }, []);

  const endTurn = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || controller.state !== "LISTENING") {
      optionsRef.current.onEmptyAudio?.();
      return;
    }
    controller.endTurn();
    resetVad();
  }, [resetVad]);

  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setInterimTranscript("");
    resetVad();
  }, [resetVad]);

  const getCurrentChildTurnId = useCallback((): string => {
    return controllerRef.current?.currentChildTurnId ?? "";
  }, []);

  const stopCapture = useCallback(() => {
    cancel();
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    inputContextRef.current?.close().catch(() => {});
    inputContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [cancel]);

  const startCapture = useCallback(async () => {
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("마이크를 사용하려면 HTTPS로 접속하세요.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: STT_SAMPLE_RATE,
        channelCount: STT_CHANNEL_COUNT,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;
    try {
      const inputContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
      inputContextRef.current = inputContext;
      const source = inputContext.createMediaStreamSource(stream);
      const processor = inputContext.createScriptProcessor(
        STT_PROCESSOR_BUFFER_SIZE,
        STT_CHANNEL_COUNT,
        STT_CHANNEL_COUNT,
      );
      sourceRef.current = source;
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const controller = controllerRef.current;
        if (!controller || !micEnabledRef.current || captureBlockedRef.current) return;
        const float32 = event.inputBuffer.getChannelData(0);
        let sumSquares = 0;
        for (let index = 0; index < float32.length; index += 1) {
          sumSquares += float32[index] * float32[index];
        }
        const rms = Math.sqrt(sumSquares / float32.length);
        const hasVoice = rms >= STT_RMS_SILENCE_THRESHOLD;

        // Both modes gate the Browser recognizer's start on actual RMS voice,
        // not on mic-enabled alone. Starting it the instant the mic opens (the
        // old manual-mode behavior) meant a child who paused a few seconds
        // before answering would trigger Chrome's `no-speech` error and end
        // the recognizer before they ever spoke, permanently forcing GCP
        // fallback for the rest of that turn.
        if (
          hasVoice
          && controller.state !== "LISTENING"
        ) {
          controller.startTurn();
        }
        if (controller.state !== "LISTENING") return;

        const pcm = new Int16Array(float32.length);
        for (let index = 0; index < float32.length; index += 1) {
          pcm[index] = Math.max(-32768, Math.min(32767, float32[index] * 32768));
        }
        controller.appendPcm(new Uint8Array(pcm.buffer.slice(0)));

        if (hasVoice) {
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            speechStartedAtRef.current = Date.now();
            optionsRef.current.onSpeechBegin?.(controller.currentChildTurnId);
          }
          silenceMsRef.current = 0;
          if (
            inputModeRef.current === "auto"
            && Date.now() - speechStartedAtRef.current >= STT_MAX_UTTERANCE_MS
          ) {
            optionsRef.current.onSpeechEnd?.(controller.currentChildTurnId);
            controller.endTurn();
            resetVad();
          }
          return;
        }

        silenceMsRef.current += STT_CHUNK_DURATION_MS;
        if (
          inputModeRef.current === "auto"
          && speechDetectedRef.current
          && silenceMsRef.current >= STT_SILENCE_MS_TO_FINALIZE
        ) {
          optionsRef.current.onSpeechEnd?.(controller.currentChildTurnId);
          controller.endTurn();
          resetVad();
        }
      };
      source.connect(processor);
      processor.connect(inputContext.destination);
    } catch (error) {
      processorRef.current?.disconnect();
      processorRef.current = null;
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      inputContextRef.current?.close().catch(() => {});
      inputContextRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      throw error;
    }
  }, [resetVad]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    micEnabledRef.current = enabled;
    if (!enabled && controllerRef.current?.state === "LISTENING") cancel();
  }, [cancel]);

  const setInputMode = useCallback((mode: "auto" | "manual") => {
    inputModeRef.current = mode;
  }, []);

  const setCaptureBlocked = useCallback((blocked: boolean) => {
    captureBlockedRef.current = blocked;
  }, []);

  useEffect(() => () => {
    controllerRef.current?.dispose();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    inputContextRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return {
    state,
    isTurnActive,
    interimTranscript,
    startTurn,
    endTurn,
    cancel,
    startCapture,
    stopCapture,
    setMicEnabled,
    setInputMode,
    setCaptureBlocked,
    getCurrentChildTurnId,
  };
};
