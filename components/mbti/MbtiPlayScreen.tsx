"use client";

/**
 * `/play/mbti` 네이티브 상태 머신 (K-Bestie-v3 메인 앱 통합)
 * (2026-07-25 200문항뱅크/세션당 20문항 개편)
 *
 * 세션 생성·황금열쇠 차감·이어하기 판단은 여전히 메인 앱의 공용 놀이 인프라
 * (/api/play/consume, /api/play/session)가 전담하고, 이 컴포넌트는 그 결과
 * (sessionId/childId)를 부모(app/play/mbti/page.tsx)로부터 props로 직접 받는다.
 *
 * ── 신규: 문항 선정이 서버 책임으로 이동 ────────────────────────────────────
 * 200문항뱅크 개편으로 20문항 선정(축당 5문항 균형 + 최근 3세션 재출제 회피)과 좌우
 * 옵션 순서 고정이 `GET /api/mbti/session`(서버, DB 조회 필요) 책임이 됐다. 이
 * 컴포넌트는 마운트 시 그 조회를 한 번 호출해 `questionOrder`/`optionOrder`/기존
 * 답변을 통째로 받아온 뒤, 절대 다시 계산하지 않고 그대로 QuestionScreen에 넘긴다.
 * 이 조회 자체가 실패하면(문항이 없으면 화면을 그릴 수 없으므로) "진행 없음으로
 * 폴백"이 아니라 명시적 오류 화면(ErrorScreen, kind="load_failed")으로 전환하고
 * 재시도를 제공한다 — 예전(정적 16문항 로컬 배열) 모델과 달리 서버 데이터 없이는
 * 문항 자체를 렌더링할 수 없기 때문이다.
 *
 * 구버전(schemaVersion 없음, 16문항) progress_state는 `parseMbtiProgressState`가
 * null로 취급해 자동으로 걸러진다 — 이 컴포넌트 입장에서는 "저장된 진행 없음"과
 * 구분할 필요가 없다(서버가 이미 새 20문항을 선정해 반환하므로 안전하게 새로 시작).
 */

import { useEffect, useState, type ReactElement } from "react";

import ErrorScreen from "@/components/mbti/ErrorScreen";
import ProgressErrorOverlay from "@/components/mbti/ProgressErrorOverlay";
import QuestionScreen from "@/components/mbti/QuestionScreen";
import ResultLoadingScreen from "@/components/mbti/ResultLoadingScreen";
import ResultScreen from "@/components/mbti/ResultScreen";
import { useResultAutoClose } from "@/hooks/useResultAutoClose";
import { completeMbtiSession } from "@/lib/api/mbtiComplete";
import { fetchMbtiSessionProgress } from "@/lib/api/fetchMbtiSessionProgress";
import { saveMbtiProgress, type MbtiProgressState } from "@/lib/api/mbtiProgress";
import type { MbtiType } from "@/lib/data/mbtiTypes";
import { classifyProgressSaveFailure } from "@/lib/mbti/classifyProgressSaveError";
import type { MbtiErrorKind } from "@/lib/mbti/errorKinds";
import type { MbtiAnswer } from "@/lib/mbti/scoreResult";

export interface MbtiPlayScreenProps {
  sessionId: string;
  childId: string;
  /** 닫기(결과 화면 닫기/5분 자동 종료/오류 화면 메인 복귀)가 요청됐을 때 호출된다.
   * 실제 이동(예: /child/play로 라우팅)은 호출부(app/play/mbti/page.tsx) 책임이다. */
  onClose: () => void;
}

type MbtiPlayStage = "resolving-resume" | "init-failed" | "questions" | "result-loading" | "result";

interface CompletedMbtiResult {
  mbtiType: MbtiType;
  answers: readonly MbtiAnswer[];
}

interface MidProgressError {
  errorKind: MbtiErrorKind;
  questionNumber: number;
  errorMessage: string;
}

