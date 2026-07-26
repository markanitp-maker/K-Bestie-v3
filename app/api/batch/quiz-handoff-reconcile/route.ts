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
 * ## 무엇을 고아로 보는가 — 상태마다 판정 조건이 다르다
 * `'claimed'`(= attempt 시작됨)에 도달하지 못한 세 상태가 대상이지만, "확실히 죽었다"를
 * 증명하는 근거가 상태별로 다르므로 하나의 조건으로 뭉뚱그리지 않는다.
 *
 *  - `'pending'` / `'mint_failed'` → **`expires_at <= now() OR mint_attempts >= 3`**
 *    소비 RPC의 게이트가 `status in ('pending','mint_failed') and expires_at > now()
 *    and mint_attempts < 3`이므로, 이 조건을 만족하면 어떤 재시도로도 소비될 수 없다.
 *    구조적으로 증명되는 조건이라 시간 기준 추정보다 정확하고, 회수도 훨씬 빠르다.
 *
 *  - `'consumed'` → **`issued_at < now() - 6h`** (이어하기 창)
 *    위 게이트 논리를 이 상태에 그대로 적용하면 **안 된다.** 게이트는 "재소비 가능성"을
 *    말할 뿐인데, 이 상태에서 막아야 하는 위험은 재소비가 아니라 "아직 attempt를 만들지
 *    않은 살아있는 세션"이다. handoff 토큰 TTL이 60초(`HANDOFF_TOKEN_TTL_SECONDS`)라
 *    `expires_at <= now()`를 적용하면 발급 60초 뒤부터 회수 대상이 되는데, 아이가
 *    학년·과목을 고르는 시간은 그보다 훨씬 길다 → 놀이 중에 열쇠를 돌려주고 뒤이어
 *    attempt가 생기는 **이중 지급**이 난다. 아래 attempt 교차확인도 이 구간에는 아직
 *    attempt 행이 없어 막아주지 못한다.
 *
 * (상태값 이름 주의: CHECK 제약은 `('pending','mint_failed','consumed','claimed')`이고
 *  `'issued'`라는 상태는 없다 — 발급 시각 컬럼 `issued_at`과 혼동하기 쉽다.)
 *
 * **`quiz_attempts` 교차 확인은 생략할 수 없다.** attempt는 실제로 만들어졌는데 상태를
 * `'claimed'`로 올리는 단계만 실패한 행이 있을 수 있고, 그걸 환불해버리면 아이가 놀이도
 * 하고 열쇠도 돌려받는 이중 지급이 된다. 그래서 `reward_transaction_id`로 attempt 존재
 * 여부를 반드시 확인하고, 하나라도 있으면 건너뛴다.
 *
 * (6시간 상수를 `lib/quiz/play/route-helpers.ts`에서 import하지 않고 여기 다시 둔 이유:
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

/** 이어하기 창과 동일. 이 시간이 지나면 어떤 경로로도 attempt로 이어질 수 없다. */
const ORPHAN_TTL_MS = 6 * 60 * 60 * 1000;

// 회수 대상 상태는 `'pending' | 'mint_failed' | 'consumed'` 세 가지이고, 상태별로 죽음을
// 판정하는 조건이 다르다(아래 1-A/1-B). `'claimed'`는 attempt가 실제로 시작된 정상
// 거래이므로 어느 쿼리에도 포함되지 않는다.

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
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - ORPHAN_TTL_MS).toISOString();
  const SELECT_COLS = "token, user_id, child_id, reward_transaction_id, issued_at, status";

  // 1-A) `pending`/`mint_failed` — 소비 게이트로 **증명 가능하게** 죽은 행.
  //      소비 RPC의 조건이 `status in ('pending','mint_failed') and expires_at > now()
  //      and mint_attempts < 3`이므로, 만료됐거나 재시도가 소진된 행은 다시 소비되는 것이
  //      구조적으로 불가능하다 → 이중 지급 위험 0. 시간 컷오프보다 정확하고 빠르다.
  const { data: deadRows, error: deadErr } = await supabase
    .from("quiz_handoff_tokens")
    .select(SELECT_COLS)
    .in("status", ["pending", "mint_failed"])
    .not("reward_transaction_id", "is", null)
    .or(`expires_at.lte."${nowIso}",mint_attempts.gte.3`)
    .order("issued_at", { ascending: true })
    .limit(MAX_BATCH);

  if (deadErr) {
    console.error("[quiz-handoff-reconcile] dead-token lookup failed:", deadErr);
    return NextResponse.json({ error: "candidate_lookup_failed" }, { status: 500 });
  }

  // 1-B) `consumed` — 여기에는 위 게이트 논리를 **적용할 수 없다**.
  //      이미 소비된 행이라 "재소비 불가"는 자명하지만, 우리가 막아야 하는 건 재소비가
  //      아니라 "아직 attempt를 만들지 않은 살아있는 세션"이다. handoff 토큰 TTL은
  //      60초(`HANDOFF_TOKEN_TTL_SECONDS`)라서 `expires_at <= now()`를 이 상태에 적용하면
  //      토큰 발급 60초 뒤부터 회수 대상이 된다 — 아이가 학년·과목을 고르는 동안(60초는
  //      우습게 넘는다) 열쇠를 돌려주고, 그 뒤 attempt가 시작돼 **놀이도 하고 열쇠도 받는**
  //      이중 지급이 발생한다. attempt 교차확인도 이 구간에는 아직 attempt 행이 없어
  //      막아주지 못한다. 그래서 이 상태만 이어하기 창(6시간) 기준을 유지한다.
  const { data: staleConsumed, error: staleErr } = await supabase
    .from("quiz_handoff_tokens")
    .select(SELECT_COLS)
    .eq("status", "consumed")
    .not("reward_transaction_id", "is", null)
    .lt("issued_at", cutoffIso)
    .order("issued_at", { ascending: true })
    .limit(MAX_BATCH);

  if (staleErr) {
    console.error("[quiz-handoff-reconcile] stale-consumed lookup failed:", staleErr);
    return NextResponse.json({ error: "candidate_lookup_failed" }, { status: 500 });
  }

  const seen = new Set<string>();
  const rows = [...(deadRows ?? []), ...(staleConsumed ?? [])]
    .filter((r) => {
      const t = r.token as string;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .slice(0, MAX_BATCH);
  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun,
      cutoff: cutoffIso,
      scanned: 0,
      candidatesByStatus: {},
      refunded: [],
      skipped: { attemptExists: 0, alreadyRefunded: 0 },
      failures: [],
    });
  }

  const candidatesByStatus = rows.reduce<Record<string, number>>((acc, r) => {
    const s = r.status as string;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

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

  const refunded: Array<{
    rewardTransactionId: string;
    childId: string | null;
    status: string;
    count: number;
  }> = [];
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
      refunded.push({
        rewardTransactionId: txId,
        childId: row.child_id ?? null,
        status: row.status as string,
        count: 0,
      });
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
        status: row.status as string,
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
    candidatesByStatus,
    refunded,
    skipped: { attemptExists: skippedAttemptExists, alreadyRefunded: skippedAlreadyRefunded },
    failures,
    truncated: rows.length === MAX_BATCH,
  });
}
