import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 기존의 무조건 +1 출석 지급 경로는 출석 룰렛으로 대체됐다.
 * 남아 있는 구버전 클라이언트가 이 API를 호출해도 룰렛과 중복 지급되지 않도록
 * 명시적으로 종료 상태를 반환한다. 미션 등 다른 황금열쇠 보상 경로에는 영향이 없다.
 */
export async function POST() {
  return NextResponse.json(
    { error: "attendance_reward_replaced_by_roulette", replacement: "/api/events/attendance-roulette/spin" },
    { status: 410 }
  );
}
