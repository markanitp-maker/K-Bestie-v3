"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ATTENDANCE_ROULETTE_LABELS,
  ATTENDANCE_ROULETTE_RESULTS,
  ATTENDANCE_ROULETTE_SECTOR_ANGLE,
  attendanceRouletteRestingRotation,
  attendanceRouletteSectorCenterAngle,
  attendanceRouletteTargetRotation,
  type AttendanceRouletteResultCode,
  type AttendanceRouletteStatus,
} from "@/lib/events/attendanceRoulette";

const WHEEL_CENTER = 160;
const WHEEL_RADIUS = 140;
const LABEL_RADIUS = 94;
const SPIN_DURATION_MS = 1_650;
const SECTOR_COLORS = ["#FFE7A3", "#FFD1A8", "#BFE7FF", "#FFD8E4", "#CFF2D7", "#E3D2FF", "#FFF1B8"];

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

function polarPoint(angle: number, radius: number) {
  const radians = angle * Math.PI / 180;
  return {
    x: WHEEL_CENTER + Math.cos(radians) * radius,
    y: WHEEL_CENTER + Math.sin(radians) * radius,
  };
}

function sectorPath(index: number) {
  const center = attendanceRouletteSectorCenterAngle(index);
  const start = polarPoint(center - ATTENDANCE_ROULETTE_SECTOR_ANGLE / 2, WHEEL_RADIUS);
  const end = polarPoint(center + ATTENDANCE_ROULETTE_SECTOR_ANGLE / 2, WHEEL_RADIUS);
  return `M ${WHEEL_CENTER} ${WHEEL_CENTER} L ${start.x} ${start.y} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${end.x} ${end.y} Z`;
}

function WheelLabel({ code, index, rotation, animated }: {
  code: AttendanceRouletteResultCode;
  index: number;
  rotation: number;
  animated: boolean;
}) {
  const center = attendanceRouletteSectorCenterAngle(index);
  const point = polarPoint(center, LABEL_RADIUS);
  const transition = animated ? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.72, 0.12, 1)` : "none";

  return (
    <g
      style={{
        transform: `translate(${point.x}px, ${point.y}px) rotate(${-rotation}deg)`,
        transformOrigin: "0px 0px",
        transition,
      }}
    >
        <text
          x="0"
          y="0"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#183153"
          fontWeight="900"
          fontSize={code === "RETRY" ? 15 : 19}
          style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.7)", strokeWidth: 2, strokeLinejoin: "round" }}
        >
          {code === "RETRY" ? (
            <>
              <tspan x="0" dy="-8">한번</tspan>
              <tspan x="0" dy="17">더</tspan>
            </>
          ) : (
            code === "LOSE" ? "꽝" : `+${code.slice(4)}`
          )}
        </text>
    </g>
  );
}

function AttendanceRouletteWheel({ rotation, animated }: { rotation: number; animated: boolean }) {
  const transition = animated ? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.72, 0.12, 1)` : "none";

  return (
    <div className="relative w-full max-w-[306px] aspect-square mx-auto" aria-label="꽝, 한번 더, 황금열쇠 1개, 3개, 5개, 7개, 9개 룰렛">
      <div className="absolute left-1/2 -top-1 -translate-x-1/2 z-20 drop-shadow-sm" aria-hidden="true">
        <svg width="34" height="38" viewBox="0 0 34 38">
          <path d="M17 35 3 8c-2-4 1-7 5-7h18c4 0 7 3 5 7L17 35Z" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="3" />
        </svg>
      </div>
      <svg viewBox="0 0 320 320" className="w-full h-full overflow-visible" role="img">
        <circle cx="160" cy="160" r="151" fill="#F6C453" opacity="0.35" />
        <g style={{ transform: `rotate(${rotation}deg)`, transformOrigin: "160px 160px", transition }}>
          {ATTENDANCE_ROULETTE_RESULTS.map((code, index) => (
            <path key={code} d={sectorPath(index)} fill={SECTOR_COLORS[index]} stroke="#FFFFFF" strokeWidth="3" />
          ))}
          {ATTENDANCE_ROULETTE_RESULTS.map((code, index) => (
            <WheelLabel key={code} code={code} index={index} rotation={rotation} animated={animated} />
          ))}
          <circle cx="160" cy="160" r="35" fill="#FFFFFF" stroke="#F6C453" strokeWidth="5" />
          <text x="160" y="162" textAnchor="middle" dominantBaseline="middle" fontSize="27" aria-hidden="true">🔑</text>
        </g>
        <circle cx="160" cy="160" r="141" fill="none" stroke="#F6C453" strokeWidth="8" />
      </svg>
    </div>
  );
}

