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
import { GoogleGenAI } from "npm:@google/genai@2.8.0";
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



/** 그룹A 모델 호출 — @google/genai SDK 사용. Vertex direct REST/GoogleAuth 제외. */
async function callReportModel(model: GroupAModelResolved, prompt: string, maxOutputTokens: number, responseSchema?: any): Promise<string> {
  const ai = getGenAIClient();
  const config: any = {
    maxOutputTokens,
    systemInstruction: "반드시 JSON 형식으로만 응답하라. 여분의 텍스트 금지.",
  };
  if (responseSchema) {
    config.responseSchema = responseSchema;
    // Vertex AI(이 파일의 getGenAIClient()는 vertexai:true 모드)는 responseSchema 사용 시
    // responseMimeType을 명시하지 않으면 기본값 text/plain과 충돌해 400을 반환한다
    // (AI Studio 모드와 다른 Vertex 고유 요구사항 — 프로젝트 §5 "responseMimeType 사용 금지"
    // 규칙은 GEMMA_API_KEY 기반 AI Studio 경로용이며 이 Vertex 경로에는 적용되지 않는다).
    config.responseMimeType = "application/json";
  }
  const response = await ai.models.generateContent({
    model: model.modelId,
    contents: prompt,
    config,
  });
  return response.text || "{}";
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

/**
 * Step 2: 일일 리포트 생성 (emotion_level + dashboard_cards + 8개 항목 포함)
 *
 * requests/017-report-check.md — child_id+business_date를 리포트 식별자로 통합한다.
 * 과거에는 chat_sessions.ended_at 기준으로 세션 하나당 리포트 하나를 만들었는데,
 * (a) 미션 세션은 ended_at을 절대 채우지 않아(app/api/mission/start/route.ts 주석
 * 참고) 미션 대화가 이 조회에 영원히 걸리지 않았고, (b) 같은 날 같은 아이가 여러
 * 세션(미션+자유대화, 또는 자유대화 여러 번)을 하면 리포트가 세션 수만큼 쪼개졌다
 * (§4.2 "child_id+business_date=1개" 위반). raw_daily_conversations는 이미
 * child_id+business_date+session_type을 직접 갖고 있으므로(018 파이프라인), 세션이
 * 아니라 이 테이블에서 곧바로 "그날 대화가 있었던 아이" 목록을 뽑아 하루 1아이 1건으로
 * 통합 생성한다.
 */
export async function generateDailyReports(db: SupabaseClient, targetDate: string): Promise<DailyReportResult> {
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  // 그날 원본 대화가 하나라도 수집된 아이 목록(미션/자유대화 구분 없이 통합).
  const { data: rawRows, error: rawListErr } = await db
    .from("raw_daily_conversations")
    .select("child_id")
    .eq("business_date", targetDate);

  if (rawListErr) throw new Error(`generateDailyReports: 대상 아이 조회 실패 — ${rawListErr.message}`);
  if (!rawRows?.length) return result;

  const candidateChildIds = Array.from(new Set(rawRows.map((r: { child_id: string }) => r.child_id)));

  // 동의 철회된 아이는 신규 리포트 생성 대상에서 제외(lib/batch/generateDailyReports.ts와 동기화).
  const { data: consentRows, error: consentErr } = await db
    .from("child_profiles")
    .select("id, guardian_consent_withdrawn_at")
    .in("id", candidateChildIds);
  if (consentErr) throw new Error(`generateDailyReports: 동의 상태 조회 실패 — ${consentErr.message}`);

  const withdrawnIds = new Set(
    (consentRows || [])
      .filter((c: { guardian_consent_withdrawn_at: string | null }) => c.guardian_consent_withdrawn_at !== null)
      .map((c: { id: string }) => c.id)
  );
  const childIds = candidateChildIds.filter((id) => !withdrawnIds.has(id));
  if (!childIds.length) return result;

  const reportModel = await resolveGroupAModel(db);

  for (const childId of childIds) {
    try {
      // 1. 보정된 대화 내역 조회 — 그날 이 아이의 모든 세션(미션+자유대화)을 합쳐서
      //    본다. 미션 완료 여부는 조건에 없다(진행중/중단 세션도 그대로 포함).
      const { data: conversations, error: convErr } = await db
        .from("raw_daily_conversations")
        .select(`
          id,
          speaker,
          raw_text,
          turn_order,
          corrected_daily_conversations (
            corrected_text,
            report_eligible
          )
        `)
        .eq("child_id", childId)
        .eq("business_date", targetDate)
        .order("turn_order", { ascending: true });

      if (convErr) throw new Error(`보정 대화 조회 실패: ${convErr.message}`);

      const validConversations = (conversations || []).filter((c: any) => {
        if (c.speaker === "k") return true;
        const corr = Array.isArray(c.corrected_daily_conversations)
          ? c.corrected_daily_conversations[0]
          : c.corrected_daily_conversations;
        return corr?.report_eligible === true;
      });

      if (!validConversations.length || !validConversations.some((c: any) => c.speaker === "child")) {
        result.skipped.push(childId);
        continue;
      }

      const transcriptText = validConversations
        .map((c: any) => {
          if (c.speaker === "child") {
            const corr = Array.isArray(c.corrected_daily_conversations)
              ? c.corrected_daily_conversations[0]
              : c.corrected_daily_conversations;
            return `아이: ${corr.corrected_text}`;
          }
          return `케이: ${c.raw_text}`;
        })
        .join("\n");

      const rawIds = validConversations.map((c: any) => c.id);

      let memoryContext = "(이전 기억 없음)";
      try {
        const { data: ltData, error: ltErr } = await db
          .from("child_memory")
          .select("memory_type, business_date, category, content")
          .eq("child_id", childId)
          .eq("memory_type", "long_term")
          .order("business_date", { ascending: false })
          .limit(15);

        const { data: stData, error: stErr } = await db
          .from("child_memory")
          .select("memory_type, business_date, category, content, expires_at")
          .eq("child_id", childId)
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

      const reportFields = {
        child_id: childId,
        business_date: targetDate,
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
      };

      // 같은 child_id+business_date 리포트가 이미 있으면(재실행/관리자 수동 재생성)
      // 새로 INSERT하지 않고 그 행을 갱신한다 — 하드 UNIQUE 제약이 없어 애플리케이션
      // 레벨에서 먼저 조회 후 분기한다. 과거(이 마이그레이션 이전) 세션당 리포트를
      // 만들던 구조 때문에 같은 child_id+business_date에 이미 여러 행이 남아있는
      // 경우가 있어(.single()/.maybeSingle()이면 그런 행에서 에러가 남) 가장 최근
      // 행 하나만 골라 갱신한다 — 남은 과거 중복 행은 그대로 두되(삭제하지 않음)
      // 앞으로는 더 늘지 않는다.
      const { data: existingRows, error: existingOneErr } = await db
        .from("daily_reports")
        .select("id")
        .eq("child_id", childId)
        .eq("business_date", targetDate)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (existingOneErr) throw new Error(existingOneErr.message);
      const existing = existingRows?.[0] ?? null;

      let reportId: string;
      if (existing) {
        const { error: updErr } = await db.from("daily_reports").update(reportFields).eq("id", existing.id);
        if (updErr) throw new Error(updErr.message);
        reportId = existing.id;
      } else {
        const { data: inserted, error: insertErr } = await db
          .from("daily_reports")
          .insert(reportFields)
          .select("id")
          .single();
        if (insertErr) throw new Error(insertErr.message);
        reportId = inserted.id;
      }
      result.created.push(reportId);

      // 리포트가 실제로 성공적으로 만들어진 뒤에만 소비 시각을 찍는다(LLM/삽입 실패 시
      // report_generated_at이 찍히면 리포트 없이 원본만 7일 뒤 삭제되는 사고로 이어진다).
      if (rawIds.length > 0) {
        const now = new Date().toISOString();
        await db.from("raw_daily_conversations").update({ report_generated_at: now }).in("id", rawIds);
        await db.from("corrected_daily_conversations").update({ report_generated_at: now }).in("raw_conversation_id", rawIds);
      }
    } catch (e) {
      result.errors.push({ sessionId: childId, error: String(e) });
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

export async function generateMemorySummaries(
  db: SupabaseClient,
  targetDate: string,
  targetChildId?: string
): Promise<MemoryBatchResult> {
  const result: MemoryBatchResult = { childrenProcessed: [], longTermFactsCreated: 0, skipped: [], errors: [] };

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

  const reportModel = await resolveGroupAModel(db);

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
      const text = await callReportModel(reportModel, prompt, EXTRACTION_MAX_OUTPUT_TOKENS, responseSchema);

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

// ── 023 LLM Wiki + RAG Memory — Step 3: Memory Extraction Agent ──────────
// 설계 문서: docs/k-bestie-llm-wiki-design.md. 기존 generateMemorySummaries(위)는
// 한 줄도 건드리지 않는다 — 같은 배치 트리거(memory-batch)에서 병행 호출되는
// 완전히 별도의 파이프라인이다.

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const REINFORCEMENT_SIMILARITY_THRESHOLD = 0.92; // 설계 문서 §9 — 튜닝 대상, 확정값 아님
const TRAIT_PATTERN_SELF_STATEMENT_CONFIDENCE = 0.85; // 설계 문서 §9 — 튜닝 대상
const EXTRACTION_PROMPT_VERSION = "extraction-v1";
// 실측: 1024로는 다중 fact+entity+relation JSON이 잘림(과거 기록). 2026-08-02 Production에서
// 대화량이 많은 아이 대상 generateMemoryFacts 호출이 4096으로도 잘리는 것을 추가로 확인해
// 8192로 올림 — 이 값은 lib/batch/contextCorrectionV3.ts·dailyReportV3.ts가 동일 유형의
// 구조화 JSON 추출에 이미 8192를 쓰고 있어 안전성이 검증된 값이다.
const EXTRACTION_MAX_OUTPUT_TOKENS = 8192;

/** gemini-embedding-001(Vertex) 호출 — memory_facts.content(추출 요약)만 임베딩한다.
 *  절대 원문(대화 발췌)을 임베딩하지 않는다(원본 삭제 후 역복원 경로 차단, 설계 문서 §2-4). */
let cachedGenAIClient: GoogleGenAI | null = null;

function getGenAIClient(): GoogleGenAI {
  if (cachedGenAIClient) return cachedGenAIClient;
  const keyJson = Deno.env.get("GCP_VERTEX_SA_KEY_JSON");
  const project = Deno.env.get("GOOGLE_CLOUD_PROJECT");
  if (!keyJson) throw new Error("GCP_VERTEX_SA_KEY_JSON not configured");
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not configured");
  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  const credentials = JSON.parse(keyJson);
  cachedGenAIClient = new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
  return cachedGenAIClient;
}

async function embedText(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]> {
  const ai = getGenAIClient();
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

function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

interface ExtractedFact {
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
  skipped: string[];
  errors: { childId: string; error: string }[];
  entityRelationWarnings: { childId: string; warning: string }[];
}

const TRAIT_PATTERN_TYPES = new Set(["trait", "pattern"]);

export async function generateMemoryFacts(db: SupabaseClient, targetDate: string, targetChildId?: string): Promise<MemoryFactBatchResult> {
  const result: MemoryFactBatchResult = {
    childrenProcessed: [], factsCreated: 0, factsReinforced: 0, factsPromoted: 0, skipped: [], errors: [],
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

  const reportModel = await resolveGroupAModel(db);

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

      const sections = new Set((messages || []).map((m: any) => m.section));
      const hasMission = sections.has("mission_1") || sections.has("mission_2");
      const hasFree = sections.has("free_chat_1") || sections.has("free_chat_2");
      const sessionType = hasMission ? "mission" : (hasFree ? "free_chat" : "free_chat");

      const transcriptText = (messages as { role: string; content: string }[])
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

      const text = await callReportModel(reportModel, prompt, EXTRACTION_MAX_OUTPUT_TOKENS, responseSchema);

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

        const { data: insertedFact, error: insertErr } = await db
          .from("memory_facts")
          .insert({
            child_id: childId,
            fact_type: rawFact.fact_type,
            subject: rawFact.subject ?? null,
            content: rawFact.content,
            confidence: rawFact.confidence ?? 0.5,
            importance: rawFact.importance ?? 0.5,
            status: initialStatus,
            source_type: sessionType === "mission" ? "mission" : "free_chat",
            source_date: targetDate,
            session_type: sessionType,
            model_version: reportModel.modelId,
            prompt_version: EXTRACTION_PROMPT_VERSION,
            pipeline_version: "v3",
            idempotency_key: `memory_batch_${childId}_${targetDate}_${rawFact.fact_type}_${factIndex}`,
            backfill_status: "normal"
          })
          .select("id")
          .single();
        if (insertErr) throw new Error(`fact 저장 실패: ${insertErr.message}`);
        const factId = insertedFact.id;

        const { error: evInsertErr } = await db.from("memory_evidence").insert({
          memory_fact_id: factId,
          evidence_summary: rawFact.evidence_summary,
          source_text: rawFact.source_excerpt ?? null,
          source_date: targetDate,
        });
        if (evInsertErr) throw new Error(`evidence 저장 실패: ${evInsertErr.message}`);

        const { error: embErr } = await db.from("memory_embeddings").insert({
          memory_fact_id: factId,
          child_id: childId,
          embedding: embeddingLiteral,
          model: EMBEDDING_MODEL,
        });
        if (embErr) throw new Error(`embedding 저장 실패: ${embErr.message}`);

        await db.from("memory_history").insert({
          memory_id: factId,
          action: "created",
          after_value: { fact_type: rawFact.fact_type, status: initialStatus },
        });

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

        result.factsCreated++;
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

export interface ConversationPipelineRetentionResult {
  rawDeleted: number;
  correctedDeleted: number;
  dryRun: boolean;
}

/**
 * requests/018 §11 — raw_daily_conversations / corrected_daily_conversations 7일 보관정책.
 *
 * 삭제 시점: "일일 리포트 생성 완료 시점(report_generated_at) + 7일" — generateDailyReports가
 * 리포트를 실제로 생성한 세션에 한해 report_generated_at을 찍으므로, 그 시점 기준으로만 판단한다.
 *
 * 보완 규칙: 세션에 아이 발화가 없었거나 report_eligible 데이터가 하나도 없어 애초에 리포트가
 * 생성되지 않는(=result.skipped) 세션은 report_generated_at이 영원히 NULL로 남아 위 규칙만으로는
 * 삭제되지 않는다. 이런 데이터가 무한 누적되지 않도록, business_date가 14일(7일의 2배 — 아직
 * 처리 중일 가능성을 감안한 여유 기간) 이상 지났는데도 report_generated_at이 NULL이면 "리포트로
 * 이어지지 않을 데이터"로 보고 함께 삭제한다.
 */
export async function deleteExpiredConversationPipelineData(
  db: SupabaseClient,
  dryRun: boolean,
): Promise<ConversationPipelineRetentionResult> {
  const result: ConversationPipelineRetentionResult = { rawDeleted: 0, correctedDeleted: 0, dryRun };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgoDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const orFilter = `report_generated_at.lt.${sevenDaysAgo},and(report_generated_at.is.null,business_date.lt.${fourteenDaysAgoDate})`;

  // corrected는 raw_conversation_id로 raw를 참조하므로 먼저 삭제한다(FK 순서).
  if (dryRun) {
    const { count: correctedCount, error: correctedErr } = await db
      .from("corrected_daily_conversations")
      .select("id", { count: "exact", head: true })
      .or(orFilter);
    if (correctedErr) throw new Error(`deleteExpiredConversationPipelineData: corrected 조회 실패 — ${correctedErr.message}`);
    result.correctedDeleted = correctedCount ?? 0;

    const { count: rawCount, error: rawErr } = await db
      .from("raw_daily_conversations")
      .select("id", { count: "exact", head: true })
      .or(orFilter);
    if (rawErr) throw new Error(`deleteExpiredConversationPipelineData: raw 조회 실패 — ${rawErr.message}`);
    result.rawDeleted = rawCount ?? 0;
    return result;
  }

  const { data: correctedDeleted, error: correctedDelErr } = await db
    .from("corrected_daily_conversations")
    .delete()
    .or(orFilter)
    .select("id");
  if (correctedDelErr) throw new Error(`deleteExpiredConversationPipelineData: corrected 삭제 실패 — ${correctedDelErr.message}`);
  result.correctedDeleted = correctedDeleted?.length ?? 0;

  const { data: rawDeleted, error: rawDelErr } = await db
    .from("raw_daily_conversations")
    .delete()
    .or(orFilter)
    .select("id");
  if (rawDelErr) throw new Error(`deleteExpiredConversationPipelineData: raw 삭제 실패 — ${rawDelErr.message}`);
  result.rawDeleted = rawDeleted?.length ?? 0;

  return result;
}

export interface MemoryEvidencePurgeResult {
  purgedCount: number;
  dryRun: boolean;
}

/**
 * 023 설계 문서 §2-4/§3 Step 6/§8-2 — memory_evidence의 원문(source_text/
 * source_message_id/source_conversation_id)은 생성 후 최대 7일만 임시 보존하고
 * 반드시 NULL로 마스킹한다(20자 축약 등으로 대체 보존하는 것도 금지 — 대표님 명시
 * 지시). evidence_summary/memory_facts는 이 함수가 절대 건드리지 않는다 — 영구
 * 보존 대상이며 원문이 아니다.
 */
export async function purgeExpiredMemoryEvidence(
  db: SupabaseClient,
  dryRun: boolean,
): Promise<MemoryEvidencePurgeResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // codex 지적: source_text만 NULL인지 확인하면, source_text는 이미 NULL인데
  // source_message_id/source_conversation_id만 남아있는 행은 영원히 파기 대상에서
  // 빠졌다 — 셋 중 하나라도 남아있으면 파기 대상으로 잡는다.
  const hasResidualSourceFilter = "source_text.not.is.null,source_message_id.not.is.null,source_conversation_id.not.is.null";

  if (dryRun) {
    const { count, error } = await db
      .from("memory_evidence")
      .select("id", { count: "exact", head: true })
      .is("source_deleted_at", null)
      .or(hasResidualSourceFilter)
      .lt("created_at", sevenDaysAgo);
    if (error) throw new Error(`purgeExpiredMemoryEvidence: 대상 조회 실패 — ${error.message}`);
    return { purgedCount: count ?? 0, dryRun };
  }

  const now = new Date().toISOString();
  const { data: purged, error } = await db
    .from("memory_evidence")
    .update({ source_text: null, source_message_id: null, source_conversation_id: null, source_deleted_at: now })
    .is("source_deleted_at", null)
    .or(hasResidualSourceFilter)
    .lt("created_at", sevenDaysAgo)
    .select("id");
  if (error) throw new Error(`purgeExpiredMemoryEvidence: 파기 실패 — ${error.message}`);

  return { purgedCount: purged?.length ?? 0, dryRun };
}
