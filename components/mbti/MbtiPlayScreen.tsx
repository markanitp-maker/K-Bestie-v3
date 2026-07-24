"use client";

/**
 * `/play/mbti` 네이티브 상태 머신 (K-Bestie-v3 메인 앱 통합, 2026-07-25)
 *
 * ── 별도 mbti 저장소 대비 변경점 ──────────────────────────────────────────────
 * 이 컴포넌트는 원래 별도 도메인(k-bestie-mbti-dev.vercel.app)에 iframe으로
 * 임베드되던 것을 메인 앱 안의 실제 페이지(/play/mbti)로 완전히 이식한 것이다.
 * 세션 생성·황금열쇠 차감·이어하기 판단은 여전히 메인 앱의 공용 놀이 인프라
 * (/api/play/consume, /api/play/session)가 전담하고, 이 컴포넌트는 그 결과
 * (sessionId/childId/startMode)를 부모(app/play/mbti/page.tsx)로부터 props로
 * 직접 받는다 — 더 이상 postMessage(MBTI_INIT/MBTI_READY/MBTI_INIT_ACK) 핸드셰이크나
 * 임베드 부모 Origin 검증이 필요 없다(같은 오리진의 일반 페이지이므로).
 *
 * 그러나 진행 저장(/api/mbti/progress)·이어하기 조회(/api/mbti/session)·완료 처리
 * (/api/mbti/complete)의 인증 방식은 그대로 유지한다 — Supabase Auth 쿠키가 아니라
 * playSessionId를 서버 DB에서 직접 조회해 검증하는 방식(대표님 지시, c6080b3
 * 패턴)이며, 이는 대표님이 이번 통합 지시에서도 명시적으로 유지하라고 한 부분이다.
 *
 * "다시 시작하기"(ProgressErrorOverlay)는 이 앱이 세션을 만들 수 없던 구 계약과
 * 달리, 같은 오리진에서 /api/play/restart를 직접 호출해 새 세션을 받아 로컬
 * 상태만 초기화하고 계속 이 페이지에 머무른다(전체 페이지 이동 없음).
 *
 * ── startMode를 신뢰하지 않고 항상 서버에서 재조회하는 이유 ────────────────────
 * 호출부가 세션 생성 시점에 "new"/"resume"을 알려주더라도, 그 값은 이 페이지가
 * 마운트된 이후(문항 진행 중 새로고침 등)에는 더 이상 진실이 아닐 수 있다 —
 * "new"로 진입한 뒤 답변을 이미 몇 개 서버에 저장한 상태에서 새로고침하면, 클라
 * 이언트가 기억하는 startMode는 여전히 "new"이므로 그 값을 그대로 믿으면 이미
 * 저장된 진행을 무시하고 처음부터 다시 시작하는 오류가 생긴다. 그래서 이 컴포넌트는
 * startMode를 받지 않고, 마운트 시 항상 /api/mbti/session을 조회해 서버에 저장된
 * 실제 상태(있으면 이어서, 없으면 처음부터)로만 판단한다.
 */

import { useEffect, useState, type ReactElement } from "react";

import ProgressErrorOverlay from "@/components/mbti/ProgressErrorOverlay";
import QuestionScreen, {
  type MbtiProgressSaveEvent,
  type QuestionScreenInitialProgress,
} from "@/components/mbti/QuestionScreen";
import ResultLoadingScreen from "@/components/mbti/ResultLoadingScreen";
import ResultScreen from "@/components/mbti/ResultScreen";
import { useResultAutoClose } from "@/hooks/useResultAutoClose";
import { completeMbtiSession } from "@/lib/api/mbtiComplete";
import { fetchMbtiSessionProgress } from "@/lib/api/fetchMbtiSessionProgress";
import { saveMbtiProgress } from "@/lib/api/mbtiProgress";
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

type MbtiPlayStage = "resolving-resume" | "questions" | "result-loading" | "result";

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
  // startMode를 신뢰하지 않고 항상 서버 조회로 재수화 여부를 판단한다(위 파일 상단 주석 참고).
  const [stage, setStage] = useState<MbtiPlayStage>("resolving-resume");
  const [initialProgress, setInitialProgress] =
    useState<QuestionScreenInitialProgress | null>(null);
  const [completedResult, setCompletedResult] = useState<CompletedMbtiResult | null>(null);
  const [midError, setMidError] = useState<MidProgressError | null>(null);
  const [showSaveErrorBanner, setShowSaveErrorBanner] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // resume 재수화: 저장된 progress_state.mbti를 조회해 initialProgress로 심는다. 조회 실패
  // 시(네트워크/서버 문제)에는 "진행 없음(처음부터)"으로 안전하게 폴백한다(무한 로딩 금지).
  useEffect(() => {
    if (stage !== "resolving-resume") {
      return;
    }
    let cancelled = false;

    fetchMbtiSessionProgress({ sessionId: activeSessionId, childId })
      .then((result) => {
        if (cancelled) return;
        const progress = result.progressState;
        setInitialProgress(
          progress && progress.answers.length > 0
            ? { answers: progress.answers, progressVersion: progress.progressVersion }
            : null,
        );
        setStage("questions");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[MbtiPlayScreen] 이어하기 진행 상태 조회 실패 — 처음부터 시작으로 폴백:", error);
        setInitialProgress(null);
        setStage("questions");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeSessionId 변경(재시작)은 별도 effect에서 stage를 다시 resolving-resume으로 돌리지 않음(재시작은 항상 new 취급)
  }, [stage]);

  const handleProgressSave = (event: MbtiProgressSaveEvent): void => {
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
      setInitialProgress(null);
      setCompletedResult(null);
      setMidError(null);
      setShowSaveErrorBanner(false);
      setStage("questions");
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

  if (stage === "questions") {
    return (
      <>
        <QuestionScreen
          sessionId={activeSessionId}
          initialProgress={initialProgress}
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

  // resolving-resume: 이어하기 진행 상태 조회 중(무한 로딩 아님 — 조회 성공/실패 모두 반드시
  // stage를 "questions"로 종료시킨다).
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
