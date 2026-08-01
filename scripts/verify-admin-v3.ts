import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import dotenv from "dotenv";
import { processSpecificCollectionJobV3 } from "../lib/batch/collection";
import { processSpecificContextCorrectionJobV3 } from "../lib/batch/contextCorrectionV3";
import { processSpecificDailyReportJobV3 } from "../lib/batch/dailyReportV3";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!;
const supabaseKey = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!;
const db = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("=== V3 Pipeline Manual Admin Verification ===");
  const businessDate = "2026-08-01"; // Fixed date for test
  const todayStr = "2026-08-01";
  const cutoffAt = "2026-08-01T23:59:59+09:00";
  const workerId = `test_script_${Date.now()}`;
  
  const childId = "56235a1c-0427-4960-87b9-d3999a603f8c";
  console.log(`\nTest Subject Child ID: ${childId}`);
  console.log(`Business Date: ${businessDate}, Cutoff: ${cutoffAt}`);

  const executionId = crypto.randomUUID();
  console.log(`Execution ID: ${executionId}`);

  console.log("\n[1] Testing Daily Report Enqueue...");
  const repIdempotencyKey = `daily_report_${childId}_${businessDate}`;
  const { error: repEqErr } = await db.from('pipeline_jobs').upsert({
    id: crypto.randomUUID(),
    job_type: 'daily_report',
    child_id: childId,
    business_date: businessDate,
    execution_id: executionId,
    status: 'pending',
    attempt_count: 0,
    idempotency_key: repIdempotencyKey
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  
  if (repEqErr) {
    console.error("Report enqueue failed:", repEqErr);
  } else {
    console.log("Report enqueue success!");
  }
  // Test 1: Enqueue Manual Collection
  const colIdempotencyKey = `collection_manual_${childId}_${businessDate}_2_${new Date(cutoffAt).getTime() / 1000}`;
  const { error: eqErr } = await db.from('pipeline_jobs').upsert({
    id: crypto.randomUUID(),
    job_type: 'collection_2',
    child_id: childId,
    business_date: businessDate,
    collection_phase: 2,
    cutoff_at: cutoffAt,
    execution_id: executionId,
    status: 'pending',
    attempt_count: 0,
    idempotency_key: colIdempotencyKey
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  if (eqErr) {
    console.error("Enqueue failed:", eqErr);
    return;
  }
  console.log("Enqueue Success!");

  // Test 2: Process Manual Collection
  console.log("\n[2] Processing Manual Collection...");
  const colRes = await processSpecificCollectionJobV3(2, childId, businessDate, workerId);
  console.log("Collection Result:", colRes);

  // Test 3: Process Context Correction (if collection was created/updated)
  console.log("\n[3] Processing Context Correction...");
  const corRes = await processSpecificContextCorrectionJobV3(childId, businessDate, workerId);
  console.log("Correction Result:", corRes);

  // Test 4: Enqueue & Process Daily Report
  console.log("\n[4] Processing Daily Report...");
  const repRes = await processSpecificDailyReportJobV3(childId, businessDate, workerId);
  console.log("Report Result:", repRes);

  // Check Pipeline Jobs Table for status
  console.log("\n[5] Checking Pipeline Jobs Status...");
  const { data: jobs } = await db
    .from("pipeline_jobs")
    .select("job_type, status, error_code")
    .eq("execution_id", executionId);
  
  console.log("Jobs for this execution:");
  console.table(jobs);

  console.log("\n✅ Verification Script Complete");
}

run().catch(console.error);
