import React, { useState, useEffect, useCallback } from "react";
import { useAdminSoftDelete, SoftDeleteRowCheckbox, SoftDeleteSelectionBar } from "@/components/admin/AdminSoftDelete";
import { type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";

interface AcquisitionLinksTabProps {
  channelFilter?: string;
  onChannelFilterChange?: (channel: string) => void;
}

export default function AcquisitionLinksTab({ channelFilter = "", onChannelFilterChange }: AcquisitionLinksTabProps = {}) {
  const [links, setLinks] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  
  // Custom Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formData, setFormData] = useState({ channel_name: "", utm_source: "", utm_medium: "", utm_campaign: "", purpose: "", utm_content: "", memo: "", destination_path: "/" });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [resultToast, setResultToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!resultToast) return;
    const t = setTimeout(() => setResultToast(null), 3000);
    return () => clearTimeout(t);
  }, [resultToast]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/acquisition/links");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "유입 링크를 불러오지 못했습니다.");
      setLinks(Array.isArray(payload.links) ? payload.links : []);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "유입 링크를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const softDelete = useAdminSoftDelete("acquisition_links", "유입 링크", load, "전체");
  const visibleLinks = (links || []).filter((r: any) => !channelFilter || r.channel_name === channelFilter);
  const channelOptions = Array.from(new Set((links || []).map((r: any) => String(r.channel_name)))).sort();
  const deletableRows = visibleLinks.filter((r: any) => !!r.id);
  const pageIds = deletableRows.map((r: any) => r.id as string);
  const allSelected = pageIds.length > 0 && pageIds.every((id: string) => softDelete.isSelected(id));
  const selectedTargets = deletableRows
    .filter((r: any) => softDelete.isSelected(r.id))
    .map((r: any) => ({
      id: r.id as string,
      identity: `${r.channel_name} (${r.link_id})`,
      summary: "유입 링크",
      status: r.status,
    }));

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.channel_name || !formData.utm_source || !formData.utm_medium || !formData.utm_campaign || !formData.purpose) {
      setResultToast({ type: "error", text: "필수 항목을 모두 입력해주세요." });
      return;
    }
    
    setSubmitLoading(true);
    try {
      const res = await fetch("/api/admin/acquisition/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        const d = await res.json();
        setResultToast({ type: "success", text: `링크가 생성되었습니다: ${d.link.link_id}` });
        setIsCreateModalOpen(false);
        setFormData({ channel_name: "", utm_source: "", utm_medium: "", utm_campaign: "", purpose: "", utm_content: "", memo: "", destination_path: "/" });
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        setResultToast({ type: "error", text: d.error || "생성 실패" });
      }
    } catch (err) {
      setResultToast({ type: "error", text: "오류 발생" });
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleToggleStatus = async (link: any) => {
    const newStatus = link.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await fetch(`/api/admin/acquisition/links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        load();
      } else {
        setResultToast({ type: "error", text: "상태 변경 실패" });
      }
    } catch (err) {
      setResultToast({ type: "error", text: "오류 발생" });
    }
  };

  const toast = resultToast && (
    <div
      style={{
        position: "fixed", top: 16, right: 16, zIndex: 100,
        padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
        background: resultToast.type === "success" ? "var(--admin-primary)" : "var(--admin-danger)",
        color: "white", border: "1px solid var(--admin-border)",
      }}
    >
      {resultToast.text}
    </div>
  );

  const columns: AdminDataTableColumn<any>[] = [
    {
      key: "select",
      header: "선택",
      render: (req) =>
        req.id ? (
          <SoftDeleteRowCheckbox checked={softDelete.isSelected(req.id)} onChange={() => softDelete.toggleSelected(req.id)} />
        ) : null,
    },
    {
      key: "channel_name",
      header: "채널명",
      sortable: true,
      sortType: "text",
      sortValue: (req) => req.channel_name,
      render: (req) => <div style={{ fontWeight: 600 }}>{req.channel_name}</div>,
    },
    {
      key: "link_id",
      header: "link_id",
      sortable: true,
      sortType: "text",
      sortValue: (req) => req.link_id,
      render: (req) => <div style={{ fontSize: "11px", color: "var(--admin-text-secondary)" }}>{req.link_id}</div>,
    },
    {
      key: "utm",
      header: "Source / Medium / Campaign",
      sortable: true,
      sortType: "text",
      sortValue: (req) => `${req.utm_source ?? ""} ${req.utm_medium ?? ""} ${req.utm_campaign ?? ""}`.trim(),
      render: (req) => <div style={{ fontSize: "11px" }}>{req.utm_source} / {req.utm_medium} / {req.utm_campaign}</div>,
    },
    {
      key: "purpose",
      header: "용도",
      sortable: true,
      sortType: "text",
      sortValue: (req) => req.purpose,
      render: (req) => req.purpose,
    },
    {
      key: "status",
      header: "상태",
      sortable: true,
      sortType: "status",
      statusOrder: { ACTIVE: 1, INACTIVE: 2 },
      sortValue: (req) => req.status,
      render: (req) => <AdminStatusBadge variant={req.status === "ACTIVE" ? "success" : "neutral"} text={req.status === "ACTIVE" ? "활성" : "비활성"} />,
    },
    {
      key: "stats",
      header: "클릭 / 가입 / 전환율",
      sortable: true,
      sortType: "number",
      sortValue: (req) => req.clicks ?? 0,
      render: (req) => (
        <div style={{ fontSize: "12px", fontWeight: 600 }}>
          {req.clicks || 0} / {req.signups || 0} / {req.conversion_rate ? req.conversion_rate.toFixed(1) : "0"}%
        </div>
      ),
    },
    {
      key: "actions",
      header: "액션",
      render: (req) => (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => {
              const url = `https://app.k-bestie.com${req.destination_path}?link_id=${req.link_id}&utm_source=${req.utm_source}&utm_medium=${req.utm_medium}&utm_campaign=${req.utm_campaign}`;
              navigator.clipboard.writeText(url);
              setResultToast({ type: "success", text: "링크 복사 완료" });
            }}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "12px",
              background: "var(--admin-surface)",
              border: "1px solid var(--admin-border)",
              cursor: "pointer",
            }}
          >
            복사
          </button>
          <button
            onClick={() => handleToggleStatus(req)}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "12px",
              background: "var(--admin-surface)",
              border: "1px solid var(--admin-border)",
              cursor: "pointer",
            }}
          >
            {req.status === "ACTIVE" ? "비활성 전환" : "활성 전환"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {toast}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>회원가입 유입 링크 관리</h2>
          <p style={{ fontSize: 13, color: "var(--admin-text-secondary)", marginTop: 4 }}>홍보 채널별 회원가입 링크를 생성하고 클릭·가입 성과를 관리합니다.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select value={channelFilter} onChange={(event) => onChannelFilterChange?.(event.target.value)} aria-label="채널 필터" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--admin-border)", background: "var(--admin-surface)" }}>
            <option value="">모든 채널</option>
            {channelOptions.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
          </select>
          <button
          onClick={() => setIsCreateModalOpen(true)}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 600,
            background: "var(--admin-primary)",
            color: "white",
            border: "none",
            cursor: "pointer",
          }}
          >
            + 신규 링크 생성
          </button>
        </div>
      </div>

      <SoftDeleteSelectionBar
        selectedCount={selectedTargets.length}
        totalCount={pageIds.length}
        allSelected={allSelected}
        onSelectAll={(checked) => softDelete.setPageSelection(pageIds, checked)}
        onClear={softDelete.clearSelection}
        onBulkDelete={() => softDelete.requestBulkDelete(selectedTargets)}
        disabled={softDelete.busy}
      />
      {softDelete.modals}

      {loadError && <div style={{ padding: 24, textAlign: "center", color: "var(--admin-danger)", border: "1px solid var(--admin-border)", borderRadius: 12 }}>{loadError}<button type="button" onClick={load} style={{ display: "block", margin: "10px auto 0", padding: "8px 14px", borderRadius: 8, border: "1px solid var(--admin-border)", background: "var(--admin-surface)", cursor: "pointer" }}>다시 시도</button></div>}
      {!loadError && <div style={{ background: "var(--admin-surface)", borderRadius: "12px", border: "1px solid var(--admin-border)", overflow: "hidden" }}>
        <AdminResponsiveTable
          mobileStrategy="card"
          columns={columns}
          data={visibleLinks}
          keyExtractor={(r) => r.id}
        />
        {loading && !links && <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--admin-text-secondary)" }}>불러오는 중...</div>}
        {links && visibleLinks.length === 0 && <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--admin-text-secondary)" }}>조건에 맞는 유입 링크가 없습니다.</div>}
      </div>}

      {isCreateModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setIsCreateModalOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="신규 유입 링크 생성" style={{ position: "relative", width: "min(400px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", background: "var(--admin-surface)", borderRadius: 12, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>신규 링크 생성</h3>
            <form onSubmit={handleCreateSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input required placeholder="채널명 (예: 인스타그램)" value={formData.channel_name} onChange={e => setFormData({...formData, channel_name: e.target.value})} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--admin-border)", fontSize: "14px" }} />
              <input required placeholder="utm_source (예: instagram)" value={formData.utm_source} onChange={e => setFormData({...formData, utm_source: e.target.value})} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--admin-border)", fontSize: "14px" }} />
              <input required placeholder="utm_medium (예: social)" value={formData.utm_medium} onChange={e => setFormData({...formData, utm_medium: e.target.value})} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--admin-border)", fontSize: "14px" }} />
              <input required placeholder="utm_campaign (예: official_launch)" value={formData.utm_campaign} onChange={e => setFormData({...formData, utm_campaign: e.target.value})} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--admin-border)", fontSize: "14px" }} />
              <input required placeholder="용도 (예: 프로필 링크)" value={formData.purpose} onChange={e => setFormData({...formData, purpose: e.target.value})} style={{ padding: "8px", borderRadius: "6px", border: "1px solid var(--admin-border)", fontSize: "14px" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setIsCreateModalOpen(false)} style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "1px solid var(--admin-border)", background: "transparent", cursor: "pointer" }}>취소</button>
                <button type="submit" disabled={submitLoading} style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "none", background: "var(--admin-primary)", color: "white", cursor: "pointer" }}>{submitLoading ? "저장 중..." : "생성"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
