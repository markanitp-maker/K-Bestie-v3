"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AdminDataTable, type AdminDataTableColumn } from "@/components/admin/shell/AdminDataTable";
import { AdminResponsiveTable } from "@/components/admin/shell/AdminResponsiveTable";
import { AdminFilterBar } from "@/components/admin/shell/AdminFilterBar";
import { AdminStatusBadge } from "@/components/admin/shell/AdminStatusBadge";
import {
  SoftDeleteButton,
  SoftDeleteRowCheckbox,
  SoftDeleteSelectionBar,
  useAdminSoftDelete,
} from "@/components/admin/AdminSoftDelete";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

function formatSubmitter(req: { submitter_name?: string | null; submitter_role?: string | null }): string {
  const role = req.submitter_role === "child" ? "아이" : "부모";
  const name = req.submitter_name?.trim();
  return name ? `${name}(${role})` : role;
}

// 컴포넌트 본문의 getCategoryLabel은 렌더 도중(선택 목록 계산 시점)에는 아직
// 초기화 전이라 쓸 수 없어서, 모듈 스코프에 같은 매핑을 둔다.
function getCategoryLabelStatic(c: string): string {
  if (c === "voc") return "문의";
  if (c === "feature") return "건의";
  if (c === "bug") return "버그";
  return c;
}

