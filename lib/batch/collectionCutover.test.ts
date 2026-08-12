import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

test("Production collection Cron은 17:55/23:55 KST phase=1/phase=2 daily enqueue를 사용한다", () => {
  // 단일 23:55 daily enqueue + 00:00-03:50 KST worker 폴링 설계는 게이트①에서
  // 2회 독립 [복잡] 반려됐다(주간 자유대화 수집 누락, late-write 미보장) —
  // vercel.json은 원래의 phase=1/phase=2 두 crons 구성으로 원복됐다.
  const config = JSON.parse(read("vercel.json")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const collectionCrons = config.crons.filter((cron) =>
    cron.path.startsWith("/api/batch/v3/collection/enqueue"),
  );

  assert.deepEqual(collectionCrons, [
    { path: "/api/batch/v3/collection/enqueue?phase=1", schedule: "55 8 * * *" },
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
