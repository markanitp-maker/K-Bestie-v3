/**
 * POST /api/batch/quiz-handoff-reconcile — 고아 handoff 황금열쇠 회수(정산) 배치
 *
 * ## 왜 필요한가
 * 황금열쇠는 handoff token을 **발급하는 시점**에 이미 차감된다
 * (`lib/quiz/handoffToken.ts` → `consumeKeys()`). 그런데 그 뒤 attempt가 실제로
 * 시작되지 않는 경로가 여러 개 있고, 그중 어느 것도 환불로 이어지지 않는다:
 *
 *  - Quiz 앱이 세션 만료/학년조회 실패 등으로 진입에 실패 → `/play/quiz-error`로 되돌아옴.
 *    그 화면은 의도적으로 무해(inert)하게 만들어져 있어 환불을 트리거하지 않는다.
 *  - 세션 자체가 없어서(`AUTH_SESSION_MISSING`) Quiz가 거래를 특정조차 못 하는 경우.
 *  - 아이가 그냥 탭을 닫은 경우 — 어떤 리다이렉트·콜백 설계로도 잡을 수 없다.
 *
 * Quiz 쪽 서버 콜백(`/api/rewards/golden-key/refund`)은 "거래를 특정할 수 있는" 실패에만
 * 대응할 수 있으므로, 그 위에 이 정산 스윕이 최종 안전망으로 필요하다.
 *
 * ## 무엇을 고아로 보는가
 * `quiz_handoff_tokens.status = 'consumed'` 상태로 남아 있고(= Quiz 세션까지는 받았지만
 * attempt 시작으로 이어지는 `'claimed'`까지 가지 못함), TTL이 지난 행.
 *
 * **`quiz_attempts` 교차 확인은 생략할 수 없다.** attempt는 실제로 만들어졌는데 상태를
 * `'claimed'`로 올리는 단계만 실패한 행이 있을 수 있고, 그걸 환불해버리면 아이가 놀이도
 * 하고 열쇠도 돌려받는 이중 지급이 된다. 그래서 `reward_transaction_id`로 attempt 존재
 * 여부를 반드시 확인하고, 하나라도 있으면 건너뛴다.
 *
 * ## TTL을 6시간으로 잡은 이유
 * 이어하기(resume) 창과 동일한 6시간을 쓴다(`ATTEMPT_MAX_AGE_MS`). 그 시간이 지나면
 * 어떤 경로로도 이 거래가 정상적으로 attempt로 이어질 수 없으므로, 그 이후의
 * `'consumed'` 행은 확정적으로 죽은 거래다. 더 짧게 잡으면 아직 살아있는 세션을
 * 환불해버릴 수 있다.
 * (상수를 `lib/quiz/play/route-helpers.ts`에서 import하지 않고 여기 다시 둔 이유:
 *  그 디렉터리는 계획 Phase 7에서 통째로 삭제 예정이라, 삭제되면 이 배치가 깨진다.)
 *
 * ## 안전 장치
 *  - `BATCH_SECRET` Bearer 인증(기존 `app/api/batch/*` 관례와 동일) + 타이밍 세이프 비교.
 *    황금열쇠 잔액을 움직이는 엔드포인트라 인증 없이 트리거되면 안 된다.
 *  - `dryRun: true`로 실제 환불 없이 대상만 조회할 수 있다.
 *  - 환불 RPC(`refund_gold_keys_by_consumption_id`)는 멱등이다 — 이미 환불된 거래는
 *    `already_refunded`로 떨어지고 잔액이 중복 증가하지 않는다. 그래도 불필요한 호출을
 *    줄이려고 `gold_key_consumptions.status`로 미리 거른다.
 *  - 응답에 처리된 `reward_transaction_id` 목록을 그대로 실어 감사/롤백 근거를 남긴다.
 *  - 공유 테이블 `quiz_handoff_tokens`는 **쓰지 않고 읽기만 한다**(CLAUDE.md §16-C:
 *    스키마 변경은 대표 승인 필요). 재처리 방지는 위 상태 필터로 해결한다.
 *
 * ## 스케줄 등록(대표가 직접 실행 — 이 파일은 등록하지 않는다)
 * 이 저장소의 관례대로 pg_cron 등록은 DRAFT로만 남기고 대표가 SQL Editor에서 실행한다
 * (`supabase/migrations/20260711400000_pg_cron_batch_registration.sql` 참고):
 *
 *   select cron.schedule(
 *     'kbestie-quiz-handoff-reconcile',
 *     '30 * * * *',                        -- 매시 30분
 *     $$ select net.http_post(
 *          url     := 'https://<K-BESTIE-HOST>/api/batch/quiz-handoff-reconcile',
 *          headers := jsonb_build_object('Content-Type','application/json',
 *                                        'Authorization','Bearer <BATCH_SECRET>'),
 *          body    := jsonb_build_object()
 *        ); $$
 *   );
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 이어하기 창과 동일. 이 시간이 지난 `consumed` 행은 확정적으로 죽은 거래다. */
const ORPHAN_TTL_MS = 6 * 60 * 60 * 1000;

