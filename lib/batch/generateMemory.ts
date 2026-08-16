import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleGenAI } from "@google/genai";
import { createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { extractJSON } from "@/app/api/_lib/utils";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;
export const EXTRACTION_MAX_OUTPUT_TOKENS = 16384;

/** KST(UTC+9) 기준 오늘 날짜 YYYY-MM-DD */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface MemoryBatchResult {
  childrenProcessed: string[];
  longTermFactsCreated: number;
  skipped: string[];
  errors: { childId: string; error: string }[];
}

export type MemorySummaryResult = MemoryBatchResult;

/** 그룹A 모델 호출 — @google/genai SDK 사용. */
async function callReportModel(
  ai: GoogleGenAI,
  modelId: string,
  prompt: string,
  maxOutputTokens: number,
  responseSchema?: Record<string, unknown>
): Promise<string> {
  const config: Record<string, unknown> = {
    maxOutputTokens,
    systemInstruction: "반드시 JSON 형식으로만 응답하라. 여분의 텍스트 금지.",
  };
  if (responseSchema) {
    config.responseSchema = responseSchema;
    config.responseMimeType = "application/json";
  }
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config,
  });
  return response.text || "{}";
}

/** gemini-embedding-001(Vertex) 호출 — memory_facts.content(추출 요약)만 임베딩한다.
 *  절대 원문(대화 발췌)을 임베딩하지 않는다(원본 삭제 후 역복원 경로 차단, 설계 문서 §2-4). */
export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<number[]> {
  const ai = createGenAIClient({ provider: "vertex" });
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
  });
  const values = response.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`임베딩 응답 형식 오류(차원 ${values?.length ?? "?"})`);
  }
  return values;
}

export function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

// P0 긴급수정(안서현 부모-케이 장애) — idempotency_key는 반드시 "내용"에 종속돼야
// 한다. 내용 해시 기반으로 바꾸면 "같은 내용 재추출"만 같은 키가 되고(안전하게 재사용),
// 의미가 다른 Fact는 절대 충돌하지 않는다.
export async function stableContentKey(content: string): Promise<string> {
  const normalized = content.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}

