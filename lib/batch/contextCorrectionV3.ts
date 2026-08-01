import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { extractJSON } from "@/app/api/_lib/utils";

interface CorrectionResult {
  claimed: number;
  completed: number;
  failed: number;
  errors: any[];
}

async function processSingleCorrectionJob(
  db: ReturnType<typeof createServiceClient>,
  job: any,
  workerId: string,
  modelId: string
) {
  const PROMPT_VERSION = "v3.0.1";

  // 1. Fetch Raw Data
  const { data: rawConvs, error: rawErr } = await db
    .from("raw_daily_conversations_v3")
    .select("id, child_id, business_date")
    .eq("child_id", job.child_id)
    .eq("business_date", job.business_date);

  if (rawErr || !rawConvs || rawConvs.length === 0) {
    throw new Error("RAW_V3_MISSING");
  }
  const rawConv = rawConvs[0];

  const { data: rawMessages, error: msgErr } = await db
    .from("raw_daily_conversation_messages_v3")
    .select("*")
    .eq("raw_daily_conversation_v3_id", rawConv.id)
    .order("created_at", { ascending: true });

  if (msgErr) {
    throw new Error(`Failed to fetch raw messages: ${msgErr.message}`);
  }

  if (!rawMessages || rawMessages.length === 0) {
    throw new Error("EMPTY_INPUT");
  }

  const validSections = ["mission_1", "free_chat_1", "mission_2", "free_chat_2"];
  const filteredMessages = rawMessages.filter((m: any) => validSections.includes(m.section));

  if (filteredMessages.length === 0) {
    throw new Error("EMPTY_INPUT");
  }

  for (const m of filteredMessages) {
    if (typeof m.display_sequence !== "number" || !Number.isInteger(m.display_sequence) || m.display_sequence < 1) {
      throw new Error("INVALID_DISPLAY_SEQUENCE");
    }
  }

  filteredMessages.sort((a: any, b: any) => a.display_sequence - b.display_sequence);

  // 2. Build Prompt
  const messageContext = filteredMessages
    .map((m: any) => `[${m.section}] ${m.role === "child" ? "아이" : "캐릭터"}: ${m.original_content} (ID: ${m.source_message_id})`)
    .join("\n");

  const prompt = `당신은 아이의 발화를 자연스럽게 보정하는 AI입니다. 
아래 대화 기록을 읽고, 아이의 발화 중 STT 인식오류나 불완전한 문장을 자연스럽게 복원하세요.
캐릭터의 발화는 그대로 유지하고 아이의 발화만 보정합니다.
의미를 새로 만들거나 사건·감정·사실을 추가하지 마세요. 확신이 없으면 원문을 유지하세요.

[하루 전체 대화]
${messageContext}

출력은 반드시 원본과 동일한 개수의 배열 구조인 JSON 형식이어야 합니다.
\`\`\`json
[
  {
    "source_message_id": "원본메시지ID",
    "content": "보정된(또는 원본) 텍스트",
    "correction_metadata": {
      "changed": true/false,
      "correction_reason": "보정 이유 또는 없음",
      "confidence": 0.0
    }
  }
]
\`\`\`
`;

  // Explicit responseSchema for structured Gemini output (No responseMimeType)
  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        source_message_id: { type: "STRING" },
        content: { type: "STRING" },
        correction_metadata: {
          type: "OBJECT",
          properties: {
            changed: { type: "BOOLEAN" },
            correction_reason: { type: "STRING" },
            confidence: { type: "NUMBER" },
          },
          required: ["changed", "correction_reason", "confidence"],
        },
      },
      required: ["source_message_id", "content", "correction_metadata"],
    },
  };

  // 3. Call Gemini via @google/genai SDK
  const aiConfig = await getModelForGroup("A");
  const ai = createGenAIClient(aiConfig);
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseSchema,
      systemInstruction: "반드시 JSON 배열 형식으로만 응답하라. 여분의 텍스트 금지.",
    },
  });

  const text = response.text || "";
  let correctedJson: any[] = [];
  try {
    correctedJson = extractJSON(text);
  } catch {
    throw new Error("JSON_PARSE_ERROR");
  }

  if (!correctedJson || !Array.isArray(correctedJson)) {
    throw new Error("JSON_PARSE_ERROR");
  }

  // 4. Strict Validation
  if (correctedJson.length !== filteredMessages.length) {
    throw new Error("MESSAGE_COUNT_MISMATCH");
  }

  const inputIds = new Set(filteredMessages.map((m: any) => m.source_message_id));
  const outputIds = new Set(correctedJson.map((m: any) => m.source_message_id));

  if (inputIds.size !== outputIds.size) {
    throw new Error("DUPLICATE_OR_MISSING_IDS");
  }

  for (const id of outputIds) {
    if (!inputIds.has(id)) {
      throw new Error("UNKNOWN_ID_FOUND");
    }
  }

  const finalMessages = filteredMessages.map((orig: any) => {
    const corr = correctedJson.find((c: any) => c.source_message_id === orig.source_message_id);
    if (!corr || typeof corr.content !== "string" || corr.content.trim() === "") {
      throw new Error("EMPTY_CONTENT_FOUND");
    }
    return {
      source_message_id: orig.source_message_id,
      session_id: orig.session_id,
      role: orig.role,
      content: corr.content,
      original_created_at: orig.created_at,
      section: orig.section,
      display_sequence: orig.display_sequence,
      correction_metadata: corr.correction_metadata || { changed: false, correction_reason: "none", confidence: 1.0 },
    };
  });

  // 5. Atomic Save via complete_context_correction_job_v3 RPC
  const { error: completeErr } = await db.rpc("complete_context_correction_job_v3", {
    p_job_id: job.id,
    p_claimed_by: workerId,
    p_raw_daily_conversation_v3_id: rawConv.id,
    p_child_id: rawConv.child_id,
    p_business_date: rawConv.business_date,
    p_model: modelId,
    p_prompt_version: PROMPT_VERSION,
    p_source_message_count: filteredMessages.length,
    p_corrected_message_count: finalMessages.length,
    p_messages: finalMessages,
  });

  if (completeErr) {
    throw new Error(`SAVE_FAILED: ${completeErr.message}`);
  }
}

