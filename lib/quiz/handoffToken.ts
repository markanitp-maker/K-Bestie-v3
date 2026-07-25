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
import { consumeKeys } from "@/lib/goldkey/ledger";
import { parseGrade } from "@/lib/mission/selectQuestions";

const HANDOFF_TOKEN_TTL_SECONDS = 60;

export type CreateQuizHandoffResult =
  | { ok: true; token: string }
  | {
      ok: false;
      reason: "child_not_found" | "invalid_grade" | "insufficient_balance" | "internal_error";
    };

export async function createQuizHandoffToken(childId: string): Promise<CreateQuizHandoffResult> {
  const supabase = createServiceClient();

  const { data: child, error: childErr } = await supabase
    .from("child_profiles")
    .select("id, grade, member_id")
    .eq("id", childId)
    .maybeSingle();

  if (childErr || !child) {
    return { ok: false, reason: "child_not_found" };
  }

  // 010 "grade 규칙": 클라이언트가 보낸 값이 아니라 서버에서 조회한 실제 프로필 값만
  // 쓰고, 값이 없거나 1~6 범위를 벗어나면 기본 학년을 임의 적용하지 않고 시작을 차단한다.
  const grade = parseGrade(child.grade);
  if (grade === null || grade < 1 || grade > 6) {
    return { ok: false, reason: "invalid_grade" };
  }

  const { data: member, error: memberErr } = await supabase
    .from("family_members")
    .select("user_id")
    .eq("id", child.member_id)
    .maybeSingle();

  if (memberErr || !member) {
    return { ok: false, reason: "child_not_found" };
  }

  const consumeResult = await consumeKeys(childId, 1);
  if (!consumeResult.ok) {
    return { ok: false, reason: "insufficient_balance" };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TOKEN_TTL_SECONDS * 1000).toISOString();

  const { error: insertErr } = await supabase.from("quiz_handoff_tokens").insert({
    token,
    user_id: member.user_id,
    status: "pending",
    expires_at: expiresAt,
    child_id: childId,
    grade,
    reward_transaction_id: consumeResult.headerId,
  });

  if (insertErr) {
    console.error(
      "[createQuizHandoffToken] quiz_handoff_tokens insert failed after gold key charge — attempting compensating refund:",
      insertErr,
      { childId, headerId: consumeResult.headerId },
    );

    // 010 "원자성 및 실패 보상": token 생성 실패 시 즉시 동일 거래를 원복한다.
    const { error: refundErr } = await supabase.rpc("refund_gold_keys_by_consumption_id", {
      p_consumption_id: consumeResult.headerId,
    });
    if (refundErr) {
      console.error(
        "[createQuizHandoffToken] compensating refund ALSO failed — manual reconciliation needed:",
        refundErr,
        { childId, headerId: consumeResult.headerId },
      );
    }

    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, token };
}
