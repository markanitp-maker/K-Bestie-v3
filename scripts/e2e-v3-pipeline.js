const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { createChunks, stringToBase64URL } = require('@supabase/ssr');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY;
const adminEmail = process.env.ADMIN_EMAILS?.split(",")[0] || "markanitp@gmail.com";
const adminPassword = process.env.QA_TEST_PASSWORD || "QaDev1c65f921aea7!";

const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const authDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const bDate = "2026-08-01";
const c1Id = crypto.randomUUID();
const c2Id = crypto.randomUUID();
const fixtureSessionId = crypto.randomUUID();

let adminUserId = null;
let existingFamilyId = null;

async function setup() {
  console.log("=== Setup Fixtures ===");
  const { data: authData, error: authErr } = await authDb.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (authErr) throw new Error("Sign in failed: " + authErr.message);
  adminUserId = authData.user.id;
  
  const { data: fams } = await adminDb.from('families').select('id').limit(1);
  existingFamilyId = fams[0].id;

  await cleanup();

  const { error: cErr } = await adminDb.from('child_profiles').insert([
    { id: c1Id, family_id: existingFamilyId, name: "Test C1 E2E", grade: "1학년", gender: "male" },
    { id: c2Id, family_id: existingFamilyId, name: "Test C2 E2E", grade: "1학년", gender: "female" },
  ]);
  if (cErr) throw new Error("Child insert failed: " + cErr.message);

  const { error: ctrlErr } = await adminDb.from("pipeline_v3_control").upsert({
    id: 1,
    enabled: true,
    cutover_at: new Date(Date.now() - 100000).toISOString()
  });
  if (ctrlErr) throw new Error("pipeline_v3_control upsert failed: " + ctrlErr.message);
  
  console.log("Setting up D. Cleanup fixtures...");
  const { error: sessErr } = await adminDb.from('chat_sessions').insert({
    id: fixtureSessionId, child_id: c2Id, session_type: "free_chat"
  });
  if (sessErr) throw new Error("Session insert failed: " + sessErr.message);
  
  const m1Id = crypto.randomUUID(); 
  const m2Id = crypto.randomUUID(); 
  const m3Id = crypto.randomUUID(); 
  const m4Id = crypto.randomUUID(); 
  
  const cutoff = new Date('2026-08-01T00:00:00Z').toISOString();
  const beforeCutoff = new Date('2026-07-31T20:00:00Z').toISOString();
  const afterCutoff = new Date('2026-08-01T10:00:00Z').toISOString();
  
  const { error: msgErr } = await adminDb.from('chat_messages').insert([
    { id: m1Id, session_id: fixtureSessionId, role: "child", content: "del1", collected_at: beforeCutoff, created_at: beforeCutoff },
    { id: m2Id, session_id: fixtureSessionId, role: "child", content: "del2", collected_at: beforeCutoff, created_at: beforeCutoff },
    { id: m3Id, session_id: fixtureSessionId, role: "child", content: "keep1", collected_at: null, created_at: beforeCutoff },
    { id: m4Id, session_id: fixtureSessionId, role: "child", content: "keep2", collected_at: afterCutoff, created_at: afterCutoff }
  ]);
  if (msgErr) throw new Error("Chat message insert failed: " + msgErr.message);
  
  console.log("Setting up E. Retention fixtures...");
  const oldDate = "2026-07-20";
  const recentDate = "2026-07-30";
  
  const oldRawId = crypto.randomUUID();
  const recentRawId = crypto.randomUUID();
  const oldCorrId = crypto.randomUUID();
  const recentCorrId = crypto.randomUUID();
  
  await adminDb.from('raw_daily_conversations_v3').insert([
    { id: oldRawId, child_id: c1Id, business_date: oldDate },
    { id: recentRawId, child_id: c1Id, business_date: recentDate }
  ]);
  await adminDb.from('corrected_daily_conversations_v3').insert([
    { id: oldCorrId, child_id: c1Id, business_date: oldDate, status: "completed", corrected_data: {} },
    { id: recentCorrId, child_id: c1Id, business_date: recentDate, status: "completed", corrected_data: {} }
  ]);
  
  return { authData, m1Id, m2Id, m3Id, m4Id, oldRawId, recentRawId, oldCorrId, recentCorrId, cutoff };
}

