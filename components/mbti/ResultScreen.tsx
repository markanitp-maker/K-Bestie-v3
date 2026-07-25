"use client";

/**
 * S5 — 결과 화면 (SPEC.md §2.1 step 7, §2.2, §3.2, §3.3, §11-8)
 *
 * `mbtiType`으로 `TYPE_PROFILES`(lib/data/typeProfiles.ts)를 조회해 캐릭터/유형명/
 * 설명/강점/어울리는 친구를 렌더링한다. 캐릭터 이미지는 `profile.imagePath`를
 * `<img>`로 렌더링하되, 실제 이미지 에셋이 아직 없으므로(SPEC.md §3.2 — Imagen 4
 * 생성은 승인 후 별도 실행) `onError` 시 이모지 플레이스홀더 박스로 폴백한다
 * (SPEC.md §7 "캐릭터 이미지 로드 실패 플레이스홀더 폴백"). 이 폴백은 전체화면
 * ErrorScreen(kind="character_image_failed", components/mbti/ErrorScreen.tsx, US-014)과
 * 의도적으로 다르다 — 이미지 하나가 깨졌다고 결과 화면 전체를 막으면 "무한 로딩 금지"
 * 원칙의 취지(과잉 차단 금지)에 어긋나므로 인라인 대체만 한다. 다만 톤/카피는
 * `MBTI_ERROR_CONTENT.character_image_failed`(lib/mbti/errorKinds.ts)와 동일한
 * "공유 오류 UI 언어"를 따른다(아래 aria-label 참고).
 *
 * ## US-009(스크린샷 저장)를 위한 DOM 계약 — 중요
 * `id="mbti-result-card"`가 붙은 컨테이너가 **캡처 대상 전체**다(SPEC.md §3.3
 * "캡처 대상은 결과 카드 영역만(닫기 버튼·안내 배너 제외)"). 이 컨테이너 안에는
 * 캐릭터 이미지/유형명/설명/강점/어울리는 친구만 들어있고, 아래는 **의도적으로
 * 컨테이너 밖에** 둔다:
 *   - [📸 스크린샷 저장] 버튼 자체(저장 버튼이 저장된 스크린샷 안에 함께 찍히는
 *     것을 방지하기 위한 설계 선택 — 스펙이 명시적으로 요구하진 않지만, 닫기
 *     버튼·안내 배너 제외와 같은 취지로 함께 제외했다. 이후 스토리에서 이 판단을
 *     바꾸고 싶다면 이 컴포넌트의 버튼 위치만 옮기면 된다.)
 *   - "⚠️ 꼭 저장해! 다음에 오면 사라져" 안내 배너
 *   - [닫기] 버튼
 * US-009는 `document.getElementById("mbti-result-card")`(또는 동등한 ref)를
 * 캡처 라이브러리에 넘기면 된다.
 *
 * ## US-009 구현 노트
 * 실제 캡처(`html-to-image`) + Web Share API 우선/다운로드 폴백 로직은
 * `hooks/useResultScreenshot.ts`에 있다(이 컴포넌트가 `#mbti-result-card`의 실제
 * DOM 소유자이므로 캡처 트리거는 여기서 건다). `onScreenshotRequest` prop은 여전히
 * 호출되어 부모(MbtiPlayScreen)가 "스크린샷 요청 시작"을 알 수 있게 유지한다(추후
 * 분석 이벤트 배선 등에 쓸 수 있는 훅 포인트).
 */

import { useState, type ReactElement } from "react";

import { useResultScreenshot } from "@/hooks/useResultScreenshot";
import { TYPE_PROFILES } from "@/lib/data/typeProfiles";
import type { MbtiType } from "@/lib/data/mbtiTypes";
import { MBTI_ERROR_CONTENT } from "@/lib/mbti/errorKinds";
import { cn } from "@/lib/cn";

const RESULT_CARD_ELEMENT_ID = "mbti-result-card";

