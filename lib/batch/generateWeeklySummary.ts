import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient, type GroupModelConfig } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { WEEKLY_REPORT_PROMPT_TEMPLATE } from "@/app/api/_lib/prompts";
import { sanitizeReportJson } from "@/app/api/_lib/reportSafetyGuard";
import { extractJSON } from "@/app/api/_lib/utils";
import { ThinkingLevel, type GoogleGenAI } from "@google/genai";
import {
  reportSectionValueForStorage,
  sanitizeReportSectionRecord,
} from "@/lib/reports/reportSectionAvailability";
import { getCompletedWeekBoundsForRunDateKst } from "@/lib/utils/weeklyDates";

export interface WeeklySummaryResult {
  created: string[];  // 생성된 weekly_summary id 목록
  skipped: string[];  // 데이터 없어서 건너뜀 (child_id)
  existing: string[]; // 동일 child_id + week_start + week_end가 이미 존재함
  errors: { childId: string; error: string }[];
}

interface WeeklyReportJson {
  summary_text: string;
  detail_text: string;
  detail_dashboard_cards?: Record<string, string>;
  mood_average: number;
  highlights: string[];
  parent_guide: string;
  weekend_activity_recommendation?: string;
}

// 원문 재분석 시 입력 토큰 상한 근사치(문자 수 기준) — 이보다 길면 청크로 나눠 맵-리듀스한다.
// 한글 대화 원문 기준 대략적 근사치이며, 정밀한 토큰 카운트가 아닌 안전 마진용 상한이다.
const MAX_TRANSCRIPT_CHARS = 60_000;
const CHUNK_CHARS = 20_000;

/** 문자열을 CHUNK_CHARS 단위로 줄바꿈 경계에서 최대한 자연스럽게 분할. */
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

/** 청크 하나를 압축 요약(맵 단계) — 최종 리듀스 프롬프트에 들어갈 원본을 줄이기 위함. */
async function mapChunkSummary(ai: GoogleGenAI, modelId: string, chunk: string): Promise<string> {
  const result = await ai.models.generateContent({
    model: modelId,
    contents: `다음은 아이와 AI 친구 케이의 대화 원문 일부입니다. 아이의 상태·관심사·감정·주말 희망사항과 관련된 내용을 놓치지 않고 5~8문장으로 압축 요약해줘(다른 설명 없이 요약문만):\n\n${chunk}`,
    config: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } },
  });
  return (result.text ?? "").trim();
}

/** 원문(또는 청크 요약 합본)을 최종 주간 리포트 JSON으로 리듀스. */
async function reduceToWeeklyReport(
  ai: GoogleGenAI,
  modelId: string,
  weekRange: string,
  transcriptText: string,
): Promise<WeeklyReportJson> {
  const prompt = WEEKLY_REPORT_PROMPT_TEMPLATE
    .replace("{{WEEK_RANGE}}", weekRange)
    .replace("{{TRANSCRIPT}}", transcriptText);

  const result = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      systemInstruction: "반드시 지정된 스키마의 JSON 객체로만, 한국어로 응답한다. JSON 외 텍스트 금지.",
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    },
  });

  const text = (result.text ?? "").trim();
  try {
    return sanitizeReportJson(extractJSON(text));
  } catch {
    throw new Error(`주간 리포트 JSON 파싱 실패: ${text.slice(0, 100)}`);
  }
}

/** 원문 재분석 — 토큰 상한 초과 시 청크 맵-리듀스로 압축한 뒤 리듀스한다. */
async function analyzeWeekTranscript(
  ai: GoogleGenAI,
  modelId: string,
  weekRange: string,
  transcriptText: string,
): Promise<WeeklyReportJson> {
  if (transcriptText.length <= MAX_TRANSCRIPT_CHARS) {
    return reduceToWeeklyReport(ai, modelId, weekRange, transcriptText);
  }

  console.warn(`[generateWeeklySummary] 원문(${transcriptText.length}자)이 상한(${MAX_TRANSCRIPT_CHARS}자)을 초과 — 청크 맵-리듀스로 압축`);
  const chunks = chunkText(transcriptText, CHUNK_CHARS);
  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    chunkSummaries.push(await mapChunkSummary(ai, modelId, chunks[i]));
  }
  const reducedTranscript = chunkSummaries.map((s, i) => `[구간 ${i + 1} 요약]\n${s}`).join("\n\n");
  return reduceToWeeklyReport(ai, modelId, weekRange, reducedTranscript);
}

/** 최후 폴백 — 원문 재분석이 청크 맵-리듀스 후에도 실패하면 기존 daily_reports 요약
 *  이어붙이기 방식으로라도 주간 리포트를 생성한다(완전 실패보다 낫다는 판단, 로그로 명시). */
async function fallbackFromDailyReports(
  db: ReturnType<typeof createServiceClient>,
  ai: GoogleGenAI,
  modelId: string,
  childId: string,
  weekStart: string,
  weekEnd: string,
  weekRange: string,
): Promise<WeeklyReportJson> {
  console.error(`[generateWeeklySummary] 원문 재분석 실패 — child ${childId}는 daily_reports 요약 이어붙이기로 폴백`);
  // requests/017-report-check.md 이후 daily_reports는 child_id+business_date로 직접
  // 조회한다(session_id 경유 join은 신규 생성분에서 NULL이라 항상 빈 결과가 됨).
  const { data: reports } = await db
    .from("daily_reports")
    .select("summary_line, mood_score, emotion_tags")
    .eq("child_id", childId)
    .gte("business_date", weekStart)
    .lte("business_date", weekEnd)
    .is("deleted_at", null);

  const dailySummaries = (reports ?? [])
    .map((r: { summary_line: string; mood_score: number; emotion_tags: string[] }, i: number) =>
      `Day ${i + 1}: ${r.summary_line} (기분 ${r.mood_score}/10, 태그: ${r.emotion_tags.join(", ")})`)
    .join("\n");

  return reduceToWeeklyReport(ai, modelId, weekRange, dailySummaries || "이번 주 기록된 대화가 없습니다.");
}

