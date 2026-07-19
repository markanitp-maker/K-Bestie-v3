import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const child_id = url.searchParams.get("child_id");
  const play_type = url.searchParams.get("play_type");

  if (!child_id || !play_type) {
    return NextResponse.json({ error: "child_id and play_type required" }, { status: 400 });
  }

  const service = createServiceClient();
  const authCheck = await requireChildAccess(service, user.id, child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: sessionData, error: sessionErr } = await service
    .from("k_play_sessions")
    .select("id, status, progress_state, resume_expires_at")
    .eq("child_id", child_id)
    .eq("play_type", play_type)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionErr) {
    console.error("[play/session] Fetch error:", sessionErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!sessionData) {
    return NextResponse.json({ canResume: false, progressState: null, sessionId: null });
  }

  const { id, status, progress_state, resume_expires_at } = sessionData;

  const now = new Date();
  const expiresAt = resume_expires_at ? new Date(resume_expires_at) : null;
  const isExpired = expiresAt ? now > expiresAt : false;

  const canResume = status !== "completed" && !isExpired;

  return NextResponse.json({
    canResume,
    progressState: canResume ? progress_state : null,
    sessionId: canResume ? id : null,
  });
}