export default function AttendanceRouletteLoginModal({
  childId,
  onBalanceChange,
  onGateResolved,
}: {
  childId: string;
  onBalanceChange?: (balance: number) => void;
  onGateResolved: () => void;
}) {
  const [status, setStatus] = useState<AttendanceRouletteStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [displayedResult, setDisplayedResult] = useState<AttendanceRouletteResultCode | null>(null);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pendingKey = useRef<string | null>(null);
  const gateResolvedRef = useRef(false);

  const resolveGate = useCallback(() => {
    if (gateResolvedRef.current) return;
    gateResolvedRef.current = true;
    onGateResolved();
  }, [onGateResolved]);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/events/attendance-roulette/status?childId=${encodeURIComponent(childId)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("status_unavailable");
    const next = await response.json() as AttendanceRouletteStatus;
    setStatus(next);
    onBalanceChange?.(next.balance);
    return next;
  }, [childId, onBalanceChange]);

  const refreshWithRetry = useCallback(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await refresh();
      } catch (cause) {
        lastError = cause;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }, [refresh]);

  useEffect(() => {
    let active = true;
    setChecking(true);
    refreshWithRetry()
      .then((next) => {
        if (!active) return;
        if (!next.canSpin) {
          resolveGate();
          return;
        }
        if (next.lastSpin) {
          setRotation(attendanceRouletteRestingRotation(next.lastSpin.resultCode));
          if (next.nextSource === "RETRY") setDisplayedResult(next.lastSpin.resultCode);
        }
        setVisible(true);
      })
      .catch(() => {
        if (active) resolveGate();
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => { active = false; };
  }, [refreshWithRetry, resolveGate]);

  const spin = async () => {
    if (spinning || !status?.canSpin) return;
    setSpinning(true);
    setAnimated(true);
    setDisplayedResult(null);
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
      setRotation((current) => attendanceRouletteTargetRotation(current, settled.resultCode));
      pendingKey.current = null;
      await new Promise((resolve) => setTimeout(resolve, SPIN_DURATION_MS));
      setDisplayedResult(settled.resultCode);
      setStatus((current) => {
        if (!current) return current;
        const nextBalance = current.balance + settled.keyReward;
        onBalanceChange?.(nextBalance);
        return {
          ...current,
          attendanceDate: settled.attendanceDate,
          canSpin: settled.canSpin,
          nextSource: settled.canSpin ? "RETRY" : null,
          baseSpinUsed: true,
          retryCreditsRemaining: settled.retryCreditsRemaining,
          lastSpin: {
            spinId: settled.spinId,
            attendanceDate: settled.attendanceDate,
            source: settled.source,
            resultCode: settled.resultCode,
            keyReward: settled.keyReward,
            settledAt: settled.settledAt,
          },
          balance: nextBalance,
        };
      });
      // 서버 정본으로 다시 맞추되, 이 조회가 일시 실패해도 이미 확정된 spin 결과와
      // 완료/RETRY 상태는 위 응답으로 유지해 사용자를 팝업에 가두지 않는다.
      await refresh().catch(() => undefined);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "spin_failed";
      setError(reason === "no_available_spin"
        ? "오늘의 룰렛을 모두 사용했어요."
        : "결과 확인이 늦어지고 있어요. 다시 시도해 주세요.");
    } finally {
      setSpinning(false);
      setAnimated(false);
    }
  };

  const closeCompleted = () => {
    if (spinning || status?.canSpin) return;
    setVisible(false);
    resolveGate();
  };

  if (checking && !visible) {
    return <div className="fixed inset-0 z-[240] bg-black/15" aria-busy="true" aria-label="오늘의 출석 확인 중" />;
  }
  if (!visible || !status) return null;

  const completed = !status.canSpin && !!displayedResult;
  const isRetry = status.nextSource === "RETRY";

  return (
    <div className="fixed inset-0 z-[250] flex items-end sm:items-center justify-center bg-black/55 px-3" role="dialog" aria-modal="true" aria-labelledby="attendance-roulette-title">
      <div className="w-full max-w-[390px] max-h-[96dvh] overflow-y-auto rounded-t-[30px] sm:rounded-[30px] bg-[#FFFDF7] px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl">
        <div className="text-center mb-3">
          <p className="text-xs font-extrabold tracking-wide text-amber-600">매일 출석 선물</p>
          <h2 id="attendance-roulette-title" className="mt-1 text-[22px] leading-tight font-black text-[var(--color-k-navy)]">황금열쇠 룰렛</h2>
          <p className="mt-1.5 text-[13px] font-semibold text-[var(--color-k-navy)]/70">
            {isRetry ? "한번 더 기회가 있어요. 다시 돌려볼까요?" : "오늘의 룰렛을 돌리고 황금열쇠를 받아보세요!"}
          </p>
        </div>

        <AttendanceRouletteWheel rotation={rotation} animated={animated} />

        <div className="min-h-[48px] mt-2">
          {displayedResult && (
            <div className="py-2.5 px-3 rounded-2xl bg-amber-100 text-center font-black text-[16px] text-amber-900" role="status">
              {displayedResult === "RETRY" ? "🎉 한번 더!" : ATTENDANCE_ROULETTE_LABELS[displayedResult]}
            </div>
          )}
          {error && <p className="mt-2 text-center text-xs font-semibold text-red-600" role="alert">{error}</p>}
        </div>

        <button
          type="button"
          onClick={completed ? closeCompleted : spin}
          disabled={spinning || (!completed && !status.canSpin)}
          className="mt-2 w-full min-h-[50px] rounded-2xl bg-amber-500 text-white font-black text-[16px] shadow-sm disabled:bg-slate-300 disabled:text-slate-500 transition-transform active:scale-[0.98]"
        >
          {spinning ? "룰렛이 돌아가고 있어요…" : completed ? "확인" : isRetry ? "다시 돌리기" : "룰렛 돌리기"}
        </button>
      </div>
    </div>
  );
}
