import { createServiceClient } from "@/lib/supabase/server";

// 황금열쇠 원장 (gold_key_ledger) 서버 전용 로직
// 적립: 출석 1개/일 + 미션완료 최대 1개/일, 만료 = earned_at + 7일
// 차감: FIFO(만료 임박 = expires_at 오름차순)
// 하루 경계는 Asia/Seoul 자정 기준
// V2 질문엔진 미션완료 보상은 record_v2_mission_answer SQL RPC가 직접 처리한다 — 이 함수는 V1 경로 및 출석/기타 용도로만 계속 쓰인다

const KST_OFFSET = "+09:00";
const EXPIRE_DAYS = 7;
const MISSION_DAILY_LIMIT = 1;

// 확정 정책(대표님 승인, 2026-07-18): 활성 골드키 보유 상한 22개.
// V2 미션완료 보상은 SQL RPC(record_v2_mission_answer, supabase/migrations/20260717170000_question_engine_v2_atomic_rpc.sql)가
// 직접 처리하므로 이 상수는 이 TS 파일에서 직접 실행되지는 않지만, 정책의 단일 문서화 지점(source of documentation)이다.
// [동기화 기준] 이 파일의 EXPIRE_DAYS/MISSION_DAILY_LIMIT/MAX_ACTIVE_BALANCE 중 하나라도 변경되면
// 반드시 위 SQL RPC 파일의 대응 하드코딩 값(만료일수, 일일한도, 잔액상한)도 같은 커밋에서 함께 갱신할 것 — 두 값이
// 어긋나면 V1(TS 경로)과 V2(RPC 경로)의 보상 정책이 서로 달라지는 회귀가 발생한다.
const MAX_ACTIVE_BALANCE = 22;

/** Asia/Seoul 기준 오늘 날짜 "YYYY-MM-DD" */
function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** KST 오늘 하루의 [시작, 끝) ISO 경계 (earned_at 필터용) */
function kstDayRange(): { start: string; end: string } {
  const day = kstToday();
  return {
    start: `${day}T00:00:00.000${KST_OFFSET}`,
    end: `${day}T23:59:59.999${KST_OFFSET}`,
  };
}

function expiresAtFromNow(): string {
  return new Date(Date.now() + EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function countEarnedToday(childId: string, reason: "attendance" | "mission"): Promise<number> {
  const supabase = createServiceClient();
  const { start, end } = kstDayRange();
  const { count, error } = await supabase
    .from("gold_key_ledger")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("reason", reason)
    .gte("earned_at", start)
    .lte("earned_at", end);

  if (error) throw error;
  return count ?? 0;
}

export type EarnResult = { earned: boolean; reason?: string };

/** 출석 적립 — 오늘 이미 출석 적립했으면 스킵(중복 방지) */
export async function earnAttendanceKey(childId: string): Promise<EarnResult> {
  const already = await countEarnedToday(childId, "attendance");
  if (already > 0) return { earned: false, reason: "already_earned_today" };

  const supabase = createServiceClient();
  const { error } = await supabase.from("gold_key_ledger").insert({
    child_id: childId,
    reason: "attendance",
    expires_at: expiresAtFromNow(),
  });
  if (error) throw error;
  return { earned: true };
}

/** 미션완료 적립 — 오늘 미션완료로 이미 1개 적립했으면 스킵 */
export async function earnMissionCompleteKey(
  childId: string,
  missionId?: string,
  rewardType: string = "mission_complete"
): Promise<EarnResult> {
  const already = await countEarnedToday(childId, "mission");
  if (already >= MISSION_DAILY_LIMIT) return { earned: false, reason: "daily_limit_reached" };

  const supabase = createServiceClient();
  const insertPayload: any = {
    child_id: childId,
    reason: "mission",
    expires_at: expiresAtFromNow(),
  };

  if (missionId) {
    insertPayload.mission_id = missionId;
    insertPayload.reward_type = rewardType;
  }

  const { error } = await supabase.from("gold_key_ledger").insert(insertPayload);
  
  if (error) {
    if (error.code === "23505") {
      return { earned: false, reason: "already_earned" };
    }
    throw error;
  }
  return { earned: true };
}

/** 유효(미만료·미소비) 황금열쇠 개수 */
export async function getBalance(childId: string): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("gold_key_ledger")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString());

  if (error) throw error;
  return count ?? 0;
}

export type ConsumeResult =
  | { ok: true; consumed: number; balance: number; headerId: string }
  | { ok: false; reason: "insufficient" | "invalid_count"; balance: number };

/**
 * FIFO(만료 임박 우선)로 count개 소비.
 * 잔액 부족이면 아무것도 소비하지 않고 실패 반환.
 * 내부적으로 원자적 RPC(consume_gold_keys)를 호출한다 — child_id 단위 advisory lock +
 * 결정론적 FOR UPDATE로 동시 요청 간 레이스를 DB 트랜잭션 안에서 차단한다(기존 조건부 UPDATE 방식의
 * "부분 소비 후 실패 보고" 결함을 구조적으로 제거).
 */
export async function consumeKeys(childId: string, count: number): Promise<ConsumeResult> {
  if (!Number.isInteger(count) || count <= 0) {
    return { ok: false, reason: "invalid_count", balance: await getBalance(childId) };
  }

  const supabase = createServiceClient();
  // 이 경로는 놀이 세션이 없는 일반 소비이므로 매 호출마다 새 idempotency_key를 생성한다
  // (호출부가 재시도 시 동일 키를 넘길 방법이 없어 이 경로 자체의 네트워크-재시도 멱등성은 보장하지
  // 않는다 — 기존 consumeKeys()도 이 보장이 없었으므로 회귀 아님. play_session 기반 소비는 KY 쪽에서
  // 별도로 consume_gold_keys를 p_idempotency_key=play_session_id 등으로 직접 호출해 멱등성을 얻는다).
  const idempotencyKey = `consumeKeys:${childId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const { data, error } = await supabase.rpc("consume_gold_keys", {
    p_child_id: childId,
    p_amount: count,
    p_idempotency_key: idempotencyKey,
    p_play_session_id: null,
  });

  if (error) throw error;
  if (!data || data.length === 0) throw new Error("consume_gold_keys returned no rows");

  const result = data[0] as { success: boolean; consumed_count: number; balance: number; header_id: string; reason: string };

  if (!result.success) {
    return { ok: false, reason: result.reason === "insufficient_balance" ? "insufficient" : "invalid_count", balance: result.balance };
  }

  return { ok: true, consumed: result.consumed_count, balance: result.balance, headerId: result.header_id };
}
