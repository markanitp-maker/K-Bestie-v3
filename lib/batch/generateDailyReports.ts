import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { extractJSON } from "@/app/api/_lib/utils";
import { reportSectionValueForStorage } from "@/lib/reports/reportSectionAvailability";
import { validateReportLanguageIntegrity } from "@/lib/reports/reportLanguageIntegrity";
import {
  buildLanguageRetryInstruction,
  buildLanguageFailureMessage,
} from "@/lib/reports/reportLanguageRetry";

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
  "teacher_adults": "...",
  "recurring_stories": "..."
}

각 상세 항목에 실제 대화 근거가 없으면 placeholder 안내 문구를 만들지 말고 빈 문자열("")로 응답하세요.
`;

function sanitizeReportJson(obj: any) {
  return obj;
}

export type DailyReportResult = { created: string[]; skipped: string[]; errors: any[] };

export async function generateDailyReports(targetDate: string, onlyChildId?: string): Promise<DailyReportResult> {
  const db = createServiceClient();
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  let query = db
    .from("corrected_daily_conversations")
    .select("id, child_id, raw_conversation_id, corrected_data")
    .eq("business_date", targetDate)
    .eq("status", "corrected")
    .is("report_generated_at", null);
    
  if (onlyChildId) query = query.eq("child_id", onlyChildId);

  const { data: correctedRows, error: corrErr } = await query;
  if (corrErr) throw new Error(`generateDailyReports: 보정 데이터 조회 실패: ${corrErr.message}`);
  if (!correctedRows?.length) return result;

  const candidateChildIds = Array.from(new Set(correctedRows.map((r: any) => r.child_id)));

  const { data: consentRows, error: consentErr } = await db
    .from("child_profiles")
    .select("id, guardian_consent_withdrawn_at")
    .in("id", candidateChildIds);
  if (consentErr) throw new Error(`generateDailyReports: 동의 상태 조회 실패: ${consentErr.message}`);

  const withdrawnIds = new Set(
    (consentRows || [])
      .filter((c: any) => c.guardian_consent_withdrawn_at !== null)
      .map((c: any) => c.id)
  );

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  for (const row of correctedRows) {
    if (withdrawnIds.has(row.child_id)) continue;
    try {
      const data = row.corrected_data || {};
      const allMessages = [
        ...(data.mission_1 || []),
        ...(data.free_chat_1 || []),
        ...(data.mission_2 || []),
        ...(data.free_chat_2 || [])
      ];

      if (!allMessages.some(m => m.role === 'child')) {
        result.skipped.push(row.child_id);
        continue;
      }

      const transcriptText = allMessages
        .map((m: any) => `${m.role === 'child' ? '아이' : '케이'}: ${m.content}`)
        .join("\n");

      const basePrompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);
      const systemInstruction =
        "모든 문장은 자연스러운 한국어로만 작성하고 일본어 문자(히라가나·가타카나)를 절대 사용하지 않는다. 한자어는 한글로 풀어 쓰며, 영어 고유명사(Roblox, YouTube, MBTI 등)는 그대로 두어도 된다.";

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
            maxOutputTokens: reportModel.maxOutputTokens ?? 8192,
            thinkingConfig: { thinkingLevel: 'MEDIUM' as any },
          },
        });

        let rawParsed: any;
        try {
          rawParsed = sanitizeReportJson(extractJSON(genResult.text ?? "{}"));
        } catch {
          throw new Error(`JSON 파싱 실패: ${genResult.text?.slice(0, 100)}`);
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
          `[generateDailyReports] 일일 리포트 언어 검증 위반 (${validation.violations.length}건, 시도 ${attempt}/${MAX_ATTEMPTS}):`,
          lastViolations,
        );

        if (attempt === MAX_ATTEMPTS) {
          throw new Error(buildLanguageFailureMessage(lastViolations));
        }
      }

      if (!report) {
        throw new Error(buildLanguageFailureMessage(lastViolations));
      }

      report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));
      const emotionLevel = report.emotion_level === "warning" || report.emotion_level === "danger" ? report.emotion_level : "safe";

      const reportFields = {
        child_id: row.child_id,
        business_date: targetDate,
        summary_line: report.summary_line ?? "",
        mood_score: report.mood_score,
        emotion_tags: report.emotion_tags ?? [],
        parent_guide: report.parent_guide ?? "",
        emotion_level: emotionLevel,
        school_academy_life: reportSectionValueForStorage(report.school_academy_life),
        peer_friendship: reportSectionValueForStorage(report.peer_friendship),
        emotion_hint: reportSectionValueForStorage(report.emotion_hint),
        interests_preferences: reportSectionValueForStorage(report.interests_preferences),
        study_concerns: reportSectionValueForStorage(report.study_concerns),
        digital_content_interests: reportSectionValueForStorage(report.digital_content_interests),
        future_dreams: reportSectionValueForStorage(report.future_dreams),
        teacher_adults: reportSectionValueForStorage(report.teacher_adults),
        recurring_stories: reportSectionValueForStorage(report.recurring_stories),
      };

      const { data: existingRows } = await db
        .from("daily_reports")
        .select("id")
        .eq("child_id", row.child_id)
        .eq("business_date", targetDate)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1);

      const existing = existingRows?.[0] ?? null;

      let reportId: string;
      if (existing) {
        await db.from("daily_reports").update(reportFields).eq("id", existing.id);
        reportId = existing.id;
      } else {
        const { data: inserted } = await db.from("daily_reports").insert(reportFields).select("id").single();
        if (!inserted) throw new Error("Insert failed");
        reportId = inserted.id;
      }
      result.created.push(reportId);

      const now = new Date().toISOString();
      await db.from("raw_daily_conversations").update({ report_generated_at: now }).eq("id", row.raw_conversation_id);
      await db.from("corrected_daily_conversations").update({ report_generated_at: now }).eq("id", row.id);

    } catch (e) {
      result.errors.push({ sessionId: row.child_id, error: String(e) });
    }
  }

  return result;
}
