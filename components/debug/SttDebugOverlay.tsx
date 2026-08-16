"use client";

import React, { useEffect, useState } from "react";
import {
  getLatestSttCaptureTelemetry,
  getLatestSttUtteranceTelemetry,
  isSttDebugEnabled,
  subscribeSttTelemetry,
  type SttCaptureTelemetry,
  type SttUtteranceTelemetry,
} from "@/hooks/useSttRouter";

/**
 * Dev 전용 STT 런타임 계측 확인 오버레이.
 * NEXT_PUBLIC_STT_DEBUG === "true" 일 때만 렌더되며, 일반 사용자에게는 전혀 렌더되지 않는다.
 */
export const SttDebugOverlay: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const [capture, setCapture] = useState<SttCaptureTelemetry | null>(null);
  const [utterance, setUtterance] = useState<SttUtteranceTelemetry | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isSttDebugEnabled()) return;
    setCapture(getLatestSttCaptureTelemetry());
    setUtterance(getLatestSttUtteranceTelemetry());
    const unsubscribe = subscribeSttTelemetry(() => {
      setCapture(getLatestSttCaptureTelemetry());
      setUtterance(getLatestSttUtteranceTelemetry());
    });
    return unsubscribe;
  }, []);

  if (!mounted || !isSttDebugEnabled()) {
    return null;
  }

  const audioContextRate = utterance?.audioContextSampleRate ?? capture?.audioContextSampleRate ?? 0;
  const trackRate = utterance?.trackSampleRate ?? capture?.trackSampleRate;
  const effectivePcmRate = utterance?.effectivePcmSampleRate ?? 0;
  const declaredGcpRate = utterance?.declaredGcpSampleRate ?? capture?.configuredSampleRate ?? 16000;
  const actualSpeechDuration = utterance?.actualSpeechDurationMs ?? 0;
  const pcmBytes = utterance?.pcmByteLength ?? 0;
  const onsetDiscardedMs = utterance?.onsetDiscardedMs ?? 0;
  const sttLatency = utterance?.sttLatencyMs ?? 0;
  const chunkActual = utterance?.chunkDurationMsActual ?? capture?.chunkDurationMsActual ?? 0;
  const chunkAssumed = utterance?.chunkDurationMsAssumed ?? capture?.chunkDurationMsAssumed ?? 128;
  const verdict = utterance?.verdict ?? capture?.verdict ?? "UNKNOWN";
  const provider = utterance?.provider ?? "-";
  const utteranceId = utterance?.utterance_id ?? "-";

  return (
    <aside
      aria-label="STT Dev Runtime Telemetry"
      data-testid="stt-debug-overlay"
      className="fixed bottom-3 right-3 z-[9999] max-w-[340px] w-[92vw] rounded-xl border border-amber-400/80 bg-slate-950/95 p-3 font-mono text-[11px] leading-snug text-slate-100 shadow-2xl backdrop-blur select-text pointer-events-auto"
      style={{ userSelect: "text" }}
    >
      <div className="flex items-center justify-between border-b border-slate-700 pb-1.5 mb-2">
        <div className="flex items-center gap-1.5 font-bold">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-amber-300">STT 계측 (Dev)</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              verdict === "MATCH_16K"
                ? "bg-emerald-900/90 text-emerald-200 border border-emerald-500"
                : verdict === "MISMATCH_44K" || verdict === "MISMATCH_48K"
                ? "bg-rose-900/90 text-rose-200 border border-rose-500"
                : "bg-slate-800 text-slate-300 border border-slate-600"
            }`}
          >
            {verdict}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsMinimized(!isMinimized)}
          className="text-[10px] text-slate-400 hover:text-white px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition"
        >
          {isMinimized ? "펼치기" : "접기"}
        </button>
      </div>

      {!isMinimized && (
        <div className="space-y-1.5 select-text">
          <div className="grid grid-cols-2 gap-x-2 border-b border-slate-800 pb-1.5">
            <div>
              <span className="text-slate-400">AudioContext:</span>{" "}
              <strong className="text-amber-300">{audioContextRate ? `${audioContextRate}Hz` : "-"}</strong>
            </div>
            <div>
              <span className="text-slate-400">Track Rate:</span>{" "}
              <span className="text-slate-200">{trackRate ? `${trackRate}Hz` : "-"}</span>
            </div>
            <div>
              <span className="text-slate-400">Effective PCM:</span>{" "}
              <strong className="text-cyan-300">{effectivePcmRate ? `${effectivePcmRate}Hz` : "-"}</strong>
            </div>
            <div>
              <span className="text-slate-400">Declared GCP:</span>{" "}
              <span className="text-slate-200">{declaredGcpRate}Hz</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-2 border-b border-slate-800 pb-1.5">
            <div>
              <span className="text-slate-400">Speech Duration:</span>{" "}
              <span className="text-slate-200">{actualSpeechDuration}ms</span>
            </div>
            <div>
              <span className="text-slate-400">PCM Bytes:</span>{" "}
              <span className="text-slate-200">{pcmBytes} B</span>
            </div>
            <div>
              <span className="text-slate-400">Onset Discarded:</span>{" "}
              <strong className={onsetDiscardedMs > 0 ? "text-rose-400" : "text-emerald-300"}>
                {onsetDiscardedMs ? `${onsetDiscardedMs.toFixed(1)}ms` : "0ms"}
              </strong>
            </div>
            <div>
              <span className="text-slate-400">STT Latency:</span>{" "}
              <span className="text-slate-200">{sttLatency}ms</span>
            </div>
          </div>

          <div className="border-b border-slate-800 pb-1.5">
            <span className="text-slate-400">Chunk Duration:</span>{" "}
            <span className="text-slate-200">
              actual <strong className="text-amber-300">{chunkActual ? `${chunkActual.toFixed(2)}ms` : "-"}</strong> vs assumed <span className="text-slate-400">{chunkAssumed}ms</span>
            </span>
          </div>

          <div className="flex justify-between text-[10px] text-slate-400 pt-0.5">
            <span>Turn: {utteranceId}</span>
            <span>Provider: {provider}</span>
          </div>
        </div>
      )}
    </aside>
  );
};
