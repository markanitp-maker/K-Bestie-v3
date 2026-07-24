"use client";

/**
 * S3 — 문항 화면 (SPEC.md §2.1 step 5, §2.2, §11-6)
 *
 * 16문항(QUESTION_BANK)을 `order`(1~16) 순서로 한 번에 하나씩 보여준다.
 * 선택지를 고르면 즉시 다음 문항으로 넘어간다(수동 "다음" 버튼 없음).
 * 상단 진행바는 `답변수 / 16`을 표시한다.
 * 16번째 답변 직후 `scoreMbtiAnswers`(US-003, AI 무관 순수 함수)로 유형을 확정하고
 * `onComplete`로 상위(상태 머신)에 결과를 넘긴다 — 이 화면은 S4/S5(결과 계산·결과
 * 화면)를 렌더링하지 않는다(별도 스토리 스코프).
 *
 * 실제 캐릭터 이미지(Imagen 4, §3.2)는 아직 생성 전이라 문항 축별 이모지로
 * 대체한다. `imagePrompt`가 실제 이미지 경로로 교체되면 이 자리만 바꾸면 된다.
 *
 * 진행 저장 실패 처리(SPEC.md §7, US-014): 이 화면은 진행 저장 API를 직접 호출하지
 * 않는다(`onProgressSave`는 여전히 fire-and-forget 이벤트 발행일 뿐이고, 실제 호출·실패
 * 분류는 상위 `MbtiPlayScreen`이 담당한다 — `classifyProgressSaveFailure` 참고). 세션/
 * 인증 자체가 무효화된 치명적 실패는 상위가 전체화면 ErrorScreen으로 전환하며 이 화면을
 * 언마운트하므로 여기서 처리할 필요가 없다. 그 외 일시적 저장 실패만 `showSaveErrorBanner`
 * prop으로 전달받아 하단의 비차단 배너로 알린다 — 배너가 떠 있어도 답변/문항 이동은 전혀
 * 막히지 않는다("무한 로딩 금지"), 이미 수집한 `answers`도 그대로 유지된다("진행 상태
 * 삭제 금지").
 */

import { useRef, useState, type ReactElement } from "react";

import { QUESTION_BANK, type Question, type QuestionChoice } from "@/lib/data/questionBank";
import type { MbtiType } from "@/lib/data/mbtiTypes";
import { MBTI_ERROR_CONTENT } from "@/lib/mbti/errorKinds";
import { scoreMbtiAnswers, type MbtiAnswer } from "@/lib/mbti/scoreResult";
import { cn } from "@/lib/cn";

/** 문항 축(axis)별 플레이스홀더 이모지. 실제 캐릭터 이미지는 별도 스토리에서 교체. */
const AXIS_PLACEHOLDER_EMOJI: Record<Question["axis"], string> = {
  EI: "🎈",
  SN: "🎨",
  TF: "💛",
  JP: "🗓️",
};

/** 화면 노출 순서(1~16) 기준으로 정렬된 문항 목록. */
const SORTED_QUESTIONS: readonly Question[] = [...QUESTION_BANK].sort(
  (a, b) => a.order - b.order,
);

/**
 * 진행 상태 저장 지점 — 매 답변 직후 한 번씩 호출된다.
 *
 * ⚠️ 통합 계약(다음 스토리에서 실제 서버 저장 API가 이 지점에 연결된다):
 * - `sessionId`: 이 문항 화면이 속한 놀이 세션 식별자(`ActiveMbtiSession.sessionId`).
 * - `questionIndex`: 방금 답변을 완료한 문항의 노출 순서(1~16, `Question.order`와 동일값).
 *   `PlayMessage.progressIndex`(lib/play-protocol.ts)에 대응된다.
 * - `answers`: 지금까지 수집된 답변 전체(제출 순서 = 문항 순서).
 * - `progressVersion`: 이 문항 화면 인스턴스 안에서 저장 호출마다 1씩 증가하는
 *   단조 증가 카운터(첫 저장 호출 = 1). `PlayMessage.progressVersion`에 대응되며,
 *   서버 저장 API가 붙으면 오래된(값이 더 작은) 요청이 최신 진행 상태를 덮어쓰지
 *   않도록 이 값으로 순번/버전을 검증한다(SPEC.md §4 "진행 상태 저장에 순번/버전 포함").
 */
export interface MbtiProgressSaveEvent {
  sessionId: string;
  questionIndex: number;
  answers: readonly MbtiAnswer[];
  progressVersion: number;
}

/** 이어하기 시 문항 화면을 재개할 저장된 진행 상태(US-011, 서버 `progress_state`에서 유래). */
export interface QuestionScreenInitialProgress {
  /** 지금까지 수집된 답변(이 값의 길이만큼 문항을 건너뛰고 이어서 진행한다). */
  answers: readonly MbtiAnswer[];
  /** 마지막으로 저장된 progressVersion. 다음 저장 호출이 이 값보다 반드시 큰 값을 쓰도록
   * 이어서 증가시켜야 서버의 버전 가드(오래된 요청 거부)에 걸리지 않는다. */
  progressVersion: number;
}

