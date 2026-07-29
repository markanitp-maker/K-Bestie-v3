import { NextResponse } from "next/server";
import { getKstHour, currentRound } from "@/lib/mission/missionTimeGate";
import { isMissionScheduleEnforced } from "@/lib/mission/missionScheduleFlag";

export const runtime = "nodejs";

// 아이 화면 진입 시간 제한(운영시간 게이트, app/child/missions/page.tsx) on/off 스위치 —
// 단일 기능 플래그 MISSION_TIME_GATE_ENABLED 전용. 값이 "true"일 때만 기존 시간 제한이
// 적용되고, 값이 없거나 그 외 값이면 기본적으로 비활성화(시간 무관 항상 진입 가능)된다.
// 베타 오픈 전까지 Dev/Preview/Production 전 환경 기본값은 비활성화이며, 대표님이 명시적으로
// 재활성화를 요청할 때만 이 값을 "true"로 설정한다. 게이트 로직(getKstHour/currentRound,
// missions/page.tsx) 자체는 그대로 유지 — 이 플래그는 적용 여부만 바꾼다.
//
// 031: MISSION_SCHEDULE_ENFORCED(Production 전용)가 켜져 있으면 위 플래그 값과 무관하게
// 게이트를 강제로 켜고, 경계값도 12~17시/19~23시(미만)로 바꾼다. activeRound/scheduleEnforced를
// 함께 내려줘 클라이언트가 currentRound()를 직접 호출하지 않고 이 서버 계산값을 그대로 쓰게
// 한다 — MISSION_SCHEDULE_ENFORCED는 NEXT_PUBLIC_ 접두어가 없어 클라이언트 번들에서는 항상
// undefined로 치환되므로, 클라이언트가 직접 판정하면 Production 실제 값과 어긋난다.
export async function GET() {
  const scheduleEnforced = isMissionScheduleEnforced();
  const enabled = process.env.MISSION_TIME_GATE_ENABLED === "true" || scheduleEnforced;
  const activeRound = enabled ? currentRound(getKstHour(), scheduleEnforced) : null;
  return NextResponse.json({ enabled, scheduleEnforced, activeRound });
}
