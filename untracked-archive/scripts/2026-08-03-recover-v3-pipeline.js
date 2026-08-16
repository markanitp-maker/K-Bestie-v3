#!/usr/bin/env node
// 001-critical.md 대응: 안서아·안서현·윤도원의 누락/실패 V3 데이터를 실제
// 관리자 API(/api/admin/reporting/run, /pulse)를 통해 복구한다. 브라우저로
// 관리자 버튼을 누르는 것과 동일한 경로를 그대로 타므로 별도 로직을 새로
// 만들지 않는다. 비밀번호/키는 절대 출력하지 않는다.
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

async function getAdminCookieHeader() {
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);

  const session = verified.session;
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  // 청크 분할(Supabase SSR 쿠키 관례) — 3180바이트 초과 시 .0/.1 분할
  if (value.length <= 3180) {
    return `${cookieName}=${value}`;
  }
  const chunks = [];
  for (let i = 0; i < value.length; i += 3180) {
    chunks.push(`${cookieName}.${chunks.length}=${value.slice(i, i + 3180)}`);
  }
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

async function pulseUntilComplete(cookie, executionId, action, maxIters = 15) {
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
  const cookie = await getAdminCookieHeader();
  const results = [];

  for (const t of targets) {
    console.log(`\n=== ${t.name} ${t.businessDate} action=${t.action} ===`);
    const runData = await runAction(cookie, t.businessDate, t.action, t.childId);
    console.log(`execution_id=${runData.execution_id}`);
    const final = await pulseUntilComplete(cookie, runData.execution_id, t.action);
    console.log(JSON.stringify(final, null, 2));
    results.push({ ...t, execution_id: runData.execution_id, final });
  }

  fs.writeFileSync(
    path.join(__dirname, "../scratch_audit/001-recovery-results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("\n=== DONE, results saved to scratch_audit/001-recovery-results.json ===");
}

main().catch((e) => {
  console.error("RECOVERY_SCRIPT_ERROR:", e.message);
  process.exit(1);
});
