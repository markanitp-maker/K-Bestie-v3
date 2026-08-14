import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260814100000_support_request_responses_notifications.sql", import.meta.url),
  "utf8"
);

test("공개 답변은 내부 메모와 별도 컬럼으로 저장한다", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS user_response text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS response_version integer NOT NULL DEFAULT 0/);
  assert.match(sql, /admin_note = CASE WHEN p_admin_note IS NOT NULL THEN p_admin_note ELSE admin_note END/);
  assert.match(sql, /user_response = v_response/);
});

test("단건 처리는 row lock 뒤 no-op과 동일 trace 재시도를 멱등 처리한다", () => {
  assert.match(sql, /WHERE id = p_request_id AND deleted_at IS NULL\s+FOR UPDATE/);
  assert.match(sql, /request_id = p_request_trace_id/);
  assert.match(sql, /IF NOT v_status_changed[\s\S]+RETURN jsonb_build_object/);
  assert.match(sql, /ON CONFLICT \(idempotency_key\) DO NOTHING/g);
});

test("답변과 중요 상태만 사용자 inbox 알림을 만들고 guest는 제외한다", () => {
  assert.match(sql, /v_after\.user_id IS NOT NULL/);
  assert.match(sql, /v_after\.submitter_role IN \('parent', 'child'\)/);
  assert.match(sql, /v_after\.status IN \('in_progress', 'resolved'\)/);
  assert.match(sql, /support:' \|\| v_after\.id::text \|\| ':response:'/);
  assert.match(sql, /support:' \|\| v_after\.id::text \|\| ':status:'/);
  assert.match(sql, /'\/support\/requests\/' \|\| v_after\.id::text/g);
});

test("인증 사용자의 직접 SELECT에서 내부 CS 필드를 제외한다", () => {
  const grant = sql.match(/GRANT SELECT \(([\s\S]+?)\) ON public\.support_requests TO authenticated;/)?.[1] ?? "";
  assert.doesNotMatch(grant, /admin_note/);
  assert.doesNotMatch(grant, /contact_email/);
  assert.doesNotMatch(grant, /device_info/);
  assert.match(grant, /user_response/);
});

test("bulk v2는 중복 id를 제거하고 단건 v2를 재사용해 알림 id를 반환한다", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_bulk_update_support_request_status_v2/);
  assert.match(sql, /cardinality\(p_request_ids\) = 0/);
  assert.match(sql, /cardinality\(p_request_ids\) > 200/);
  assert.match(sql, /p_status IS NULL OR p_status NOT IN \('open','in_progress','resolved','closed'\)/);
  assert.match(sql, /SELECT DISTINCT request_id[\s\S]+ORDER BY request_id/);
  assert.match(sql, /public\.admin_update_support_request_v2\(/);
  assert.match(sql, /p_request_trace_id \|\| ':' \|\| v_id::text/);
  assert.match(sql, /v_notification_ids := v_notification_ids \|\| COALESCE\(v_result->'notification_ids', '\[\]'::jsonb\)/);
  assert.match(sql, /'updated_count', v_count/);
  assert.match(sql, /'notification_ids', v_notification_ids/);
  assert.doesNotMatch(sql, /EXCEPTION\s+WHEN[\s\S]+admin_bulk_update_support_request_status_v2/);
});

test("새 관리자 RPC는 service_role 전용이고 v1을 제거하지 않는다", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_update_support_request_v2[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_update_support_request_v2[\s\S]+TO service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_bulk_update_support_request_status_v2[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_bulk_update_support_request_status_v2[\s\S]+TO service_role/);
  assert.doesNotMatch(sql, /DROP FUNCTION[^;]+admin_update_support_request_v1/);
});
