"use client";

/**
 * S3 — 문항 화면 (2026-07-25 200문항뱅크/세션당 20문항 개편)
 *
 * 세션 생성 시 서버(`GET /api/mbti/session`)가 이미 고정해 넘겨준 20문항
 * `questionOrder`와 문항별 좌우 노출 순서 `optionOrder`를 그대로 따라간다 — 이 화면은
 * 문항을 선정하거나 순서를 섞지 않는다(그 책임은 전적으로 서버에 있다). 선택지를
 * 고르면 즉시 다음 문항으로 넘어간다(수동 "다음" 버튼 없음). 상단 진행바는
 * `답변수 / 20`을 표시한다. 20번째 답변 직후 `scoreMbtiAnswers`(AI 무관 순수 함수)로
 * 유형을 확정하고 `onComplete`로 상위(상태 머신)에 결과를 넘긴다.
 *
 * 중복 탭 방지: 같은 문항에서 버튼이 연타되어도 첫 클릭만 처리된다(`lastProcessedQuestionIdRef`
 * 로 문항 단위 잠금 — 클릭 즉시 동기적으로 잠기므로 같은 렌더 프레임 안의 연타도 막는다).
 *
 * 진행 저장 실패 처리: 이 화면은 진행 저장 API를 직접 호출하지 않는다(`onProgressSave`는
 * fire-and-forget 이벤트 발행일 뿐이고, 실제 호출·실패 분류는 상위 `MbtiPlayScreen`이
 * 담당한다). 세션/인증 자체가 무효화된 치명적 실패는 상위가 전체화면 오류로 전환하며 이
 * 화면을 언마운트하므로 여기서 처리할 필요가 없다. 그 외 일시적 저장 실패만
 * `showSaveErrorBanner` prop으로 전달받아 하단의 비차단 배너로 알린다.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import { QUESTION_BANK, type QuestionChoice } from "@/lib/data/questionBank";
import type { MbtiType } from "@/lib/data/mbtiTypes";
import { MBTI_ERROR_CONTENT } from "@/lib/mbti/errorKinds";
import { scoreMbtiAnswers, type MbtiAnswer } from "@/lib/mbti/scoreResult";
import type { MbtiOptionOrder } from "@/lib/mbti/selectQuestions";
import { cn } from "@/lib/cn";

const QUESTION_BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));
const TOTAL_QUESTIONS = 20;

/**
 * 진행 상태 저장 지점 — 매 답변 직후 한 번씩 호출된다.
 */
export interface MbtiProgressSaveEvent {
  sessionId: string;
  questionIndex: number;
  answers: readonly MbtiAnswer[];
  progressVersion: number;
}

export interface QuestionScreenProps {
  /** 현재 놀이 세션 식별자. `onProgressSave` 이벤트에 그대로 실려 전달된다. */
  sessionId: string;
  /** 세션 생성 시 서버가 고정한 20문항 표시 순서(같은 축 연속 없음). */
  questionOrder: readonly string[];
  /** 문항 ID → 그 문항의 고정 화면 좌우 순서("AB"|"BA"). */
  optionOrder: Readonly<Record<string, MbtiOptionOrder>>;
  /** 이어하기 시 이미 답변된 문항들(신규 시작이면 빈 배열). */
  initialAnswers: readonly MbtiAnswer[];
  /** 이어하기 시 마지막으로 저장된 progressVersion(신규 시작이면 0). */
  initialProgressVersion: number;
  /** 매 답변 직후 호출되는 진행 저장 지점. */
  onProgressSave: (event: MbtiProgressSaveEvent) => void;
  /** 20문항 전부 답변 + 판정 완료 시 호출된다. */
  onComplete: (mbtiType: MbtiType, answers: readonly MbtiAnswer[]) => void;
  /** 상위가 최근 진행 저장이 일시적으로 실패했다고 판단했을 때 true. */
  showSaveErrorBanner?: boolean;
}

