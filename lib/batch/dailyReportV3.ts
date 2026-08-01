import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
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
  return obj;
}

export type DailyReportResultV3 = { completed: number; failed: number; errors: any[] };

export async function processDailyReportJobsV3(limit: number, workerId: string): Promise<DailyReportResultV3> {
  const db = createServiceClient();
  const result: DailyReportResultV3 = { completed: 0, failed: 0, errors: [] };

  const { data: claimedJobs, error: claimError } = await db.rpc('claim_daily_report_jobs_v3', {
    p_claimed_by: workerId,
    p_limit: limit
  });

  if (claimError) throw new Error(`Failed to claim jobs: ${claimError.message}`);
  if (!claimedJobs || claimedJobs.length === 0) return result;

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  for (const job of claimedJobs) {
    try {
      // 1. Fetch corrected_daily_conversations_v3
      const { data: corrConv, error: corrErr } = await db
        .from('corrected_daily_conversations_v3')
        .select('*')
        .eq('child_id', job.child_id)
        .eq('business_date', job.business_date)
        .eq('correction_status', 'completed')
        .maybeSingle();

      if (corrErr) throw new Error(`DB_ERROR: ${corrErr.message}`);
      if (!corrConv) throw new Error(`NOT_FOUND: Completed corrected conv v3 not found`);

      // 2. Fetch messages
      const { data: messages, error: msgErr } = await db
        .from('corrected_daily_conversation_messages_v3')
        .select('*')
        .eq('conversation_id', corrConv.id)
        .order('display_sequence', { ascending: true });

      if (msgErr) throw new Error(`MSG_DB_ERROR: ${msgErr.message}`);
      
      const filteredMessages = (messages || []).filter(m => !m.deleted_at);

      if (filteredMessages.length !== corrConv.corrected_message_count) {
        throw new Error(`PERMANENT_FAIL: Message count mismatch (${filteredMessages.length} vs ${corrConv.corrected_message_count})`);
      }
      
      if (filteredMessages.length === 0) {
        throw new Error(`PERMANENT_FAIL: No messages`);
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
        .map(m => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`)
        .join("\n");

      const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

      // 4. Generate Content
      const genResult = await ai.models.generateContent({
        model: reportModel.modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: reportModel.maxOutputTokens }
      });

      let report: any;
      try {
        report = sanitizeReportJson(extractJSON(genResult.text ?? "{}"));
      } catch {
        throw new Error(`PARSE_FAIL: Invalid JSON response`);
      }

      report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));
      const emotionLevel = report.emotion_level === "warning" || report.emotion_level === "danger" ? report.emotion_level : "safe";

      const reportFields = {
        child_id: job.child_id,
        business_date: job.business_date,
        summary_line: report.summary_line ?? "",
        mood_score: report.mood_score,
        emotion_tags: report.emotion_tags ?? [],
        parent_guide: report.parent_guide ?? "",
        emotion_level: emotionLevel,
        school_academy_life: report.school_academy_life ?? "",
        peer_friendship: report.peer_friendship ?? "",
        emotion_hint: report.emotion_hint ?? "",
        interests_preferences: report.interests_preferences ?? "",
        study_concerns: report.study_concerns ?? "",
        digital_content_interests: report.digital_content_interests ?? "",
        future_dreams: report.future_dreams ?? "",
        recurring_stories: report.recurring_stories ?? "",
      };

      // 5. Existing check & Transactional Save (Upsert + Complete Job)
      const { data: existingRows } = await db
        .from("daily_reports")
        .select("id")
        .eq("child_id", job.child_id)
        .eq("business_date", job.business_date)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1);

      const existing = existingRows?.[0] ?? null;
      let finalReportId = existing?.id;

      if (existing) {
        const { error: updErr } = await db.from("daily_reports").update(reportFields).eq("id", existing.id);
        if (updErr) throw new Error(`UPDATE_FAIL: ${updErr.message}`);
      } else {
        const { data: inserted, error: insErr } = await db.from("daily_reports").insert(reportFields).select("id").single();
        if (insErr) throw new Error(`INSERT_FAIL: ${insErr.message}`);
        finalReportId = inserted.id;
      }

      const { error: completeErr } = await db.rpc('complete_daily_report_job_v3', {
        p_job_id: job.id,
        p_claimed_by: workerId,
        p_child_id: job.child_id,
        p_business_date: job.business_date,
        p_report_id: finalReportId
      });

      if (completeErr) throw new Error(`COMPLETE_FAIL: ${completeErr.message}`);

      result.completed++;
    } catch (e: any) {
      result.failed++;
      result.errors.push({ job_id: job.id, error: e.message });
      
      const isRetryable = e.message.includes('429') || e.message.includes('50') || e.message.includes('fetch failed') || e.message.includes('DB_ERROR') || e.message.includes('INSERT_FAIL');
      const isPermanent = e.message.includes('PERMANENT_FAIL') || e.message.includes('NOT_FOUND') || e.message.includes('PARSE_FAIL');

      if (isPermanent) {
        await db.from('pipeline_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id);
      } else if (job.attempt_count >= job.max_attempts) {
        await db.from('pipeline_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id);
      } else {
        // Simple backoff logic
        const nextRetry = new Date(Date.now() + 5 * 60000).toISOString();
        await db.from('pipeline_jobs').update({ status: 'retry_wait', next_retry_at: nextRetry, updated_at: new Date().toISOString() }).eq('id', job.id);
      }
    }
  }

  return result;
}

export async function processSpecificDailyReportJobV3(childId: string, businessDate: string, workerId: string) {
  const db = createServiceClient();
  
  // 1. Specific Claim
  const { data: jobs, error: claimErr } = await db
    .from('pipeline_jobs')
    .update({
      status: 'processing',
      claimed_by: workerId,
      claimed_at: new Date().toISOString(),
      claim_expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('job_type', 'daily_report')
    .eq('child_id', childId)
    .eq('business_date', businessDate)
    .in('status', ['pending', 'retry_wait'])
    .select('id, attempt_count, max_attempts');
    
  if (claimErr) throw new Error(`Claim failed: ${claimErr.message}`);
  if (!jobs || jobs.length === 0) return { success: false, reason: 'NO_PENDING_JOB' };
  
  const job = jobs[0];

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  try {
    // 1. Fetch corrected_daily_conversations_v3
    const { data: corrConv, error: corrErr } = await db
      .from('corrected_daily_conversations_v3')
      .select('*')
      .eq('child_id', childId)
      .eq('business_date', businessDate)
      .eq('correction_status', 'completed')
      .maybeSingle();

    if (corrErr) throw new Error(`DB_ERROR: ${corrErr.message}`);
    if (!corrConv) throw new Error(`NOT_FOUND: Completed corrected conv v3 not found`);

    // 2. Fetch messages
    const { data: messages, error: msgErr } = await db
      .from('corrected_daily_conversation_messages_v3')
      .select('*')
      .eq('conversation_id', corrConv.id)
      .order('display_sequence', { ascending: true });

    if (msgErr) throw new Error(`MSG_DB_ERROR: ${msgErr.message}`);
    
    const filteredMessages = (messages || []).filter(m => !m.deleted_at);

    if (filteredMessages.length !== corrConv.corrected_message_count) {
      throw new Error(`PERMANENT_FAIL: Message count mismatch (${filteredMessages.length} vs ${corrConv.corrected_message_count})`);
    }
    
    if (filteredMessages.length === 0) {
      throw new Error(`PERMANENT_FAIL: No messages`);
    }

    const sourceIds = new Set();
    for (const m of filteredMessages) {
      if (!m.source_message_id) throw new Error(`PERMANENT_FAIL: source_message_id is null`);
      if (sourceIds.has(m.source_message_id)) throw new Error(`PERMANENT_FAIL: Duplicate source_message_id ${m.source_message_id}`);
      sourceIds.add(m.source_message_id);
    }

    // 3. Transcript generation
    const transcriptText = filteredMessages
      .map(m => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`)
      .join("\n");

    const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

    // 4. Generate Content
    const genResult = await ai.models.generateContent({
      model: reportModel.modelId,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: reportModel.maxOutputTokens }
    });

    let report: any;
    try {
      report = sanitizeReportJson(extractJSON(genResult.text ?? "{}"));
    } catch {
      throw new Error(`PARSE_FAIL: Invalid JSON response`);
    }

    report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));
    const emotionLevel = report.emotion_level === "warning" || report.emotion_level === "danger" ? report.emotion_level : "safe";

    const reportFields = {
      child_id: childId,
      business_date: businessDate,
      summary_line: report.summary_line ?? "",
      mood_score: report.mood_score,
      emotion_tags: report.emotion_tags ?? [],
      parent_guide: report.parent_guide ?? "",
      emotion_level: emotionLevel,
      school_academy_life: report.school_academy_life ?? "",
      peer_friendship: report.peer_friendship ?? "",
      emotion_hint: report.emotion_hint ?? "",
      interests_preferences: report.interests_preferences ?? "",
      study_concerns: report.study_concerns ?? "",
      digital_content_interests: report.digital_content_interests ?? "",
      future_dreams: report.future_dreams ?? "",
      recurring_stories: report.recurring_stories ?? "",
    };

    // 5. Existing check & Transactional Save (Upsert + Complete Job)
    const { data: existingRows } = await db
      .from("daily_reports")
      .select("id")
      .eq("child_id", childId)
      .eq("business_date", businessDate)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = existingRows?.[0] ?? null;
    let finalReportId = existing?.id;

    if (existing) {
      const { error: updErr } = await db.from("daily_reports").update(reportFields).eq("id", existing.id);
      if (updErr) throw new Error(`UPDATE_FAIL: ${updErr.message}`);
    } else {
      const { data: inserted, error: insErr } = await db.from("daily_reports").insert(reportFields).select("id").single();
      if (insErr) throw new Error(`INSERT_FAIL: ${insErr.message}`);
      finalReportId = inserted.id;
    }

    const { error: completeErr } = await db.rpc('complete_daily_report_job_v3', {
      p_job_id: job.id,
      p_claimed_by: workerId,
      p_child_id: childId,
      p_business_date: businessDate,
      p_report_id: finalReportId
    });

    if (completeErr) throw new Error(`COMPLETE_FAIL: ${completeErr.message}`);

    return { success: true, job_id: job.id };
  } catch (e: any) {
    const isRetryable = e.message.includes('429') || e.message.includes('50') || e.message.includes('fetch failed') || e.message.includes('DB_ERROR') || e.message.includes('INSERT_FAIL');
    const isPermanent = e.message.includes('PERMANENT_FAIL') || e.message.includes('NOT_FOUND') || e.message.includes('PARSE_FAIL');

    if (isPermanent) {
      await db.from('pipeline_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id);
    } else if (job.attempt_count >= job.max_attempts) {
      await db.from('pipeline_jobs').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', job.id);
    } else {
      const nextRetry = new Date(Date.now() + 5 * 60000).toISOString();
      await db.from('pipeline_jobs').update({ status: 'retry_wait', next_retry_at: nextRetry, updated_at: new Date().toISOString() }).eq('id', job.id);
    }

    return { success: false, reason: e.message };
  }
}
