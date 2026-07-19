import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { status?: string; questionText?: string; override?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: q, error: qErr } = await supabase
    .from("parent_questions")
    .select("child_id")
    .eq("id", id)
    .maybeSingle();

  if (qErr || !q) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, q.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, any> = {};

  if (body.status === "declined" || body.status === "중지됨") {
    // 백워드 호환성을 위해 중지됨 포함
    updates.status = "declined";
  } else if (body.questionText) {
    // 안전 재검사 (lib/plan/parentQuestionFilter.ts는 route 밖에서 가져와야 함)
    // Wait, let's import it correctly at the top. Since I'm replacing the function, the import needs to be there.
    // I should have used multi_replace_file_content to add the import if missing. 
    // Wait, the original file didn't import `filterParentQuestion`. I will add it dynamically.
    const { filterParentQuestion } = await import("@/lib/plan/parentQuestionFilter");
    
    const filterResult = filterParentQuestion(body.questionText.trim());
    if (filterResult.verdict === "block") {
      return NextResponse.json(
        { error: filterResult.reason, category: filterResult.category, suggestion: filterResult.suggestion },
        { status: 400 }
      );
    }
    if (filterResult.verdict === "suggest" && !body.override) {
      return NextResponse.json(
        { error: filterResult.reason, category: filterResult.category, suggestion: filterResult.suggestion, overridable: true },
        { status: 422 }
      );
    }
    updates.question_text = body.questionText.trim();
    updates.status = "parent_edited";
  } else {
    return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
  }

  const { error } = await supabase
    .from("parent_questions")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...updates });
}