/** 한 번의 실행에서 처리할 최대 건수(폭주 방지). */
const MAX_BATCH = 200;

const REFUND_REASON = "reconcile_orphaned_handoff";

interface RefundRpcResult {
  success: boolean;
  refunded_count: number;
  header_id: string | null;
  reason: string;
}

function isAuthorized(req: NextRequest, secret: string): boolean {
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual은 길이가 다르면 throw하므로 길이를 먼저 비교한다.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  if (!isAuthorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body = (await req.json()) as { dryRun?: boolean } | null;
    dryRun = body?.dryRun === true;
  } catch {
    // 본문 없음 = 기본 실행(크론이 빈 body로 호출한다).
  }

  const supabase = createServiceClient();
  const cutoffIso = new Date(Date.now() - ORPHAN_TTL_MS).toISOString();

  // 1) TTL이 지난 `consumed` handoff 행 = 1차 후보.
  const { data: candidates, error: candErr } = await supabase
    .from("quiz_handoff_tokens")
    .select("token, user_id, child_id, reward_transaction_id, issued_at")
    .eq("status", "consumed")
    .not("reward_transaction_id", "is", null)
    .lt("issued_at", cutoffIso)
    .order("issued_at", { ascending: true })
    .limit(MAX_BATCH);

  if (candErr) {
    console.error("[quiz-handoff-reconcile] candidate lookup failed:", candErr);
    return NextResponse.json({ error: "candidate_lookup_failed" }, { status: 500 });
  }

  const rows = candidates ?? [];
  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun,
      cutoff: cutoffIso,
      scanned: 0,
      refunded: [],
      skipped: { attemptExists: 0, alreadyRefunded: 0 },
      failures: [],
      pendingOrphansDetected: await countPendingOrphans(supabase, cutoffIso),
    });
  }

  const txIds = rows.map((r) => r.reward_transaction_id as string);

  // 2) attempt가 실제로 존재하는 거래는 제외한다(이중 지급 방지 — 생략 불가).
  const { data: attemptRows, error: attemptErr } = await supabase
    .from("quiz_attempts")
    .select("reward_transaction_id")
    .in("reward_transaction_id", txIds);

  if (attemptErr) {
    console.error("[quiz-handoff-reconcile] attempt cross-check failed:", attemptErr);
    return NextResponse.json({ error: "attempt_lookup_failed" }, { status: 500 });
  }
  const hasAttempt = new Set(
    (attemptRows ?? []).map((a) => a.reward_transaction_id as string).filter(Boolean),
  );

  // 3) 이미 환불된 거래는 RPC 호출 자체를 생략한다(RPC는 멱등이지만 불필요한 호출 감소).
  const { data: consumptionRows, error: consErr } = await supabase
    .from("gold_key_consumptions")
    .select("id, status")
    .in("id", txIds);

  if (consErr) {
    console.error("[quiz-handoff-reconcile] consumption lookup failed:", consErr);
    return NextResponse.json({ error: "consumption_lookup_failed" }, { status: 500 });
  }
  const alreadyRefunded = new Set(
    (consumptionRows ?? []).filter((c) => c.status === "refunded").map((c) => c.id as string),
  );

  const refunded: Array<{ rewardTransactionId: string; childId: string | null; count: number }> = [];
  const failures: Array<{ rewardTransactionId: string; reason: string }> = [];
  let skippedAttemptExists = 0;
  let skippedAlreadyRefunded = 0;

  for (const row of rows) {
    const txId = row.reward_transaction_id as string;

    if (hasAttempt.has(txId)) {
      skippedAttemptExists += 1;
      continue;
    }
    if (alreadyRefunded.has(txId)) {
      skippedAlreadyRefunded += 1;
      continue;
    }
    if (dryRun) {
      refunded.push({ rewardTransactionId: txId, childId: row.child_id ?? null, count: 0 });
      continue;
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "refund_gold_keys_by_consumption_id",
      {
        p_consumption_id: txId,
        p_external_attempt_id: "",
        p_refund_reason: REFUND_REASON,
      },
    );

    if (rpcErr) {
      console.error("[quiz-handoff-reconcile] refund RPC error:", rpcErr, { txId });
      failures.push({ rewardTransactionId: txId, reason: "rpc_error" });
      continue;
    }

    const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as RefundRpcResult | undefined;
    if (!result) {
      failures.push({ rewardTransactionId: txId, reason: "no_result" });
      continue;
    }
    if (result.success) {
      refunded.push({
        rewardTransactionId: txId,
        childId: row.child_id ?? null,
        count: result.refunded_count,
      });
      continue;
    }
    if (result.reason === "already_refunded") {
      skippedAlreadyRefunded += 1;
      continue;
    }
    failures.push({ rewardTransactionId: txId, reason: result.reason });
  }

  // 감사 근거: 어떤 거래를 되돌렸는지 로그에도 남긴다(응답만으로는 크론 실행 시 유실).
  if (refunded.length > 0) {
    console.warn(
      `[quiz-handoff-reconcile] refunded ${refunded.length} orphaned handoff(s)${dryRun ? " (DRY RUN)" : ""}:`,
      refunded.map((r) => r.rewardTransactionId),
    );
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    cutoff: cutoffIso,
    scanned: rows.length,
    refunded,
    skipped: { attemptExists: skippedAttemptExists, alreadyRefunded: skippedAlreadyRefunded },
    failures,
    pendingOrphansDetected: await countPendingOrphans(supabase, cutoffIso),
    truncated: rows.length === MAX_BATCH,
  });
}

/**
 * `status='pending'`인 채로 만료된 행의 개수 — **탐지만 하고 환불하지 않는다.**
 *
 * 이것도 같은 종류의 누수다(토큰 발급 시점에 이미 차감됐는데 아이가 Quiz 화면에
 * 도달조차 못 한 경우). 다만 이번 지시 범위는 `consumed` 고아이고, 황금열쇠 잔액을
 * 움직이는 범위를 요청 없이 넓히지 않는다 — 숫자만 보고해서 대표/코디네이터가
 * 판단할 수 있게 한다. 0이 아니면 별도 결정이 필요하다는 신호다.
 */
async function countPendingOrphans(
  supabase: ReturnType<typeof createServiceClient>,
  cutoffIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("quiz_handoff_tokens")
    .select("token", { count: "exact", head: true })
    .eq("status", "pending")
    .not("reward_transaction_id", "is", null)
    .lt("issued_at", cutoffIso);
  if (error) {
    console.error("[quiz-handoff-reconcile] pending orphan count failed:", error);
    return -1;
  }
  return count ?? 0;
}
