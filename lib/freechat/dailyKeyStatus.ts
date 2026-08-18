// 요청서 011 — 오늘 자유대화 황금열쇠 획득 여부.
//
// Source of Truth 는 public.gold_key_ledger 다. 총 보유량(balance), localStorage,
// "이번 세션에서 모달을 봤는지", 미션 완료 여부는 판정에 쓰지 않는다(§3-1).
// 판정 조건은 child_id + reward_type='freechat_daily_engagement' + KST business_date 하나뿐이다.
//
// 미션(mission_complete / mission_v3_complete)·출석 룰렛(attendance_roulette)·관리자 지급은
// reward_type 이 다르므로 이 판정에 절대 걸리지 않는다(§3-2).

import { FREECHAT_DAILY_REWARD_TYPE } from "./dailyEngagementReward";

/** 화면에 필요한 최소 계약. ledger 전체 이력을 클라이언트로 보내지 않는다(§3-4). */
export interface FreechatDailyKeyStatus {
  earnedToday: boolean;
  earnedAt: string | null;
  businessDate: string;
  rewardAmount: number;
}

/** gold_key_ledger 에서 읽어오는 최소 필드. */
export interface FreechatDailyKeyLedgerRow {
  earned_at: string | null;
}

/**
 * 조회 결과(오늘 business_date 의 freechat 지급 행)를 화면 계약으로 바꾼다.
 * 행이 없으면 미획득이며 rewardAmount 는 0 이다. 있으면 현재 정책상 1 이다(§6).
 */
export function buildFreechatDailyKeyStatus(
  row: FreechatDailyKeyLedgerRow | null | undefined,
  businessDate: string
): FreechatDailyKeyStatus {
  if (!row) {
    return { earnedToday: false, earnedAt: null, businessDate, rewardAmount: 0 };
  }
  return {
    earnedToday: true,
    earnedAt: row.earned_at ?? null,
    businessDate,
    rewardAmount: 1,
  };
}

/** 지급 직후(pause 응답 reward.earned=true) 화면 상태를 즉시 갱신할 때 쓴다(§3-7). */
export function markFreechatDailyKeyEarned(
  previous: FreechatDailyKeyStatus | null,
  businessDate: string,
  earnedAt: string
): FreechatDailyKeyStatus {
  return {
    earnedToday: true,
    earnedAt,
    businessDate: previous?.businessDate ?? businessDate,
    rewardAmount: 1,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 서버 응답에서 상태를 읽는다. 형식이 어긋나면 null 을 돌려주며, 화면은 그 경우
 * "아직 안 받았어" 로 단정하지 않고 상태 표시를 숨긴다(§3-12).
 */
export function parseFreechatDailyKeyStatus(value: unknown): FreechatDailyKeyStatus | null {
  if (!isRecord(value)) return null;
  const { earnedToday, earnedAt, businessDate, rewardAmount } = value;
  if (typeof earnedToday !== "boolean") return null;
  if (typeof businessDate !== "string" || businessDate === "") return null;
  if (typeof rewardAmount !== "number" || !Number.isFinite(rewardAmount)) return null;
  // earnedAt 은 nullable 이다. 값이 아예 없는 응답도 null 로 받아들이고, 숫자·객체 등
  // 형식이 틀린 값만 거부한다.
  if (earnedAt !== null && earnedAt !== undefined && typeof earnedAt !== "string") return null;
  return { earnedToday, earnedAt: earnedAt ?? null, businessDate, rewardAmount };
}

/** 조회에 쓰는 reward_type. 다른 보상과 섞이지 않도록 한 곳에서만 참조한다. */
export const FREECHAT_DAILY_KEY_REWARD_TYPE = FREECHAT_DAILY_REWARD_TYPE;
