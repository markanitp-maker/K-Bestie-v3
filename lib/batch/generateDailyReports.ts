import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { REPORT_PROMPT_TEMPLATE } from "@/app/api/_lib/prompts";
import { sanitizeReportJson } from "@/app/api/_lib/reportSafetyGuard";

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

export interface DailyReportResult {
  created: string[];  // 생성된 daily_report id 목록
  skipped: string[];  // 대화 없어서 건너뜀 (session_id)
  errors: { sessionId: string; error: string }[];
}

/**
 * Step 2: 일일 리포트 생성
 *
 * targetDate에 종료된(ended_at::date = targetDate) 모든 세션에 대해
 * daily_reports가 없으면 Gemini로 생성해 삽입한다.
 *
 * @param targetDate  "YYYY-MM-DD"
 */
export async function generateDailyReports(targetDate: string): Promise<DailyReportResult> {
  const db = createServiceClient();
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  // targetDate에 종료된 세션 중 리포트 없는 것 — 동의 철회된 아이는 신규 리포트 생성 대상에서 제외
  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, child_id, child_profiles!inner(guardian_consent_withdrawn_at)")
    .gte("ended_at", `${targetDate}T00:00:00+09:00`)
    .lte("ended_at", `${targetDate}T23:59:59+09:00`)
    .is("child_profiles.guardian_consent_withdrawn_at", null)
    .not("id", "in", `(SELECT session_id FROM daily_reports)`);

  if (fetchErr) {
    throw new Error(`generateDailyReports: 세션 조회 실패 — ${fetchErr.message}`);
  }
  if (!sessions?.length) return result;

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  for (const session of sessions) {
    try {
      // requests/018 — chat_messages 원문 대신 보정 파이프라인 결과를 사용한다.
      // 미션 완료 여부만으로 세션 전체를 버리지 않는다: report_eligible=true인 아이 발화가
      // 하나라도 있으면 정상 리포트를 생성한다(Edge Function _shared/batch.ts와 동일 로직 — 동기화 유지).
      const { data: conversations, error: convErr } = await db
        .from("raw_daily_conversations")
        .select(
          `
          id,
          speaker,
          raw_text,
          turn_order,
          corrected_daily_conversations (
            corrected_text,
            report_eligible
          )
        `
        )
        .eq("session_id", session.id)
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
        result.skipped.push(session.id);
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
      const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

      const genResult = await ai.models.generateContent({
        model: reportModel.modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: reportModel.maxOutputTokens,
        },
      });

      let report: {
        summary_line: string;
        mood_score: number;
        emotion_tags: string[];
        parent_guide: string;
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
        report = sanitizeReportJson(extractJSON(genResult.text ?? "{}"));
      } catch {
        throw new Error(`JSON 파싱 실패: ${genResult.text?.slice(0, 100)}`);
      }

      report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));

      const emotionLevel =
        report.emotion_level === "warning" || report.emotion_level === "danger"
          ? report.emotion_level
          : "safe";

      const { data: inserted, error: insertErr } = await db
        .from("daily_reports")
        .insert({
          session_id: session.id,
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
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);
      result.created.push(inserted.id);

      // 리포트가 실제로 성공적으로 만들어진 뒤에만 소비 시각을 찍는다(LLM/삽입 실패 시
      // report_generated_at이 찍히면 리포트 없이 원본만 7일 뒤 삭제되는 사고로 이어진다).
      if (rawIds.length > 0) {
        const now = new Date().toISOString();
        await db.from("raw_daily_conversations").update({ report_generated_at: now }).in("id", rawIds);
        await db.from("corrected_daily_conversations").update({ report_generated_at: now }).in("raw_conversation_id", rawIds);
      }
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }

  return result;
}
