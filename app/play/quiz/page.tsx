"use client";

/**
 * `/play/quiz` — 퀴즈마스터 놀이 네이티브 페이지 (requests/021).
 *
 * app/play/mbti/page.tsx와 완전히 동일한 패턴: 황금열쇠 차감+handoff token 발급은
 * app/child/play/page.tsx의 공용 놀이 모달 흐름(/api/quiz/start-handoff)이 전담하고,
 * 그 결과(token/childId)를 sessionStorage(k_quiz_active_handoff)로 이 페이지에
 * 핸드오프한다 - URL에는 싣지 않는다(브라우저 히스토리·서버 로그 노출 방지).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import QuizPlayScreen from "@/components/quiz/QuizPlayScreen";
import { readQuizSessionHandoff, type QuizSessionHandoff } from "@/lib/play/quizSessionHandoff";

const QuizPlayPage = (): ReactElement => {
  const router = useRouter();
  const [handoff, setHandoff] = useState<QuizSessionHandoff | null | undefined>(undefined);

  useEffect(() => {
    // MBTI 패턴과 동일하게 sessionStorage에 남겨둔다(지우지 않는다) - "이어하기"가
    // window.location.reload()로 이 페이지를 통째로 재마운트하므로, 그때 다시 읽을
    // 값(특히 QuizPlayScreen이 채워 넣는 attemptId)이 남아있어야 한다.
    setHandoff(readQuizSessionHandoff());
  }, []);

  const handleClose = (): void => {
    router.push("/child/play");
  };

  if (handoff === undefined) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl" aria-hidden="true">
          🧠
        </span>
        <p className="text-sm text-gray-500">놀이를 준비하고 있어요...</p>
      </main>
    );
  }

  if (!handoff) {
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
    <QuizPlayScreen
      token={handoff.token}
      childId={handoff.childId}
      initialAttemptId={handoff.attemptId ?? null}
      onClose={handleClose}
    />
  );
};

export default QuizPlayPage;
