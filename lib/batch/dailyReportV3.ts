import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { extractJSON } from "@/app/api/_lib/utils";
import {
  isMeaningfulReportSection,
  reportSectionValueForStorage,
} from "@/lib/reports/reportSectionAvailability";
import { validateReportLanguageIntegrity } from "@/lib/reports/reportLanguageIntegrity";
import {
  buildLanguageRetryInstruction,
  buildLanguageFailureMessage,
} from "@/lib/reports/reportLanguageRetry";
// 020 §3-11 — 잡 사이에 짧은 간격을 둬 Vertex 요청이 같은 순간에 몰리지 않게 한다.
import { throttleBetweenBatchLlmJobs } from "./llmThrottle";

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
  "recurring_stories": "...",
  "teacher_adults": "선생님·어른 관련 언급이 있었다면 상세 서술, 없으면 빈 문자열",
  "dashboard_cards": {
    "school_academy_life": "학교·학원 생활 15자 이내 한줄 요약",
    "peer_friendship": "친구 관계 15자 이내 한줄 요약",
    "emotion_hint": "마음 흐름 15자 이내 한줄 요약",
    "interests_preferences": "관심사·취향 15자 이내 한줄 요약",
    "study_concerns": "공부 고민 15자 이내 한줄 요약",
    "digital_content_interests": "디지털·콘텐츠 15자 이내 한줄 요약",
    "teacher_adults": "선생님·어른 15자 이내 한줄 요약",
    "recurring_stories": "반복 이야기 15자 이내 한줄 요약"
  }
}

