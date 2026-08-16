#!/usr/bin/env node
// 001/002-critical.md: 안서아·안서현의 cutover_at(2026-08-01 20:46:53 UTC) 이전
// 날짜(07-29~08-01)는 collect_chat_messages_v3의 cutover_at 필터에 막혀 정상
// collect_and_generate로는 수집되지 않는다. cutover_at을 광범위하게 과거로
// 되돌리지 않기 위해, 아주 짧은 시간만 cutover_at을 낮춘 뒤 지정된 (child,date)
// 쌍만 순차적으로 collect_and_generate를 실행하고, 즉시 원래 값으로 복원한다.
// 이 창구가 열려 있는 동안에는 이 스크립트 외의 어떤 수집도 트리거하지 않는다
// (pg_cron은 17:55/23:55 KST 고정 스케줄이라 지금 시간대에는 충돌하지 않음).
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const envPath = path.join(__dirname, "../.env.local");
const envVars = {};
fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
});

const SUPABASE_URL = envVars["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_ROLE_KEY = envVars["SUPABASE_SERVICE_ROLE_KEY"];
const ANON_KEY = envVars["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const BASE = "https://app.k-bestie.com";
const ADMIN_EMAIL = "markanitp@gmail.com";
const ORIGINAL_CUTOVER_AT = "2026-08-01T20:46:53.000Z";
const TEMP_CUTOVER_AT = "2026-07-01T00:00:00.000Z";

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function getCutoverAt() {
  const { data, error } = await service.from("pipeline_v3_control").select("cutover_at").eq("id", 1).single();
  if (error) throw new Error(`read cutover_at failed: ${error.message}`);
  return data.cutover_at;
}

async function setCutoverAt(iso) {
  const { error } = await service.from("pipeline_v3_control").update({ cutover_at: iso }).eq("id", 1);
  if (error) throw new Error(`update cutover_at failed: ${error.message}`);
}

async function getAdminCookieHeader() {
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  const session = verified.session;
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  if (value.length <= 3180) return `${cookieName}=${value}`;
  const chunks = [];
  for (let i = 0; i < value.length; i += 3180) chunks.push(`${cookieName}.${chunks.length}=${value.slice(i, i + 3180)}`);
  return chunks.join("; ");
}

async function runAction(cookie, businessDate, action, childId) {
  const res = await fetch(`${BASE}/api/admin/reporting/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ businessDate, action, target: { scope: "single", childId } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`run failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function pulseUntilComplete(cookie, executionId, action, maxIters = 20) {
  let last = null;
  for (let i = 0; i < maxIters; i++) {
    const res = await fetch(`${BASE}/api/admin/reporting/pulse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ executionId, action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`pulse failed (${res.status}): ${JSON.stringify(data)}`);
    last = data;
    if (data.isComplete) return data;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return last;
}

async function main() {
  const targets = JSON.parse(process.argv[2]);
  const before = await getCutoverAt();
  console.log(`cutover_at before: ${before}`);
  if (Math.abs(new Date(before).getTime() - new Date(ORIGINAL_CUTOVER_AT).getTime()) > 1000) {
    throw new Error(`SAFETY ABORT: cutover_at(${before}) != expected(${ORIGINAL_CUTOVER_AT}) — 다른 세션이 이미 바꿨을 수 있음. 확인 필요.`);
  }
  const RESTORE_TO = before; // 실제 현재값(소수점까지)을 그대로 복원 대상으로 사용

  const cookie = await getAdminCookieHeader();
  const results = [];
  let restored = false;
  try {
    await setCutoverAt(TEMP_CUTOVER_AT);
    console.log(`cutover_at temporarily lowered to ${TEMP_CUTOVER_AT}`);

    for (const t of targets) {
      console.log(`\n=== ${t.name} ${t.businessDate} collect_and_generate ===`);
      const runData = await runAction(cookie, t.businessDate, "collect_and_generate", t.childId);
      const final = await pulseUntilComplete(cookie, runData.execution_id, "collect_and_generate");
      console.log(JSON.stringify(final, null, 2));
      results.push({ ...t, execution_id: runData.execution_id, final });
    }
  } finally {
    await setCutoverAt(RESTORE_TO);
    const after = await getCutoverAt();
    restored = Math.abs(new Date(after).getTime() - new Date(RESTORE_TO).getTime()) < 1000;
    console.log(`cutover_at restored to ${after} (restored=${restored})`);
  }

  fs.writeFileSync(
    path.join(__dirname, "../scratch_audit/002-backfill-results.json"),
    JSON.stringify({ restored, results }, null, 2)
  );
  console.log("\n=== DONE ===");
  if (!restored) {
    console.error("CRITICAL: cutover_at was NOT restored correctly — manual check required immediately.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("BACKFILL_SCRIPT_ERROR:", e.message);
  process.exit(1);
});
