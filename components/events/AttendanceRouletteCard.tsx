"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ATTENDANCE_ROULETTE_LABELS,
  ATTENDANCE_ROULETTE_RESULTS,
  type AttendanceRouletteResultCode,
  type AttendanceRouletteStatus,
} from "@/lib/events/attendanceRoulette";

type SpinResponse = {
  ok: true;
  spinId: string;
  attendanceDate: string;
  source: "BASE" | "RETRY";
  resultCode: AttendanceRouletteResultCode;
  keyReward: number;
  retryCreditsRemaining: number;
  canSpin: boolean;
  settledAt: string;
};

function createIdempotencyKey(childId: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `attendance-roulette:${childId}:${random}`;
}

export default function AttendanceRouletteCard({
  childId,
  onBalanceChange,
}: {
  childId: string;
  onBalanceChange?: (balance: number) => void;
}) {
  const [status, setStatus] = useState<AttendanceRouletteStatus | null>(null);
  const [result, setResult] = useState<SpinResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const pendingKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/events/attendance-roulette/status?childId=${encodeURIComponent(childId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("status_unavailable");
    const next = await response.json() as AttendanceRouletteStatus;
    setStatus(next);
    onBalanceChange?.(next.balance);
    return next;
  }, [childId, onBalanceChange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh()
      .catch(() => active && setError("룰렛 정보를 불러오지 못했어요."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    if (result || !status?.lastSpin) return;
    const targetIndex = ATTENDANCE_ROULETTE_RESULTS.indexOf(status.lastSpin.resultCode);
    setRotation(-targetIndex * (360 / ATTENDANCE_ROULETTE_RESULTS.length));
  }, [result, status?.lastSpin]);

  const spin = async () => {
    if (spinning || !status?.canSpin) return;
    setSpinning(true);
    setError(null);
    if (!pendingKey.current) pendingKey.current = createIdempotencyKey(childId);

    try {
      const response = await fetch("/api/events/attendance-roulette/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId, idempotencyKey: pendingKey.current }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        if (response.status === 409) pendingKey.current = null;
        await refresh();
        throw new Error(payload?.error ?? "spin_failed");
      }

      const settled = payload as SpinResponse;
      const targetIndex = ATTENDANCE_ROULETTE_RESULTS.indexOf(settled.resultCode);
      setRotation((current) => {
        const nextFullTurns = Math.floor(current / 360) + 4;
        return nextFullTurns * 360 - targetIndex * (360 / ATTENDANCE_ROULETTE_RESULTS.length);
      });
      setResult(settled);
      pendingKey.current = null;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await refresh();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "spin_failed";
      setError(reason === "no_available_spin" ? "오늘의 룰렛을 모두 사용했어요." : "결과 확인이 늦어지고 있어요. 다시 눌러 확인해 주세요.");
    } finally {
      setSpinning(false);
    }
  };

  const lastResult = result?.resultCode ?? status?.lastSpin?.resultCode ?? null;
  const completed = status && !status.canSpin;

  return (
    <section
      aria-label="오늘 출석 황금열쇠 룰렛"
      className="rounded-[22px] bg-white/90 border border-amber-200 shadow-sm px-4 py-4 mb-3 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-extrabold text-[17px] text-[var(--color-k-navy)]">🎁 오늘 황금열쇠 룰렛</p>
          <p className="text-[13px] mt-1 text-[var(--color-k-navy)]/75">
            {loading ? "오늘의 기회를 확인하고 있어요." : status?.canSpin
              ? status.nextSource === "RETRY" ? "한번 더! 추가 기회가 있어요." : "퀴즈 도전에 필요한 열쇠를 받아보세요!"
              : "오늘 출석 완료 · 내일 다시 도전해요!"}
          </p>
        </div>
        <div className="relative w-[120px] h-[120px] shrink-0" aria-label="꽝, 한번 더, 황금열쇠 1개, 3개, 5개, 7개, 9개 룰렛">
          <div className="absolute left-1/2 -top-1 -translate-x-1/2 z-10 text-amber-600">▼</div>
          <div
            aria-hidden="true"
            className="w-full h-full rounded-full border-4 border-amber-300 bg-[conic-gradient(#FFF0B5_0deg_51deg,#FFD6A5_51deg_103deg,#CDEBFF_103deg_154deg,#FFE0E8_154deg_206deg,#D8F3DC_206deg_257deg,#E8D7FF_257deg_309deg,#FFF5CC_309deg_360deg)] flex items-center justify-center transition-transform duration-[1200ms] ease-out shadow-inner"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            {ATTENDANCE_ROULETTE_RESULTS.map((code, index) => {
              const angle = index * (360 / ATTENDANCE_ROULETTE_RESULTS.length);
              const shortLabel = code === "LOSE" ? "꽝" : code === "RETRY" ? "한번더" : `+${code.slice(4)}`;
              return (
                <span
                  key={code}
                  className="absolute left-1/2 top-1/2 text-[9px] font-extrabold text-[var(--color-k-navy)] whitespace-nowrap"
                  style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-45px) rotate(${-angle}deg)` }}
                >
                  {shortLabel}
                </span>
              );
            })}
            <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-lg shadow z-10">🔑</span>
          </div>
        </div>
      </div>

      {lastResult && (
        <div className="mt-3 py-2 px-3 rounded-xl bg-amber-50 text-center font-bold text-[15px] text-amber-800" role="status">
          {lastResult === "RETRY" ? "🎉 한번 더!" : ATTENDANCE_ROULETTE_LABELS[lastResult]}
        </div>
      )}

      {error && <p className="mt-2 text-center text-xs text-red-600" role="alert">{error}</p>}

      <button
        type="button"
        onClick={spin}
        disabled={loading || spinning || !status?.canSpin}
        className="mt-3 w-full min-h-[44px] rounded-2xl bg-amber-500 text-white font-extrabold text-[15px] disabled:bg-slate-300 disabled:text-slate-500 transition-transform active:scale-[0.98]"
      >
        {spinning ? "결과를 확인하고 있어요…" : status?.nextSource === "RETRY" ? "다시 돌리기" : completed ? "오늘 참여 완료" : "룰렛 돌리기"}
      </button>
    </section>
  );
}
