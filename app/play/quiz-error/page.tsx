import Link from "next/link";
import type { ReactElement } from "react";

/**
 * `/play/quiz-error` — Quiz 앱이 놀이를 계속할 수 없을 때(세션 만료 등) 사용자를
 * 되돌려보내는 수신 화면.
 *
 * 흐름: Quiz 앱이 상대 경로 `Location: /play/quiz-error?quiz_error_code=...`로 리다이렉트
 * → 프록시 Route Handler가 이 경로만 예외적으로 허용하고 프록시 오리진 기준 상대경로로
 * 되돌림 → 브라우저가 K-Bestie의 이 페이지로 이동. `/play/quiz`의 **형제** 경로라
 * middleware 게이트에 매칭되지 않으므로 프록시되지 않고 K-Bestie가 직접 서빙한다.
 *
 * **보안: 이 화면은 반드시 무해(inert)해야 한다.**
 * 쿼리스트링을 만드는 주체가 업스트림(Quiz 배포)이므로 여기 오는 값은 전부 신뢰할 수
 * 없는 입력이다. 따라서
 *  - 오류 코드는 아래 화이트리스트와 정확히 일치할 때만 해석하고, 그 외에는 일반 문구로
 *    떨어뜨린다.
 *  - 쿼리 값으로 **어떤 부수효과도 일으키지 않는다** — 환불·차감·상태 변경·추가 리다이렉트
 *    전부 금지. 황금열쇠 환불은 Quiz 서버가 서버간 콜백(`/api/play/callback/refund`)으로
 *    처리하고, 사용자에게는 `/child/play`의 기존 환불 알림 폴링이 알려준다. 이 화면이
 *    환불을 트리거하면 공격자가 URL만으로 환불을 유발할 수 있게 된다.
 *  - 자유 텍스트를 그대로 렌더링하지 않는다(코드 표기는 `^[A-Z_]{1,40}$`로 제한).
 *    Quiz는 `quiz_error_detail`(자유 텍스트)도 함께 보내지만 **의도적으로 렌더링하지
 *    않는다** — 업스트림이 통제하는 임의 문자열이고, 아이 사용자에게 보여줄 가치가 없다.
 *    디버깅이 필요하면 Quiz 쪽 서버 로그를 본다.
 */

/** Quiz 앱(worker-1)이 실제로 내보내는 코드 목록에 맞춘다. */
const ERROR_MESSAGES: Record<string, string> = {
  AUTH_SESSION_MISSING: "놀이 로그인 정보가 없어요.",
  AUTH_SESSION_EXPIRED: "놀이 시간이 오래 지나서 연결이 끊어졌어요.",
  HANDOFF_TOKEN_INVALID: "놀이를 시작하는 정보가 올바르지 않아요.",
  HANDOFF_TOKEN_EXPIRED: "놀이를 시작하는 정보가 만료됐어요.",
  GRADE_LOOKUP_FAILED: "학년 정보를 불러오지 못했어요.",
  SUBJECT_LOAD_FAILED: "과목 정보를 불러오지 못했어요.",
  QUIZ_START_FAILED: "퀴즈를 시작하지 못했어요.",
  QUESTION_BANK_UNAVAILABLE: "지금은 문제를 불러올 수 없어요.",
  UNKNOWN_LOADING_ERROR: "놀이를 불러오는 중 문제가 생겼어요.",
};

const FALLBACK_MESSAGE = "놀이를 계속할 수 없어서 돌아왔어요.";

/** 표시용으로만 허용하는 코드 형태. 그 외에는 아예 노출하지 않는다. */
const DISPLAYABLE_CODE = /^[A-Z_]{1,40}$/;

export const dynamic = "force-dynamic";

export default async function QuizErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const raw = params.quiz_error_code;
  const code = typeof raw === "string" ? raw : undefined;

  const message = (code && ERROR_MESSAGES[code]) || FALLBACK_MESSAGE;
  const shownCode = code && DISPLAYABLE_CODE.test(code) ? code : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-4xl" aria-hidden="true">
        🧠
      </span>
      <p className="text-base font-bold text-gray-800">{message}</p>
      <p className="text-sm text-gray-500">
        황금열쇠를 썼다면 자동으로 돌려드려요.
        <br />
        놀이 화면에서 확인할 수 있어요.
      </p>
      <Link
        href="/child/play"
        className="mt-2 rounded-2xl bg-gray-800 px-6 py-3 text-sm font-bold text-white shadow-md active:scale-95 transition-transform"
      >
        놀이로 돌아가기
      </Link>
      {shownCode && (
        <p className="mt-4 text-[11px] text-gray-400">오류 코드: {shownCode}</p>
      )}
    </main>
  );
}
