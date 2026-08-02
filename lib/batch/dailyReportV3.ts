import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { extractJSON } from "@/app/api/_lib/utils";

const REPORT_PROMPT_TEMPLATE = `
아이의 오늘 하루 대화 전문입니다. 이를 바탕으로 부모님을 위한 요약 리포트를 작성해주세요.

[오늘의 대화록]
{{TRANSCRIPT}}

반드시 JSON 형식으로 다음 필드를 포함해 응답하세요.
{
  "summary_line": "한 줄 요약 (예: 오늘은 유치원에서 재미있는 일이 있었다고 합니다)",
  "mood_score": 5,
  "emotion_tags": ["신남", "기대"],
  "parent_guide": "부모님을 위한 조언",
  "emotion_level": "safe",
  "school_academy_life": "...",
  "peer_friendship": "...",
  "emotion_hint": "...",
  "interests_preferences": "...",
  "study_concerns": "...",
  "digital_content_interests": "...",
  "future_dreams": "...",
  "recurring_stories": "..."
}
`;

function sanitizeReportJson(obj: any) {
  if (!obj || typeof obj !== "object") {
    throw new Error("Invalid report object");
  }
  const str = (v: any) => (typeof v === "string" ? v.trim() : "");
  const moodScore = Math.max(1, Math.min(10, Math.round(typeof obj.mood_score === "number" ? obj.mood_score : 5)));
  const emotionLevel = (obj.emotion_level === "warning" || obj.emotion_level === "danger") ? obj.emotion_level : "safe";
  const emotionTags = Array.isArray(obj.emotion_tags)
    ? obj.emotion_tags.filter((t: any) => typeof t === "string" && t.trim() !== "")
    : [];

  return {
    summary_line: str(obj.summary_line),
    mood_score: moodScore,
    emotion_tags: emotionTags,
    parent_guide: str(obj.parent_guide),
    emotion_level: emotionLevel,
    school_academy_life: str(obj.school_academy_life),
    peer_friendship: str(obj.peer_friendship),
    emotion_hint: str(obj.emotion_hint),
    interests_preferences: str(obj.interests_preferences),
    study_concerns: str(obj.study_concerns),
    digital_content_interests: str(obj.digital_content_interests),
    future_dreams: str(obj.future_dreams),
    recurring_stories: str(obj.recurring_stories),
  };
}

export type DailyReportResultV3 = { completed: number; skipped: number; failed: number; errors: any[] };

