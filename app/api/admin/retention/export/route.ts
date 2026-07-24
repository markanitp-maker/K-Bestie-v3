import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { GET as getRetentionData } from "../route";

export const runtime = "nodejs";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  // Call the main API to get the data
  const res = await getRetentionData(req);
  if (!res.ok) {
    return NextResponse.json({ error: "데이터 조회 실패" }, { status: res.status });
  }

  const data = await res.json();

  // Construct CSV
  const header = [
    "지표",
    "값"
  ].join(",");

  const rows = [
    `접속 아이 수,${data.activeChildren}명`,
    `미션 완료율,${pct(data.missionCompletionRate)}`,
    `하루 2회 미션 목표 달성률,${pct(data.dailyGoalAchievementRate)}`,
    `평균 체류시간(초),${data.avgSessionDurationSec.toFixed(1)}`,
    `대화 턴 수,${data.avgTurnsPerSession.toFixed(1)}턴`,
    `D1 재방문율,${pct(data.d1RetentionRate)}`,
    `D3 재방문율,${pct(data.d3RetentionRate)}`,
    `D7 재방문율,${pct(data.d7RetentionRate)}`,
    `D14 재방문율,${pct(data.d14RetentionRate)}`,
    `D30 재방문율,${pct(data.d30RetentionRate)}`,
    ``,
    `아이별 접속 요약 (아이 이름/연속 접속 일수/기간 내 총 세션 수/접속일 평균 세션 수)`,
  ];

  if (data.perChildDaily && data.perChildDaily.length > 0) {
    for (const child of data.perChildDaily) {
      // Escape name just in case it contains commas
      const name = `"${child.name.replace(/"/g, '""')}"`;
      rows.push(`${name},${child.consecutiveDays},${child.totalSessionsInPeriod},${child.avgSessionsPerActiveDay}`);
    }
  }

  const csvContent = "\uFEFF" + [header, ...rows].join("\n"); // prepend BOM for excel

  const periodParam = req.nextUrl.searchParams.get("period") || "7d";

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="retention-${periodParam}.csv"`,
    },
  });
}