dashboard_cards 각 값은 반드시 다음 규칙을 지켜야 합니다.
- 공백 포함 15자 이내, 한 줄
- 해당 영역의 실제 대화 내용에 근거한 구체적인 문장 (예: "친구와 피구했어요", "수학 문제가 어려워요")
- 상세 필드 문장을 그대로 자르지 말고 새로 압축해서 작성
- 해당 영역에 대화 근거가 전혀 없으면 빈 문자열("")로 둘 것
- 다음과 같은 범용 안내 문구는 절대 사용하지 말 것: "새로운 이야기가 있어요", "새로운 소식이 있어요", "분석을 준비 중이에요", "관심이 있어 보여요", "다양한 이야기를 했어요", "특별한 이야기가 있어요"
`;

const FORBIDDEN_DASHBOARD_PHRASES = [
  "새로운 이야기가 있어요",
  "새로운 소식이 있어요",
  "분석을 준비 중이에요",
  "관심이 있어 보여요",
  "다양한 이야기를 했어요",
  "특별한 이야기가 있어요",
];

const DASHBOARD_CARD_FIELDS = [
  "school_academy_life",
  "peer_friendship",
  "emotion_hint",
  "interests_preferences",
  "study_concerns",
  "digital_content_interests",
  "teacher_adults",
  "recurring_stories",
] as const;

function isValidDashboardSummary(value: string): boolean {
  if (value === "") return true; // 근거 없음 = 정상적인 데이터 부족 상태
  if (!isMeaningfulReportSection(value)) return false;
  if (value.includes("\n")) return false;
  if (value.length > 15) return false;
  if (FORBIDDEN_DASHBOARD_PHRASES.includes(value)) return false;
  return true;
}

// requests/019 §7 15자 검증 로직 — 최초 생성값이 기준을 넘으면 해당 영역의 상세
// 문장을 근거로 재요약을 1회 시도하고, 그래도 실패하면 단순 절단 대신 데이터
// 부족(빈 문자열)으로 처리한다.
async function validateAndCompressDashboardCards(
  rawCards: Record<string, any>,
  detailFields: Record<string, string>,
  ai: any,
  model: string
): Promise<Record<string, string>> {
  const str = (v: any) => (typeof v === "string" ? v.trim() : "");
  const result: Record<string, string> = {};

  for (const field of DASHBOARD_CARD_FIELDS) {
    const candidate = str(rawCards?.[field]);

    // P0 실측 발견(2026-08-03, 안서아 등 Production 실사용자): dashboard_cards가
    // 비어 있어도(candidate === "") isValidDashboardSummary가 "근거 없음"으로
    // 간주해 그대로 통과시켜, 같은 LLM 응답의 상세 필드(detailFields[field])에는
    // 실제 내용이 있는데 dashboard_cards만 비어 저장되는 사례가 다수 확인됐다
    // (Gemini가 한 응답 안에서 상세 필드는 채우고 dashboard_cards 하위 항목만
    // 소홀히 비우는 불일치). candidate가 유효하고 "비어있지 않을 때만" 그대로
    // 채택하고, 비어 있으면(또는 규칙 위반이면) 상세 필드를 근거로 압축을
    // 시도한다 — 상세 필드도 없을 때만 진짜 "근거 없음"으로 확정한다.
    if (candidate !== "" && isValidDashboardSummary(candidate)) {
      result[field] = candidate;
      continue;
    }

    const sourceText = detailFields[field] || candidate;
    if (!sourceText) {
      result[field] = "";
      continue;
    }

    try {
      const retryResult = await ai.models.generateContent({
        model,
        contents: `다음 문장을 공백 포함 15자 이내의 한 줄로 압축 요약하세요. 실제 내용을 반영하고 "새로운 이야기가 있어요"류의 범용 문구는 쓰지 마세요.\n\n문장: ${sourceText}`,
        config: {
          responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
          responseMimeType: "application/json",
          maxOutputTokens: 512,
        },
      });
      const parsed = extractJSON(retryResult.text ?? "{}");
      const compressed = str(parsed?.summary);
      result[field] = isValidDashboardSummary(compressed) ? compressed : "";
      if (!isValidDashboardSummary(compressed)) {
        console.error(`[dailyReportV3] dashboard_cards.${field} 재요약 실패 — 데이터 부족으로 처리`, { candidate, compressed });
      }
    } catch (e: any) {
      console.error(`[dailyReportV3] dashboard_cards.${field} 재요약 중 오류 — 데이터 부족으로 처리`, e.message);
      result[field] = "";
    }
  }

  return result;
}

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
    school_academy_life: reportSectionValueForStorage(obj.school_academy_life),
    peer_friendship: reportSectionValueForStorage(obj.peer_friendship),
    emotion_hint: reportSectionValueForStorage(obj.emotion_hint),
    interests_preferences: reportSectionValueForStorage(obj.interests_preferences),
    study_concerns: reportSectionValueForStorage(obj.study_concerns),
    digital_content_interests: reportSectionValueForStorage(obj.digital_content_interests),
    future_dreams: reportSectionValueForStorage(obj.future_dreams),
    recurring_stories: reportSectionValueForStorage(obj.recurring_stories),
    teacher_adults: reportSectionValueForStorage(obj.teacher_adults),
    dashboard_cards_raw: (obj.dashboard_cards && typeof obj.dashboard_cards === "object") ? obj.dashboard_cards : {},
  };
}

export type DailyReportResultV3 = { completed: number; skipped: number; failed: number; errors: any[] };

async function processSingleReportJob(
  db: ReturnType<typeof createServiceClient>,
  job: any,
  workerId: string,
  reportModel: any,
  ai: any,
  executionSource: "manual" | "scheduled"
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

  const basePrompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);
  const systemInstruction =
    "모든 문장은 자연스러운 한국어로만 작성하고 일본어 문자(히라가나·가타카나)를 절대 사용하지 않는다. 한자어는 한글로 풀어 쓰며, 영어 고유명사(Roblox, YouTube, MBTI 등)는 그대로 두어도 된다.";

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
      teacher_adults: { type: "STRING" },
      dashboard_cards: {
        type: "OBJECT",
        properties: {
          school_academy_life: { type: "STRING" },
          peer_friendship: { type: "STRING" },
          emotion_hint: { type: "STRING" },
          interests_preferences: { type: "STRING" },
          study_concerns: { type: "STRING" },
          digital_content_interests: { type: "STRING" },
          teacher_adults: { type: "STRING" },
          recurring_stories: { type: "STRING" },
        },
        required: [
          "school_academy_life", "peer_friendship", "emotion_hint", "interests_preferences",
          "study_concerns", "digital_content_interests", "teacher_adults", "recurring_stories",
        ],
      },
    },
    required: [
      "summary_line", "mood_score", "emotion_tags", "parent_guide",
      "emotion_level", "school_academy_life", "peer_friendship", "emotion_hint",
      "interests_preferences", "study_concerns", "digital_content_interests",
      "future_dreams", "recurring_stories", "teacher_adults", "dashboard_cards"
    ],
  };

  const MAX_ATTEMPTS = 2;
  let lastViolations: Array<{ path: string; kind: string }> = [];
  let report: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 1
        ? basePrompt
        : basePrompt + buildLanguageRetryInstruction(lastViolations);

    const genResult = await ai.models.generateContent({
      model: getLlmModel("dailyReport"),
      contents: prompt,
      config: {
        systemInstruction,
        responseSchema,
        // Gemini requires responseMimeType: "application/json" whenever responseSchema
        // is set — 2026-08-02 Production 실사용에서 이 누락으로 Context Correction과
        // 동일한 400 INVALID_ARGUMENT("text/plain" unsupported)가 재현됨을 확인.
        responseMimeType: "application/json",
        maxOutputTokens: reportModel.maxOutputTokens ?? 8192,
        thinkingConfig: { thinkingLevel: 'MEDIUM' as any },
      },
    });

    let rawParsed: any;
    try {
      rawParsed = sanitizeReportJson(extractJSON(genResult.text ?? "{}"));
    } catch {
      throw new Error(`PARSE_FAIL: Invalid JSON response`);
    }

    const validation = validateReportLanguageIntegrity(rawParsed);
    if (validation.ok) {
      report = rawParsed;
      break;
    }

    lastViolations = validation.violations.map((v) => ({
      path: v.path,
      kind: v.kind,
    }));

    console.warn(
      `[processSingleReportJob] 일일 리포트 언어 검증 위반 (${validation.violations.length}건, 시도 ${attempt}/${MAX_ATTEMPTS}):`,
      lastViolations,
    );

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(buildLanguageFailureMessage(lastViolations));
    }
  }

  if (!report) {
    throw new Error(buildLanguageFailureMessage(lastViolations));
  }

  const dashboardCards = await validateAndCompressDashboardCards(
    report.dashboard_cards_raw,
    {
      school_academy_life: report.school_academy_life,
      peer_friendship: report.peer_friendship,
      emotion_hint: report.emotion_hint,
      interests_preferences: report.interests_preferences,
      study_concerns: report.study_concerns,
      digital_content_interests: report.digital_content_interests,
      teacher_adults: report.teacher_adults,
      recurring_stories: report.recurring_stories,
    },
    ai,
    getLlmModel("dailyReport")
  );

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
    teacher_adults: report.teacher_adults,
    dashboard_cards: dashboardCards,
  };

  // 5. Save report & Complete Job via atomic RPC
  const { data: finalReportId, error: completeErr } = await db.rpc("save_and_complete_daily_report_job_v3", {
    p_job_id: job.id,
    p_claimed_by: workerId,
    p_child_id: job.child_id,
    p_business_date: job.business_date,
    p_report_payload: reportFields,
    p_generation_source: executionSource,
    p_source_data_updated_at: corrConv.updated_at || new Date().toISOString(),
    p_model_version: getLlmModel("dailyReport"),
  });

  if (completeErr) throw new Error(`COMPLETE_FAIL: ${completeErr.message}`);

  return "completed";
}

export async function processDailyReportJobsV3(
  limit: number,
  workerId: string,
  executionId?: string,
  executionSource: "manual" | "scheduled" = "scheduled"
): Promise<DailyReportResultV3> {
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

  // 020 §3-11 — 첫 잡 앞에서는 기다리지 않는다. 잡을 하나 끝낸 뒤에만 간격을 둔다.
  let isFirstJob = true;
  for (const job of claimedJobs) {
    if (!isFirstJob) {
      await throttleBetweenBatchLlmJobs();
    }
    isFirstJob = false;
    try {
      const outcome = await processSingleReportJob(db, job, workerId, reportModel, ai, executionSource);
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
