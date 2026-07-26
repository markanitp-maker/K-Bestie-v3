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
  created: string[];  // 생성/갱신된 daily_report id 목록
  skipped: string[];  // 대화 없어서 건너뜀 (child_id)
  errors: { sessionId: string; error: string }[];  // sessionId 필드는 호환용 이름 유지, 값은 childId
}

/**
 * Step 2: 일일 리포트 생성
 *
 * requests/017-report-check.md — child_id+business_date를 리포트 식별자로 통합.
 * ⚠️ 이 함수는 supabase/functions/_shared/batch.ts의 동명 함수(Deno, 실제 운영 크론
 * 경로)와 로직을 동기화해서 유지해야 한다 - 이 파일은 관리자 수동 실행/로컬 테스트
 * 전용이다.
 *
 * @param targetDate  "YYYY-MM-DD"
 * @param onlyChildId 지정하면 그 아이만 처리한다(관리자 "특정 아이" 실행용). 생략하면
 *                    그날 원본 대화가 있는 모든 아이를 대상으로 한다.
 */
export async function generateDailyReports(targetDate: string, onlyChildId?: string): Promise<DailyReportResult> {
  const db = createServiceClient();
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  // 그날 원본 대화가 하나라도 수집된 아이 목록(미션/자유대화 통합, 세션 단위 아님).
  let rawQuery = db
    .from("raw_daily_conversations")
    .select("child_id")
    .eq("business_date", targetDate);
  if (onlyChildId) rawQuery = rawQuery.eq("child_id", onlyChildId);

  const { data: rawRows, error: rawListErr } = await rawQuery;
  if (rawListErr) throw new Error(`generateDailyReports: 대상 아이 조회 실패 — ${rawListErr.message}`);
  if (!rawRows?.length) return result;

  const candidateChildIds = Array.from(new Set(rawRows.map((r: { child_id: string }) => r.child_id)));

  // 동의 철회된 아이는 신규 리포트 생성 대상에서 제외.
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

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  for (const childId of childIds) {
    try {
      // requests/018 — chat_messages 원문 대신 보정 파이프라인 결과를 사용한다.
      // 미션 완료 여부만으로 전체를 버리지 않는다: report_eligible=true인 아이 발화가
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

      const reportFields = {
        child_id: childId,
        business_date: targetDate,
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
      };

      // 같은 child_id+business_date 리포트가 이미 있으면(재실행/관리자 수동 재생성)
      // 새로 INSERT하지 않고 갱신한다 — 하드 UNIQUE 제약이 없고, 이 마이그레이션 이전
      // 세션당 리포트를 만들던 구조 때문에 같은 child_id+business_date에 이미 여러
      // 행이 남아있는 경우가 있어(.maybeSingle()이면 에러) 가장 최근 행만 골라 갱신한다.
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
