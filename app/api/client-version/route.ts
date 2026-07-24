import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, childId, clientSha, swVersion } = body;
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || "local";

    const service = await createServiceClient();
    const { error } = await service.from("client_version_events").insert({
      session_id: sessionId ?? null,
      child_id: childId ?? null,
      client_sha: clientSha,
      sw_version: swVersion,
      deployment_id: deploymentId
    });

    if (error) {
      console.error("[client-version] insert error:", error);
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[client-version] unhandled error:", error);
    return NextResponse.json({ ok: false });
  }
}
