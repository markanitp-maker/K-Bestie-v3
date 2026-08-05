"use client";

import React, { useEffect, useState } from "react";
import { AdminKpiCard, AdminKpiGrid } from "@/components/admin/shell/AdminKpiCard";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";
import { AdminErrorState } from "@/components/admin/shell/AdminErrorState";

// requests/request-parent-query-router-grade{1,2,3,4,5,6}-v1.md §14 — 읽기 전용 통계 화면.
// 운영자가 이 화면에서 Green/Red 규칙을 즉시 수정하는 기능은 의도적으로 제공하지 않는다.

interface GradeStats {
  grade: number;
  policyVersion: string;
  productionEnabled: boolean;
  totalEvents: number;
  routeCounts: Record<string, number>;
  ruleCounts: Record<string, number>;
  defaultRedCount: number;
  defaultRedRatio: number;
  multiQuestionEvents: number;
  totalRegistered: number;
  registrationOutcomeCounts: Record<string, number>;
}

interface RouterStats {
  supabaseTarget: string;
  totalEvents: number;
  totalRegistered: number;
  perGrade: GradeStats[];
  crisisClinicallyReviewed: boolean;
  note: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  ai_generated: "대기 중",
  mission_confirming: "질문 전달됨",
  reconfirm_pending: "재확인 중",
  confirmed: "답변 완료",
  declined: "답변 거부",
  cancelled: "취소됨",
  expired: "만료됨",
};

function GradeCard({ g }: { g: GradeStats }) {
  const [expanded, setExpanded] = useState(g.grade === 4);
  return (
    <div style={{ background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 16, padding: "var(--admin-space-16)" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>
          {g.grade}학년 <span style={{ fontSize: 12, fontWeight: 400, color: "var(--admin-text-secondary)" }}>({g.policyVersion})</span>
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            color: g.productionEnabled ? "#166534" : "#92400e",
            background: g.productionEnabled ? "#dcfce7" : "#fef3c7",
          }}
        >
          {g.productionEnabled ? "Production 활성" : "Production 비활성"}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: "var(--admin-space-12)", display: "flex", flexDirection: "column", gap: "var(--admin-space-16)" }}>
          <AdminKpiGrid>
            <AdminKpiCard title="GREEN" value={g.routeCounts.GREEN ?? 0} />
            <AdminKpiCard title="RED" value={g.routeCounts.RED ?? 0} />
            <AdminKpiCard title="CRISIS" value={g.routeCounts.CRISIS ?? 0} />
            <AdminKpiCard title="default RED 비율" value={`${Math.round(g.defaultRedRatio * 100)}%`} />
            <AdminKpiCard title="다중 질문 감지" value={g.multiQuestionEvents} />
            <AdminKpiCard title="등록된 질문" value={g.totalRegistered} />
            <AdminKpiCard title="전체 판정 이벤트" value={g.totalEvents} />
          </AdminKpiGrid>

          <div>
            <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>rule_id별 판정 건수</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(g.ruleCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([ruleId, count]) => (
                  <div key={ruleId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span>{ruleId}</span>
                    <span style={{ fontWeight: 600 }}>{count}건</span>
                  </div>
                ))}
              {Object.keys(g.ruleCounts).length === 0 && (
                <p style={{ fontSize: 12, color: "var(--admin-text-secondary)" }}>아직 데이터가 없습니다.</p>
              )}
            </div>
          </div>

          <div>
            <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>등록·거절·거부·만료 현황</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(g.registrationOutcomeCounts).map(([status, count]) => (
                <div key={status} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>{OUTCOME_LABELS[status] ?? status}</span>
                  <span style={{ fontWeight: 600 }}>{count}건</span>
                </div>
              ))}
              {Object.keys(g.registrationOutcomeCounts).length === 0 && (
                <p style={{ fontSize: 12, color: "var(--admin-text-secondary)" }}>아직 등록된 질문이 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ParentQueryRouterTab() {
  const [stats, setStats] = useState<RouterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/parent-query-router")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setStats(d);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: "var(--admin-space-24)", color: "var(--admin-text-secondary)" }}>불러오는 중...</div>;
  if (error) return <AdminErrorState error={error} onRetry={() => window.location.reload()} />;
  if (!stats) return null;

  return (
    <div style={{ width: "100%" }}>
      <AdminPageHeader
        title="부모 질문 라우터(4학년)"
        description={
          <>
            환경: <strong>{stats.supabaseTarget === "prod" ? "Production" : "Development"}</strong> · 전체 판정 이벤트{" "}
            {stats.totalEvents}건 · 전체 등록 {stats.totalRegistered}건
            <br />
            Crisis 임상 검토 상태:{" "}
            <strong>{stats.crisisClinicallyReviewed ? "승인됨" : "PENDING_REVIEW(전문가 승인 전 — 전용 문구 잠금)"}</strong>
          </>
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-16)" }}>
        {stats.perGrade.map((g) => (
          <GradeCard key={g.grade} g={g} />
        ))}
      </div>

      <p style={{ marginTop: "var(--admin-space-16)", fontSize: "var(--admin-text-xs)", color: "var(--admin-text-secondary)" }}>{stats.note}</p>
    </div>
  );
}