async function cleanup() {
  console.log("=== Cleaning up Fixture ===");
  await adminDb.from("chat_messages").delete().eq('session_id', fixtureSessionId);
  await adminDb.from("chat_sessions").delete().eq('id', fixtureSessionId);
  
  await adminDb.from("raw_daily_conversations_v3").delete().in('business_date', ["2026-07-20", "2026-07-30", bDate]);
  await adminDb.from("corrected_daily_conversations_v3").delete().in('business_date', ["2026-07-20", "2026-07-30", bDate]);
  
  await adminDb.from("pipeline_execution_items").delete().in("business_date", [bDate, "2026-07-20", "2026-07-30"]);
  
  await adminDb.from("child_profiles").delete().in('id', [c1Id, c2Id]);
  
  await adminDb.from("pipeline_v3_control").update({ enabled: false, cutover_at: null }).eq('id', 1);
}

async function pollPulse(page, execId, action, targetCount) {
  let isComplete = false;
  let attempts = 0;
  let lastStatus = null;
  while (!isComplete && attempts < 15) {
    attempts++;
    await page.waitForTimeout(2000);
    const pulseData = await page.evaluate(async (args) => {
      const res = await fetch('/api/admin/reporting/pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      return { status: res.status, data: await res.json() };
    }, { executionId: execId, action, targetCount });
    
    if (pulseData.status !== 200 || !pulseData.data.ok) {
      console.log(`[Pulse Polling Error] status: ${pulseData.status}`, pulseData.data);
      break;
    }
    lastStatus = pulseData.data;
    if (pulseData.data.isComplete) {
      isComplete = true;
    }
  }
  return lastStatus;
}

(async () => {
  let browser;
  try {
    const fixtures = await setup();
    
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const projectRef = SUPABASE_URL.match(/:\/\/([^.]+)\.supabase/)?.[1] || "";
    const cookieName = `sb-${projectRef}-auth-token`;
    const encodedSession = 'base64-' + stringToBase64URL(JSON.stringify(fixtures.authData.session));
    const chunks = createChunks(cookieName, encodedSession);
    const cookies = chunks.map(c => ({
      name: c.name, value: c.value, domain: '127.0.0.1', path: '/'
    }));
    await context.addCookies(cookies);
    await page.goto('http://127.0.0.1:3000/');
    await page.waitForTimeout(1000);

    console.log("=== A. Admin Single API ===");
    for (const action of ["collect", "generate", "collect_and_generate"]) {
      console.log(`\n[-- action: ${action} ---]`);
      let res = await page.evaluate(async (args) => {
        const r = await fetch('/api/admin/reporting/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({action: args.action, target: {scope: "single", childId: args.c1Id}, businessDate: args.bDate})
        });
        return { status: r.status, data: await r.json() };
      }, { action, c1Id, bDate });
      
      console.log(`Run status: ${res.status}`);
      if (res.status !== 200) {
        console.log(`Run error:`, res.data);
        if (res.data?.error?.includes("No conversations collected")) {
           console.log("Expected business error, continuing...");
        } else {
           throw new Error("Unexpected error status for A");
        }
      } else {
        const execId = res.data.execution_id;
        console.log(`Execution ID: ${execId}`);
        const pulse = await pollPulse(page, execId, action, 1);
        console.log(`Pulse final state: complete=${pulse?.isComplete}, partialFailure=${pulse?.partialFailure}`);
      }
    }

    console.log("\n[=== B & C. Admin All API & Memory Batch ===]");
    let allRes = await page.evaluate(async (args) => {
      const r = await fetch('/api/admin/reporting/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({action: "collect_and_generate", target: {scope: "all"}, businessDate: args.bDate})
      });
      return { status: r.status, data: await r.json() };
    }, { bDate });
    console.log(`Run all status: ${allRes.status}`);
    if (allRes.data.execution_id) {
      const pulseAll = await pollPulse(page, allRes.data.execution_id, "collect_and_generate", allRes.data.targetCount);
      console.log(`Pulse All final state: complete=${pulseAll?.isComplete}`);
      console.log("Summary:", JSON.stringify(pulseAll?.summary, null, 2));
      
      const ourChildStatus = pulseAll?.statuses?.find(s => s.childId === c1Id);
      console.log(`Child C1 status: Memory=${ourChildStatus?.memory || "skipped"}, Report=${ourChildStatus?.report || "skipped"}`);
    }

    console.log("\n[=== D. Cleanup Actual Validation ===]");
    const { data: dRes, error: dErr } = await adminDb.rpc("cleanup_chat_messages_v3", {
      p_cutoff_at: fixtures.cutoff,
      p_limit: 1000
    });
    console.log(`RPC cleanup_chat_messages_v3 returned: ${dRes}`);
    if (dErr) console.error(dErr);
    
    const { data: dMsgs } = await adminDb.from('chat_messages').select('id, collected_at').eq('session_id', fixtureSessionId);
    console.log("Remaining chat messages count:", dMsgs.length);
    const hasM1 = dMsgs.find(m => m.id === fixtures.m1Id);
    const hasM2 = dMsgs.find(m => m.id === fixtures.m2Id);
    const hasM3 = dMsgs.find(m => m.id === fixtures.m3Id);
    const hasM4 = dMsgs.find(m => m.id === fixtures.m4Id);
    console.log(`m1 (del): ${!hasM1}, m2 (del): ${!hasM2}, m3 (keep null): ${!!hasM3}, m4 (keep new): ${!!hasM4}`);
    
    const { data: dRes2 } = await adminDb.rpc("cleanup_chat_messages_v3", { p_cutoff_at: fixtures.cutoff, p_limit: 1000 });
    console.log(`2nd RPC cleanup_chat_messages_v3 returned: ${dRes2}`);

    console.log("\n[=== E. Retention Actual Validation ===]");
    const retCutoff = "2026-07-25";
    const { data: rRes, error: rErr } = await adminDb.rpc("purge_v3_retention_batch", {
      p_cutoff_date: retCutoff,
      p_limit: 1000
    });
    console.log(`RPC purge_v3_retention_batch returned:`, rRes);
    if (rErr) console.error(rErr);
    
    const { data: rRaws } = await adminDb.from('raw_daily_conversations_v3').select('id');
    const { data: rCorrs } = await adminDb.from('corrected_daily_conversations_v3').select('id');
    const hasOldRaw = rRaws.find(m => m.id === fixtures.oldRawId);
    const hasNewRaw = rRaws.find(m => m.id === fixtures.recentRawId);
    const hasOldCorr = rCorrs.find(m => m.id === fixtures.oldCorrId);
    const hasNewCorr = rCorrs.find(m => m.id === fixtures.recentCorrId);
    console.log(`oldRaw (del): ${!hasOldRaw}, newRaw (keep): ${!!hasNewRaw}`);
    console.log(`oldCorr (del): ${!hasOldCorr}, newCorr (keep): ${!!hasNewCorr}`);
    
    const { data: rRes2 } = await adminDb.rpc("purge_v3_retention_batch", { p_cutoff_date: retCutoff, p_limit: 1000 });
    console.log(`2nd RPC purge_v3_retention_batch returned:`, rRes2);

  } catch (e) {
    console.error("Test failed:", e);
  } finally {
    if (browser) await browser.close();
    await cleanup();
    
    const { data: fRaws } = await adminDb.from('raw_daily_conversations_v3').select('id').eq('child_id', c1Id);
    const { data: fCorrs } = await adminDb.from('corrected_daily_conversations_v3').select('id').eq('child_id', c1Id);
    const { data: fMsgs } = await adminDb.from('chat_messages').select('id').eq('session_id', fixtureSessionId);
    const { data: cProfiles } = await adminDb.from('child_profiles').select('id').in('id', [c1Id, c2Id]);
    console.log("\n[=== F. Final Check ===]");
    console.log(`Fixtures remaining: Raw=${fRaws.length}, Corr=${fCorrs.length}, Msg3=${fMsgs.length}, Children=${cProfiles.length}`);
    
    const { data: ctrl } = await adminDb.from('pipeline_v3_control').select('*').eq('id', 1).single();
    console.log(`Control state: enabled=${ctrl.enabled}, cutover_at=${ctrl.cutover_at}`);
  }
})();
