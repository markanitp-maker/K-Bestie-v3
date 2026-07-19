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
      // 미션 완료 여부 확인 (게이지 100% = COMPLETED)
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

      // 메시지 가져오기
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
        .map((m) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");
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
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }

  return result;
}
