// 퀴즈마스터 handoff token 발급 (requests/010) — 서버 전용
//
// 황금열쇠 소비는 MBTI 등 놀이 세션 인프라(consume_play_access/k_play_sessions)를
// 전혀 쓰지 않고, 기존 범용 경로인 lib/goldkey/ledger.ts의 consumeKeys()
// (=consume_gold_keys, p_play_session_id=NULL)를 그대로 재사용한다 — MBTI 쪽 코드/
// 스키마는 이 모듈에서 전혀 참조하지 않는다.
//
// reward_transaction_id는 consumeKeys()가 반환하는 headerId(=gold_key_consumptions.id)를
// 그대로 쓴다 — 퀴즈마스터는 이 값을 파싱하지 않는 불투명 문자열로만 다룬다.

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { parseGrade, getEffectiveContentGrade } from "@/lib/mission/selectQuestions";

const HANDOFF_TOKEN_TTL_SECONDS = 60;

/**
 * 퀴즈마스터 1회 시작 비용(황금열쇠). 2026-07-27 대표 지시로 1 → 2로 변경.
 *
 * 차감은 **handoff token 발급 시점에 여기서만** 일어난다. 이어하기(resume)는 이 경로를
 * 아예 타지 않으므로 재차감되지 않는다.
 *
 * 화면 표시값은 `app/child/play/page.tsx`의 `GAMES` 배열(`keys`)에 따로 있다 —
 * 둘이 어긋나면 UI가 실제 차감량과 다른 숫자를 안내하게 되므로 **한쪽만 바꾸지 말 것.**
 * (놀이 4종이 전부 그 배열에 비용을 두는 기존 구조라 퀴즈만 공유 상수로 빼지 않았다.)
 */
const QUIZ_GOLD_KEY_COST = 2;

export type CreateQuizHandoffResult =
  | { ok: true; token: string }
  | {
      ok: false;
      reason:
        | "child_not_found"
        | "invalid_grade"
        | "insufficient_balance"
        | "already_starting"
        | "internal_error";
    };

/**
 * @param options.isRestart "새로 시작하기"(requests/023). 차감이 확정된 뒤에만 기존
 *   진행 attempt를 종료 상태로 전환한다 — 순서는 begin_quiz_start_charge RPC가 지킨다.
 */
export async function createQuizHandoffToken(
  childId: string,
  userId: string,
  rawGrade: number | string | null,
  options?: { isRestart?: boolean }
): Promise<CreateQuizHandoffResult> {
  const supabase = createServiceClient();

  // 010 "grade 규칙": 클라이언트가 보낸 값이 아니라 서버에서 조회한 실제 프로필 값만
  // 쓰고, 값이 없거나 1~6 범위를 벗어나면 기본 학년을 임의 적용하지 않고 시작을 차단한다.
  // (request_middle_school_grade_support) 퀴즈마스터 콘텐츠는 초1~6뿐이므로 중학교
  // 1학년(실제 학년 7)은 여기서 콘텐츠 학년 6으로 대체한다 — 저장되는 grade는 콘텐츠
  // 학년이며 실제 학년이 아니다(퀴즈마스터에는 콘텐츠 학년만 필요).
  const realGrade = parseGrade(rawGrade);
  if (realGrade === null) {
    return { ok: false, reason: "invalid_grade" };
  }
  const grade = getEffectiveContentGrade(realGrade);
  if (grade < 1 || grade > 6) {
    return { ok: false, reason: "invalid_grade" };
  }

  // requests/023 "황금열쇠 처리 원칙": 더블클릭·다중 탭이 두 번 차감하지 못하게 한다.
  // 예전에는 lib/goldkey/ledger.ts의 consumeKeys()를 그대로 썼는데, 그 헬퍼는 호출마다
  // 난수 idempotency_key를 만들어(해당 파일 주석에 명시) 동시 요청을 전혀 막지 못했다.
  // begin_quiz_start_charge는 advisory lock + play_start_guards 부분 유니크 인덱스로
  // "아이×놀이당 진행 중인 시작 1건"을 DB 레벨에서 보장하고, 그 안에서 차감까지 끝낸다.
  const { data: chargeData, error: chargeErr } = await supabase.rpc("begin_quiz_start_charge", {
    p_child_id: childId,
    p_user_id: userId,
    p_keys_needed: QUIZ_GOLD_KEY_COST,
    p_is_restart: options?.isRestart === true,
    p_ttl_seconds: HANDOFF_TOKEN_TTL_SECONDS,
  });

  if (chargeErr || !chargeData || chargeData.length === 0) {
    console.error("[createQuizHandoffToken] begin_quiz_start_charge failed:", chargeErr, {
      childId,
      isRestart: options?.isRestart === true,
    });
    return { ok: false, reason: "internal_error" };
  }

  const charge = chargeData[0] as {
    guard_id: string | null;
    consumption_id: string | null;
    reason: string;
  };

  if (charge.reason === "already_starting") {
    return { ok: false, reason: "already_starting" };
  }
  if (charge.reason === "insufficient_balance") {
    return { ok: false, reason: "insufficient_balance" };
  }
  if (charge.reason !== "ok" || !charge.consumption_id) {
    console.error("[createQuizHandoffToken] unexpected charge reason:", charge.reason, { childId });
    return { ok: false, reason: "internal_error" };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TOKEN_TTL_SECONDS * 1000).toISOString();

  const { error: insertErr } = await supabase.from("quiz_handoff_tokens").insert({
    token,
    user_id: userId,
    status: "pending",
    expires_at: expiresAt,
    child_id: childId,
    grade,
    reward_transaction_id: charge.consumption_id,
  });

  if (insertErr) {
    console.error(
      "[createQuizHandoffToken] quiz_handoff_tokens insert failed after gold key charge — attempting compensating refund:",
      insertErr,
      { childId, headerId: charge.consumption_id },
    );

    // 010 "원자성 및 실패 보상": token 생성 실패 시 즉시 동일 거래를 원복한다.
    const { error: refundErr } = await supabase.rpc("refund_gold_keys_by_consumption_id", {
      p_consumption_id: charge.consumption_id,
    });
    if (refundErr) {
      console.error(
        "[createQuizHandoffToken] compensating refund ALSO failed — manual reconciliation needed:",
        refundErr,
        { childId, headerId: charge.consumption_id },
      );
    }

    // 시작이 확정 실패했으므로 guard를 TTL까지 붙잡아 둘 이유가 없다 — 즉시 풀어
    // 아이가 곧바로 다시 시도할 수 있게 한다(실패해도 TTL로 자연히 풀리므로 무시).
    if (charge.guard_id) {
      const { error: releaseErr } = await supabase.rpc("release_play_start_guard", {
        p_guard_id: charge.guard_id,
      });
      if (releaseErr) {
        console.error("[createQuizHandoffToken] guard release failed:", releaseErr, {
          guardId: charge.guard_id,
        });
      }
    }

    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, token };
}