const MbtiPlayScreen = ({
  sessionId,
  childId,
  onClose,
}: MbtiPlayScreenProps): ReactElement => {
  // 재시작("다시 시작하기") 시 새 세션으로 교체되므로 prop이 아니라 로컬 state로 관리한다.
  const [activeSessionId, setActiveSessionId] = useState(sessionId);
  const [stage, setStage] = useState<MbtiPlayStage>("resolving-resume");
  const [sessionProgress, setSessionProgress] = useState<MbtiProgressState | null>(null);
  const [initRetrying, setInitRetrying] = useState(false);
  const [initRetryToken, setInitRetryToken] = useState(0);
  const [completedResult, setCompletedResult] = useState<CompletedMbtiResult | null>(null);
  const [midError, setMidError] = useState<MidProgressError | null>(null);
  const [showSaveErrorBanner, setShowSaveErrorBanner] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // 세션 진행 상태 조회 + (최초 진입이면) 서버의 20문항 선정 결과를 받아온다.
  // 조회 성공/실패 모두 반드시 "resolving-resume"을 벗어난다(무한 로딩 금지).
  useEffect(() => {
    if (stage !== "resolving-resume") {
      return;
    }
    let cancelled = false;
    setInitRetrying(initRetryToken > 0);

    fetchMbtiSessionProgress({ sessionId: activeSessionId, childId })
      .then((result) => {
        if (cancelled) return;
        setSessionProgress(result.progressState);
        setStage("questions");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[MbtiPlayScreen] 문항 선정/이어하기 진행 상태 조회 실패:", error);
        setStage("init-failed");
      })
      .finally(() => {
        if (!cancelled) {
          setInitRetrying(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeSessionId는 재시작 시 handleRestart가 stage를 다시 "resolving-resume"으로 되돌릴 때 클로저로 최신값을 읽는다
  }, [stage, initRetryToken]);

  const handleRetryInit = (): void => {
    setInitRetryToken((token) => token + 1);
    setStage("resolving-resume");
  };

  const handleProgressSave = (event: {
    sessionId: string;
    questionIndex: number;
    answers: readonly MbtiAnswer[];
    progressVersion: number;
  }): void => {
    saveMbtiProgress(event)
      .then(() => {
        setShowSaveErrorBanner(false);
      })
      .catch((error: unknown) => {
        console.error("[MbtiPlayScreen] 진행 상태 저장 실패:", error);
        const outcome = classifyProgressSaveFailure(error);
        if (outcome.type === "fatal") {
          setMidError({
            errorKind: outcome.kind,
            questionNumber: event.questionIndex,
            errorMessage: error instanceof Error ? error.message : outcome.kind,
          });
          return;
        }
        setShowSaveErrorBanner(true);
      });
  };

  const handleQuestionsComplete = (
    mbtiType: MbtiType,
    answers: readonly MbtiAnswer[],
  ): void => {
    setCompletedResult({ mbtiType, answers });
    setStage("result-loading");

    completeMbtiSession({ sessionId: activeSessionId, mbtiType, answers }).catch(
      (error: unknown) => {
        console.error("[MbtiPlayScreen] 세션 완료 처리 실패:", error);
      },
    );
  };

  const handleResultLoadingComplete = (): void => {
    setStage("result");
  };

  const handleScreenshotRequest = (): void => {
    // no-op — 실제 캡처 로직은 ResultScreen 내부(useResultScreenshot)가 처리함
  };

  const handleClose = (): void => {
    onClose();
  };

  const handleContinueInPlace = (): void => {
    setMidError(null);
  };

  const handleRestart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    try {
      const res = await fetch("/api/play/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_id: childId, play_type: "mbti" }),
      });
      if (!res.ok) {
        alert("초기화에 실패했어요. 잠시 후 다시 시도해줘.");
        return;
      }
      const data = await res.json();
      setActiveSessionId(data.session_id);
      setSessionProgress(null);
      setCompletedResult(null);
      setMidError(null);
      setShowSaveErrorBanner(false);
      // 새 세션은 서버에 아직 20문항이 선정되지 않은 빈 상태이므로, 정적 화면 전환이 아니라
      // resolving-resume으로 되돌아가 GET /api/mbti/session이 새로 선정하도록 한다.
      setStage("resolving-resume");
    } catch (error) {
      console.error("[MbtiPlayScreen] 다시 시작하기 실패:", error);
      alert("초기화에 실패했어요. 잠시 후 다시 시도해줘.");
    } finally {
      setRestarting(false);
    }
  };

  const handleReportBug = (): void => {
    fetch("/api/play/bug-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playType: "mbti",
        eventType: "PLAY_BUG_REPORT",
        occurredAt: new Date().toISOString(),
        sessionId: activeSessionId,
        childId,
        stage: "in_progress",
        questionNumber: midError?.questionNumber ?? null,
        errorMessage: midError?.errorMessage ?? "문항 진행 중 오류",
        networkStatus: typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
        dbStatus: "unknown",
        browserOS: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      }),
    }).catch((error) => {
      console.error("[MbtiPlayScreen] 버그 신고 전송 실패:", error);
    });
  };

  const handleCloseAfterReport = (): void => {
    onClose();
  };

  // 결과 화면(S5) 5분 무반응 자동 종료.
  useResultAutoClose(stage === "result", () => onClose());

  if (stage === "init-failed") {
    return (
      <ErrorScreen
        kind="load_failed"
        onReturnToMain={onClose}
        onRetry={handleRetryInit}
        retrying={initRetrying}
      />
    );
  }

  if (stage === "result-loading") {
    return <ResultLoadingScreen onLoadingComplete={handleResultLoadingComplete} />;
  }

  if (stage === "result" && completedResult) {
    return (
      <ResultScreen
        mbtiType={completedResult.mbtiType}
        onScreenshotRequest={handleScreenshotRequest}
        onClose={handleClose}
      />
    );
  }

  if (stage === "questions" && sessionProgress) {
    return (
      <>
        <QuestionScreen
          sessionId={activeSessionId}
          questionOrder={sessionProgress.questionOrder}
          optionOrder={sessionProgress.optionOrder}
          initialAnswers={sessionProgress.answers}
          initialProgressVersion={sessionProgress.progressVersion}
          onProgressSave={handleProgressSave}
          onComplete={handleQuestionsComplete}
          showSaveErrorBanner={showSaveErrorBanner}
        />
        {midError ? (
          <ProgressErrorOverlay
            onRestart={handleRestart}
            onContinue={handleContinueInPlace}
            onReportBug={handleReportBug}
            onCloseAfterReport={handleCloseAfterReport}
          />
        ) : null}
      </>
    );
  }

  // resolving-resume: 문항 선정/이어하기 진행 상태 조회 중(무한 로딩 아님 — 조회 성공/실패
  // 모두 반드시 stage를 벗어나게 한다).
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-4xl" aria-hidden="true">
        🐾
      </span>
      <p className="text-sm text-gray-500">놀이를 준비하고 있어요...</p>
    </main>
  );
};

export default MbtiPlayScreen;
