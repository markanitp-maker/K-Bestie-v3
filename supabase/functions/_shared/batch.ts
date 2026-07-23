// Supabase Edge Function 공용 배치 로직 (Deno 런타임)
//
// TODO: 대화 내역(chat_messages) 7일 경과 자동 파기 스텝 추가 필요 — 자세한 건 FUTURE_TODO.md 참고.
//
// ⚠️ 운영 스케줄의 소스오브트루스 = 이 Edge Function 코드.
//    Next.js 쪽 lib/batch/*.ts + app/api/batch/daily/route.ts 는 로컬 수동 테스트 전용이며
//    운영 크론 경로가 아니다. 로직 변경 시 양쪽을 함께 맞춰야 한다.
//
// 프롬프트/모델 설정은 Next 쪽 순수 모듈을 그대로 재사용(중복 방지):
//   - app/api/_lib/prompts.ts     (REPORT_PROMPT_TEMPLATE, WEEKLY_REPORT_PROMPT_TEMPLATE)
//   - app/api/_lib/reportModel.ts (getActiveReportModel — provider_switch_settings 미조회 시 폴백용)
// 두 파일은 외부 import가 없는 순수 TS라 Deno에서 그대로 import 가능하다.
// ⚠️ app/api/_lib/ai.ts는 여기서 import하면 안 된다 — @/lib/supabase/server(Next 전용 경로 별칭)에
//    의존해서 Deno 번들링이 깨진다(과거 실제로 배포 실패한 원인). getActiveReportModel처럼 순수한
//    설정만 필요하면 반드시 reportModel.ts에서 가져올 것.
//
// provider_switch_settings(그룹A)를 이 파일에서 직접 조회한다 — Next.js ai.ts의
// getModelForGroup()은 Next 전용 createServiceClient()에 의존해 Deno에서 재사용 불가.
// Vertex 인증은 npm:google-auth-library(JWT 서비스 계정)로 OAuth 액세스 토큰을 얻어
// Vertex generateContent REST 엔드포인트를 직접 호출한다(GEMMA_API_KEY와 무관, 별도 자격증명).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoogleAuth } from "npm:google-auth-library@9";
import {
  REPORT_PROMPT_TEMPLATE,
  WEEKLY_REPORT_PROMPT_TEMPLATE,
} from "../../../app/api/_lib/prompts.ts";
import { getActiveReportModel } from "../../../app/api/_lib/reportModel.ts";
import { sanitizeReportJson } from "../../../app/api/_lib/reportSafetyGuard.ts";

function extractJSON(text: string) {
  try {
    const cleanText = text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(cleanText);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch {}
    }
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch {}
    }
    console.error("[extractJSON] JSON 추출 실패. 원문(300자):", text.substring(0, 300));
    throw new Error("JSON 파싱 오류");
  }
}

type ProviderId = "vertex";

interface GroupAModelResolved {
  provider: ProviderId;
  modelId: string;
  maxOutputTokens: number;
}

let cachedVertexAuth: GoogleAuth | null = null;

