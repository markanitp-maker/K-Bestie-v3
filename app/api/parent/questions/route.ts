import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { filterParentQuestion } from "@/lib/plan/parentQuestionFilter";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { getLlmModel } from "@/lib/llm/modelRouter";
import { checkAndDeductQuota } from "@/lib/plan/parentQuestionQuota";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";
import { checkApprovalForChild } from "@/lib/plan/approvalGuard";
import { logBehaviorEvent } from "@/lib/analytics/logBehaviorEvent";

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
    console.error("JSON 추출 실패. 원문(300자):", text.substring(0, 300));
    throw new Error("JSON 파싱 오류");
  }
}

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const approvalBlocked = await checkApprovalForChild(childId);
  if (approvalBlocked) return approvalBlocked;
  const { data: questions, error } = await supabase
    .from("parent_questions")
    .select("id, question_text, status, created_at, delivered_count")
    .eq("child_id", childId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const { data: member } = await supabase.from('family_members').select('family_id').eq('user_id', user.id).maybeSingle();
    if (member?.family_id) {
      await logBehaviorEvent({
        eventName: "parent_conversation_topic_view",
        actorType: "parent",
        actorId: user.id,
        familyId: member.family_id,
        childId: childId,
        feature: "conversation_topic",
        route: "/parent/questions"
      });
    }
  } catch (e) {
    // 의도적 무시
  }

  return NextResponse.json({ questions: questions ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId: string; questionText: string; override?: boolean; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, questionText, override, idempotencyKey } = body;
  if (!childId || !questionText?.trim()) {
    return NextResponse.json({ error: "childId and questionText required" }, { status: 400 });
  }

  const reqIdemKey = idempotencyKey || crypto.randomUUID();

  const authCheck = await requireChildAccess(supabase, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const approvalBlocked = await checkApprovalForChild(childId);
  if (approvalBlocked) return approvalBlocked;

  const filterResult = filterParentQuestion(questionText.trim());
  if (filterResult.verdict === "block") {
    return NextResponse.json(
      { error: filterResult.reason, category: filterResult.category, suggestion: filterResult.suggestion },
      { status: 400 },
    );
  }
  if (filterResult.verdict === "suggest" && !override) {
    return NextResponse.json(
      {
        error: filterResult.reason,
        category: filterResult.category,
        suggestion: filterResult.suggestion,
        overridable: true,
      },
      { status: 422 },
    );
  }

  const { data: existing } = await supabase
    .from("parent_questions")
    .select("id, status, question_text")
    .eq("request_idempotency_key", reqIdemKey)
    .maybeSingle();
  
  if (existing) {
    return NextResponse.json({ questionId: existing.id, status: existing.status, questionText: existing.question_text });
  }

  const quotaCheck = await checkAndDeductQuota(supabase, childId);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 429 });
  }

  const deadlineAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("parent_questions")
    .insert({ 
      child_id: childId, 
      question_text: questionText.trim(),
      status: "draft",
      request_idempotency_key: reqIdemKey,
      deadline_at: deadlineAt
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const questionId = data.id;

  let aiGeneratedText = questionText.trim();
  try {
    const aiModel = await getModelForGroup("B");
    const ai = createGenAIClient(aiModel);
    const systemInstruction = `부모님이 아이에게 물어보고 싶은 질문을 작성했습니다. 이 질문을 6~8세 아이의 눈높이에 맞게 다정하고 부드러운 케이의 말투로 1~2문장으로 자연스럽게 다듬어주세요. 결과는 반드시 JSON 형식으로만 응답하고, JSON 외의 텍스트는 절대 포함하지 마세요. {"rewritten": "다듬어진 질문"}`;
    const result = await ai.models.generateContent({
      model: getLlmModel("parentQuestionGeneration"),
      contents: [{ role: "user", parts: [{ text: questionText.trim() }] }],
      config: { systemInstruction: { parts: [{ text: systemInstruction }] }, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'LOW' as any } }
    });
    
    if (result.text) {
      const parsed = extractJSON(result.text);
      if (parsed.rewritten) {
        aiGeneratedText = parsed.rewritten;
      }
    }
  } catch (err) {
    console.error("AI question rewrite failed:", err);
  }

  await supabase.from("parent_questions").update({
    status: "ai_generated",
    question_text: aiGeneratedText
  }).eq("id", questionId);

  return NextResponse.json({ questionId, status: "ai_generated", questionText: aiGeneratedText });
}