async function processSingleReportJob(
  db: ReturnType<typeof createServiceClient>,
  job: any,
  workerId: string,
  reportModel: any,
  ai: any
): Promise<"completed" | "skipped"> {
  // 1. Fetch corrected_daily_conversations_v3
  const { data: corrConv, error: corrErr } = await db
    .from("corrected_daily_conversations_v3")
    .select("*")
    .eq("child_id", job.child_id)
    .eq("business_date", job.business_date)
    .or("status.eq.completed,correction_status.eq.completed")
    .maybeSingle();

  if (corrErr) throw new Error(`DB_ERROR: ${corrErr.message}`);

  // No corrected conversation -> SKIPPED report outcome
  if (!corrConv) {
    const { error: compErr } = await db.rpc("complete_daily_report_job_v3", {
      p_job_id: job.id,
      p_claimed_by: workerId,
      p_child_id: job.child_id,
      p_business_date: job.business_date,
      p_report_id: null,
      p_summary_note: "SKIPPED",
    });
    if (compErr) throw new Error(`COMPLETE_FAIL: ${compErr.message}`);
    return "skipped";
  }

  // 2. Fetch messages
  const { data: messages, error: msgErr } = await db
    .from("corrected_daily_conversation_messages_v3")
    .select("*")
    .eq("corrected_daily_conversation_id", corrConv.id)
    .order("display_sequence", { ascending: true });

  if (msgErr) throw new Error(`MSG_DB_ERROR: ${msgErr.message}`);
  
  const filteredMessages = messages || [];

  // Zero messages -> SKIPPED report outcome
  if (filteredMessages.length === 0) {
    const { error: compErr } = await db.rpc("complete_daily_report_job_v3", {
      p_job_id: job.id,
      p_claimed_by: workerId,
      p_child_id: job.child_id,
      p_business_date: job.business_date,
      p_report_id: null,
      p_summary_note: "SKIPPED",
    });
    if (compErr) throw new Error(`COMPLETE_FAIL: ${compErr.message}`);
    return "skipped";
  }

  // Check source_message_id for duplicates or nulls
  const sourceIds = new Set();
  for (const m of filteredMessages) {
    if (!m.source_message_id) throw new Error(`PERMANENT_FAIL: source_message_id is null`);
    if (sourceIds.has(m.source_message_id)) throw new Error(`PERMANENT_FAIL: Duplicate source_message_id ${m.source_message_id}`);
    sourceIds.add(m.source_message_id);
  }

  // 3. Transcript generation
  const transcriptText = filteredMessages
    .map((m: any) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
    .join("\n");

  const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

  // 4. Generate Content via @google/genai SDK with explicit responseSchema
  const responseSchema = {
    type: "OBJECT",
    properties: {
      summary_line: { type: "STRING" },
      mood_score: { type: "NUMBER" },
      emotion_tags: { type: "ARRAY", items: { type: "STRING" } },
      parent_guide: { type: "STRING" },
      emotion_level: { type: "STRING" },
      school_academy_life: { type: "STRING" },
      peer_friendship: { type: "STRING" },
      emotion_hint: { type: "STRING" },
      interests_preferences: { type: "STRING" },
      study_concerns: { type: "STRING" },
      digital_content_interests: { type: "STRING" },
      future_dreams: { type: "STRING" },
      recurring_stories: { type: "STRING" },
    },
    required: [
      "summary_line", "mood_score", "emotion_tags", "parent_guide",
      "emotion_level", "school_academy_life", "peer_friendship", "emotion_hint",
      "interests_preferences", "study_concerns", "digital_content_interests",
      "future_dreams", "recurring_stories"
    ],
  };

  const genResult = await ai.models.generateContent({
    model: getLlmModel("dailyReport"),
    contents: prompt,
    config: {
      responseSchema,
      maxOutputTokens: reportModel.maxOutputTokens ?? 8192,
      thinkingConfig: { thinkingLevel: 'MEDIUM' as any },
    },
  });

  let report: any;
  try {
    report = sanitizeReportJson(extractJSON(genResult.text ?? "{}"));
  } catch {
    throw new Error(`PARSE_FAIL: Invalid JSON response`);
  }

  const reportFields = {
    child_id: job.child_id,
    business_date: job.business_date,
    summary_line: report.summary_line,
    mood_score: report.mood_score,
    emotion_tags: report.emotion_tags,
    parent_guide: report.parent_guide,
    emotion_level: report.emotion_level,
    school_academy_life: report.school_academy_life,
    peer_friendship: report.peer_friendship,
    emotion_hint: report.emotion_hint,
    interests_preferences: report.interests_preferences,
    study_concerns: report.study_concerns,
    digital_content_interests: report.digital_content_interests,
    future_dreams: report.future_dreams,
    recurring_stories: report.recurring_stories,
  };

  // 5. Save report & Complete Job via atomic RPC
  const { data: finalReportId, error: completeErr } = await db.rpc("save_and_complete_daily_report_job_v3", {
    p_job_id: job.id,
    p_claimed_by: workerId,
    p_child_id: job.child_id,
    p_business_date: job.business_date,
    p_report_payload: reportFields,
  });

  if (completeErr) throw new Error(`COMPLETE_FAIL: ${completeErr.message}`);

  return "completed";
}

export async function processDailyReportJobsV3(limit: number, workerId: string, executionId?: string): Promise<DailyReportResultV3> {
  const db = createServiceClient();
  const result: DailyReportResultV3 = { completed: 0, skipped: 0, failed: 0, errors: [] };

  const rpcName = executionId ? "claim_daily_report_jobs_v3_for_execution" : "claim_daily_report_jobs_v3";
  const rpcParams: any = {
    p_claimed_by: workerId,
    p_limit: limit,
  };
  if (executionId) {
    rpcParams.p_execution_id = executionId;
  }

  const { data: claimedJobs, error: claimError } = await db.rpc(rpcName, rpcParams);

  if (claimError) throw new Error(`Failed to claim jobs: ${claimError.message}`);
  if (!claimedJobs || claimedJobs.length === 0) return result;

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  for (const job of claimedJobs) {
    try {
      const outcome = await processSingleReportJob(db, job, workerId, reportModel, ai);
      if (outcome === "completed") {
        result.completed++;
      } else {
        result.skipped++;
      }
    } catch (e: any) {
      result.failed++;
      result.errors.push({ job_id: job.id, error: e.message });

      const msg = e.message || "";
      // Treat claim/lease loss specially: do not attempt a stale failure write
      if (msg.includes("LEASE_EXPIRED")) {
        continue;
      }

      const isRetryable =
        msg.includes("429") ||
        msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504") ||
        msg.toLowerCase().includes("fetch failed") ||
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("network") ||
        msg.toLowerCase().includes("connection") ||
        msg.toLowerCase().includes("serialization") ||
        msg.toLowerCase().includes("deadlock") ||
        msg.toLowerCase().includes("temporarily unavailable");

      const { error: markFailErr } = await db.rpc("mark_pipeline_job_failed_v3", {
        p_job_id: job.id,
        p_claimed_by: workerId,
        p_error_code: isRetryable ? "RETRYABLE_ERROR" : "PERMANENT_ERROR",
        p_error_summary: msg.substring(0, 200),
        p_retryable: isRetryable,
      });

      if (markFailErr) {
        console.error(`Failed to mark report pipeline job failed: ${markFailErr.message}`);
      }
    }
  }

  return result;
}
