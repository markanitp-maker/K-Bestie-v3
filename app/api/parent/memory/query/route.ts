import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { searchMemoryFacts } from "@/lib/memory/vectorRetrieval";
import { createGenAIClient, LEAN_E_MODEL_ID } from "@/app/api/_lib/ai";

export const runtime = "nodejs";

// GET /api/parent/memory/query?childId=&question=
// 023 LLM Wiki + RAG Memory — Step 7 Parent Agent Backend(설계 문서 §10).
// 부모 질문 → memory_facts 벡터 검색 → Gemini 답변 + 근거 요약 + 신뢰도.
//
// 절대 규칙(설계 문서 §8-3, 기존 "부모 원문 열람 불가" 규칙과 정합): 응답에는 fact의
// 요약(content)/신뢰도만 포함하고, memory_evidence.source_text(대화 원문)는 절대
// 포함하지 않는다 — 이 API가 조회하는 memory_facts 테이블 자체에도 원문이 없다
// (원문은 memory_evidence에만, 그것도 7일 임시 보존 — §2-4).
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

  const facts = await searchMemoryFacts(service, childId, question.trim(), 10);

  if (!facts || facts.length === 0) {
    return NextResponse.json({
      answer: "아직 그 부분에 대해 알고 있는 기억이 없어요.",
      evidenceFacts: [],
      confidence: 0,
    });
  }

  const memoryText = facts
    .map((f) => `- [${f.factType}] ${f.content}(신뢰도 ${f.confidence.toFixed(2)}, ${f.sourceCount}회 확인)`)
    .join("\n");

  const systemInstruction = `너는 부모에게 아이에 대한 정보를 요약해서 알려주는 역할이다.
아래 '기억 목록'만 근거로 부모의 질문에 답해라.

[기억 목록]
${memoryText}

규칙(반드시 지켜라):
1. 기억 목록에 없는 내용은 절대 지어내지 마라(할루시네이션 금지).
2. 대화 원문을 그대로 인용하지 말고, 정리된 사실로만 답해라.
3. 답변은 한국어 2~3문장, 부모에게 안내하듯 정중하고 따뜻한 톤으로.
4. 기억 목록이 질문과 관련이 부족하면 "확실하게 아는 내용이 부족하다"고 정직하게 답해라.`;

  try {
    const ai = createGenAIClient({ provider: "vertex" });
    const response = await ai.models.generateContent({
      model: LEAN_E_MODEL_ID,
      contents: question.trim(),
      config: { systemInstruction, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2, maxOutputTokens: 200 },
    });
    const answer = response.text?.trim() || "지금은 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";

    const avgConfidence = facts.reduce((s, f) => s + f.confidence, 0) / facts.length;

    return NextResponse.json({
      answer,
      evidenceFacts: facts.map((f) => ({
        factType: f.factType,
        content: f.content,
        confidence: f.confidence,
        sourceDate: f.sourceDate,
        sourceCount: f.sourceCount,
      })),
      confidence: Math.round(avgConfidence * 100) / 100,
    });
  } catch (err) {
    console.error("[parent/memory/query] LLM 답변 생성 실패:", err);
    return NextResponse.json({ error: "답변 생성 중 오류가 발생했어요." }, { status: 500 });
  }
}