export interface QuestionScreenProps {
  /** 현재 놀이 세션 식별자. `onProgressSave` 이벤트에 그대로 실려 전달된다. */
  sessionId: string;
  /**
   * 이어하기(S2 → S3)로 진입했을 때 재개할 진행 상태. 신규 시작이면 `null`/`undefined`(항상
   * 문항 1부터 시작).
   */
  initialProgress?: QuestionScreenInitialProgress | null;
  /**
   * 매 답변 직후 호출되는 진행 저장 지점(SPEC.md §2.1 step 5 "매 답변 서버 진행
   * 저장"). 실제 서버 API는 별도 스토리에서 연결되며, 지금은 no-op 스텁을
   * 전달해도 동작에 문제 없다.
   */
  onProgressSave: (event: MbtiProgressSaveEvent) => void;
  /** 16문항 전부 답변 + 판정 완료 시 호출된다. S4(결과 계산)는 상위 컴포넌트 책임. */
  onComplete: (mbtiType: MbtiType, answers: readonly MbtiAnswer[]) => void;
  /** 상위(`MbtiPlayScreen`)가 최근 진행 저장이 일시적으로 실패했다고 판단했을 때 true.
   * SPEC.md §7 "진행 저장 실패"의 비차단 인라인 표시 트리거 — true여도 화면/입력은
   * 전혀 막히지 않는다(US-014). 세션/인증 자체가 무효화된 치명적 실패는 상위가 이
   * 컴포넌트를 언마운트하고 전체화면 ErrorScreen으로 전환하므로 이 prop과 무관하다. */
  showSaveErrorBanner?: boolean;
}

const TOTAL_QUESTIONS = SORTED_QUESTIONS.length;

const QuestionScreen = ({
  sessionId,
  initialProgress,
  onProgressSave,
  onComplete,
  showSaveErrorBanner = false,
}: QuestionScreenProps): ReactElement => {
  const [answers, setAnswers] = useState<readonly MbtiAnswer[]>(
    () => initialProgress?.answers ?? [],
  );
  // 이어하기 시 마지막 저장 버전부터 이어서 증가시킨다 — 0부터 다시 시작하면 서버의 버전
  // 가드(진행 저장 API, US-011)가 재개 후 첫 저장을 "오래된 요청"으로 오인해 무시할 수 있다.
  const progressVersionRef = useRef(initialProgress?.progressVersion ?? 0);

  const currentIndex = answers.length;
  const currentQuestion = SORTED_QUESTIONS[currentIndex];

  const handleChoose = (choice: QuestionChoice): void => {
    if (!currentQuestion) {
      return;
    }

    const nextAnswers: readonly MbtiAnswer[] = [
      ...answers,
      { questionId: currentQuestion.id, selectedPole: choice.pole },
    ];
    setAnswers(nextAnswers);

    progressVersionRef.current += 1;
    onProgressSave({
      sessionId,
      questionIndex: currentQuestion.order,
      answers: nextAnswers,
      progressVersion: progressVersionRef.current,
    });

    if (nextAnswers.length === TOTAL_QUESTIONS) {
      const mbtiType = scoreMbtiAnswers(nextAnswers);
      onComplete(mbtiType, nextAnswers);
    }
  };

  if (!currentQuestion) {
    // 16번째 답변 직후에는 onComplete가 상위 전환을 트리거하므로 이론상 도달하지
    // 않는다. 상위가 아직 전환 전인 렌더 타이밍을 대비한 방어적 렌더.
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl" aria-hidden="true">
          ✨
        </span>
        <p className="text-sm text-gray-500">결과를 계산하고 있어요...</p>
      </main>
    );
  }

  const progressRatio = answers.length / TOTAL_QUESTIONS;
  const progressPercent = Math.round(progressRatio * 100);

  return (
    <main className="flex min-h-dvh flex-col items-center gap-8 bg-gradient-to-b from-amber-50 to-white px-6 py-8">
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

      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <span className="text-6xl" aria-hidden="true">
            {AXIS_PLACEHOLDER_EMOJI[currentQuestion.axis]}
          </span>
          <h1 className="text-xl font-bold text-gray-900">{currentQuestion.prompt}</h1>
        </div>

        <div className="grid w-full grid-cols-1 gap-4">
          {currentQuestion.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => handleChoose(choice)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-3xl border-2 border-amber-200 bg-white px-6 py-5",
                "text-center text-base font-semibold text-gray-800 shadow-sm transition",
                "active:scale-95 active:border-amber-500 active:bg-amber-50",
              )}
            >
              <span className="text-3xl" aria-hidden="true">
                {choice.id === "A" ? "🅰️" : "🅱️"}
              </span>
              {choice.text}
            </button>
          ))}
        </div>
      </div>

      {showSaveErrorBanner ? (
        // 비차단 인라인 배너(SPEC.md §7 "진행 저장 실패") — 문항 UI를 가리지 않게 하단
        // 고정 위치에 띄우고, 답변 진행을 막지 않는다. 답은 이미 로컬 answers에 보존되어
        // 있고 다음 답변 시 자동으로 다시 저장을 시도한다.
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
