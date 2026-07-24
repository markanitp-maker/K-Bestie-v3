"use client";

/**
 * `/play/mbti` — MBTI 놀이 네이티브 페이지.
 *
 * 세션 생성·황금열쇠 차감은 app/child/play/page.tsx의 기존 공용 놀이 모달 흐름
 * (/api/play/consume)이 전담한다. 그 결과(sessionId/childId)는 URL 쿼리 파라미터가
 * 아니라 sessionStorage(`k_mbti_active_session`)로 이 페이지에 핸드오프한다 —
 * playSessionId는 쿠키 인증 없이 진행 저장/완료 API에 쓰기를 허용하는 캐퍼빌리티
 * 토큰이므로, URL(브라우저 히스토리·서버 접근 로그에 남는다)에 싣지 않기 위함이다.
 * 이어하기 여부 자체는 이 페이지가 신뢰하지 않고 MbtiPlayScreen이 매번 서버
 * (/api/mbti/session)에서 재확인한다.
 */

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import MbtiPlayScreen from "@/components/mbti/MbtiPlayScreen";
import { readMbtiSessionHandoff, type MbtiSessionHandoff } from "@/lib/play/mbtiSessionHandoff";

const MbtiPlayPage = (): ReactElement => {
  const router = useRouter();
  const [session, setSession] = useState<MbtiSessionHandoff | null | undefined>(undefined);

  useEffect(() => {
    setSession(readMbtiSessionHandoff());
  }, []);

  const handleClose = (): void => {
    router.push("/child/play");
  };

  if (session === undefined) {
    // sessionStorage 판독 전(마운트 직후 1틱) — 무한 로딩 아님, 다음 렌더에서 즉시 확정된다.
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl" aria-hidden="true">
          🐾
        </span>
        <p className="text-sm text-gray-500">놀이를 준비하고 있어요...</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl" aria-hidden="true">
          🧭
        </span>
        <h1 className="text-xl font-bold text-gray-900">잘못된 주소로 들어왔어요</h1>
        <p className="max-w-sm text-sm leading-relaxed text-gray-600">
          이 화면은 놀이 목록에서만 열 수 있어요. 메인 화면으로 돌아가 줘.
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="w-full max-w-xs rounded-full border-2 border-amber-300 bg-white px-8 py-4 text-lg font-bold text-amber-600 transition active:scale-95"
        >
          메인으로 돌아가기
        </button>
      </main>
    );
  }

  return (
    <MbtiPlayScreen
      sessionId={session.sessionId}
      childId={session.childId}
      onClose={handleClose}
    />
  );
};

export default MbtiPlayPage;
