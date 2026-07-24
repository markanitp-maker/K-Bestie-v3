"use client";

/**
 * US-009 — 결과 카드 스크린샷 저장 훅 (SPEC.md §3.3, §11-9)
 *
 * `elementId`로 지정된 DOM 서브트리만 `html-to-image`로 PNG化한다(ResultScreen.tsx의
 * `#mbti-result-card` 계약 — 저장 버튼·안내 배너·닫기 버튼은 그 컨테이너 밖에 있으므로
 * 자동으로 캡처 대상에서 제외된다).
 *
 * 흐름:
 * 1. Web Share API 우선 — `navigator.canShare({ files: [...] })`로 "파일 공유"가 실제로
 *    지원되는지 확인한다(`navigator.share` 존재만으로는 파일 공유 가능 여부를 보장하지
 *    않는 브라우저가 있어 `canShare` 결과를 신뢰한다). 보안 컨텍스트(HTTPS/localhost)가
 *    아니면 애초에 시도하지 않는다.
 * 2. 다운로드 폴백 — Web Share 미지원이거나 공유가 실패하면(사용자 취소 제외)
 *    `<a download>` 클릭으로 표준 브라우저 다운로드를 트리거한다.
 * 3. 캡처 자체가 실패하면(타인티드 캔버스, 미지원 브라우저 등) 화면을 크래시시키지 않고
 *    `status: "error"` + `errorMessage`로 호출부가 인라인 오류를 보여줄 수 있게 한다.
 *
 * 동시 캡처 방지: `inFlightRef`로 캡처 진행 중 재호출을 무시한다(호출부의 버튼
 * disabled와 별개로 훅 레벨에서도 중복 트리거를 막기 위한 이중 안전장치).
 */

import { useCallback, useRef, useState } from "react";
import { toBlob } from "html-to-image";

export type ResultScreenshotStatus = "idle" | "capturing" | "error";

export interface UseResultScreenshotResult {
  /** 현재 캡처 진행 상태. "capturing"일 때 호출부는 버튼을 비활성화해야 한다. */
  status: ResultScreenshotStatus;
  /** status가 "error"일 때 사용자에게 보여줄 메시지. 그 외엔 null. */
  errorMessage: string | null;
  /** 지정한 elementId의 DOM을 캡처해 공유/다운로드까지 처리한다. */
  captureAndSave: (elementId: string) => Promise<void>;
}

const SCREENSHOT_FILE_NAME = "mbti-result.png";
const CAPTURE_FAILURE_MESSAGE = "스크린샷 저장에 실패했어요. 다시 시도해줘.";
const ELEMENT_NOT_FOUND_MESSAGE = "저장할 결과 화면을 찾을 수 없어요. 다시 시도해줘.";

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

/** `navigator.share`뿐 아니라 "파일 공유"가 실제로 가능한지까지 확인한다. */
function canShareFile(file: File): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return false;
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = SCREENSHOT_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 다운로드 트리거는 클릭 이벤트를 동기적으로 발생시키지만, 브라우저가 실제로 다운로드를
  // 시작하는 시점은 비동기이므로 즉시 revoke하지 않고 여유를 둔다.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export function useResultScreenshot(): UseResultScreenshotResult {
  const [status, setStatus] = useState<ResultScreenshotStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const captureAndSave = useCallback(async (elementId: string): Promise<void> => {
    if (inFlightRef.current) {
      return;
    }

    const node = document.getElementById(elementId);
    if (!node) {
      setStatus("error");
      setErrorMessage(ELEMENT_NOT_FOUND_MESSAGE);
      return;
    }

    inFlightRef.current = true;
    setStatus("capturing");
    setErrorMessage(null);

    try {
      const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true });
      if (!blob) {
        throw new Error("html-to-image toBlob returned null");
      }

      const file = new File([blob], SCREENSHOT_FILE_NAME, { type: "image/png" });

      if (canShareFile(file)) {
        try {
          await navigator.share({ files: [file] });
          setStatus("idle");
          return;
        } catch (shareError) {
          if (isAbortError(shareError)) {
            // 사용자가 공유시트를 직접 취소한 경우 — 오류가 아니라 정상 취소이므로
            // 다운로드 폴백으로 넘어가지 않고 조용히 idle로 되돌린다.
            setStatus("idle");
            return;
          }
          console.error("[useResultScreenshot] Web Share 실패, 다운로드로 폴백:", shareError);
          // 공유 자체가 실패하면(취소가 아닌 다른 사유) 아래 다운로드 폴백으로 계속 진행
        }
      }

      downloadBlob(blob);
      setStatus("idle");
    } catch (error) {
      console.error("[useResultScreenshot] 결과 카드 캡처 실패:", error);
      setStatus("error");
      setErrorMessage(CAPTURE_FAILURE_MESSAGE);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  return { status, errorMessage, captureAndSave };
}
