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
 * ## iOS Safari 전용 버그: 동물 이미지 누락 (2026-07-26, 이식)
 *
 * 이전 구현은 캡처 직전 `<img>` src를 fetch→dataURL로 수동 치환하는 방식이었는데,
 * 자매 프로젝트(`/mnt/e/VibeCoding/mbti`)에서 동일 버그를 실기기로 재현해 근본 원인을
 * 추적한 결과 그 방식은 효과가 없었다 — `html-to-image`는 애초에 모든 `<img>`를
 * 자동으로 dataURL로 임베딩하므로(`embed-images.js`) 수동 치환은 라이브러리가 이미
 * 하던 일의 중복일 뿐이었다.
 *
 * 진짜 파이프라인(`html-to-image`의 `toCanvas`, `es/index.js`):
 * 1. DOM을 `<foreignObject>`로 감싼 SVG 문자열로 직렬화(내부 이미지는 이미 dataURL로
 *    임베딩됨, `foreignObject`에는 `externalResourcesRequired="true"` 지정).
 * 2. 그 SVG 문자열을 **다시 하나의 `<img>`로 로드**한다(`createImage`) —
 *    `onload` → `img.decode()` → `requestAnimationFrame` **딱 1번**만 기다리고
 *    "준비됨"으로 판정한다.
 * 3. 그 이미지를 캔버스에 `drawImage`.
 *
 * WebKit(iOS Safari)은 `foreignObject`의 `externalResourcesRequired`를 Chrome만큼
 * 엄격히 지키지 않는 것으로 알려져 있다 — 바깥쪽 SVG-as-image의 `onload`가, 그 안의
 * 이미지가 실제로 래스터화(픽셀로 그려짐)되기 **전에** 먼저 발생할 수 있다. 라이브러리가
 * 넣어둔 rAF 1번만으로는 이 차이를 못 따라잡아, 아직 다 그려지지 않은 프레임을 캔버스가
 * 캡처해버린다(동물 이미지가 통째로 빈 칸). PC Chrome(Blink)은 이 시점 차이가 없어 항상
 * 정상이었다 — CORS도, 이미지 로딩 자체도 문제가 아니라 **캔버스에 그리기 직전 찰나의
 * 렌더링 유예 시간 부족**이 원인이었다.
 *
 * ### 수정
 * 라이브러리의 고수준 `toBlob()`(내부적으로 `createImage` + 즉시 `drawImage`를 실행) 대신
 * export된 저수준 `toSvg()`만 가져다 쓰고, "SVG를 이미지로 로드 → 캔버스에 그리기" 사이
 * 구간을 직접 구현해 `requestAnimationFrame` 2번 + 짧은 `setTimeout`으로 여유 시간을
 * 추가로 확보한 뒤에만 `drawImage`한다. DOM 구조·원본 화면의 이미지 렌더링은 전혀
 * 건드리지 않는다(html-to-image의 `toSvg` 자체가 내부적으로 노드를 복제해서 처리한다).
 */

import { useCallback, useRef, useState } from "react";
import { toSvg } from "html-to-image";

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
const PIXEL_RATIO = 2;
/** rAF 2번 이후 추가로 기다리는 시간(ms) — iOS Safari의 foreignObject 래스터화 지연 대응.
 * PC Chrome에서는 사실상 즉시 통과하므로 체감 지연이 없다. */
const SAFARI_SETTLE_DELAY_MS = 120;

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`SVG 이미지 로드 실패: ${src.slice(0, 64)}...`));
    img.src = src;
  });
}

/**
 * `img`가 실제로 픽셀까지 그려졌다고 신뢰할 수 있을 때까지 기다린다. `decode()`가
 * 있으면 우선 사용하고, 그 뒤 rAF 2번 + 짧은 setTimeout으로 iOS Safari의 foreignObject
 * 래스터화 지연에 대한 여유 시간을 추가로 확보한다(단일 rAF만으로는 재현되는 문제였음
 * — 위 파일 상단 설명 참고).
 */
async function waitUntilPaintSettled(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === "function") {
    try {
      await img.decode();
    } catch (decodeError) {
      console.error("[useResultScreenshot] SVG 이미지 디코딩 실패, 계속 진행:", decodeError);
    }
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, SAFARI_SETTLE_DELAY_MS);
  });
}

/** `node`를 PNG Blob으로 캡처한다. 원본 DOM은 전혀 수정하지 않는다(`toSvg`가 내부적으로
 * 노드를 복제해 처리함). */
async function captureNodeAsBlob(node: HTMLElement): Promise<Blob | null> {
  const svgDataUrl = await toSvg(node, {
    cacheBust: true,
    backgroundColor: "#ffffff",
    // 외부 CDN 폰트 재임베딩 과정의 iOS Safari fetch/CORS 불안정성을 캡처 실패 경로에서
    // 제외하는 방어적 안전장치(이번 버그와는 별개, 폰트 임베딩 정확도에만 영향).
    skipFonts: true,
  });

  const img = await loadImage(svgDataUrl);
  await waitUntilPaintSettled(img);

  const width = node.offsetWidth || img.naturalWidth;
  const height = node.offsetHeight || img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width * PIXEL_RATIO;
  canvas.height = height * PIXEL_RATIO;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
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
      const blob = await captureNodeAsBlob(node);
      if (!blob) {
        throw new Error("결과 카드 캡처 실패 — blob 생성 안 됨");
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
