import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BUILD_STAMP } from "@/lib/pwa/buildStamp";

export const runtime = "nodejs";

function currentBuildId(): string {
  // 손으로 올리는 상수가 아니라 배포 식별자를 돌려준다. 상수를 쓰면 상수를 안 올린
  // 배포에서 옛 클라이언트와 값이 같아져 버전 불일치를 영영 못 잡는다(2026-08-14).
  return BUILD_STAMP;
}

export async function GET() {
  return NextResponse.json(
    { buildId: currentBuildId() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, childId, clientSha, swVersion } = body;
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || currentBuildId();

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