export async function runContextCorrectionWorkerV3(limit: number, workerId?: string, executionId?: string): Promise<CorrectionResult> {
  const db = createServiceClient();
  const wId = workerId || `context-worker-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const result: CorrectionResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    errors: [],
  };

  const rpcName = executionId ? "claim_context_correction_jobs_v3_for_execution" : "claim_context_correction_jobs_v3";
  const rpcParams: any = {
    p_claimed_by: wId,
    p_limit: limit,
  };
  if (executionId) {
    rpcParams.p_execution_id = executionId;
  }

  // 1. Claim Jobs
  const { data: jobs, error: claimErr } = await db.rpc(rpcName, rpcParams);

  if (claimErr) {
    throw new Error(`Failed to claim context_correction jobs: ${claimErr.message}`);
  }

  if (!jobs || jobs.length === 0) {
    return result;
  }
  result.claimed = jobs.length;

  const aiConfig = await getModelForGroup("A");
  const MODEL_NAME = aiConfig.modelId;

  for (const job of jobs) {
    try {
      await processSingleCorrectionJob(db, job, wId, MODEL_NAME);
      result.completed++;
    } catch (err: any) {
      result.failed++;
      result.errors.push({ job_id: job.id, error: err.message });

      const errMsg = err.message || "Unknown error";
      const isRetryable =
        errMsg.includes("JSON_PARSE_ERROR") ||
        errMsg.includes("429") ||
        errMsg.includes("503") ||
        errMsg.includes("timeout") ||
        errMsg.includes("SAVE_FAILED");

      const { error: markFailErr } = await db.rpc("mark_pipeline_job_failed_v3", {
        p_job_id: job.id,
        p_claimed_by: wId,
        p_error_code: isRetryable ? "RETRYABLE_ERROR" : "PERMANENT_ERROR",
        p_error_summary: errMsg.substring(0, 200),
        p_retryable: isRetryable,
      });

      if (markFailErr) {
        console.error(`Failed to mark correction pipeline job failed: ${markFailErr.message}`);
      }
    }
  }

  return result;
}
