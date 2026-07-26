"use client";

/**
 * E1~E9 — 오류·복구 화면 공용 컴포넌트 (SPEC.md §2.2, §7)
 *
 * 9종 오류 kind(MbtiErrorKind)를 파라미터로 받아 동일한 레이아웃/톤으로 렌더링한다.
 * 공통 원칙(SPEC.md §7): "메인으로 돌아가기" 버튼은 예외 없이 항상 렌더링한다
 * (kind와 무관하게, 아래 JSX에서 조건 분기 없이 고정 렌더).
 *
 * 재시도(onRetry)는 kind별 카피(lib/mbti/errorKinds.ts)에 `retryLabel`이 정의된
 * 경우에만 노출한다. 재시도의 구체적 동작(예: 세션 생성 idempotency key 재사용 여부)은
 * 호출부(MbtiPlayScreen 등) 책임이며 이 컴포넌트는 관여하지 않는다.
 */

import type { ReactElement } from "react";

import { MBTI_ERROR_CONTENT, type MbtiErrorKind } from "@/lib/mbti/errorKinds";
import { cn } from "@/lib/cn";

export interface ErrorScreenProps {
  /** SPEC.md §7의 9종 오류 중 하나 */
  kind: MbtiErrorKind;
  /** 항상 제공되는 "메인으로 돌아가기" 콜백. 실제 postMessage 기반 모달 닫기는
   * US-013(postMessage 배선) 스코프 — 지금은 콜백 계약만 고정한다. */
  onReturnToMain: () => void;
  /** 있으면 kind별 retryLabel과 함께 재시도 버튼을 노출한다. 없으면(또는 kind에
   * retryLabel이 없으면) 재시도 버튼을 렌더링하지 않는다. */
  onRetry?: () => void;
  /** 재시도 진행 중 여부(버튼 비활성화 + 라벨 변경용). onRetry 없을 땐 무시된다. */
  retrying?: boolean;
}

const ErrorScreen = ({
  kind,
  onReturnToMain,
  onRetry,
  retrying = false,
}: ErrorScreenProps): ReactElement => {
  const content = MBTI_ERROR_CONTENT[kind];
  const showRetry = Boolean(onRetry && content.retryLabel);

  return (
    <main
      role="alert"
      data-mbti-error-kind={kind}
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-rose-50 to-white px-6 py-10 text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <span className="text-6xl" aria-hidden="true">
          {content.emoji}
        </span>
        <h1 className="text-2xl font-bold text-k-text-primary">{content.title}</h1>
        <p className="max-w-sm text-base leading-relaxed text-k-text-secondary">{content.description}</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        {showRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className={cn(
              "w-full rounded-full bg-k-orange px-8 py-4 text-lg font-bold text-white shadow-md transition active:scale-95",
              "disabled:cursor-not-allowed disabled:bg-k-disabled disabled:active:scale-100",
            )}
          >
            {retrying ? "다시 시도하는 중..." : content.retryLabel}
          </button>
        ) : null}

        {/* SPEC.md §7 공통 원칙: 모든 오류 화면에 "메인으로 돌아가기" 버튼은 예외 없음 */}
        <button
          type="button"
          onClick={onReturnToMain}
          className={cn(
            "w-full rounded-full border-2 px-8 py-4 text-lg font-bold transition active:scale-95",
            showRetry
              ? "border-k-border bg-white text-k-text-secondary"
              : "border-k-orange bg-white text-k-orange",
          )}
        >
          메인으로 돌아가기
        </button>
      </div>
    </main>
  );
};

export default ErrorScreen;
