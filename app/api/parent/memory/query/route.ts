import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { searchMemoryFacts } from "@/lib/memory/vectorRetrieval";
import { createGenAIClient, LEAN_E_MODEL_ID } from "@/app/api/_lib/ai";
import {
  detectDateRangeQuery,
  buildDailyReportSummaryText,
  buildCorrectedConversationInternalText,
} from "@/lib/memory/parentDateQuery";

export const runtime = "nodejs";

// GET /api/parent/memory/query?childId=&question=
// 023 LLM Wiki + RAG Memory — Step 7 Parent Agent Backend(설계 문서 §10).
// 부모 질문 → memory_facts 벡터 검색 → Gemini 답변 + 근거 요약 + 신뢰도.
//
// P0 긴급수정(안서현 부모-케이 장애) — "오늘/어제/그제/이번 주/특정 날짜"처럼 시간
// 범위가 있는 질문은 의미 기반 벡터 검색만으로는 신뢰도 있게 답할 수 없다(유사도
// 검색은 "그 날짜"라는 개념이 없다). 날짜 의도를 감지하면 KST business_date로 해석해
// daily_reports(이미 부모에게 공개된 요약)를 우선 조회하고, 그 날짜에 리포트가 아직
// 없으면 corrected_daily_conversations_v3에서 안전한 요약 소스를 만들어 LLM 내부
// 컨텍스트로만 쓴다(응답에 원문 그대로 포함 금지). 그 다음에만 V3 Vector Retrieval을
// 보조 컨텍스트로 추가한다 — Legacy child_memory 폴백과 중복 주입되지 않는다
// (searchMemoryFacts 자체가 V3 결과 있으면 Legacy를 호출하지 않는 설계, 이 함수는
// 그 결과를 그대로 재사용).
//
// 절대 규칙(설계 문서 §8-3, 기존 "부모 원문 열람 불가" 규칙과 정합): 응답에는 fact의
// 요약(content)/신뢰도만 포함하고, memory_evidence.source_text(대화 원문)나
// corrected_daily_conversations_v3의 대화 내용은 절대 그대로 포함하지 않는다 —
// LLM이 그 내용을 근거로 생성한 답변 문장만 반환한다.
export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  const question = req.nextUrl.searchParams.get("question");
  if (!childId || !question?.trim()) {
    return NextResponse.json({ error: "childId, question required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(authClient, user.id, childId);
  // codex 지적: allowed만 확인하면 자기 자신에게 접근 권한이 있는 "child" 역할
  // 세션도 통과한다 — 이 API는 부모 전용(설계 문서 §10 "Parent Agent")이라
  // role까지 명시적으로 확인한다.
  if (!authCheck.allowed || authCheck.role !== "parent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // memory_facts 등은 서비스 롤 전용 RLS(설계 문서 §2-7) — 인증된 부모 본인 확인
  // (requireChildAccess) 후에만 서비스 클라이언트로 조회한다.
  const service = createServiceClient();

  const trimmedQuestion = question.trim();
  const dateMatch = detectDateRangeQuery(trimmedQuestion);

  let dateContextText = "";
  let dateContextLabel: string | null = null;
  let dateContextFound = false;

  if (dateMatch) {
    dateContextLabel = dateMatch.label;
    const { data: reports } = await service
      .from("daily_reports")
      .select("business_date, school_academy_life, peer_friendship, emotion_hint, interests_preferences, study_concerns, digital_content_interests, future_dreams, recurring_stories")
      .eq("child_id", childId)
      .in("business_date", dateMatch.businessDates)
      .is("deleted_at", null)
      .order("business_date", { ascending: true });

    const reportTexts = (reports ?? [])
      .map((r) => {
        const summary = buildDailyReportSummaryText(r as Record<string, unknown>);
        return summary ? `[${r.business_date} 일일 리포트]\n${summary}` : "";
      })
      .filter(Boolean);

    if (reportTexts.length > 0) {
      dateContextText = reportTexts.join("\n\n");
      dateContextFound = true;
    } else {
      // 그 날짜에 daily_report가 아직 없으면 corrected_daily_conversation_messages_v3
      // (generateMemoryFacts가 조회하는 것과 동일한 정규화 테이블)에서 안전한 요약
      // 소스를 만든다(내부 컨텍스트 전용, 응답에 직접 포함하지 않음).
      const { data: correctedMessages } = await service
        .from("corrected_daily_conversation_messages_v3")
        .select("business_date, role, content, display_sequence")
        .eq("child_id", childId)
        .in("business_date", dateMatch.businessDates)
        .order("business_date", { ascending: true })
        .order("display_sequence", { ascending: true });

      const byDate = new Map<string, Array<{ role: unknown; content: unknown }>>();
      for (const m of correctedMessages ?? []) {
        const list = byDate.get(m.business_date) ?? [];
        list.push({ role: m.role, content: m.content });
        byDate.set(m.business_date, list);
      }

      const correctedTexts = Array.from(byDate.entries())
        .map(([businessDate, msgs]) => {
          const text = buildCorrectedConversationInternalText(msgs);
          return text ? `[${businessDate} 대화 기록]\n${text}` : "";
        })
        .filter(Boolean);

      if (correctedTexts.length > 0) {
        dateContextText = correctedTexts.join("\n\n");
        dateContextFound = true;
      }
    }
  }

  // V3 Vector Retrieval — 날짜 컨텍스트가 있어도 보조 컨텍스트로 함께 사용한다
  // (Legacy child_memory와는 searchMemoryFacts 내부 설계상 중복 주입되지 않음).
  const facts = await searchMemoryFacts(service, childId, trimmedQuestion, 10);

  if (!dateContextFound && (!facts || facts.length === 0)) {
    return NextResponse.json({
      answer: dateContextLabel
        ? `${dateContextLabel}에 대해서는 아직 확인된 기록이 없어요.`
        : "아직 그 부분에 대해 알고 있는 기억이 없어요.",
      evidenceFacts: [],
      confidence: 0,
      dateContext: dateContextLabel ? { label: dateContextLabel, found: false } : null,
    });
  }

  const memoryFactsText = facts && facts.length > 0
    ? facts.map((f) => `- [${f.factType}] ${f.content}(신뢰도 ${f.confidence.toFixed(2)}, ${f.sourceCount}회 확인)`).join("\n")
    : "(관련된 일반 기억 없음)";

  const systemInstruction = `너는 부모에게 아이에 대한 정보를 요약해서 알려주는 역할이다.
아래 근거만 사용해서 부모의 질문에 답해라. 다른 내용은 절대 지어내지 마라(할루시네이션 금지).

${dateContextText ? `[${dateContextLabel} 관련 기록]\n${dateContextText}\n` : ""}
[그 외 참고할만한 기억]
${memoryFactsText}

규칙(반드시 지켜라):
1. 근거에 없는 내용은 절대 지어내지 마라.
2. 위 기록의 문장을 그대로 인용하지 말고, 정리된 사실로만 답해라(원문 노출 금지).
3. 답변은 한국어 2~3문장, 부모에게 안내하듯 정중하고 따뜻한 톤으로.
4. 질문에 날짜가 있는데 위에 "${dateContextLabel ?? ""}" 관련 기록이 없으면, 정직하게 그 날짜엔 확인된 내용이 부족하다고 답해라.
5. 근거가 질문과 관련이 부족하면 "확실하게 아는 내용이 부족하다"고 정직하게 답해라.`;

  try {
    const ai = createGenAIClient({ provider: "vertex" });
    const response = await ai.models.generateContent({
      model: LEAN_E_MODEL_ID,
      contents: trimmedQuestion,
      config: { systemInstruction, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2, maxOutputTokens: 200 },
    });
    const answer = response.text?.trim() || "지금은 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";

    const avgConfidence = facts && facts.length > 0
      ? facts.reduce((s, f) => s + f.confidence, 0) / facts.length
      : dateContextFound ? 0.8 : 0;

    return NextResponse.json({
      answer,
      evidenceFacts: (facts ?? []).map((f) => ({
        factType: f.factType,
        content: f.content,
        confidence: f.confidence,
        sourceDate: f.sourceDate,
        sourceCount: f.sourceCount,
      })),
      confidence: Math.round(avgConfidence * 100) / 100,
      dateContext: dateContextLabel ? { label: dateContextLabel, found: dateContextFound } : null,
    });
  } catch (err) {
    console.error("[parent/memory/query] LLM 답변 생성 실패:", err);
    return NextResponse.json({ error: "답변 생성 중 오류가 발생했어요." }, { status: 500 });
  }
}
