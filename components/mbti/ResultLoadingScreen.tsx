"use client";

/**
 * S4 — 결과 계산 로딩 화면 (SPEC.md §2.2, §11-7)
 *
 * "짧은 연출(캐릭터 등장 애니메이션)"만 담당한다. MBTI 판정(`scoreMbtiAnswers`)은
 * 이미 동기 함수라 S3→S4 전환 시점에는 유형이 이미 확정되어 있으므로, 이 화면은
 * 비동기 계산을 "기다리는" 화면이 아니라 **시간 기반(time-based)** 연출이다.
 * `durationMs`(기본 1500ms)가 지나면 `onLoadingComplete`를 호출해 상위(S5)로 넘어간다.
 *
 * 애니메이션은 외부 라이브러리 없이 CSS `@keyframes`만 사용한다(app/globals.css의
 * `mbti-character-pop` / `mbti-bounce-dot` 참조).
 */

import { useEffect, type ReactElement } from "react";

export interface ResultLoadingScreenProps {
  /** 연출 노출 시간(ms). 이 시간이 지나면 onLoadingComplete가 호출된다. 기본값 1500ms. */
  durationMs?: number;
  /** 연출이 끝났을 때 호출된다 (→ 상위 상태 머신에서 S5 결과 화면으로 전환). */
  onLoadingComplete: () => void;
}

const DEFAULT_DURATION_MS = 1500;

const ResultLoadingScreen = ({
  durationMs = DEFAULT_DURATION_MS,
  onLoadingComplete,
}: ResultLoadingScreenProps): ReactElement => {
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      onLoadingComplete();
    }, durationMs);

    return () => window.clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 매 렌더마다 새 타이머가 잡히지 않도록 durationMs/onLoadingComplete 변경 시에만 재실행
  }, [durationMs, onLoadingComplete]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gradient-to-b from-amber-50 to-white px-6 py-10 text-center">
      <span
        className="mbti-loading-character text-7xl"
        aria-hidden="true"
      >
        🐾
      </span>
      <p className="text-lg font-bold text-gray-900">어떤 동물 친구일까...?</p>
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span className="sr-only">결과를 계산하는 중입니다</span>
        <span className="mbti-loading-dot h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden="true" />
        <span
          className="mbti-loading-dot h-2.5 w-2.5 rounded-full bg-amber-400"
          style={{ animationDelay: "0.15s" }}
          aria-hidden="true"
        />
        <span
          className="mbti-loading-dot h-2.5 w-2.5 rounded-full bg-amber-400"
          style={{ animationDelay: "0.3s" }}
          aria-hidden="true"
        />
      </div>
    </main>
  );
};

export default ResultLoadingScreen;
