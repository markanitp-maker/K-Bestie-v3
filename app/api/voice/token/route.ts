import { NextRequest, NextResponse } from "next/server";
import { getModelForGroup, VERTEX_LIVE_VOICE_MODEL_ID } from "@/app/api/_lib/ai";
import { K_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";
import { createClient } from "@/lib/supabase/server";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { mintVertexLiveTicket } from "@/lib/plan/vertexLiveTicket";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// TODO: Tier3 하루 사용시간 상한(cap) 체크를 여기 추가할 것 — 자세한 건 FUTURE_TODO.md 참고.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, body.childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const consentBlocked = await checkConsentForChild(body.childId);
  if (consentBlocked) return consentBlocked;

  // 그룹C(라이브) 스위치 조회 — 연결 시작 시점에 1회 스냅샷되어 세션 수명 동안 고정된다
  // (클라이언트 useGeminiLive.startSession()이 매 연결마다 이 라우트를 새로 호출하므로,
  // 이미 연결된 세션은 관리자가 스위치를 바꿔도 영향받지 않고 다음 연결부터 반영됨).
  const voiceModel = await getModelForGroup("C");

  // Vertex Live는 브라우저가 직접 붙을 수 있는 ephemeral 토큰 메커니즘이 없다(서비스계정
  // 자격증명은 프런트에 노출 금지 — 하드룰③). 대신 별도 배포된 Cloud Run 릴레이
  // (services/vertex-live-relay)의 접속 정보 + 1회성 단기 티켓만 내려준다.
  // AI Studio 경로는 이 분기 아래에서 완전히 그대로 유지된다.
  if (voiceModel.provider !== "vertex") {
    return NextResponse.json({ error: "Only vertex provider is supported" }, { status: 500 });
  }

  const relayUrl = process.env.VERTEX_LIVE_RELAY_URL;
  if (!relayUrl) {
    return NextResponse.json({ error: "VERTEX_LIVE_RELAY_URL not configured" }, { status: 500 });
  }
  // 아이 설정(child_profiles.live_voice_name)에 저장된 목소리를 서버가 직접 조회해 v1
  // 서명 티켓에 포함시킨다 — 브라우저가 임의 값을 보낼 수 없는 server-trust 경로
  // (mintVertexLiveTicket 내부에서도 Google 공식 30개 목록으로 한 번 더 검증,
  // 미설정/미지원 시 Achernar로 대체). 릴레이는 이 v1 포맷과 예전 legacy 포맷을 모두
  // 받으므로(하위호환), 배포 타이밍이 어긋나도 서비스가 끊기지 않는다.
  const { liveVoiceName } = await getVoiceModeForChild(body.childId);
  try {
    const ticket = mintVertexLiveTicket(body.childId, liveVoiceName);
    const parsed = new URL(relayUrl);
    parsed.protocol = "wss:";
    parsed.searchParams.set("ticket", ticket);
    if (parsed.protocol !== "wss:") {
      throw new Error("Invalid protocol");
    }
    return NextResponse.json({
      mode: "relay",
      wsUrl: parsed.toString(),
      model: VERTEX_LIVE_VOICE_MODEL_ID,
    });
  } catch (error) {
    console.error("[Voice Token] Failed to parse relay URL or mint ticket");
    return NextResponse.json({ 
      error: "Invalid relay URL configuration or failed to mint ticket" 
    }, { status: 500 });
  }
}
