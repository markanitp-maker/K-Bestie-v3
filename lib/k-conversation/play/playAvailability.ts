import { getSupabaseTarget } from "@/lib/supabase/env";
import { pickAvoiding } from "@/lib/freechat/reactionEngine";

/**
 * 케이 놀이 전체 kill switch.
 *
 * 게임별로 각각 막지 않는다. Registry 에 새 놀이가 추가돼도 자동으로 함께 막혀야 한다.
 * 프로덕션 품질 사고로 2026-08-18 부터 프로덕션만 꺼 둔 상태다(요청서 010).
 * 대표님 Dev QA 승인 전에는 프로덕션에서 켜지 않는다.
 */
export function isKPlayEnabled(): boolean {
  const override = process.env.NEXT_PUBLIC_K_PLAY_ENABLED?.trim().toLowerCase();
  if (override === "true") {
    return true;
  }
  return getSupabaseTarget() !== "prod";
}

/**
 * 만화책 읽기(comic_book) 놀이 노출 여부 판정.
 *
 * Production DB 에는 play_registry 에 comic_book 행이 아예 없다.
 * 따라서 Production 에서 카드만 켜지면 아이가 눌렀을 때 티켓 발급이 실패해 깨진 버튼이 보인다.
 * Dev 에서는 기본 켜짐, Production 에서는 NEXT_PUBLIC_COMIC_BOOK_ENABLED=true 명시 시에만 켜진다.
 * Dev 에서도 긴급 차단이 가능하도록 명시적 "false" 값은 비활성화 처리한다.
 */
export function isComicBookEnabled(): boolean {
  const override = process.env.NEXT_PUBLIC_COMIC_BOOK_ENABLED?.trim().toLowerCase();
  if (override === "true") {
    return true;
  }
  if (override === "false") {
    return false;
  }
  return getSupabaseTarget() !== "prod";
}

/**
 * 놀이가 꺼져 있을 때 아이에게 그대로 들려줄 안내.
 *
 * 프롬프트 지침으로는 안 된다 — 케이가 "좋아, 신나게 해보자!" 라고 호응해
 * 아이가 시작되지도 않을 게임을 기다렸다(2026-08-18 프로덕션 실측).
 * 모델에게 맡기지 않고 이 문구를 그대로 말한다.
 */
export const K_PLAY_DISABLED_TEMPLATES = [
  "놀이는 지금 준비 중이야! 우리 그냥 얘기하자 😊",
  "놀이는 지금 열심히 준비하고 있어! 우리 재미있는 이야기 나누자.",
  "지금은 놀이 준비 중이야! 우리 다른 이야기하면서 놀까?",
  "놀이는 아직 준비 중이거든! 오늘은 우리 신나게 수다 떨자.",
  "지금은 놀이를 준비하고 있어! 우리 무슨 이야기할까?",
  "놀이는 지금 준비 중이야! 우리 재미있게 대화하자.",
];

/**
 * 놀이가 꺼져 있을 때 아이 발화에 응답할 결정론 문구를 반환한다.
 * 최근 케이 발화(recentKTexts)를 확인하여 동일 문구 반복을 회피한다.
 */
export function getPlayDisabledResponse(
  recentKTexts: string[] = [],
  rand: () => number = Math.random
): string {
  const selected = pickAvoiding(K_PLAY_DISABLED_TEMPLATES, recentKTexts, (t) => t, rand);
  return selected ?? K_PLAY_DISABLED_TEMPLATES[0];
}

