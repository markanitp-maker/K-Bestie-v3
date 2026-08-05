import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { GET as getParents } from "../parents/route";
import { GET as getChildren } from "../children/route";

export const runtime = "nodejs";

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function boolCell(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return v ? "O" : "X";
}

// requests/063 §13 — scope(all/parent/child)와 필터 기준으로 CSV를 내려준다.
// 이전 구현은 완전히 사라진 레거시 데이터 모델(activeChildren, perChildDaily 등)을
// 참조하고 있어 현재 대시보드와 무관하게 항상 깨진 값을 반환하고 있었다 — 실제
// parents/children 드릴다운 API(이미 이름·로그인아이디·D1/D3/D7/W2를 계산해 반환)를
// 그대로 재사용해 다시 작성한다.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const scope = (req.nextUrl.searchParams.get("scope") || "all") as "all" | "parent" | "child";
  if (!["all", "parent", "child"].includes(scope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const header = [
    "사용자 유형", "이름", "로그인 아이디", "최초 사용일", "마지막 활동일",
    "D1", "D3", "D7", "W2", "활동일 수", "미션 수", "자유대화 수", "놀이 수", "내부 테스트 계정 여부",
  ];
  const rows: string[] = [header.join(",")];

  if (scope === "all" || scope === "parent") {
    const res = await getParents(req);
    if (!res.ok) return NextResponse.json({ error: "부모 데이터 조회 실패" }, { status: res.status });
    const data = await res.json();
    for (const p of data.parents || []) {
      rows.push([
        "부모",
        csvEscape(p.name || ""),
        csvEscape(p.loginId || ""),
        csvEscape(p.joinedAt ? p.joinedAt.slice(0, 10) : ""),
        csvEscape(p.lastVisitAt ? p.lastVisitAt.slice(0, 10) : ""),
        boolCell(p.d1Retained),
        boolCell(p.d3Retained),
        boolCell(p.d7Retained),
        boolCell(p.w2Retained),
        p.activeDaysTotal ?? 0,
        "", "", "", // 부모는 미션/자유대화/놀이 개념이 없음
        p.isTestAccount ? "O" : "X",
      ].join(","));
    }
  }

  if (scope === "all" || scope === "child") {
    const res = await getChildren(req);
    if (!res.ok) return NextResponse.json({ error: "아이 데이터 조회 실패" }, { status: res.status });
    const data = await res.json();
    for (const c of data.children || []) {
      rows.push([
        "아이",
        csvEscape(c.name || ""),
        csvEscape(c.loginId || ""),
        csvEscape(c.firstActiveDate || ""),
        csvEscape(c.lastVisitAt ? c.lastVisitAt.slice(0, 10) : ""),
        boolCell(c.d1Retained),
        boolCell(c.d3Retained),
        boolCell(c.d7Retained),
        boolCell(c.w2Retained),
        c.activeDaysTotal ?? 0,
        c.missionCount ?? 0,
        c.freechatCount ?? 0,
        c.playCount ?? 0,
        c.isTestAccount ? "O" : "X",
      ].join(","));
    }
  }

  const csvContent = "﻿" + rows.join("\n"); // BOM for Excel
  const todayStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="retention-${scope}-${todayStr}.csv"`,
    },
  });
}
