export const PLAY_KEY_COSTS = {
  comic_book: 2,
  quiz: 2,
  hairstyle: 3,
  mbti: 3,
} as const;

export type PlayType = keyof typeof PLAY_KEY_COSTS;

// init 단계(놀이 진입 직후, 첫 문항 진입 전) 오류만 자동 환불 대상이다.
export const AUTO_REFUND_STAGES = new Set(["init"]);