/** GCP_VERTEX_SA_KEY_JSON 서비스 계정으로 Vertex AI 액세스 토큰 발급(GCP_BILLING_SA_KEY_JSON과 완전 분리). */
async function getVertexAccessToken(): Promise<string> {
  const keyJson = Deno.env.get("GCP_VERTEX_SA_KEY_JSON");
  if (!keyJson) throw new Error("GCP_VERTEX_SA_KEY_JSON not configured");
  if (!cachedVertexAuth) {
    const credentials = JSON.parse(keyJson);
    cachedVertexAuth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  const client = await cachedVertexAuth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Vertex 액세스 토큰 발급 실패");
  return token.token;
}

/** 그룹A(리포트·요약) provider/model을 provider_switch_settings에서 조회.
 *  조회 실패/미실행 시 기존 getActiveReportModel() 기반 Vertex로 안전하게 폴백. */
async function resolveGroupAModel(db: SupabaseClient): Promise<GroupAModelResolved> {
  const fallback = getActiveReportModel();
  try {
    const { data } = await db
      .from("provider_switch_settings")
      .select("provider, model_id")
      .eq("group", "A")
      .maybeSingle();
    const provider = (data?.provider as ProviderId | undefined) ?? "vertex";
    const modelId = data?.model_id ?? fallback.modelId;
    return { provider, modelId, maxOutputTokens: fallback.maxOutputTokens };
  } catch {
    return { provider: "vertex", modelId: fallback.modelId, maxOutputTokens: fallback.maxOutputTokens };
  }
}



export interface CloseResult {
  closed: string[];
  skipped: string[];
  errors: { sessionId: string; error: string }[];
}
export interface DailyReportResult {
  created: string[];
  skipped: string[];
  errors: { sessionId: string; error: string }[];
}
export interface WeeklySummaryResult {
  created: string[];
  skipped: string[];
  errors: { childId: string; error: string }[];
}

export function serviceClient(): SupabaseClient {
  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Edge Function 런타임이 자동 주입
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}



/** Vertex AI generateContent REST 호출 — GCP_VERTEX_SA_KEY_JSON 서비스 계정 OAuth 토큰 사용. */
async function callVertex(modelId: string, prompt: string, maxOutputTokens: number): Promise<string> {
  const project = Deno.env.get("GOOGLE_CLOUD_PROJECT");
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not configured");
  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  const accessToken = await getVertexAccessToken();

  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;

  const res = await fetch(
    `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${modelId}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Vertex API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

/** 그룹A 모델 호출 — 오직 Vertex만 호출. Vertex 실패 시 예외를 발생시킨다.
 *  DB 설정이 "vertex"가 아닐 경우에도 예외를 발생시켜(fail-closed) AI Studio 호출을 원천 차단한다. */
async function callReportModel(model: GroupAModelResolved, prompt: string, maxOutputTokens: number): Promise<string> {
  if (model.provider !== "vertex") {
    throw new Error(`[batch] 지원되지 않는 provider입니다: ${model.provider}. 오직 vertex만 허용됩니다.`);
  }

  return await callVertex(model.modelId, prompt, maxOutputTokens);
}

/** Step 1: 자유 대화 세션 마감 */
export async function closeFreeSessions(db: SupabaseClient, targetDate: string): Promise<CloseResult> {
  const result: CloseResult = { closed: [], skipped: [], errors: [] };

  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, started_at")
    .eq("session_type", "free")
    .is("ended_at", null)
    .lte("started_at", `${targetDate}T23:59:59+09:00`);

  if (fetchErr) throw new Error(`closeFreeSessions: 세션 조회 실패 — ${fetchErr.message}`);
  if (!sessions?.length) return result;

  for (const session of sessions) {
    try {
      const { data: lastMsg } = await db
        .from("chat_messages")
        .select("created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const endedAt = lastMsg?.created_at ?? session.started_at;

      const { error: updateErr } = await db
        .from("chat_sessions")
        .update({ ended_at: endedAt })
        .eq("id", session.id);

      if (updateErr) throw new Error(updateErr.message);
      result.closed.push(session.id);
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }
  return result;
}

/** Step 2: 일일 리포트 생성 (emotion_level + dashboard_cards 포함) */
export async function generateDailyReports(db: SupabaseClient, targetDate: string): Promise<DailyReportResult> {
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  const { data: existingReports, error: existingErr } = await db
    .from("daily_reports")
    .select("session_id");

  if (existingErr) throw new Error(`generateDailyReports: 기존 리포트 조회 실패 — ${existingErr.message}`);

  const existingSessionIds = Array.from(
    new Set((existingReports || []).map((r: { session_id: string }) => r.session_id))
  );

  let query = db
    .from("chat_sessions")
    .select("id, child_id")
    .gte("ended_at", `${targetDate}T00:00:00+09:00`)
    .lte("ended_at", `${targetDate}T23:59:59+09:00`);

  if (existingSessionIds.length > 0) {
    query = query.not("id", "in", `(${existingSessionIds.join(",")})`);
  }

  const { data: sessions, error: fetchErr } = await query;

  if (fetchErr) throw new Error(`generateDailyReports: 세션 조회 실패 — ${fetchErr.message}`);
  if (!sessions?.length) return result;

  const reportModel = await resolveGroupAModel(db);

  for (const session of sessions) {
    try {
      // 1. 미션 완료 여부 확인 (게이지 100% = COMPLETED)
      const { data: progress, error: progErr } = await db
        .from("mission_progress")
        .select("status")
        .eq("session_id", session.id)
        .maybeSingle();

      if (progErr) throw new Error(progErr.message);

      if (progress?.status !== "COMPLETED") {
        // 미완료 처리 (0~99% 또는 자유대화)
        const { data: inserted, error: insertErr } = await db
          .from("daily_reports")
          .insert({
            session_id: session.id,
            summary_line: "아이가 미션을 완료하지 않아 업데이트가 없습니다",
            mood_score: 5,
            emotion_tags: [],
            parent_guide: "",
            emotion_level: "safe",
            school_academy_life: null,
            peer_friendship: null,
            emotion_hint: null,
            interests_preferences: null,
            study_concerns: null,
            digital_content_interests: null,
            future_dreams: null,
            recurring_stories: null,
          })
          .select("id")
          .single();

        if (insertErr) throw new Error(insertErr.message);
        result.created.push(inserted.id);
        continue;
      }

      const { data: messages, error: msgErr } = await db
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(session.id);
        continue;
      }

      const transcriptText = messages
        .map((m: { role: string; content: string }) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");

      let memoryContext = "(이전 기억 없음)";
      try {
        const { data: ltData, error: ltErr } = await db
          .from("child_memory")
          .select("memory_type, business_date, category, content")
          .eq("child_id", session.child_id)
          .eq("memory_type", "long_term")
          .order("business_date", { ascending: false })
          .limit(15);
        
        const { data: stData, error: stErr } = await db
          .from("child_memory")
          .select("memory_type, business_date, category, content, expires_at")
          .eq("child_id", session.child_id)
          .eq("memory_type", "short_term")
          .neq("business_date", targetDate)
          .order("business_date", { ascending: false });
        
        if (ltErr || stErr) {
          console.error("child_memory 조회 실패(daily report):", ltErr || stErr);
        } else {
          const validSt = (stData || [])
            .filter((m: { expires_at: string | null }) => !m.expires_at || new Date(m.expires_at) > new Date())
            .slice(0, 3);
          
          const combined = [...(ltData || []), ...validSt];
          if (combined.length > 0) {
            memoryContext = combined.map((m: { business_date: string; memory_type: string; content: string }) => `[${m.business_date}] (${m.memory_type}): ${m.content}`).join("\n");
          }
        }
      } catch (err) {
        console.error("child_memory 예외 발생(daily report):", err);
      }

      const prompt = REPORT_PROMPT_TEMPLATE
        .replace("{{MEMORY_CONTEXT}}", memoryContext)
        .replace("{{TRANSCRIPT}}", transcriptText);

      const text = await callReportModel(reportModel, prompt, reportModel.maxOutputTokens);

      let report: {
        summary_line?: string;
        mood_score?: number;
        emotion_tags?: string[];
        parent_guide?: string;
        emotion_level?: string;
        school_academy_life?: string;
        peer_friendship?: string;
        emotion_hint?: string;
        interests_preferences?: string;
        study_concerns?: string;
        digital_content_interests?: string;
        future_dreams?: string;
        recurring_stories?: string;
      };
      try {
        report = sanitizeReportJson(extractJSON(text));
      } catch {
        throw new Error(`JSON 파싱 실패: ${text.slice(0, 100)}`);
      }

      const moodScore = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));
      const emotionLevel =
        report.emotion_level === "warning" || report.emotion_level === "danger"
          ? report.emotion_level
          : "safe";

      const { data: inserted, error: insertErr } = await db
        .from("daily_reports")
        .insert({
          session_id: session.id,
          summary_line: report.summary_line ?? "",
          mood_score: moodScore,
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
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);
      result.created.push(inserted.id);
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }
  return result;
}

/** targetDate가 속한 주의 월요일/일요일 DATE 문자열 */
function getWeekBounds(targetDate: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${targetDate}T12:00:00Z`);
  const dow = d.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

interface WeeklyReportJson {
  summary_text?: string;
  detail_text?: string;
  detail_dashboard_cards?: Record<string, string>;
  mood_average?: number;
  highlights?: string[];
  parent_guide?: string;
  weekend_activity_recommendation?: string;
}

// 원문 재분석 입력 토큰 상한 근사치(문자 수) — 초과 시 청크 맵-리듀스로 압축한다.
const MAX_TRANSCRIPT_CHARS = 60_000;
const CHUNK_CHARS = 20_000;

function chunkText(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function mapChunkSummary(model: GroupAModelResolved, chunk: string): Promise<string> {
  const prompt = `다음은 아이와 AI 친구 케이의 대화 원문 일부입니다. 아이의 상태·관심사·감정·주말 희망사항과 관련된 내용을 놓치지 않고 5~8문장으로 압축 요약해줘(다른 설명 없이 요약문만):\n\n${chunk}`;
  return await callReportModel(model, prompt, 512);
}

async function reduceToWeeklyReport(model: GroupAModelResolved, weekRange: string, transcriptText: string): Promise<WeeklyReportJson> {
  const prompt = WEEKLY_REPORT_PROMPT_TEMPLATE
    .replace("{{WEEK_RANGE}}", weekRange)
    .replace("{{TRANSCRIPT}}", transcriptText);
  const text = await callReportModel(model, prompt, 2048);
  try {
    return sanitizeReportJson(extractJSON(text));
  } catch {
    throw new Error(`주간 리포트 JSON 파싱 실패: ${text.slice(0, 100)}`);
  }
}

/** 원문 재분석 — 토큰 상한 초과 시 청크 맵-리듀스로 압축한 뒤 리듀스. */
async function analyzeWeekTranscript(model: GroupAModelResolved, weekRange: string, transcriptText: string): Promise<WeeklyReportJson> {
  if (transcriptText.length <= MAX_TRANSCRIPT_CHARS) {
    return reduceToWeeklyReport(model, weekRange, transcriptText);
  }
  console.warn(`[generateWeeklySummary] 원문(${transcriptText.length}자)이 상한 초과 — 청크 맵-리듀스로 압축`);
  const chunks = chunkText(transcriptText, CHUNK_CHARS);
  const chunkSummaries: string[] = [];
  for (const chunk of chunks) {
    chunkSummaries.push(await mapChunkSummary(model, chunk));
  }
  const reducedTranscript = chunkSummaries.map((s, i) => `[구간 ${i + 1} 요약]\n${s}`).join("\n\n");
  return reduceToWeeklyReport(model, weekRange, reducedTranscript);
}

/** 최후 폴백 — 청크 맵-리듀스 후에도 실패하면 daily_reports 요약 이어붙이기로 강등(로그 남김). */
async function fallbackFromDailyReports(
  db: SupabaseClient,
  model: GroupAModelResolved,
  childId: string,
  weekStart: string,
  weekEnd: string,
  weekRange: string,
): Promise<WeeklyReportJson> {
  console.error(`[generateWeeklySummary] 원문 재분석 실패 — child ${childId}는 daily_reports 요약 이어붙이기로 폴백`);
  const { data: reports } = await db
    .from("daily_reports")
    .select("summary_line, mood_score, emotion_tags, chat_sessions!inner(child_id)")
    .eq("chat_sessions.child_id", childId)
    .gte("created_at", `${weekStart}T00:00:00Z`)
    .lte("created_at", `${weekEnd}T23:59:59Z`);

  const dailySummaries = (reports ?? [])
    .map((r: { summary_line: string; mood_score: number; emotion_tags: string[] }, i: number) =>
      `Day ${i + 1}: ${r.summary_line} (기분 ${r.mood_score}/10, 태그: ${r.emotion_tags.join(", ")})`)
    .join("\n");

  return reduceToWeeklyReport(model, weekRange, dailySummaries || "이번 주 기록된 대화가 없습니다.");
}

/** Step 3: 주간 리포트 — 그 주 대화 원문 전체를 재분석해 요약+상세를 함께 생성(이어붙이기 금지).
 *  토큰 상한 초과 시 청크 맵-리듀스, 그래도 실패하면 daily_reports 요약으로 자동 강등.
 *  토요일(6) 또는 forceWeekly */
export async function generateWeeklySummary(
  db: SupabaseClient,
  targetDate: string,
  forceWeekly = false,
): Promise<WeeklySummaryResult> {
  const result: WeeklySummaryResult = { created: [], skipped: [], errors: [] };

  const dow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
  if (!forceWeekly && dow !== 6) return result;

  const { weekStart, weekEnd } = getWeekBounds(targetDate);

  const { data: sessionsWithChild, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, child_id")
    .gte("started_at", `${weekStart}T00:00:00Z`)
    .lte("started_at", `${weekEnd}T23:59:59Z`);

  if (fetchErr) throw new Error(`generateWeeklySummary: 세션 조회 실패 — ${fetchErr.message}`);
  if (!sessionsWithChild?.length) return result;

  const sessionsByChild = new Map<string, string[]>();
  for (const s of sessionsWithChild as { id: string; child_id: string }[]) {
    if (!sessionsByChild.has(s.child_id)) sessionsByChild.set(s.child_id, []);
    sessionsByChild.get(s.child_id)!.push(s.id);
  }

  const weekRange = `${weekStart} ~ ${weekEnd}`;
  const reportModel = await resolveGroupAModel(db);

  for (const [childId, sessionIds] of sessionsByChild) {
    try {
      if (!sessionIds.length) {
        result.skipped.push(childId);
        continue;
      }

      const { data: messages, error: msgErr } = await db
        .from("chat_messages")
        .select("role, content")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(childId);
        continue;
      }

      const transcriptText = (messages as { role: string; content: string }[])
        .map((m) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");

      let report: WeeklyReportJson;
      try {
        report = await analyzeWeekTranscript(reportModel, weekRange, transcriptText);
      } catch (analyzeErr) {
        console.error(`[generateWeeklySummary] 청크 맵-리듀스도 실패:`, (analyzeErr as Error).message);
        report = await fallbackFromDailyReports(db, reportModel, childId, weekStart, weekEnd, weekRange);
      }

      const moodAverage = Math.max(1, Math.min(10, Math.round((report.mood_average ?? 5) * 10) / 10));

      const { data: inserted, error: insertErr } = await db
        .from("weekly_summaries")
        .upsert(
          {
            child_id: childId,
            week_start: weekStart,
            week_end: weekEnd,
            summary_text: report.summary_text ?? "",
            detail_text: report.detail_text ?? "",
            detail_dashboard_cards: report.detail_dashboard_cards ?? {},
            mood_average: moodAverage,
            highlights: report.highlights ?? [],
            parent_guide: report.parent_guide ?? "",
            weekend_activity_recommendation: report.weekend_activity_recommendation ?? "",
          },
          { onConflict: "child_id,week_start" },
        )
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);
      result.created.push(inserted.id);
    } catch (e) {
      result.errors.push({ childId, error: String(e) });
    }
  }
  return result;
}

/** KST(UTC+9) 기준 오늘 날짜 YYYY-MM-DD */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Authorization: Bearer <BATCH_SECRET> 검증. 통과 시 null, 실패 시 Response 반환 */
export function checkAuth(req: Request): Response | null {
  const secret = Deno.env.get("BATCH_SECRET");
  if (!secret) {
    return new Response(JSON.stringify({ error: "BATCH_SECRET not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export interface MemoryBatchResult {
  childrenProcessed: string[];
  longTermFactsCreated: number;
  skipped: string[];
  errors: { childId: string; error: string }[];
}

export async function generateMemorySummaries(db: SupabaseClient, targetDate: string): Promise<MemoryBatchResult> {
  const result: MemoryBatchResult = { childrenProcessed: [], longTermFactsCreated: 0, skipped: [], errors: [] };

  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, child_id")
    .eq("demo_mode", false)
    .gte("ended_at", `${targetDate}T00:00:00+09:00`)
    .lte("ended_at", `${targetDate}T23:59:59+09:00`);

  if (fetchErr) throw new Error(`generateMemorySummaries: 세션 조회 실패 — ${fetchErr.message}`);
  if (!sessions?.length) return result;

  const sessionsByChild = new Map<string, string[]>();
  for (const s of sessions) {
    if (!sessionsByChild.has(s.child_id)) sessionsByChild.set(s.child_id, []);
    sessionsByChild.get(s.child_id)!.push(s.id);
  }

  const reportModel = await resolveGroupAModel(db);

  for (const [childId, sessionIds] of sessionsByChild) {
    try {
      const { data: messages, error: msgErr } = await db
        .from("chat_messages")
        .select("role, content")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(childId);
        continue;
      }

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

      const text = await callReportModel(reportModel, prompt, reportModel.maxOutputTokens);

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
        .eq("child_id", childId)
        .eq("business_date", targetDate);
      if (deleteErr) throw new Error(`기존 메모리 삭제 실패: ${deleteErr.message}`);

      if (parsed.daily_summary) {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: shortErr } = await db
          .from("child_memory")
          .insert({
            child_id: childId,
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
                child_id: childId,
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

      result.childrenProcessed.push(childId);
    } catch (e) {
      result.errors.push({ childId, error: String(e) });
    }
  }

  return result;
}

export interface RetentionDeleteResult {
  targetSessionIds: string[];
  deletedMessageCount: number;
  dryRun: boolean;
}

export async function deleteExpiredChatMessages(db: SupabaseClient, dryRun: boolean): Promise<RetentionDeleteResult> {
  const result: RetentionDeleteResult = {
    targetSessionIds: [],
    deletedMessageCount: 0,
    dryRun,
  };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let allSessionIds: string[] = [];
  const pageSize = 1000;
  let rangeFrom = 0;
  
  while (true) {
    const rangeTo = rangeFrom + pageSize - 1;
    const { data: reports, error: reportErr } = await db
      .from("daily_reports")
      .select("session_id")
      .lt("created_at", sevenDaysAgo)
      .order("id", { ascending: true })
      .range(rangeFrom, rangeTo);

    if (reportErr) throw new Error(`deleteExpiredChatMessages: 리포트 조회 실패 — ${reportErr.message}`);
    
    if (!reports || reports.length === 0) {
      break;
    }

    allSessionIds.push(...reports.map((r: { session_id: string }) => r.session_id));

    if (reports.length < pageSize) {
      break;
    }
    
    rangeFrom += pageSize;
  }

  const sessionIds = Array.from(new Set(allSessionIds));
  if (sessionIds.length === 0) {
    return result;
  }

  result.targetSessionIds = sessionIds;

  const chunkSize = 200;
  let totalMessagesCount = 0;

  for (let i = 0; i < sessionIds.length; i += chunkSize) {
    const chunk = sessionIds.slice(i, i + chunkSize);
    
    if (dryRun) {
      const { count, error: countErr } = await db
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .in("session_id", chunk);

      if (countErr) throw new Error(`deleteExpiredChatMessages: 메시지 개수 조회 실패 — ${countErr.message}`);
      totalMessagesCount += count ?? 0;
    } else {
      const { data: deleted, error: deleteErr } = await db
        .from("chat_messages")
        .delete()
        .in("session_id", chunk)
        .select("id");

      if (deleteErr) throw new Error(`deleteExpiredChatMessages: 삭제 실행 실패 — ${deleteErr.message}`);
      totalMessagesCount += deleted ? deleted.length : 0;
    }
  }

  result.deletedMessageCount = totalMessagesCount;

  return result;
}
