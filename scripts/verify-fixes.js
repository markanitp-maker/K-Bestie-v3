#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const TOKEN = envVars['SUPABASE_ACCESS_TOKEN'];
const PROJECT_REF = 'fetvnhhjicndmxvhrffk';

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN not found.');
  process.exit(1);
}

async function runSQL(q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : { success: true };
}

async function verify() {
  try {
    console.log("=== (a) create_family_with_owner exists & families trigger ===");
    let r = await runSQL("SELECT proname FROM pg_proc WHERE proname = 'create_family_with_owner';");
    console.log("Function:", r);
    r = await runSQL("SELECT event_manipulation FROM information_schema.triggers WHERE trigger_name = 'trg_owner_succession_guard_families' AND event_object_table = 'families';");
    console.log("Trigger events:", r.map(x => x.event_manipulation).join(', '));

    console.log("\n=== (b) fn_check_owner_succession_guard contains 'IS NULL OR' ===");
    r = await runSQL("SELECT prosrc LIKE '%IS NULL OR%' as has_is_null_or FROM pg_proc WHERE proname = 'fn_check_owner_succession_guard';");
    console.log(r);

    console.log("\n=== (c) restore/purge functions contain 'account_withdrawal_' ===");
    r = await runSQL("SELECT proname, prosrc LIKE '%account_withdrawal_%' as has_lock FROM pg_proc WHERE proname IN ('request_account_restore', 'admin_approve_account_restore', 'admin_reject_account_restore', 'purge_account_family_data');");
    console.log(r);

    console.log("\n=== (d) families.purge_initiated_by & admin_approve_account_restore ===");
    r = await runSQL("SELECT column_name FROM information_schema.columns WHERE table_name = 'families' AND column_name = 'purge_initiated_by';");
    console.log("Column:", r);
    r = await runSQL("SELECT prosrc LIKE '%purge_initiated_by%' as has_purge_initiated_by FROM pg_proc WHERE proname = 'admin_approve_account_restore';");
    console.log("Function:", r);

    console.log("\n=== (e) request_account_withdrawal contains p_confirmed_last_guardian ===");
    r = await runSQL("SELECT prosrc LIKE '%p_confirmed_last_guardian%' AND prosrc LIKE '%last_guardian_confirmation_required%' as has_params FROM pg_proc WHERE proname = 'request_account_withdrawal';");
    console.log(r);

    console.log("\n=== (f) INSERT test (should fail with FK error) ===");
    try {
      await runSQL("SELECT * FROM public.create_family_with_owner(gen_random_uuid(), '임시검증가족');");
      console.log("FAILED: Expected error but succeeded.");
    } catch (e) {
      console.log("SUCCESS: Caught error:", e.message);
    }
  } catch(e) {
    console.error("Verification error:", e);
  }
}

verify();
