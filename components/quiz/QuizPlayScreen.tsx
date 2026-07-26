"use client";

/**
 * requests/021 — 퀴즈마스터를 K-Bestie 내부 Full Screen Modal 놀이 모듈로 전환.
 * app/play/mbti/MbtiPlayScreen과 동일한 역할: sessionId 대신 handoff token을 받아
 * ①token 소비(redeem) ②과목 선택 ③문제 풀이 ④결과 표시를 전부 이 컴포넌트 하나가
 * 오케스트레이션한다. 원본 퀴즈마스터의 grade 선택 화면은 제거했다 - K-Bestie가
 * handoff 발급 시점에 이미 학년을 확정해 넘기므로 아이가 다시 고를 필요가 없다
 * (redeem 응답의 grade를 그대로 신뢰).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  QUIZ_REDEEM_PATH,
  QUIZ_START_PATH,
  QUIZ_PROGRESS_PATH,
  QUIZ_SUBMIT_PATH,
  QUIZ_HEARTBEAT_PATH,
  QUIZ_BACKGROUND_PATH,
  QUIZ_BUG_REPORT_PATH,
  QUIZ_LEADERBOARD_PATH,
  quizAttemptHydratePath,
  type QuizRedeemResponse,
  type QuizStartResponse,
  type QuizSubmitResponse,
  type QuizAttemptHydrateResponse,
  type QuizLeaderboardResponse,
} from "@/lib/quiz/play/api-contracts";
import {
  mapQuizApiError,
  mapThrownError,
  extractErrorDetail,
  type QuizUiError,
} from "@/lib/quiz/play/error-mapping";
import type { QuizGrade, QuizSubject, QuizLeaderboardPublicEntry } from "@/lib/quiz/play/types";
import { attachAttemptIdToQuizSessionHandoff } from "@/lib/play/quizSessionHandoff";

const HEARTBEAT_INTERVAL_MS = 30_000;
const AUTO_ADVANCE_FEEDBACK_MS = 500;
const SUBJECTS: readonly QuizSubject[] = ["국어", "영어", "수학", "과학", "사회", "창의", "상식"];
const GRADES: readonly QuizGrade[] = [1, 2, 3, 4, 5, 6];

type Phase =
  | "redeeming"
  | "grade_select"
  | "subject_select"
  | "starting"
  | "playing"
  | "submitting"
  | "submitted"
  | "error";

type BugReportState = "idle" | "pending" | "sent" | "failed";

export interface QuizPlayScreenProps {
  token: string;
  childId: string;
  /** 이미 시작된 attempt가 있으면(이어하기 새로고침) redeem/과목선택을 건너뛰고 바로 hydrate한다. */
  initialAttemptId: string | null;
  onClose: () => void;
}