export interface ResultScreenProps {
  /** 판정 확정된 MBTI 유형. `TYPE_PROFILES`에서 프로필을 조회하는 키로 쓰인다. */
  mbtiType: MbtiType;
  /**
   * [📸 스크린샷 저장] 클릭 시 호출된다. 실제 캡처(Web Share API 우선 + 다운로드
   * 폴백, SPEC.md §3.3)는 `useResultScreenshot` 훅이 이 컴포넌트 안에서 처리하며,
   * 이 prop은 부모에게 "요청이 시작됨"을 알리는 부가 훅 포인트로 계속 호출된다.
   */
  onScreenshotRequest: () => void;
  /**
   * [닫기] 클릭 시 호출된다. 실제 모달 닫기/postMessage(`PLAY_CLOSE_REQUEST`)
   * 배선(SPEC.md §5)은 US-013 스코프라 여기서는 스텁 연결만 한다.
   */
  onClose: () => void;
}

const ResultScreen = ({ mbtiType, onScreenshotRequest, onClose }: ResultScreenProps): ReactElement => {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const profile = TYPE_PROFILES[mbtiType];
  const { status: screenshotStatus, errorMessage: screenshotError, captureAndSave } = useResultScreenshot();
  const isCapturing = screenshotStatus === "capturing";

  const handleScreenshotClick = (): void => {
    if (isCapturing) {
      return;
    }
    onScreenshotRequest();
    void captureAndSave(RESULT_CARD_ELEMENT_ID);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center gap-5 bg-gradient-to-b from-amber-50 to-white px-6 py-10 text-center">
      {/* 캡처 대상(US-009): 캐릭터/유형명/설명/강점/어울리는 친구만 포함 */}
      <div
        id={RESULT_CARD_ELEMENT_ID}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white/80 p-6 shadow-md"
      >
        {imageLoadFailed ? (
          <div
            className="flex h-40 w-40 items-center justify-center rounded-full bg-amber-100 text-6xl"
            role="img"
            aria-label={`${profile.animalName} ${MBTI_ERROR_CONTENT.character_image_failed.title}`}
          >
            🐾
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- 이미지 로드 실패 시 onError 폴백이 필요해 next/image 대신 plain img 사용
          <img
            src={profile.imagePath}
            alt={`${profile.animalName} 캐릭터`}
            className="h-40 w-40 rounded-full object-cover"
            onError={() => setImageLoadFailed(true)}
          />
        )}

        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-semibold text-amber-600">{mbtiType}</p>
          <h1 className="text-2xl font-bold text-gray-900">{profile.animalName}</h1>
          {/* 결과는 진단이나 고정된 성격이 아니라 이번 놀이 회차에서 나타난 경향임을
           * 분명히 한다(2026-07-25 200문항뱅크 개편 요구사항) — 다음에 다시 하면 문항
           * 구성이 달라 다른 결과가 나올 수 있다는 점도 함께 안내한다. */}
          <p className="text-xs text-gray-400">오늘 답변에서 나온 경향이에요. 다음에 또 해보면 달라질 수도 있어요!</p>
        </div>

        <p className="text-base leading-relaxed text-gray-700">{profile.childDescription}</p>

        <div className="w-full text-left">
          <h2 className="text-sm font-bold text-gray-500">나의 강점</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {profile.strengths.map((strength) => (
              <li key={strength} className="text-sm text-gray-700">
                ✨ {strength}
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full text-left">
          <h2 className="text-sm font-bold text-gray-500">어울리는 친구</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{profile.compatibleFriends}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleScreenshotClick}
        disabled={isCapturing}
        aria-busy={isCapturing}
        className={cn(
          "w-full max-w-sm rounded-full bg-amber-500 px-8 py-4 text-lg font-bold text-white shadow-md transition active:scale-95",
          isCapturing && "cursor-not-allowed opacity-70 active:scale-100",
        )}
      >
        {isCapturing ? "저장 중..." : "📸 스크린샷 저장"}
      </button>

      {screenshotStatus === "error" && screenshotError !== null ? (
        <p role="alert" className="max-w-sm text-sm font-semibold text-red-500">
          ❌ {screenshotError}
        </p>
      ) : null}

      <p role="alert" className="max-w-sm text-sm font-semibold text-red-500">
        ⚠️ 꼭 저장해! 다음에 오면 사라져
      </p>

      <button
        type="button"
        onClick={onClose}
        className={cn(
          "w-full max-w-sm rounded-full border-2 border-amber-300 bg-white px-8 py-4 text-lg font-bold text-amber-600 transition active:scale-95",
        )}
      >
        닫기
      </button>
    </main>
  );
};

export default ResultScreen;
