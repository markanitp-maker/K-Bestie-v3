import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { extractJSON } from "@/app/api/_lib/utils";

interface CorrectionResult {
  claimed: number;
  completed: number;
  skipped: number;
  failed: number;
  errors: any[];
}

const CHUNK_SIZE = 25;

const CORRECTION_RESPONSE_SCHEMA = {
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

function buildChunkPrompt(chunk: any[]) {
  const messageContext = chunk
    .map((m: any) => `[${m.section}] ${m.role === "child" ? "아이" : "캐릭터"}: ${m.original_content} (ID: ${m.source_message_id})`)
    .join("\n");

  return `당신은 아이의 발화를 자연스럽게 보정하는 AI입니다.
아래 대화 기록을 읽고, 아이의 발화 중 STT 인식오류나 불완전한 문장을 자연스럽게 복원하세요.
캐릭터의 발화는 그대로 유지하고 아이의 발화만 보정합니다.
의미를 새로 만들거나 사건·감정·사실을 추가하지 마세요. 확신이 없으면 원문을 유지하세요.
이 구간은 하루 전체 대화 중 일부입니다. 여기 없는 메시지는 신경쓰지 말고, 아래 목록의 메시지만 빠짐없이 반환하세요.

[대화 구간]
${messageContext}

출력은 반드시 아래 목록과 동일한 개수의 배열 구조인 JSON 형식이어야 합니다.
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
}

// 하루 전체를 한 번에 Gemini에 보내면 메시지가 많은 날(수십~수백 개) 응답이
// 잘리거나 일부 메시지가 누락돼 예전에는 전체 개수 불일치로 PERMANENT_ERROR
// 처리했다(2026-08-02 Production 장애: 윤도원 68개 메시지 중 일부 누락으로
// MESSAGE_COUNT_MISMATCH 영구 실패). 이제는 CHUNK_SIZE 단위로 나눠 각 구간을
// 독립적으로 보정하고, source_message_id로 병합한다 — 어느 chunk가 실패하거나
// 일부 메시지를 반환하지 않아도 그 메시지만 원문 fallback으로 채우고 나머지는
// 정상 처리해 전체 Job을 절대 영구 실패시키지 않는다.
async function correctChunk(
  ai: ReturnType<typeof createGenAIClient>,
  modelId: string,
  chunk: any[],
  inputIds: Set<string>
): Promise<Map<string, { content: string; correction_metadata: any }>> {
  const prompt = buildChunkPrompt(chunk);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          responseSchema: CORRECTION_RESPONSE_SCHEMA,
          responseMimeType: "application/json",
          systemInstruction: "반드시 JSON 배열 형식으로만 응답하라. 여분의 텍스트 금지.",
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: "LOW" as any },
        },
      });

      const text = response.text || "";
      const correctedJson = extractJSON(text);
      if (!Array.isArray(correctedJson)) {
        throw new Error("JSON_PARSE_ERROR");
      }

      const result = new Map<string, { content: string; correction_metadata: any }>();
      for (const c of correctedJson) {
        const id = c?.source_message_id;
        // Gemini가 이 chunk에 없던 ID를 반환하면 무시(마스킹)
        if (typeof id !== "string" || !inputIds.has(id)) continue;
        // 같은 ID가 중복 반환되면 먼저 나온 한 건만 사용
        if (result.has(id)) continue;
        if (typeof c.content !== "string" || c.content.trim() === "") continue;
        result.set(id, {
          content: c.content,
          correction_metadata: c.correction_metadata || { changed: false, correction_reason: "none", confidence: 1.0 },
        });
      }
      return result;
    } catch {
      if (attempt === 0) continue; // JSON 파싱 실패 등은 1회 재시도
    }
  }
  // 재시도 후에도 실패하면 이 chunk의 메시지는 전부 원문 fallback으로 처리
  // (호출부에서 correctedMap에 없는 ID는 자동으로 원문을 사용한다)
  return new Map();
}

async function processSingleCorrectionJob(
  db: ReturnType<typeof createServiceClient>,
  job: any,
  workerId: string,
  modelId: string
): Promise<{ skipped: boolean }> {
  const PROMPT_VERSION = "v3.1.0";

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

  // These are backward-compatible raw storage sections, not current mission rounds.
  // daily_single messages are physically stored in mission_2 by the collection layer.
  const validSections = ["mission_1", "free_chat_1", "mission_2", "free_chat_2"];
  const filteredMessages = (rawMessages || []).filter((m: any) => validSections.includes(m.section));

  // "진짜 대화 0건"(그날 미션·자유대화를 아예 하지 않음, rawMessages 자체가 비어있음)과
  // "raw는 있는데 전부 알 수 없는 section"(향후 새 section 타입 추가 시 validSections
  // 갱신 누락 등 파이프라인 이상 가능성)을 구분한다. 전자만 NO_CONVERSATION 성공 종료로
  // 조용히 넘기고(admin/reporting/run의 generate 액션이 corrected 부재를 다루는 것과
  // 동일 계약), 후자는 관측 가능하도록 별도 에러 코드로 계속 실패시킨다.
  if ((rawMessages || []).length === 0) {
    const { error: noConvErr } = await db.rpc("complete_context_correction_job_v3_no_conversation", {
      p_job_id: job.id,
      p_claimed_by: workerId,
    });
    if (noConvErr) {
      throw new Error(`NO_CONVERSATION_MARK_FAILED: ${noConvErr.message}`);
    }
    return { skipped: true };
  }

  if (filteredMessages.length === 0) {
    throw new Error("UNKNOWN_SECTION_ANOMALY");
  }

  for (const m of filteredMessages) {
    if (typeof m.display_sequence !== "number" || !Number.isInteger(m.display_sequence) || m.display_sequence < 1) {
      throw new Error("INVALID_DISPLAY_SEQUENCE");
    }
  }

  filteredMessages.sort((a: any, b: any) => a.display_sequence - b.display_sequence);

  // 2. Chunk + correct
  const inputIds = new Set(filteredMessages.map((m: any) => m.source_message_id));
  const aiConfig = await getModelForGroup("A");
  const ai = createGenAIClient(aiConfig);

  const correctedMap = new Map<string, { content: string; correction_metadata: any }>();
  for (let i = 0; i < filteredMessages.length; i += CHUNK_SIZE) {
    const chunk = filteredMessages.slice(i, i + CHUNK_SIZE);
    const chunkResult = await correctChunk(ai, modelId, chunk, inputIds);
    for (const [id, val] of chunkResult) {
      correctedMap.set(id, val);
    }
  }

  // 3. Merge — source_message_id 기준, 누락 메시지는 원문 fallback (항상
  // filteredMessages와 동일한 개수·순서를 보장하므로 count mismatch 자체가
  // 구조적으로 발생할 수 없다)
  const finalMessages = filteredMessages.map((orig: any) => {
    const corr = correctedMap.get(orig.source_message_id);
    return {
      source_message_id: orig.source_message_id,
      session_id: orig.session_id,
      role: orig.role,
      content: corr ? corr.content : orig.original_content,
      original_created_at: orig.created_at,
      section: orig.section,
      display_sequence: orig.display_sequence,
      correction_metadata: corr
        ? corr.correction_metadata
        : { changed: false, correction_reason: "gemini_missing_fallback", confidence: 0 },
    };
  });

  // 4. Atomic Save via complete_context_correction_job_v3 RPC
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

  return { skipped: false };
}

export async function runContextCorrectionWorkerV3(limit: number, workerId?: string, executionId?: string): Promise<CorrectionResult> {
  const db = createServiceClient();
  const wId = workerId || `context-worker-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const result: CorrectionResult = {
    claimed: 0,
    completed: 0,
    skipped: 0,
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

  const MODEL_NAME = getLlmModel("contextCorrection");

  for (const job of jobs) {
    try {
      const { skipped } = await processSingleCorrectionJob(db, job, wId, MODEL_NAME);
      if (skipped) {
        result.skipped++;
      } else {
        result.completed++;
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push({ job_id: job.id, error: err.message });

      const errMsg = err.message || "Unknown error";
      const isRetryable =
        errMsg.includes("JSON_PARSE_ERROR") ||
        errMsg.includes("429") ||
        errMsg.includes("503") ||
        errMsg.includes("timeout") ||
        errMsg.includes("SAVE_FAILED") ||
        errMsg.includes("NO_CONVERSATION_MARK_FAILED");

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