export async function generateMemorySummaries(
  db: SupabaseClient,
  targetDate: string,
  targetChildId?: string
): Promise<MemorySummaryResult> {
  const result: MemorySummaryResult = {
    childrenProcessed: [],
    longTermFactsCreated: 0,
    skipped: [],
    errors: [],
  };

  let query = db
    .from("corrected_daily_conversations_v3")
    .select("id, child_id, business_date")
    .eq("business_date", targetDate)
    .or("status.eq.completed,correction_status.eq.completed");

  if (targetChildId) {
    query = query.eq("child_id", targetChildId);
  }

  const { data: convs, error: fetchErr } = await query;

  if (fetchErr) throw new Error(`generateMemorySummaries: 보정 대화 조회 실패 — ${fetchErr.message}`);
  if (!convs?.length) return result;

  const modelId = getLlmModel("supabaseBatchReport");
  const ai = createGenAIClient({ provider: "vertex" });

  for (const conv of convs) {
    try {
      const { data: messages, error: msgErr } = await db
        .from("corrected_daily_conversation_messages_v3")
        .select("session_id, role, content, display_sequence")
        .eq("corrected_daily_conversation_id", conv.id)
        .order("display_sequence", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(conv.child_id);
        continue;
      }

      const sessionIds = Array.from(
        new Set(
          messages
            .map((m: any) => m.session_id)
            .filter((id: any): id is string => typeof id === "string" && id.length > 0)
        )
      );

      const transcriptText = (messages as { role: string; content: string }[])
        .map((m) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");

      const prompt = `너는 아이와 나눈 하루치 대화를 부모에게 보여주는 게 아니라, "케이"라는 AI 친구가 나중에
이 아이와 다시 대화할 때 참고할 내부 기억으로 정리하는 역할이다.

아래는 오늘 하루 아이와 나눈 대화 원문이다.

${transcriptText}

다음 형식의 JSON으로만 응답해라(다른 텍스트 없이):
{
  "daily_summary": "오늘 하루 있었던 일을 케이 입장에서 짧게 정리한 요약 (3~5문장)",
  "long_term_facts": [
    { "category": "interest" | "friend" | "family" | "dream" | "event", "content": "짧은 사실 문장" }
  ]
}
- long_term_facts는 반복해서 기억할 가치가 있는 것만 담아라(좋아하는 것, 친구 이름, 가족
  이야기, 꿈, 특별한 사건 등). 없으면 빈 배열로 둬라.
- 아이의 안전을 위협하거나 민감한 개인정보(주소, 전화번호 등)는 절대 담지 마라.`;

      const responseSchema = {
        type: "OBJECT",
        properties: {
          daily_summary: { type: "STRING" },
          long_term_facts: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                category: { type: "STRING" },
                content: { type: "STRING" },
              },
              required: ["category", "content"],
            },
          },
        },
        required: ["daily_summary", "long_term_facts"],
      };

      // reportModel.maxOutputTokens(1024)는 리포트 본문용 값인데, 여기선 daily_summary+
      // long_term_facts 배열까지 함께 담는 JSON이라 잘릴 수 있다 — 같은 파일의
      // EXTRACTION_MAX_OUTPUT_TOKENS(아래 선언, "1024로는 다중 fact JSON이 잘림" 실측 기록)와
      // 동일한 원인으로 2026-08-02 Production에서 실제로 "JSON 파싱 실패"(중간에 끊긴
      // 문자열)가 재현돼 여기도 같은 값으로 맞춘다.
      const text = await callReportModel(ai, modelId, prompt, EXTRACTION_MAX_OUTPUT_TOKENS, responseSchema);

      let parsed: {
        daily_summary?: string;
        long_term_facts?: { category: string; content: string }[];
      };
      try {
        parsed = extractJSON(text);
      } catch {
        throw new Error(`JSON 파싱 실패: ${text.slice(0, 100)}`);
      }

      const { error: deleteErr } = await db
        .from("child_memory")
        .delete()
        .eq("child_id", conv.child_id)
        .eq("business_date", targetDate);
      if (deleteErr) throw new Error(`기존 메모리 삭제 실패: ${deleteErr.message}`);

      if (parsed.daily_summary) {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: shortErr } = await db
          .from("child_memory")
          .insert({
            child_id: conv.child_id,
            memory_type: "short_term",
            category: null,
            content: parsed.daily_summary,
            source_session_ids: sessionIds,
            business_date: targetDate,
            expires_at: expiresAt,
          });
        if (shortErr) throw new Error(`단기 기억 저장 실패: ${shortErr.message}`);
      }

      if (parsed.long_term_facts && Array.isArray(parsed.long_term_facts)) {
        const allowedCategories = ["interest", "friend", "family", "dream", "event"];
        for (const fact of parsed.long_term_facts) {
          if (allowedCategories.includes(fact.category) && fact.content) {
            const { error: longErr } = await db
              .from("child_memory")
              .insert({
                child_id: conv.child_id,
                memory_type: "long_term",
                category: fact.category,
                content: fact.content,
                source_session_ids: sessionIds,
                business_date: targetDate,
                expires_at: null,
              });
            if (longErr) throw new Error(`장기 기억 저장 실패: ${longErr.message}`);
            result.longTermFactsCreated++;
          }
        }
      }

      result.childrenProcessed.push(conv.child_id);
    } catch (e) {
      result.errors.push({ childId: conv.child_id, error: String(e) });
    }
  }

  return result;
}

export const REINFORCEMENT_SIMILARITY_THRESHOLD = 0.92; // 설계 문서 §9 — 튜닝 대상, 확정값 아님
export const TRAIT_PATTERN_SELF_STATEMENT_CONFIDENCE = 0.85; // 설계 문서 §9 — 튜닝 대상
export const EXTRACTION_PROMPT_VERSION = "extraction-v1";

const TRAIT_PATTERN_TYPES = new Set(["trait", "pattern"]);

