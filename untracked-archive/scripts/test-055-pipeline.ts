import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("=== 055 Pipeline UPSERT Test ===");
  const childId = "00000000-0000-0000-0000-000000000001"; // Need a valid child id. Let's find one.
  const { data: child } = await db.from("child_profiles").select("id").limit(1).single();
  if (!child) {
    console.error("No child profile found in Dev DB.");
    return;
  }
  const testChildId = child.id;
  const testDate = new Date().toISOString().split("T")[0];
  const executionId = crypto.randomUUID();

  console.log(`Target Child: ${testChildId}, Date: ${testDate}`);

  // Test 17.1 & 17.2 & 17.3: Concurrent / Sequential Job Execution
  // First, ensure no pipeline jobs exist for this date to start fresh.
  await db.from("pipeline_jobs").delete().eq("child_id", testChildId).eq("business_date", testDate);
  await db.from("daily_reports").delete().eq("child_id", testChildId).eq("business_date", testDate);
  await db.from("pipeline_execution_items").delete().eq("child_id", testChildId).eq("business_date", testDate);

  console.log("\n[17.1, 17.2] Initial manual enqueue...");
  // Simulate manual generation context via pipeline execution item
  await db.from("pipeline_execution_items").insert({
    execution_id: executionId,
    child_id: testChildId,
    business_date: testDate,
    job_type: "daily_report",
    item_key: "daily_report",
    status: "pending"
  });

  // Call the atomic RPC to enqueue
  const { error: enqueueErr1 } = await db.rpc("enqueue_daily_report_job_v3", {
    p_child_id: testChildId,
    p_business_date: testDate,
    p_execution_id: executionId
  });
  if (enqueueErr1) console.error("Enqueue Err 1:", enqueueErr1);

  // Run the batch worker to process it, pretending it's manual (workerId starts with admin_pulse)
  // But wait, the script cannot easily call the worker route, we can call processDailyReportJobsV3 directly!
  // However, script doesn't have access to next/server. We can just invoke the RPC `save_and_complete_daily_report_job_v3` directly.
  
  const jobIdRes = await db.from("pipeline_jobs").select("id").eq("child_id", testChildId).eq("business_date", testDate).eq("job_type", "daily_report").single();
  const jobId = jobIdRes.data?.id;

  console.log("Job ID:", jobId);
  
  if (jobId) {
    // Manually claim the job for testing
    await db.from("pipeline_jobs").update({
      status: 'processing',
      claimed_by: 'test_worker',
      claim_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }).eq("id", jobId);

    // 17.2: Simulate processing
    const { data: completeRes, error: completeErr } = await db.rpc("save_and_complete_daily_report_job_v3", {
      p_job_id: jobId,
      p_claimed_by: "test_worker",
      p_child_id: testChildId,
      p_business_date: testDate,
      p_generation_source: "manual",
      p_source_data_updated_at: new Date().toISOString(),
      p_model_version: "test-model",
      p_report_payload: {
        school_academy_life: "Test 1",
        peer_friendship: "Test 2"
      }
    });
    console.log("Save & Complete Result (Manual):", completeRes, completeErr);

    // Verify 17.2
    const { data: report1 } = await db.from("daily_reports").select("*").eq("child_id", testChildId).eq("business_date", testDate).order('created_at', { ascending: false }).limit(1).single();
    console.log("Report Generation Source:", report1?.generation_source);
    console.log("Report Generation Version:", report1?.generation_version);
    if (report1?.generation_source === "manual") console.log("✅ 17.2 PASS");
    else console.log("❌ 17.2 FAIL");

    // 17.3: Already scheduled report exists, manual regenerate
    // Pretend we enqueue again
    const execId2 = crypto.randomUUID();
    await db.from("pipeline_execution_items").insert({
        execution_id: execId2,
        child_id: testChildId,
        business_date: testDate,
        job_type: "daily_report",
        item_key: "daily_report",
        status: "pending"
    });
    await db.rpc("enqueue_daily_report_job_v3", { p_child_id: testChildId, p_business_date: testDate, p_execution_id: execId2 });
    
    const jobIdRes2 = await db.from("pipeline_jobs").select("id").eq("child_id", testChildId).eq("business_date", testDate).eq("job_type", "daily_report").single();
    
    await db.from("pipeline_jobs").update({
      status: 'processing',
      claimed_by: 'test_worker',
      claim_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }).eq("id", jobIdRes2.data?.id);

    const { data: completeRes2, error: completeErr2 } = await db.rpc("save_and_complete_daily_report_job_v3", {
      p_job_id: jobIdRes2.data?.id,
      p_claimed_by: "test_worker",
      p_child_id: testChildId,
      p_business_date: testDate,
      p_generation_source: "manual", 
      p_source_data_updated_at: new Date().toISOString(),
      p_model_version: "test-model",
      p_report_payload: {
        school_academy_life: "Test 1 Updated",
        peer_friendship: "Test 2 Updated"
      }
    });

    console.log("Save & Complete Result 2 (Manual over manual):", completeRes2, completeErr2);
    
    const { data: report2 } = await db.from("daily_reports").select("*").eq("child_id", testChildId).eq("business_date", testDate).order('created_at', { ascending: false }).limit(1).single();
    console.log("Updated Report Generation Source:", report2?.generation_source);
    console.log("Updated Report Generation Version:", report2?.generation_version);
    if (report2?.generation_version === (report1?.generation_version || 1) + 1) console.log("✅ 17.3 PASS");
    else console.log("❌ 17.3 FAIL");
  }

  console.log("\n[17.6, 17.7] Admin screen data verification...");
  // Simulate route call response format
  const { data: reports } = await db
    .from("daily_reports")
    .select("child_id, created_at, updated_at, generation_source, generation_version")
    .eq("business_date", testDate)
    .eq("child_id", testChildId);

  if (reports && reports.length > 0) {
     const r = reports[0];
     console.log("pulse / children route data mapping:");
     console.log("lastReportGeneratedAt:", r.updated_at || r.created_at);
     console.log("generationSource:", r.generation_source);
     console.log("generationVersion:", r.generation_version);
     console.log("✅ 17.6, 17.7 PASS (Data available for UI mapping)");
  } else {
     console.log("❌ 17.6, 17.7 FAIL");
  }

}

run().catch(console.error);