export default function FeedbackTab({ fixedCategory }: { fixedCategory: "voc" | "feature" | "bug" }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [status, setStatus] = useState<string>("all");
  const [role, setRole] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const query = new URLSearchParams();
    query.set("category", fixedCategory);
    if (status && status !== "all") query.set("status", status);
    if (role && role !== "all") query.set("role", role);
    if (search) query.set("search", search);

    fetch(`/api/admin/support-requests?${query.toString()}`)
      .then((r) => r.json())
      .then((d) => setRequests(d.requests || []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [fixedCategory, status, role, search]);

  useEffect(() => {
    load();
  }, [load]);

  // requests/066 소프트 삭제 — 문의·건의·버그 접수(support_requests).
  const filterSummary = [
    `유형=${fixedCategory}`,
    status !== "all" ? `상태=${status}` : null,
    role !== "all" ? `접수자=${role}` : null,
    search ? `검색="${search}"` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const resourceName = fixedCategory === "voc" ? "support_requests_voc" :
                       fixedCategory === "feature" ? "support_requests_feature" : "support_requests_bug";
  const resourceLabel = fixedCategory === "voc" ? "문의 접수" :
                        fixedCategory === "feature" ? "건의 접수" : "버그 접수";

  const softDelete = useAdminSoftDelete(resourceName as any, resourceLabel, load, filterSummary);
  const pageIds = requests.map((r) => r.id as string);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => softDelete.isSelected(id));
  const selectedTargets = requests
    .filter((r) => softDelete.isSelected(r.id))
    .map((r) => ({
      id: r.id as string,
      identity: `${r.request_number || r.id} / ${formatSubmitter(r)}`,
      summary: getCategoryLabelStatic(r.category),
      status: r.status ?? null,
    }));

  const handleUpdate = async (id: string, newStatus: string, newNote: string) => {
    try {
      const res = await fetch(`/api/admin/support-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, admin_note: newNote }),
      });
      if (res.ok) {
        alert("저장되었습니다.");
        load();
      } else {
        const d = await res.json();
        alert(d.error || "저장 실패");
      }
    } catch (e) {
      alert("오류 발생");
    }
  };

  const getCategoryLabel = getCategoryLabelStatic;

  const getStatusLabel = (s: string) => {
    if (s === "open" || s === "received") return "접수됨";
    if (s === "in_progress" || s === "reviewing") return "확인 중";
    if (s === "resolved") return "처리 완료";
    if (s === "closed") return "종료";
    return s;
  };

  const getStatusVariant = (s: string) => {
    if (s === "open" || s === "received") return "warning";
    if (s === "in_progress" || s === "reviewing") return "info";
    if (s === "resolved") return "success";
    if (s === "closed") return "neutral";
    return "neutral";
  };

  const columns = ([
    {
      key: "select",
      header: "선택",
      render: (req: any) => (
        <SoftDeleteRowCheckbox checked={softDelete.isSelected(req.id)} onChange={() => softDelete.toggleSelected(req.id)} />
      ),
    },
    { key: "request_number", header: "접수번호", render: (req: any) => req.request_number || "-" },
    { key: "submitter", header: "접수자", render: (req: any) => formatSubmitter(req) },
    { key: "summary", header: "제목/내용 요약", render: (req: any) => (
      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
        {req.category === "voc" ? req.body : req.subject}
        {req.attachments && req.attachments.filter((a: any) => a.upload_status === "uploaded").length > 0 && (
          <span style={{ marginLeft: "var(--admin-space-8)", fontSize: "var(--admin-text-xs)", background: "var(--admin-surface)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--admin-border)" }}>
            이미지 {req.attachments.filter((a: any) => a.upload_status === "uploaded").length}장
          </span>
        )}
      </div>
    )},
    { key: "created_at", header: "접수일", render: (req: any) => formatDateTime(req.created_at) },
    { key: "status", header: "상태", render: (req: any) => (
      <AdminStatusBadge text={getStatusLabel(req.status)} variant={getStatusVariant(req.status)} />
    )},
    {
      key: "actions",
      header: "액션",
      render: (req: any) => (
        <SoftDeleteButton
          disabled={softDelete.busy}
          onClick={(e) => {
            e.stopPropagation();
            softDelete.requestDelete({
              id: req.id,
              identity: `${req.request_number || req.id} / ${formatSubmitter(req)}`,
              summary: getCategoryLabel(req.category),
              status: getStatusLabel(req.status),
            });
          }}
        />
      ),
    },
  ].filter(Boolean) as AdminDataTableColumn<any>[]);

  return (
    <div style={{ width: "100%" }}>
      <h2 style={{ fontSize: "var(--admin-text-lg)", fontWeight: "var(--admin-weight-bold)", color: "var(--admin-text-primary)", marginBottom: "var(--admin-space-12)" }}>
        {fixedCategory === "voc" ? "문의 접수 목록" :
         fixedCategory === "feature" ? "건의 접수 목록" :
         fixedCategory === "bug" ? "버그 접수 목록" :
         "문의·건의·버그 접수 목록"}
      </h2>

      <AdminFilterBar
        searchNode={
          <input
            type="text"
            placeholder="검색어 (접수번호, 내용)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              minWidth: 240,
              padding: "var(--admin-space-8) var(--admin-space-12)",
              fontSize: "var(--admin-text-sm)",
              borderRadius: 8,
              border: "1px solid var(--admin-border)",
            }}
          />
        }
        filterNodes={[
          <select key="status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "var(--admin-space-6) var(--admin-space-10)", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-sm)", background: "var(--admin-surface)", color: "var(--admin-text-primary)" }}>
            <option value="all">모든 상태</option>
            <option value="open">접수됨 (open)</option>
            <option value="in_progress">확인 중 (in_progress)</option>
            <option value="resolved">처리 완료 (resolved)</option>
            <option value="closed">종료 (closed)</option>
          </select>,
          <select key="role" value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: "var(--admin-space-6) var(--admin-space-10)", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-sm)", background: "var(--admin-surface)", color: "var(--admin-text-primary)" }}>
            <option value="all">모든 접수자</option>
            <option value="child">아이</option>
            <option value="parent">부모</option>
          </select>
        ]}
      />

      <div style={{ marginTop: "var(--admin-space-16)" }}>
        <SoftDeleteSelectionBar
          selectedCount={softDelete.selectedIds.length}
          totalCount={pageIds.length}
          allSelected={allSelected}
          onSelectAll={(checked) => softDelete.setPageSelection(pageIds, checked)}
          onClear={softDelete.clearSelection}
          onBulkDelete={() => softDelete.requestBulkDelete(selectedTargets)}
          disabled={softDelete.busy}
        />
        <AdminResponsiveTable mobileStrategy="card"
          columns={columns}
          data={requests}
          isLoading={loading}
          keyExtractor={(req) => req.id}
          emptyMessage="조건에 맞는 접수가 없습니다."
          onRowClick={(req) => setExpandedId(expandedId === req.id ? null : req.id)}
          expandedRowIds={expandedId ? new Set([expandedId]) : new Set()}
          expandedRowRender={(req) => (
            <div style={{ padding: "var(--admin-space-16)", background: "var(--admin-focus)" }}>
              <FeedbackDetail req={req} onUpdate={(status, note) => handleUpdate(req.id, status, note)} />
            </div>
          )}
        />
      </div>

      {softDelete.modals}
    </div>
  );
}

function FeedbackDetail({ req, onUpdate }: { req: any; onUpdate: (status: string, note: string) => void }) {
  const [status, setStatus] = useState(req.status || "open");
  const [note, setNote] = useState(req.admin_note || "");

  return (
    <div style={{ display: "flex", gap: "var(--admin-space-24)", fontSize: "var(--admin-text-sm)", color: "var(--admin-text-primary)" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--admin-space-8)" }}>
        <div><b style={{ fontWeight: "var(--admin-weight-bold)" }}>접수 화면:</b> {req.current_route || "-"}</div>
        <div><b style={{ fontWeight: "var(--admin-weight-bold)" }}>환경:</b> {req.environment || "-"} / <b style={{ fontWeight: "var(--admin-weight-bold)" }}>앱 버전:</b> {req.app_version || "-"}</div>
        <div><b style={{ fontWeight: "var(--admin-weight-bold)" }}>기기 정보:</b> {req.device_info ? JSON.stringify(req.device_info) : "-"}</div>
        <div><b style={{ fontWeight: "var(--admin-weight-bold)" }}>접수자 ID:</b> {req.user_id}</div>
        <div><b style={{ fontWeight: "var(--admin-weight-bold)" }}>아이 ID:</b> {req.child_id || "없음"}</div>
        <div><b style={{ fontWeight: "var(--admin-weight-bold)" }}>보호자 ID:</b> {req.guardian_id || "없음"}</div>
        
        <div style={{ marginTop: "var(--admin-space-8)", padding: "var(--admin-space-12)", background: "var(--admin-bg)", borderRadius: 8, border: "1px solid var(--admin-border)" }}>
          <div style={{ fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-4)" }}>제목: {req.subject}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{req.body}</div>
        </div>

        {req.attachments && req.attachments.filter((a: any) => a.upload_status === "uploaded").length > 0 && (
          <div style={{ marginTop: "var(--admin-space-8)", padding: "var(--admin-space-12)", background: "var(--admin-bg)", borderRadius: 8, border: "1px solid var(--admin-border)" }}>
            <div style={{ fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-8)" }}>첨부 이미지</div>
            <div style={{ display: "flex", gap: "var(--admin-space-12)", overflowX: "auto" }}>
              {req.attachments.filter((a: any) => a.upload_status === "uploaded").map((a: any, idx: number) => {
                const downloadName = `FB-${(req.request_number || 'UNKNOWN').replace('REQ-', '')}-${idx + 1}.${a.stored_filename.split('.').pop()}`;
                const downloadUrl = `${a.signed_url}&download=${downloadName}`;
                return (
                  <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: "var(--admin-space-4)", minWidth: 100 }}>
                    <a href={a.signed_url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                      <img src={a.signed_url} alt={a.original_filename} style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8, border: "1px solid var(--admin-border)" }} />
                    </a>
                    <a href={downloadUrl} download={downloadName} style={{ fontSize: "var(--admin-text-xs)", color: "var(--admin-primary)", textAlign: "center", textDecoration: "underline" }}>다운로드</a>
                    <div style={{ fontSize: 10, color: "var(--admin-text-secondary)", textAlign: "center" }}>
                      {a.mime_type.split('/')[1]?.toUpperCase()} • {(a.file_size / 1024).toFixed(1)} KB
                      {a.width && a.height ? ` • ${a.width}x${a.height}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: "var(--admin-space-12)" }}>
        <div>
          <div style={{ fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-4)" }}>상태 변경</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: "var(--admin-space-6) var(--admin-space-10)", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-sm)", background: "var(--admin-bg)", color: "var(--admin-text-primary)" }}>
            <option value="open">접수됨 (open)</option>
            <option value="in_progress">확인 중 (in_progress)</option>
            <option value="resolved">처리 완료 (resolved)</option>
            <option value="closed">종료 (closed)</option>
          </select>
        </div>
        <div>
          <div style={{ fontWeight: "var(--admin-weight-bold)", marginBottom: "var(--admin-space-4)" }}>관리자 메모</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%", height: 100, padding: "var(--admin-space-8)", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: "var(--admin-text-sm)", background: "var(--admin-bg)", color: "var(--admin-text-primary)", resize: "none" }}
            placeholder="내부 처리 메모를 남기세요."
          />
        </div>
        <button
          onClick={() => onUpdate(status, note)}
          style={{ width: "100%", padding: "var(--admin-space-8)", borderRadius: 8, border: "none", background: "var(--admin-primary)", color: "white", fontWeight: "var(--admin-weight-bold)", cursor: "pointer" }}
        >
          저장하기
        </button>
      </div>
    </div>
  );
}
