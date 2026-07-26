"use client";

/**
 * 문항 진행 중 오류 복구 오버레이 (신 계약, 제품 지시 동작 변경)
 *
 * ── 언제 뜨는가 ──────────────────────────────────────────────────────────────
 * `stage === "questions"`(핸드셰이크·첫 문항 진입 이후) 도중 발생한 오류에서만 뜬다.
 * 첫 문항 진입 실패(핸드셰이크/init 타임아웃 등)는 이 오버레이가 아니라 상위가 자동으로
 * `MBTI_ERROR`를 보내고 전체화면 ErrorScreen을 렌더한다(MbtiPlayScreen 참고).
 *
 * ── 정확히 3개의 버튼만 ───────────────────────────────────────────────────────
 * 제품 지시상 선택지는 정확히 3개다(4번째 금지, 자동 재시도 금지, 환불 자격 판단 금지).
 *   - "다시 시작하기": K-Bestie-v3 네이티브 통합(2026-07-25) 이후 상위(MbtiPlayScreen)가
 *     같은 오리진의 /api/play/restart를 직접 호출해 새 세션을 받아 로컬 상태를 초기화한다
 *     (별도 iframe 시절엔 세션을 못 만들어 메인 앱에 재열기 신호만 보냈지만, 지금은 이
 *     페이지 자체가 메인 앱의 일부라 직접 재시작 가능).
 *   - "이어가기": 서버 호출 없이 오버레이만 닫고 현재 in-memory 문항 상태에서 그대로
 *     계속 진행한다(순수 로컬 재개). QuestionScreen은 이 오버레이 아래에 계속 마운트된
 *     채라 답변 상태가 보존된다.
 *   - "버그 신고하기": 상위가 진단 정보를 담아 /api/play/bug-report를 직접 호출한 뒤
 *     "접수 확인" 상태로 전환한다.
 *
 * ── 접수 확인 상태 ───────────────────────────────────────────────────────────
 * 버그 신고 후에는 "접수 확인" UI를 보여준다. 사용자가 이 상태에서 창을 닫으면 세션
 * 종료로 간주해 상위가 닫기 콜백을 호출한다(onCloseAfterReport).
 *
 * 이 컴포넌트는 오버레이 상태 전환(options → confirmed)만 소유하고, 실제 API 호출·
 * 페이지 이동은 전부 상위(MbtiPlayScreen)가 소유한다.
 */

import { useState, type ReactElement } from "react";

import { cn } from "@/lib/cn";

export interface ProgressErrorOverlayProps {
  /** "다시 시작하기" — 상위가 메인 앱에 MBTI_CLOSE_REQUEST(재시작 요청 신호)를 보낸다. */
  onRestart: () => void;
  /** "이어가기" — 상위가 오버레이만 닫는다(서버 호출 없음, 로컬 재개). */
  onContinue: () => void;
  /** "버그 신고하기" — 상위가 진단 자동 수집 + PLAY_BUG_REPORT 전송을 수행한다. */
  onReportBug: () => void;
  /** "접수 확인" 상태에서 사용자가 닫을 때 — 상위가 세션 종료(닫기 메시지)를 보낸다. */
  onCloseAfterReport: () => void;
}

type OverlayPhase = "options" | "confirmed";

const ProgressErrorOverlay = ({
  onRestart,
  onContinue,
  onReportBug,
  onCloseAfterReport,
}: ProgressErrorOverlayProps): ReactElement => {
  const [phase, setPhase] = useState<OverlayPhase>("options");

  const handleReportBugClick = (): void => {
    onReportBug();
    setPhase("confirmed");
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={phase === "confirmed" ? "버그 신고 접수 확인" : "놀이 중 문제 발생"}
      className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/40 px-6 py-10 text-center backdrop-blur-sm"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-6 rounded-3xl bg-white px-6 py-8 shadow-xl">
        {phase === "confirmed" ? (
          <>
            <div className="flex flex-col items-center gap-3">
              <span className="text-6xl" aria-hidden="true">
                ✅
              </span>
              <h1 className="text-xl font-bold text-k-text-primary">신고가 접수되었어요</h1>
              <p className="text-base leading-relaxed text-k-text-secondary">
                알려줘서 고마워! 보호자에게 문제를 전달했어요. 이제 창을 닫아도 돼요.
              </p>
            </div>
            <button
              type="button"
              onClick={onCloseAfterReport}
              className="w-full rounded-full bg-k-orange px-8 py-4 text-lg font-bold text-white shadow-md transition active:scale-95"
            >
              닫기
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <span className="text-6xl" aria-hidden="true">
                😵
              </span>
              <h1 className="text-xl font-bold text-k-text-primary">문제가 생겼어요</h1>
              <p className="text-base leading-relaxed text-k-text-secondary">
                놀이를 하다가 문제가 생겼어요. 어떻게 할까?
              </p>
            </div>

            <div className="flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={onContinue}
                className="w-full rounded-full bg-k-orange px-8 py-4 text-lg font-bold text-white shadow-md transition active:scale-95"
              >
                이어가기
              </button>
              <button
                type="button"
                onClick={onRestart}
                className={cn(
                  "w-full rounded-full border-2 border-k-orange bg-white px-8 py-4 text-lg font-bold text-k-orange transition active:scale-95",
                )}
              >
                다시 시작하기
              </button>
              <button
                type="button"
                onClick={handleReportBugClick}
                className="w-full rounded-full border-2 border-k-border bg-white px-8 py-4 text-lg font-bold text-k-text-secondary transition active:scale-95"
              >
                버그 신고하기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProgressErrorOverlay;
