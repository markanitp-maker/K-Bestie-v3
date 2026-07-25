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
 *
 * ## iOS Safari 전용 버그: 동물 이미지 누락 (2026-07-25 수정)
 * PC Chrome은 정상인데 iPhone Safari에서만 저장된 PNG에 동물 이미지가 빠지는 문제가
 * 재현됐다. `html-to-image`는 DOM을 SVG `<foreignObject>`로 직렬화해 캔버스에 그리는데,
 * WebKit(iOS Safari)은 이 과정에서 외부 URL(src)을 그대로 참조하는 `<img>`를 안정적으로
 * 페인트하지 못하는 알려진 한계가 있다 — 라이브러리 자체의 내장 이미지 임베딩
 * (fetch→data: URL 변환)이 iOS Safari의 fetch/CORS 처리 차이로 실패하거나 누락되는
 * 사례가 실제로 보고돼 있다. `inlineImagesForCapture`로 캡처 직전에 캡처 대상 내부의
 * 모든 `<img>` src를 직접 fetch해 `data:` URL로 선(先)치환하면, html-to-image 쪽 자체
 * 임베딩 로직에 기대지 않고 항상 캡처 결과에 픽셀이 포함된다. 화면에 보이는 실제
 * `<img>` 요소의 src를 캡처 순간에만 바꿨다가 캡처 직후(성공/실패 무관) 원래 src로
 * 되돌리므로, 화면 표시용 DOM 구조·사용자 경험은 전혀 바뀌지 않는다(같은 이미지라
 * 시각적으로도 깜빡임이 없다).
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

/**
 * 캡처 대상(`node`) 내부 모든 `<img>`가 실제로 화면에 그려질 준비(로드 완료 + 디코딩
 * 완료)가 될 때까지 기다린다. `html-to-image`는 DOM을 그대로 직렬화하므로, 이미지
 * 요소가 아직 로드 중이면(특히 결과 화면 진입 직후 캐릭터 이미지가 막 렌더링된 시점에
 * 바로 저장 버튼을 누르는 경우) 빈 칸으로 캡처된다 — 실제로 재현된 버그. 개별 이미지가
 * 실패해도(예: onError 폴백으로 이미 사라진 img) 전체 캡처를 막지 않고 로그만 남긴다.
 */
async function waitForImagesReady(node: HTMLElement): Promise<void> {
  const images = Array.from(node.querySelectorAll("img"));

  await Promise.all(
    images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      }
      try {
        await img.decode();
      } catch (decodeError) {
        console.error("[useResultScreenshot] 캡처 대상 이미지 디코딩 실패:", img.src, decodeError);
      }
    }),
  );
}

/** 이미지 URL을 fetch해 `data:` URL로 변환한다. 실패하면 null(호출부가 원본 src를 유지). */
async function toDataUrl(src: string): Promise<string | null> {
  try {
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("FileReader 실패"));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("[useResultScreenshot] 이미지 dataURL 변환 실패:", src, error);
    return null;
  }
}

/**
 * 캡처 대상(`node`) 내부 `<img>`의 src를 `data:` URL로 선치환하고, 원래 src로 되돌리는
 * 함수를 반환한다. 이미 `data:` URL이거나 변환에 실패한 이미지는 원본 src를 그대로 둔다
 * (변환 실패가 캡처 자체를 막지 않게 하기 위함 — html-to-image 자체 임베딩으로 폴백됨).
 */
async function inlineImagesForCapture(node: HTMLElement): Promise<() => void> {
  const images = Array.from(node.querySelectorAll("img"));
  const restores: Array<() => void> = [];

  await Promise.all(
    images.map(async (img) => {
      const originalSrc = img.src;
      if (!originalSrc || originalSrc.startsWith("data:")) {
        return;
      }
      const dataUrl = await toDataUrl(originalSrc);
      if (!dataUrl) {
        return;
      }
      img.src = dataUrl;
      restores.push(() => {
        img.src = originalSrc;
      });
    }),
  );

  return () => {
    for (const restore of restores) {
      restore();
    }
  };
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
      await waitForImagesReady(node);

      // iOS Safari 우회: 캡처 순간에만 <img> src를 data: URL로 바꾸고, 캡처 직후(성공/
      // 실패 무관) 반드시 원래 src로 되돌린다 — 화면 표시 구조는 그대로 유지된다.
      const restoreImages = await inlineImagesForCapture(node);
      let blob: Blob | null;
      try {
        // src가 data: URL로 바뀌면 새 로드 사이클이 시작되므로 다시 한번 로드/디코딩
        // 완료를 기다린다.
        await waitForImagesReady(node);

        blob = await toBlob(node, {
          pixelRatio: 2,
          cacheBust: true,
          backgroundColor: "#ffffff",
          // 외부 CDN(@import) 폰트 재임베딩 과정에서 iOS Safari가 겪는 fetch/CORS
          // 불안정성을 캡처 실패 경로에서 제외한다 — 텍스트는 이미 브라우저가 실제
          // 폰트로 렌더링한 상태이므로, 이 옵션은 캡처 결과물의 폰트 임베딩(재현
          // 정확도)에만 영향이 있고 이번 버그(동물 이미지 누락)와는 무관한 폴백 폭을
          // 넓히는 안전장치다.
          skipFonts: true,
        });
      } finally {
        restoreImages();
      }
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
