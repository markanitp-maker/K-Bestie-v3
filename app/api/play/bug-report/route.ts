import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { 
      playType, 
      eventType, 
      occurredAt, 
      sessionId, 
      childId, 
      stage, 
      questionNumber, 
      errorMessage, 
      networkStatus, 
      dbStatus, 
      browserOS 
    } = body;

    if (!playType || !sessionId || !childId || !stage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { allowed } = await requireChildAccess(supabase, user.id, childId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceClient = createServiceClient();
    
    let validSessionId = sessionId;
    if (sessionId) {
      const { data: sessionData } = await serviceClient
        .from("k_play_sessions")
        .select("child_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!sessionData || sessionData.child_id !== childId) {
        validSessionId = null;
      }
    }

    // 민감정보 제거 (토큰/답변원문 제거)
    let safeErrorMessage = typeof errorMessage === "string" ? errorMessage : "";
    if (safeErrorMessage.length > 2000) {
      safeErrorMessage = safeErrorMessage.substring(0, 2000);
    }
    safeErrorMessage = safeErrorMessage
      .replace(/Bearer\s+[A-Za-z0-9\-\._~+\/]+/gi, "[REDACTED]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, "[REDACTED]")
      .replace(/(sk-[A-Za-z0-9_-]+|key=[A-Za-z0-9_-]+)/gi, "[REDACTED]")
      .replace(/[A-Za-z0-9]{40,}/g, "[REDACTED]");
    
    // browserOS 파싱
    let os = null;
    let browser = browserOS;
    if (browserOS && typeof browserOS === "string") {
      if (browserOS.toLowerCase().includes("win")) os = "Windows";
      else if (browserOS.toLowerCase().includes("mac")) os = "macOS";
      else if (browserOS.toLowerCase().includes("android")) os = "Android";
      else if (browserOS.toLowerCase().includes("ios") || browserOS.toLowerCase().includes("iphone")) os = "iOS";
    }

    const { data: report, error: reportErr } = await serviceClient
      .from("play_bug_reports")
      .insert({
        play_type: playType,
        play_session_id: validSessionId,
        child_id: childId,
        occurred_at: occurredAt || new Date().toISOString(),
        stage,
        question_number: questionNumber,
        error_message: safeErrorMessage,
        network_status: networkStatus,
        db_status: dbStatus,
        browser,
        os,
        app_version: req.headers.get("x-app-version") || null,
        metadata: {
          errorCode: body.errorCode,
          eventType
        }
      })
      .select("id")
      .single();

    if (reportErr) {
      console.error("[bug-report] DB error:", reportErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, report_id: report.id });
  } catch (err) {
    console.error("[bug-report] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
