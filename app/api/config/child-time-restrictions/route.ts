import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 아이 화면 진입 시간 제한(운영시간 게이트, app/child/missions/page.tsx) on/off 스위치 —
// 단일 기능 플래그 MISSION_TIME_GATE_ENABLED 전용. 값이 "true"일 때만 기존 시간 제한이
// 적용되고, 값이 없거나 그 외 값이면 기본적으로 비활성화(시간 무관 항상 진입 가능)된다.
// 베타 오픈 전까지 Dev/Preview/Production 전 환경 기본값은 비활성화이며, 대표님이 명시적으로
// 재활성화를 요청할 때만 이 값을 "true"로 설정한다. 게이트 로직(getKstHour/currentRound,
// missions/page.tsx) 자체는 그대로 유지 — 이 플래그는 적용 여부만 바꾼다.
export async function GET() {
  const enabled = process.env.MISSION_TIME_GATE_ENABLED === "true";
  return NextResponse.json({ enabled });
}