export interface ExtractedFact {
  fact_type: "interest" | "friend" | "family" | "dream" | "event" | "trait" | "pattern";
  subject?: string | null;
  content: string;
  confidence?: number;
  importance?: number;
  is_explicit_self_statement?: boolean;
  evidence_summary: string;
  source_excerpt?: string; // 임시 보존(최대 7일) — 원문 발췌, 영구 보존 금지
  entities?: { entity_type: "person" | "place" | "object" | "activity" | "other"; entity_name: string }[];
  relations?: { source_entity_name: string; relation_type: string; target_entity_name: string }[];
}

export interface MemoryFactBatchResult {
  childrenProcessed: string[];
  factsCreated: number;
  factsReinforced: number;
  factsPromoted: number;
  factsSkippedDuplicate: number;
  skipped: string[];
  errors: { childId: string; error: string }[];
  entityRelationWarnings: { childId: string; warning: string }[];
}

export async function generateMemoryFacts(
  db: SupabaseClient,
  targetDate: string,
  targetChildId?: string
): Promise<MemoryFactBatchResult> {
  const result: MemoryFactBatchResult = {
    childrenProcessed: [],
    factsCreated: 0,
    factsReinforced: 0,
    factsPromoted: 0,
    factsSkippedDuplicate: 0,
    skipped: [],
    errors: [],
    entityRelationWarnings: [],
  };

  let query = db
    .from("corrected_daily_conversations_v3")
    .select("id, child_id, business_date")
    .eq("business_date", targetDate)
    .or("status.eq.completed,correction_status.eq.completed");

  if (targetChildId) {
    query = query.eq("child_id", targetChildId);
  }

  const { data: convs, error: fetchErr } = await query;
  if (fetchErr) throw new Error(`generateMemoryFacts: 대상 보정 대화 조회 실패 — ${fetchErr.message}`);
  if (!convs?.length) return result;

  const modelId = getLlmModel("supabaseBatchReport");
  const ai = createGenAIClient({ provider: "vertex" });

  for (const conv of convs) {
    const childId = conv.child_id;
    try {
      const { data: messages, error: msgErr } = await db
        .from("corrected_daily_conversation_messages_v3")
        .select("session_id, role, content, section, display_sequence")
        .eq("corrected_daily_conversation_id", conv.id)
        .order("display_sequence", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(childId);
        continue;
      }

      // 066-llm-wiki QA: 이전에는 하루 전체(미션+자유대화 혼합) 메시지를 한 번에 합쳐
      // 단일 sessionType으로 추출했다 — 같은 날 미션과 자유대화를 모두 하면 자유대화에서만
      // 나온 발화의 Fact까지 source_type='mission'으로 잘못 표시되는 결함이 있었다(§17
      // "source 구분"). 구간별로 분리해 추출해 각자의 실제 출처를 유지한다.
      const missionMessages = (messages as { role: string; content: string; section: string }[])
        .filter((m) => m.section === "mission_1" || m.section === "mission_2");
      const freeChatMessages = (messages as { role: string; content: string; section: string }[])
        .filter((m) => m.section === "free_chat_1" || m.section === "free_chat_2");

      const groups: { sessionType: "mission" | "free_chat"; groupMessages: { role: string; content: string }[] }[] = [];
      if (missionMessages.length > 0) groups.push({ sessionType: "mission", groupMessages: missionMessages });
      if (freeChatMessages.length > 0) groups.push({ sessionType: "free_chat", groupMessages: freeChatMessages });

      if (groups.length === 0) {
        result.skipped.push(childId);
        continue;
      }

      for (const group of groups) {
        const sessionType = group.sessionType;
        const transcriptText = group.groupMessages
          .map((m) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
          .join("\n");

        const prompt = `너는 아이와 케이의 대화에서 장기적으로 기억할 가치가 있는 사실(Fact)과 그 사실에
연결된 사람/장소/사물(Entity), 그리고 Entity 간 관계(Relation)를 추출하는 역할이다.

아래는 오늘 하루 아이와 나눈 대화 원문이다.

${transcriptText}

다음 형식의 JSON으로만 응답해라(다른 텍스트 없이):
{
  "facts": [
    {
      "fact_type": "interest" | "friend" | "family" | "dream" | "event" | "trait" | "pattern",
      "subject": "이 사실이 누구/무엇에 대한 것인지(짧은 텍스트, 없으면 null)",
      "content": "짧은 사실 문장(한 문장)",
      "confidence": 0.0~1.0 (이 추출이 얼마나 확실한지),
      "importance": 0.0~1.0 (이 사실이 얼마나 중요한지),
      "is_explicit_self_statement": true 또는 false (아이가 스스로 명확히 말한 것인지,
        추론/암시가 아닌지 — trait/pattern에서만 중요),
      "evidence_summary": "원문을 그대로 인용하지 말고, '미션 대화 중 축구를 좋아한다고
        언급'처럼 근거를 짧게 요약(20자 내외)",
      "source_excerpt": "이 사실의 근거가 된 원문 발췌(짧게, 실제 대화 문장)",
      "entities": [{"entity_type": "person"|"place"|"object"|"activity"|"other", "entity_name": "이름"}],
      "relations": [{"source_entity_name": "...", "relation_type": "...", "target_entity_name": "..."}]
    }
  ]
}

규칙(반드시 지켜라):
- fact_type이 "trait"(성향) 또는 "pattern"(반복 패턴)인 경우, 단일 발화나 일회성
  사건만으로는 절대 만들지 마라 — 오늘 대화 안에서도 여러 번 드러나거나, 아이가
  명확히 스스로 규정한 경우("나는 원래 조용한 편이야")에만 만들어라.
- 반복해서 기억할 가치가 있는 것만 담아라(좋아하는 것, 친구 이름, 가족 이야기, 꿈,
  특별한 사건, 안정적인 성향, 반복되는 행동/감정 패턴). 단순 인사·하루짜리 잡담은
  제외해라. 없으면 facts를 빈 배열로 둬라.
- 아이의 안전을 위협하거나 민감한 개인정보(주소, 전화번호 등)는 절대 담지 마라.
- source_excerpt는 이 서버가 최대 7일만 임시 보관하고 이후 반드시 삭제한다 — 너무
  길게 인용하지 말고 근거 확인에 필요한 최소한만 담아라.`;

        const responseSchema = {
          type: "OBJECT",
          properties: {
            facts: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  fact_type: { type: "STRING" },
                  subject: { type: "STRING" },
                  content: { type: "STRING" },
                  confidence: { type: "NUMBER" },
                  importance: { type: "NUMBER" },
                  is_explicit_self_statement: { type: "BOOLEAN" },
                  evidence_summary: { type: "STRING" },
                  source_excerpt: { type: "STRING" },
                  entities: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        entity_type: { type: "STRING" },
                        entity_name: { type: "STRING" },
                      },
                      required: ["entity_type", "entity_name"],
                    },
                  },
                  relations: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        source_entity_name: { type: "STRING" },
                        relation_type: { type: "STRING" },
                        target_entity_name: { type: "STRING" },
                      },
                      required: ["source_entity_name", "relation_type", "target_entity_name"],
                    },
                  },
                },
                required: ["fact_type", "content", "evidence_summary"],
              },
            },
          },
          required: ["facts"],
        };

        const text = await callReportModel(ai, modelId, prompt, EXTRACTION_MAX_OUTPUT_TOKENS, responseSchema);

        let parsed: { facts?: ExtractedFact[] };
        try {
          parsed = extractJSON(text);
        } catch {
          throw new Error(`JSON 파싱 실패: ${text.slice(0, 100)}`);
        }

        const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
        const allowedFactTypes = new Set(["interest", "friend", "family", "dream", "event", "trait", "pattern"]);
        const clamp01 = (v: unknown, fallback: number): number => {
          const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
          return Math.min(1, Math.max(0, n));
        };

        let factIndex = 0;
        for (const rawFact of facts) {
          factIndex++;
          if (
            typeof rawFact.fact_type !== "string" || !allowedFactTypes.has(rawFact.fact_type) ||
            typeof rawFact.content !== "string" || !rawFact.content.trim() ||
            typeof rawFact.evidence_summary !== "string" || !rawFact.evidence_summary.trim()
          ) continue;
          rawFact.confidence = clamp01(rawFact.confidence, 0.5);
          rawFact.importance = clamp01(rawFact.importance, 0.5);

          const embedding = await embedText(rawFact.content, "RETRIEVAL_DOCUMENT");
          const { error: embeddingUsageError } = await db.from("usage_events").insert({
            child_id: conv.child_id,
            kind: "embedding",
            model: EMBEDDING_MODEL,
            request_count: 1,
            input_count: rawFact.content.length,
            est_cost_krw: null,
            environment: process.env.NEXT_PUBLIC_SUPABASE_TARGET === "prod" ? "production" : "development",
          });
          if (embeddingUsageError) {
            console.error(`[memory-facts] embedding usage 기록 실패(${conv.child_id}): ${embeddingUsageError.message}`);
          }
          const embeddingLiteral = toPgVectorLiteral(embedding);

          const { data: matchRows, error: matchErr } = await db.rpc("find_similar_memory_fact", {
            p_child_id: conv.child_id,
            p_embedding: embeddingLiteral,
            p_fact_type: rawFact.fact_type,
            p_similarity_threshold: REINFORCEMENT_SIMILARITY_THRESHOLD,
          });
          if (matchErr) throw new Error(`벡터 유사도 검색 실패: ${matchErr.message}`);
          const match = Array.isArray(matchRows) ? matchRows[0] : matchRows;

          if (match?.fact_id) {
            const { data: evInserted, error: evErr } = await db
              .from("memory_evidence")
              .upsert(
                {
                  memory_fact_id: match.fact_id,
                  evidence_summary: rawFact.evidence_summary,
                  source_text: rawFact.source_excerpt ?? null,
                  source_date: targetDate,
                },
                { onConflict: "memory_fact_id,source_date", ignoreDuplicates: true },
              )
              .select("id");
            if (evErr) throw new Error(`evidence 저장 실패: ${evErr.message}`);

            if (!evInserted || evInserted.length === 0) {
              continue;
            }

            const { data: existingFact, error: fetchErr } = await db
              .from("memory_facts")
              .select("id, status, source_count, confidence")
              .eq("id", match.fact_id)
              .single();
            if (fetchErr) throw new Error(`기존 fact 조회 실패: ${fetchErr.message}`);

            const newSourceCount = (existingFact.source_count ?? 1) + 1;
            const shouldPromote = existingFact.status === "candidate" && newSourceCount >= 2;
            const newStatus = shouldPromote ? "active" : existingFact.status;
            const newConfidence = Math.min(1, (existingFact.confidence ?? 0.5) + 0.05);

            const { error: updErr } = await db
              .from("memory_facts")
              .update({
                source_count: newSourceCount,
                last_confirmed_at: new Date().toISOString(),
                confidence: newConfidence,
                status: newStatus,
                updated_at: new Date().toISOString(),
              })
              .eq("id", match.fact_id);
            if (updErr) throw new Error(`fact 갱신 실패: ${updErr.message}`);

            await db.from("memory_history").insert({
              memory_id: match.fact_id,
              action: shouldPromote ? "promoted" : "reinforced",
              before_value: { status: existingFact.status, source_count: existingFact.source_count },
              after_value: { status: newStatus, source_count: newSourceCount },
            });

            if (shouldPromote) result.factsPromoted++;
            else result.factsReinforced++;
            continue;
          }

          let initialStatus: "candidate" | "active" = "active";
          if (TRAIT_PATTERN_TYPES.has(rawFact.fact_type)) {
            const isConfidentSelfStatement =
              rawFact.is_explicit_self_statement === true &&
              (rawFact.confidence ?? 0) >= TRAIT_PATTERN_SELF_STATEMENT_CONFIDENCE;
            initialStatus = isConfidentSelfStatement ? "active" : "candidate";
          }

          // P0 긴급수정 — idempotency_key를 내용 해시 기반으로 생성하고, Fact·Evidence·
          // Embedding·History 4개 INSERT를 단일 RPC(트랜잭션)로 묶어 부분 실패로 고아
          // Fact(evidence/embedding 없음)가 남거나, 동시 실행/재시도 시 유니크 제약
          // 위반으로 배치 전체가 죽는 문제를 없앤다. 충돌 시(동일 내용 재추출) RPC가
          // 기존 fact_id를 그대로 반환해 중복을 만들지 않는다.
          const contentKey = await stableContentKey(rawFact.content);
          const idempotencyKey = `memory_batch_${childId}_${targetDate}_${rawFact.fact_type}_${contentKey}`;

          const { data: factRpcRows, error: factRpcErr } = await db.rpc("create_memory_fact_with_evidence", {
            p_idempotency_key: idempotencyKey,
            p_child_id: childId,
            p_fact_type: rawFact.fact_type,
            p_subject: rawFact.subject ?? null,
            p_content: rawFact.content,
            p_confidence: rawFact.confidence ?? 0.5,
            p_importance: rawFact.importance ?? 0.5,
            p_status: initialStatus,
            p_source_type: sessionType === "mission" ? "mission" : "free_chat",
            p_source_date: targetDate,
            p_session_type: sessionType,
            p_model_version: modelId,
            p_prompt_version: EXTRACTION_PROMPT_VERSION,
            p_pipeline_version: "v3",
            p_evidence_summary: rawFact.evidence_summary,
            p_source_text: rawFact.source_excerpt ?? null,
            p_embedding: embeddingLiteral,
            p_embedding_model: EMBEDDING_MODEL,
          });
          if (factRpcErr) throw new Error(`fact 저장 실패: ${factRpcErr.message}`);
          const factRpcResult = Array.isArray(factRpcRows) ? factRpcRows[0] : factRpcRows;
          const factId = factRpcResult?.fact_id;
          if (!factId) throw new Error("fact 저장 실패: RPC가 fact_id를 반환하지 않음");
          if (!factRpcResult.was_new) {
            // 동시 실행/재시도로 동일 내용의 Fact가 이미 존재 — entity/relation은 아래에서
            // 계속 upsert(멱등적)하되 evidence/embedding/history 중복 생성은 RPC 내부에서
            // 이미 막았으므로 여기서는 추가 작업 없음.
            result.factsSkippedDuplicate = (result.factsSkippedDuplicate ?? 0) + 1;
          }

          // Entity/Relation — 이름 기준으로 upsert(같은 아이 안에서 중복 방지, §2-1 유니크 인덱스).
          const entityIdByName = new Map<string, string>();
          for (const ent of rawFact.entities ?? []) {
            if (!ent.entity_name) continue;
            const { data: upserted, error: entErr } = await db
              .from("memory_entities")
              .upsert(
                { child_id: childId, entity_type: ent.entity_type, entity_name: ent.entity_name },
                { onConflict: "child_id,entity_type,entity_name" },
              )
              .select("id")
              .single();
            if (entErr) {
              // codex 지적: 조용히 넘어가면 이 entity를 참조하는 relation도 이유 없이
              // 누락된다 — result에 보이게 기록한다(전체 fact 처리를 막지는 않음).
              result.entityRelationWarnings.push({
                childId,
                warning: `entity upsert 실패(${ent.entity_name}): ${entErr.message}`,
              });
              continue;
            }
            entityIdByName.set(ent.entity_name, upserted.id);
          }
          for (const rel of rawFact.relations ?? []) {
            const sourceId = entityIdByName.get(rel.source_entity_name);
            const targetId = entityIdByName.get(rel.target_entity_name);
            if (!sourceId || !targetId) {
              result.entityRelationWarnings.push({
                childId,
                warning: `relation 건너뜀(entity 미확보): ${rel.source_entity_name} -> ${rel.target_entity_name}`,
              });
              continue;
            }
            const { error: relErr } = await db.from("memory_relations").insert({
              child_id: childId,
              source_entity_id: sourceId,
              relation_type: rel.relation_type,
              target_entity_id: targetId,
              derived_from_fact_id: factId,
            });
            if (relErr) {
              result.entityRelationWarnings.push({
                childId,
                warning: `relation 저장 실패(${rel.source_entity_name}->${rel.target_entity_name}): ${relErr.message}`,
              });
            }
          }

          if (factRpcResult.was_new) result.factsCreated++;
        }
      } // end for (const group of groups)

      result.childrenProcessed.push(childId);
    } catch (e) {
      result.errors.push({ childId, error: String(e) });
    }
  }

  return result;
}