export default function QuizPlayScreen({
  token,
  childId,
  initialAttemptId,
  onClose,
}: QuizPlayScreenProps) {
  const [phase, setPhase] = useState<Phase>(initialAttemptId ? "playing" : "redeeming");
  const [uiError, setUiError] = useState<QuizUiError | null>(null);
  const [grade, setGrade] = useState<QuizGrade | null>(null);
  const [pendingSubject, setPendingSubject] = useState<QuizSubject | null>(null);

  const [attemptId, setAttemptId] = useState<string | null>(initialAttemptId);
  const [questions, setQuestions] = useState<QuizStartResponse["questions"]>([]);
  const [position, setPosition] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [result, setResult] = useState<QuizSubmitResponse | null>(null);
  const [bugReportState, setBugReportState] = useState<BugReportState>("idle");
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboardPublicEntry[] | null>(null);

  // ---- 0) 이어하기: 이미 시작된 attempt가 있으면 redeem/과목선택을 건너뛰고 서버
  // 상태를 그대로 재확인해 복원한다("이어하기"는 절대 초기화·재출제하지 않는다). ----
  useEffect(() => {
    if (!initialAttemptId) return;
    let ignore = false;

    async function hydrate() {
      let res: Response;
      try {
        res = await fetch(quizAttemptHydratePath(initialAttemptId!));
      } catch (err) {
        if (ignore) return;
        setUiError(mapThrownError(err, "quiz_engine"));
        setPhase("error");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (ignore) return;
        setUiError(mapQuizApiError(body, "quiz_engine"));
        setPhase("error");
        return;
      }

      const data = (await res.json()) as QuizAttemptHydrateResponse;
      if (ignore) return;

      setQuestions(data.questions);
      setPosition(data.attempt.current_position);
      setAnswers(data.attempt.submitted_answers);

      if (data.attempt.status === "submitted") {
        setResult({
          score: data.attempt.score ?? 0,
          accumulated_time_seconds: data.attempt.accumulated_time_seconds,
          cumulative_score: null,
          cumulative_time: null,
          rank: null,
          status: "submitted",
          already_submitted: true,
        });
        setPhase("submitted");
      } else {
        setPhase("playing");
      }
    }

    void hydrate();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 1) redeem: handoff token 소비 + 학년 확인 (신규 시작일 때만) ----
  useEffect(() => {
    if (initialAttemptId) return;
    let ignore = false;

    async function redeem() {
      let res: Response;
      try {
        res = await fetch(QUIZ_REDEEM_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, childId }),
        });
      } catch (err) {
        if (ignore) return;
        setUiError(mapThrownError(err, "redeem"));
        setPhase("error");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (ignore) return;
        setUiError(mapQuizApiError(body, "redeem"));
        setPhase("error");
        return;
      }

      const data = (await res.json()) as QuizRedeemResponse;
      if (ignore) return;
      setGrade(data.grade);
      setPhase("grade_select");
    }

    void redeem();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 1-1) 학년 확인: handoff에서 이미 확정된 학년을 아이에게 보여주고 확인받는다
  // (실질적 선택지는 없음 - 본인 학년만 활성, 나머지는 비활성 표시). ----
  function handleConfirmGrade() {
    setPhase("subject_select");
  }

  // ---- 2) 과목 선택 → 시작 ----
  async function handleSelectSubject(subject: QuizSubject) {
    if (!grade || pendingSubject) return;
    setPendingSubject(subject);
    setPhase("starting");

    let res: Response;
    try {
      res = await fetch(QUIZ_START_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId, grade, subject }),
      });
    } catch (err) {
      setUiError(mapThrownError(err, "subject_select"));
      setPhase("error");
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setUiError(mapQuizApiError(body, "subject_select"));
      setPhase("error");
      return;
    }

    const data = (await res.json()) as QuizStartResponse;
    setAttemptId(data.attemptId);
    setQuestions(data.questions);
    setPosition(data.current_position);
    setAnswers(data.submitted_answers);
    setPhase("playing");
    // 이후 새로고침("이어하기")이 이미 소비된 token이 아니라 이 attemptId로 복원할 수
    // 있도록 sessionStorage에 남겨 둔다.
    attachAttemptIdToQuizSessionHandoff(data.attemptId);
  }

  // ---- 3) heartbeat(30초 주기) + 백그라운드 신호 ----
  useEffect(() => {
    if (phase !== "playing" || !attemptId) return;

    const sendHeartbeat = () => {
      void fetch(QUIZ_HEARTBEAT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      });
    };

    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        void fetch(QUIZ_BACKGROUND_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId }),
        });
      } else {
        sendHeartbeat();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [phase, attemptId]);

  // ---- 진행 저장 ----
  const saveProgress = useCallback(
    async (nextPosition: number, nextAnswers: Record<string, number>): Promise<boolean> => {
      if (!attemptId) return false;
      let res: Response;
      try {
        res = await fetch(QUIZ_PROGRESS_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId, current_position: nextPosition, answers: nextAnswers }),
        });
      } catch (err) {
        setUiError(mapThrownError(err, "quiz_engine"));
        setPhase("error");
        return false;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setUiError(mapQuizApiError(body, "quiz_engine"));
        setPhase("error");
        return false;
      }

      return true;
    },
    [attemptId]
  );

  // ---- 제출 후 리더보드(결과 화면 하단) ----
  useEffect(() => {
    if (phase !== "submitted") return;
    let ignore = false;

    async function loadLeaderboard() {
      try {
        const res = await fetch(QUIZ_LEADERBOARD_PATH);
        if (!res.ok || ignore) return;
        const data = (await res.json()) as QuizLeaderboardResponse;
        if (!ignore) setLeaderboard(data.entries);
      } catch {
        // leave leaderboard as null — section renders empty, nothing else affected
      }
    }

    void loadLeaderboard();
    return () => {
      ignore = true;
    };
  }, [phase]);

  const currentQuestion = questions[position];

  async function handleSelectOption(displaySlotIndex: number) {
    if (!currentQuestion || isAdvancing) return;

    const nextAnswers = { ...answers, [currentQuestion.id]: displaySlotIndex };
    setAnswers(nextAnswers);
    setIsAdvancing(true);

    await new Promise((resolve) => setTimeout(resolve, AUTO_ADVANCE_FEEDBACK_MS));

    const isLastQuestion = position === questions.length - 1;
    if (isLastQuestion) {
      await handleSubmit(nextAnswers);
      return;
    }

    const nextPosition = position + 1;
    setPosition(nextPosition);
    void saveProgress(nextPosition, nextAnswers);
    setIsAdvancing(false);
  }

  function goTo(nextPosition: number) {
    if (nextPosition < 0 || nextPosition >= questions.length) return;
    setPosition(nextPosition);
    void saveProgress(nextPosition, answers);
  }

  async function handleSubmit(answersOverride?: Record<string, number>) {
    if (!attemptId) return;
    const answersToSubmit = answersOverride ?? answers;
    setShowSubmitConfirm(false);
    setPhase("submitting");

    const saved = await saveProgress(position, answersToSubmit);
    if (!saved) return;

    let res: Response;
    try {
      res = await fetch(QUIZ_SUBMIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, answers: answersToSubmit }),
      });
    } catch (err) {
      setUiError(mapThrownError(err, "submit"));
      setPhase("error");
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setUiError(mapQuizApiError(body, "submit"));
      setPhase("error");
      return;
    }

    const data = (await res.json()) as QuizSubmitResponse;
    setResult(data);
    setPhase("submitted");
  }

  async function handleBugReport() {
    setBugReportState("pending");
    try {
      const res = await fetch(QUIZ_BUG_REPORT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: attemptId,
          location: uiError?.location ?? "quiz_engine",
          error_code: uiError?.code ?? "UNKNOWN_ERROR",
          detail_log: uiError ? extractErrorDetail(uiError) : null,
        }),
      });
      setBugReportState(res.ok ? "sent" : "failed");
    } catch {
      setBugReportState("failed");
    }
  }

  function handleContinue() {
    // "이어하기": 로컬 상태를 리셋하지 않는다 - 새로고침으로 서버 상태를 그대로 재확인한다.
    window.location.reload();
  }

  const orderedOptions = useMemo(() => currentQuestion?.options ?? [], [currentQuestion]);
  const progressPercent = questions.length > 0 ? ((position + 1) / questions.length) * 100 : 0;

  return (
    <main className="flex min-h-dvh flex-col bg-k-background">
      <div className="shrink-0 flex items-center px-4 pt-4 pb-2">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      {phase === "redeeming" && (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-k-text-secondary">준비하는 중...</p>
        </div>
      )}

      {phase === "grade_select" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
          <div className="text-center">
            <h1 className="text-xl font-bold text-k-text-primary">학년을 확인하세요</h1>
            <p className="mt-2 text-sm text-k-text-secondary">
              {grade}학년으로 문제가 출제돼요
            </p>
          </div>
          <div role="list" className="grid w-full max-w-md grid-cols-3 gap-3">
            {GRADES.map((g) => {
              const active = g === grade;
              return (
                <button
                  key={g}
                  type="button"
                  role="listitem"
                  disabled={!active}
                  aria-pressed={active}
                  aria-disabled={!active}
                  className="flex items-center justify-center rounded-2xl border-2 py-5 text-lg font-semibold transition-colors disabled:cursor-not-allowed"
                  style={
                    active
                      ? { borderColor: "var(--color-k-orange)", background: "var(--color-k-orange-tint)", color: "var(--color-k-orange)" }
                      : { borderColor: "var(--color-k-border)", background: "var(--color-k-surface)", color: "var(--color-k-disabled)" }
                  }
                >
                  {g}학년
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleConfirmGrade}
            className="w-full max-w-xs rounded-2xl py-3.5 font-bold text-white active:scale-95 transition-transform"
            style={{ background: "var(--color-k-orange)" }}
          >
            확인
          </button>
        </div>
      )}

      {phase === "subject_select" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
          <div className="text-center">
            <h1 className="text-xl font-bold text-k-text-primary">과목을 선택하세요</h1>
            <p className="mt-2 text-sm text-k-text-secondary">문제 10개를 풀어봐요</p>
          </div>
          <div role="list" className="grid w-full max-w-md grid-cols-2 gap-3 sm:grid-cols-3">
            {SUBJECTS.map((subject) => (
              <button
                key={subject}
                type="button"
                role="listitem"
                onClick={() => handleSelectSubject(subject)}
                className="flex items-center justify-center rounded-2xl border-2 py-5 text-lg font-semibold transition-colors active:scale-95"
                style={{ borderColor: "var(--color-k-orange)", background: "var(--color-k-orange-tint)", color: "var(--color-k-orange)" }}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "starting" && (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-k-text-secondary">{pendingSubject} 문제를 준비하는 중...</p>
        </div>
      )}

      {phase === "error" && (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <h1 className="text-2xl font-bold text-k-text-primary">문제가 발생했어요</h1>
          <p className="max-w-sm text-base text-k-text-secondary">
            {uiError?.userMessage ?? "문제가 발생했어요."}
          </p>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <button
              type="button"
              onClick={() => void handleBugReport()}
              disabled={bugReportState === "pending" || bugReportState === "sent"}
              className="rounded-2xl py-3.5 font-bold text-white active:scale-95 transition-transform disabled:opacity-60"
              style={{ background: "var(--color-k-navy)" }}
            >
              {bugReportState === "sent"
                ? "신고 접수됨"
                : bugReportState === "pending"
                  ? "신고 접수 중..."
                  : bugReportState === "failed"
                    ? "신고 실패, 다시 시도"
                    : "버그 신고하기"}
            </button>
            {attemptId ? (
              <button
                type="button"
                onClick={handleContinue}
                className="rounded-2xl py-3.5 font-bold text-white active:scale-95 transition-transform"
                style={{ background: "var(--color-k-orange)" }}
              >
                이어하기
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl py-3.5 font-bold text-white active:scale-95 transition-transform"
                style={{ background: "var(--color-k-orange)" }}
              >
                놀이 화면으로
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "submitting" && (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-k-text-secondary">제출하는 중...</p>
        </div>
      )}

      {phase === "submitted" && (
        <div className="flex flex-1 flex-col items-center gap-6 overflow-y-auto p-8 text-center">
          <div className="w-full max-w-sm rounded-3xl p-8 shadow-md" style={{ background: "var(--color-k-surface)" }}>
            <h1 className="text-2xl font-bold text-k-text-primary mb-2">결과</h1>
            <p className="text-5xl font-bold" style={{ color: "var(--color-k-orange)" }}>
              {result?.score ?? 0}점
            </p>
            <p className="mt-3 text-base text-k-text-secondary">
              {result?.rank != null ? `현재 순위: ${result.rank}위` : "잘했어요!"}
            </p>
          </div>

          <div className="w-full max-w-sm rounded-3xl p-6 text-left shadow-md" style={{ background: "var(--color-k-surface)" }}>
            <h2 className="mb-3 text-lg font-semibold text-k-text-primary">리더보드</h2>
            {leaderboard === null ? (
              <p className="text-sm text-k-text-secondary">불러오는 중...</p>
            ) : leaderboard.length === 0 ? (
              <p className="text-sm text-k-text-secondary">아직 리더보드 정보가 없어요.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {leaderboard.map((entry, index) => (
                  <li
                    key={entry.user_id}
                    className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-k-text-primary">
                      {index + 1}. {entry.name} ({entry.masked_id})
                    </span>
                    <span style={{ color: "var(--color-k-sky-blue)" }}>{entry.cumulative_score}점</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full max-w-xs shrink-0 rounded-2xl py-3.5 font-bold text-white active:scale-95 transition-transform"
            style={{ background: "var(--color-k-orange)" }}
          >
            놀이 화면으로
          </button>
        </div>
      )}

      {phase === "playing" && !currentQuestion && (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-k-text-secondary">불러오는 중...</p>
        </div>
      )}

      {phase === "playing" && currentQuestion && (
        <div className="flex flex-1 flex-col gap-6 p-6">
          <div className="flex flex-col items-center gap-2 pb-2">
            <Image
              src="/Images/logo/Logo.png"
              alt="내친구 케이"
              width={84}
              height={24}
              className="object-contain"
              priority
            />
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={80}
              height={80}
              className="object-contain"
              priority
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm font-medium" style={{ color: "var(--color-k-sky-blue)" }}>
              <span>{position + 1} / {questions.length}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-k-surface">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressPercent}%`, background: "var(--color-k-sky-blue)" }}
              />
            </div>
          </div>

          <h1 className="text-xl font-semibold text-k-text-primary">{currentQuestion.question_text}</h1>

          <div className="flex flex-col gap-3">
            {orderedOptions.map((optionText, displaySlotIndex) => {
              const selected = answers[currentQuestion.id] === displaySlotIndex;
              return (
                <button
                  key={displaySlotIndex}
                  type="button"
                  onClick={() => void handleSelectOption(displaySlotIndex)}
                  disabled={isAdvancing}
                  aria-pressed={selected}
                  className="rounded-2xl border-2 px-4 py-3 text-left text-k-text-primary transition-colors disabled:cursor-not-allowed"
                  style={
                    selected
                      ? { borderColor: "var(--color-k-orange)", background: "var(--color-k-orange-tint)" }
                      : { borderColor: "var(--color-k-border)", background: "white" }
                  }
                >
                  {optionText}
                </button>
              );
            })}
          </div>

          <div className="mt-auto flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => goTo(position - 1)}
              disabled={position === 0 || isAdvancing}
              className="rounded-2xl px-4 py-2 font-medium text-k-text-secondary transition-colors disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              onClick={() => setShowSubmitConfirm(true)}
              disabled={isAdvancing}
              className="rounded-2xl px-6 py-3 font-bold text-white active:scale-95 transition-transform disabled:opacity-60"
              style={{ background: "var(--color-k-navy)" }}
            >
              제출하기
            </button>
            <button
              type="button"
              onClick={() => goTo(position + 1)}
              disabled={position === questions.length - 1 || isAdvancing}
              className="rounded-2xl px-4 py-2 font-medium text-k-text-secondary transition-colors disabled:opacity-40"
            >
              다음
            </button>
          </div>

          {showSubmitConfirm && (
            <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-k-navy/40 p-4 z-50">
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl">
                <p className="mb-6 text-lg font-medium text-k-text-primary">제출하시겠습니까?</p>
                <div className="flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowSubmitConfirm(false)}
                    className="rounded-2xl px-5 py-3 font-bold text-white active:scale-95 transition-transform"
                    style={{ background: "var(--color-k-navy)" }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    className="rounded-2xl px-5 py-3 font-bold text-white active:scale-95 transition-transform"
                    style={{ background: "var(--color-k-orange)" }}
                  >
                    제출
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