/**
 * Step 3: 주간 리포트 생성 — 그 주 대화 원문 전체를 재분석해 요약+상세를 함께 생성한다
 * (daily_reports 이어붙이기 금지). 토큰 상한 초과 시 청크 맵-리듀스, 그래도 실패하면
 * daily_reports 요약 이어붙이기로 자동 강등(로그 남김).
 *
 * targetDate가 토요일이거나 forceWeekly=true 일 때 직전 완료 주간을 생성.
 *
 * @param targetDate  "YYYY-MM-DD"
 * @param forceWeekly 요일 무관 강제 실행
 */
export async function generateWeeklySummary(
  targetDate: string,
  forceWeekly = false,
): Promise<WeeklySummaryResult> {
  const result: WeeklySummaryResult = { created: [], skipped: [], existing: [], errors: [] };

  // 토요일(6)이 아니면 skip (forceWeekly로 override 가능) — 매주 토요일 06:00 KST 실행
  const dow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
  if (!forceWeekly && dow !== 6) return result;

  const { weekStart, weekEnd } = getCompletedWeekBoundsForRunDateKst(targetDate);
  // weekEnd 당일 23:59:59.999를 넘는 마이크로초 정밀도 세션까지 포함하기 위해 반개구간으로 조회.
  const weekEndExclusive = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const db = createServiceClient();

  // 해당 주에 세션이 있었던 아이 목록(daily_reports가 있는 child만 — 대화가 없으면 스킵)
  // 동의 철회된 아이는 신규 주간 리포트 생성 대상에서 제외
  const { data: sessionsWithChild, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, child_id, child_profiles!inner(guardian_consent_withdrawn_at)")
    .gte("started_at", `${weekStart}T00:00:00+09:00`)
    .lt("started_at", `${weekEndExclusive}T00:00:00+09:00`)
    .is("child_profiles.guardian_consent_withdrawn_at", null);

  if (fetchErr) {
    throw new Error(`generateWeeklySummary: 세션 조회 실패 — ${fetchErr.message}`);
  }
  if (!sessionsWithChild?.length) return result;

  const sessionsByChild = new Map<string, string[]>();
  for (const s of sessionsWithChild as { id: string; child_id: string }[]) {
    if (!sessionsByChild.has(s.child_id)) sessionsByChild.set(s.child_id, []);
    sessionsByChild.get(s.child_id)!.push(s.id);
  }

  const childIds = [...sessionsByChild.keys()];
  // DB 제약은 UNIQUE(child_id, week_start) 하나뿐이므로 그 키만으로 조회한다(week_end까지 걸면
  // 제약보다 좁아져 INSERT가 23505로 실패할 수 있음). deleted_at 필터도 걸지 않는다 — soft-delete된
  // 행도 이 제약에 걸리므로, 필터를 걸면 오히려 재생성 시도 후 INSERT 충돌로 이어진다.
  const { data: existingRows, error: existingErr } = await db
    .from("weekly_summaries")
    .select("child_id")
    .in("child_id", childIds)
    .eq("week_start", weekStart);
  if (existingErr) throw new Error(`generateWeeklySummary: 기존 리포트 조회 실패 — ${existingErr.message}`);
  const existingChildIds = new Set((existingRows ?? []).map((row: { child_id: string }) => row.child_id));

  const reportModel: GroupModelConfig = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);
  const weekRange = `${weekStart} ~ ${weekEnd}`;

  for (const [childId, sessionIds] of sessionsByChild) {
    try {
      if (existingChildIds.has(childId)) {
        result.existing.push(childId);
        continue;
      }
      if (!sessionIds.length) {
        result.skipped.push(childId);
        continue;
      }

      const { data: messages, error: msgErr } = await db
        .from("chat_messages")
        .select("role, content, created_at")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(childId);
        continue;
      }

      const transcriptText = messages
        .map((m: { role: string; content: string }) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");

      let report: WeeklyReportJson;
      try {
        report = await analyzeWeekTranscript(ai, getLlmModel("weeklyReport"), weekRange, transcriptText);
      } catch (analyzeErr) {
        console.error(`[generateWeeklySummary] 청크 맵-리듀스도 실패:`, (analyzeErr as Error).message);
        report = await fallbackFromDailyReports(db, ai, getLlmModel("weeklyReport"), childId, weekStart, weekEnd, weekRange);
      }

      const moodAverage = Math.max(1, Math.min(10, Math.round((report.mood_average ?? 5) * 10) / 10));

      const { data: inserted, error: insertErr } = await db
        .from("weekly_summaries")
        .insert(
          {
            child_id: childId,
            week_start: weekStart,
            week_end: weekEnd,
            summary_text: report.summary_text ?? "",
            detail_text: reportSectionValueForStorage(report.detail_text),
            detail_dashboard_cards: sanitizeReportSectionRecord(report.detail_dashboard_cards),
            mood_average: moodAverage,
            highlights: report.highlights ?? [],
            parent_guide: report.parent_guide ?? "",
            weekend_activity_recommendation: report.weekend_activity_recommendation ?? "",
          },
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
