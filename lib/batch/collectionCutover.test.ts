import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

test("Production collection Cron은 23:55 KST phase=2 daily enqueue를 사용한다", () => {
  // 094(2026-08-17): 17:55 phase=1 을 없애고 23:55 phase=2 단독으로 간다.
  //
  // 과거에 단일 23:55 안이 게이트에서 2회 반려된 적이 있다. 사유는
  // "주간 자유대화 수집 누락"과 "late-write 미보장"이었다. 그때 반려된 안은
  // worker 를 00:00~03:50 폴링으로 바꾸는 것까지 묶여 있었다. 이번엔 worker 와
  // reconcile 을 그대로 두므로 그 반려가 그대로 적용되지 않는다.
  //
  // 두 사유를 Production DB 함수로 다시 확인했다:
  //  - enqueue_collection_jobs_v3: phase2 창은 00:00 ~ 익일 00:00 이다(하루 전체).
  //    phase1 은 00:00~17:55 였다. 즉 phase2 는 증분이 아니라 하루 전부를 덮는다.
  //  - collect_chat_messages_v3: `collected_at IS NULL` 로 중복만 걸러내고,
  //    phase2 는 mission_phase IN (1,2) + 비미션 세션 전부를 가져간다.
  //    함수 안의 17:55 는 구간 라벨 계산용이지 수집 필터가 아니다.
  //  - 23:55~24:00 사이 late-write 는 phase1 이 있을 때도 못 가져왔다.
  //    00:10 reconcile 이 덮는 범위이고, 이번 변경으로 달라지지 않는다.
  const config = JSON.parse(read("vercel.json")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const collectionCrons = config.crons.filter((cron) =>
    cron.path.startsWith("/api/batch/v3/collection/enqueue"),
  );

  assert.deepEqual(collectionCrons, [
    { path: "/api/batch/v3/collection/enqueue?phase=2", schedule: "55 14 * * *" },
  ]);
  assert.ok(!config.crons.some((cron) => cron.path === "/api/batch/v3/worker"));
});

test("마감 수집 DB 계약은 late write, retry, idempotency를 보존한다", () => {
  const reconcileSql = read(
    "supabase/migrations/20260808130000_fix_night_only_pipeline_candidates_and_reconcile.sql",
  );
  const enqueueCoreSql = read(
    "supabase/migrations/20260803100000_fix_v3_pipeline_forward_chaining.sql",
  );

  assert.match(reconcileSql, /m\.created_at\s*<\s*v_end[\s\S]*m\.collected_at IS NULL/i);
  assert.match(reconcileSql, /job_type='collection_2' AND status='failed'/i);
  assert.match(reconcileSql, /NOT EXISTS[\s\S]*job_type='collection_2'/i);
  assert.match(enqueueCoreSql, /pg_advisory_xact_lock/i);
  assert.match(enqueueCoreSql, /v_job_status = 'completed'[\s\S]*v_uncollected > 0/i);
  assert.match(enqueueCoreSql, /v_job_status = 'failed'[\s\S]*status = 'pending'/i);
});
