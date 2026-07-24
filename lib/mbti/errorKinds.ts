/**
 * 케이 놀이: MBTI — 오류·복구 화면 9종 공용 데이터 (SPEC.md §7)
 *
 * 9종: 로딩 실패 / Supabase 연결 실패 / 인증 만료 / 세션 만료 / 진행 저장 실패 /
 * 캐릭터 이미지 로드 실패(플레이스홀더 폴백) / 네트워크 단절 / 잘못된 URL 접근 /
 * 메인-놀이 버전 불일치.
 *
 * 공통 원칙(SPEC.md §7): 황금열쇠 중복 차감 금지, 진행 상태 삭제 금지,
 * 미완료를 완료 처리 금지, 무한 로딩 금지, "메인으로 돌아가기" 버튼 항상 제공.
 * 이 파일은 카피/재시도 라벨만 담당하고, 각 화면·트리거 지점(components/mbti/*)이
 * 위 원칙을 실제로 지킨다.
 */

export type MbtiErrorKind =
  | "load_failed"
  | "supabase_unreachable"
  | "auth_expired"
  | "session_expired"
  | "progress_save_failed"
  | "character_image_failed"
  | "network_offline"
  | "invalid_url"
  | "version_mismatch";

/** 화면 렌더링·분석 이벤트 등에서 9종 전체를 순회할 때 사용 (예: 리뷰/테스트) */
export const ALL_MBTI_ERROR_KINDS: readonly MbtiErrorKind[] = [
  "load_failed",
  "supabase_unreachable",
  "auth_expired",
  "session_expired",
  "progress_save_failed",
  "character_image_failed",
  "network_offline",
  "invalid_url",
  "version_mismatch",
];

export interface MbtiErrorContent {
  emoji: string;
  title: string;
  description: string;
  /** 있으면 "다시 시도" 류 버튼을 노출한다(라벨은 상황에 맞게 다름). 없으면 재시도 버튼 없이
   * "메인으로 돌아가기"만 제공한다(예: auth_expired — 재시도로 해결되지 않는 상태). */
  retryLabel?: string;
}

/** 아이 대상 톤(따뜻하고 안심시키는 말투) — 문항·복구 화면과 동일한 문체. */
export const MBTI_ERROR_CONTENT: Record<MbtiErrorKind, MbtiErrorContent> = {
  load_failed: {
    emoji: "😵",
    title: "불러오다가 문제가 생겼어요",
    description: "화면을 불러오는 중에 문제가 생겼어요. 다시 한번 시도해볼까?",
    retryLabel: "다시 시도",
  },
  supabase_unreachable: {
    emoji: "🔌",
    title: "서버와 연결이 잘 안돼요",
    description: "지금은 서버에 연결하기 어려워요. 잠시 후 다시 시도해줘.",
    retryLabel: "다시 시도",
  },
  auth_expired: {
    emoji: "🔑",
    title: "로그인이 만료됐어요",
    description: "안전을 위해 로그인 상태가 풀렸어요. 메인 화면에서 다시 들어와 줘.",
  },
  session_expired: {
    emoji: "⏰",
    title: "놀이 시간이 끝났어요",
    description: "너무 오래 쉬어서 놀이가 종료됐어요. 새로 시작해볼까?",
    retryLabel: "새로 시작",
  },
  progress_save_failed: {
    emoji: "💾",
    title: "저장하다가 문제가 생겼어요",
    description: "지금까지 답은 안전해요. 잠시 후 자동으로 다시 저장할게요.",
    retryLabel: "다시 저장",
  },
  character_image_failed: {
    emoji: "🖼️",
    title: "캐릭터 그림을 불러오지 못했어요",
    description: "그림 대신 기본 캐릭터로 보여줄게요. 결과는 그대로 안전해요.",
  },
  network_offline: {
    emoji: "📡",
    title: "인터넷 연결이 끊겼어요",
    description: "와이파이나 데이터가 연결됐는지 확인하고 다시 시도해줘.",
    retryLabel: "다시 시도",
  },
  invalid_url: {
    emoji: "🧭",
    title: "잘못된 주소로 들어왔어요",
    description: "이 화면은 메인 앱에서만 열 수 있어요. 메인 화면으로 돌아가 줘.",
  },
  version_mismatch: {
    emoji: "🔄",
    title: "새로운 버전이 있어요",
    description: "더 좋아진 버전이 나왔어요! 새로고침하면 최신 버전으로 놀 수 있어요.",
    retryLabel: "새로고침",
  },
};