const QuestionScreen = ({
  sessionId,
  questionOrder,
  optionOrder,
  initialAnswers,
  initialProgressVersion,
  onProgressSave,
  onComplete,
  showSaveErrorBanner = false,
}: QuestionScreenProps): ReactElement => {
  const [answers, setAnswers] = useState<readonly MbtiAnswer[]>(initialAnswers);
  // 이미지 로드 실패 상태 — 문항 ID별로 추적해야 문항이 바뀌었는데 이전 문항의 실패
  // 상태가 남아 새 문항의 정상 이미지까지 플레이스홀더로 가려버리는 버그를 막는다.
  const [failedImageQuestionId, setFailedImageQuestionId] = useState<string | null>(null);
  const progressVersionRef = useRef(initialProgressVersion);
  // 문항 단위 중복 탭 잠금 — 마지막으로 "처리 시작"한 문항 ID. 클릭 즉시(동기) 갱신되므로
  // 같은 렌더 프레임 안에서 같은 문항에 대한 두 번째 클릭은 이 값과 비교해 무시된다.
  const lastProcessedQuestionIdRef = useRef<string | null>(null);

  const currentIndex = answers.length;
  const currentQuestionId = questionOrder[currentIndex];
  const currentQuestion = currentQuestionId ? QUESTION_BY_ID.get(currentQuestionId) : undefined;

  const handleChoose = (choice: QuestionChoice): void => {
    if (!currentQuestion || !currentQuestionId) {
      return;
    }
    if (lastProcessedQuestionIdRef.current === currentQuestionId) {
      return; // 같은 문항에 대한 중복 탭 — 무시
    }
    lastProcessedQuestionIdRef.current = currentQuestionId;

    const nextAnswers: readonly MbtiAnswer[] = [
      ...answers,
      { questionId: currentQuestionId, selectedOptionId: choice.id },
    ];
    setAnswers(nextAnswers);

    progressVersionRef.current += 1;
    onProgressSave({
      sessionId,
      questionIndex: nextAnswers.length,
      answers: nextAnswers,
      progressVersion: progressVersionRef.current,
    });

    if (nextAnswers.length === TOTAL_QUESTIONS) {
      const { mbtiType } = scoreMbtiAnswers(nextAnswers);
      onComplete(mbtiType, nextAnswers);
    }
  };

  // 다음 문항으로 실제로 넘어가면(currentQuestionId 변경) 다음 문항에서 다시 탭할 수 있도록
  // 잠금을 해제한다. 초기 마운트 시에도 한 번 실행되어 잠금 상태를 currentQuestionId와
  // 동기화한다(문제 없음 — 아직 아무것도 처리되지 않았으므로).
  useEffect(() => {
    if (lastProcessedQuestionIdRef.current !== currentQuestionId) {
      lastProcessedQuestionIdRef.current = null;
    }
  }, [currentQuestionId]);

  if (!currentQuestion || !currentQuestionId) {
    // 20번째 답변 직후에는 onComplete가 상위 전환을 트리거하므로 이론상 도달하지 않는다.
    // 상위가 아직 전환 전인 렌더 타이밍을 대비한 방어적 렌더.
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl" aria-hidden="true">
          ✨
        </span>
        <p className="text-sm text-gray-500">결과를 계산하고 있어요...</p>
      </main>
    );
  }

  const order = optionOrder[currentQuestionId] ?? "AB";
  const displayedChoices: readonly [QuestionChoice, QuestionChoice] =
    order === "AB"
      ? currentQuestion.choices
      : [currentQuestion.choices[1], currentQuestion.choices[0]];

  const progressRatio = answers.length / TOTAL_QUESTIONS;
  const progressPercent = Math.round(progressRatio * 100);

  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 bg-gradient-to-b from-amber-50 to-white px-6 py-8">
      <div className="w-full max-w-sm">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={TOTAL_QUESTIONS}
          aria-valuenow={answers.length}
          aria-label={`진행 상태: ${answers.length} / ${TOTAL_QUESTIONS}문항`}
          className="h-3 w-full overflow-hidden rounded-full bg-amber-100"
        >
          <div
            className="h-full rounded-full bg-amber-500 transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-center text-sm font-medium text-gray-500">
          {answers.length} / {TOTAL_QUESTIONS}
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5">
        {/* 문항 상단 일러스트 — 정상 출제에서는 모든 활성 문항이 imagePath를 가지므로
         * 아래 플레이스홀더 분기는 실제로 노출되지 않는다. 이미지 로드 실패 같은 예외
         * 상황에서만 같은 크기의 🐾 플레이스홀더로 대체해 레이아웃이 깨지지 않게 하는
         * 방어적 fallback이다(questionBank.ts의 Question.imagePath 주석 참고). */}
        {currentQuestion.imagePath && failedImageQuestionId !== currentQuestion.id ? (
          <img
            key={currentQuestion.id}
            src={currentQuestion.imagePath}
            alt=""
            width={800}
            height={450}
            loading="eager"
            className="aspect-[16/9] w-full max-w-sm rounded-3xl border border-amber-100 bg-amber-50/60 object-contain shadow-sm"
            onError={() => setFailedImageQuestionId(currentQuestion.id)}
          />
        ) : (
          <div
            className="flex aspect-[16/9] w-full max-w-sm items-center justify-center rounded-3xl border border-amber-100 bg-amber-50/60 shadow-sm"
            aria-hidden="true"
          >
            <span className="text-5xl">🐾</span>
          </div>
        )}

        <h1 className="text-lg font-bold leading-snug text-gray-900 sm:text-xl">
          {currentQuestion.prompt}
        </h1>

        {/* 4지선다가 아닌 2지선다지만, 좌우가 아닌 세로 스택으로 배치해 문구가 길어져도
         * 모바일/태블릿에서 스크롤 없이(또는 최소 스크롤로) 두 보기 전체가 한 화면에 들어온다. */}
        <div className="grid w-full grid-cols-1 gap-3">
          {displayedChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => handleChoose(choice)}
              className={cn(
                "flex items-center gap-3 rounded-3xl border-2 border-amber-200 bg-white px-5 py-4",
                "text-left text-base font-semibold leading-snug text-gray-800 shadow-sm transition",
                "active:scale-95 active:border-amber-500 active:bg-amber-50",
              )}
            >
              <span className="text-2xl shrink-0" aria-hidden="true">
                {choice.id === "A" ? "🅰️" : "🅱️"}
              </span>
              <span>{choice.text}</span>
            </button>
          ))}
        </div>
      </div>

      {showSaveErrorBanner ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-4 z-10 mx-auto w-full max-w-sm px-4"
        >
          <div className="flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 text-sm text-gray-700 shadow-lg ring-1 ring-amber-200">
            <span aria-hidden="true">{MBTI_ERROR_CONTENT.progress_save_failed.emoji}</span>
            <span>{MBTI_ERROR_CONTENT.progress_save_failed.description}</span>
          </div>
        </div>
      ) : null}
    </main>
  );
};

export default QuestionScreen;
