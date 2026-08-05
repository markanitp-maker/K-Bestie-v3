"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { SoftDeleteResource } from "@/lib/admin/softDeleteService";

/**
 * 관리자 운영 요청 데이터 소프트 삭제 공통 UI (requests/066)
 *
 * 각 관리자 탭이 삭제 버튼/모달/다중 선택을 매번 새로 짜지 않도록 한 곳에 모았다.
 * 실제 삭제는 항상 서버(/api/admin/trash/delete)에서 화이트리스트 검증을 거치며,
 * 이 컴포넌트는 화면 흐름만 담당한다.
 *
 * 제외 대상(부모·아이·가족 계정, 대화·미션·리포트·원장 등)에는 이 컴포넌트를
 * 붙이지 않는다 — 붙이더라도 서버가 리소스를 거부한다.
 */

/** 일괄 삭제 최종 확인에 정확히 입력해야 하는 문구. */
export const BULK_DELETE_CONFIRM_PHRASE = "운영 요청 데이터를 삭제합니다";

export interface SoftDeleteTarget {
  id: string;
  /** 모달에 표시할 식별 정보(사용자/요청 식별). */
  identity: string;
  /** 모달에 표시할 제목 또는 대표 내용. */
  summary?: string | null;
  /** 현재 상태. */
  status?: string | null;
}

export interface SoftDeleteOperationResult {
  requested: number;
  deletedCount: number;
  skippedCount: number;
  failedIds: string[];
  error?: string;
}

const dangerButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #dc2626",
  background: "#fff",
  color: "#dc2626",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

/** 목록 행에 쓰는 위험 동작 스타일 삭제 버튼(아이콘 단독이 아니라 텍스트 포함). */
export function SoftDeleteButton({
  onClick,
  disabled,
  label = "삭제",
}: {
  onClick: (event: React.MouseEvent) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ ...dangerButtonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {label}
    </button>
  );
}

export interface UseAdminSoftDelete {
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  toggleSelected: (id: string) => void;
  setPageSelection: (ids: string[], checked: boolean) => void;
  clearSelection: () => void;
  requestDelete: (target: SoftDeleteTarget) => void;
  requestBulkDelete: (targets: SoftDeleteTarget[]) => void;
  busy: boolean;
  lastResult: SoftDeleteOperationResult | null;
  dismissResult: () => void;
  /** 화면에 그대로 렌더링하면 되는 확인 모달 + 결과 패널. */
  modals: React.ReactNode;
}

/**
 * @param resource 화이트리스트 리소스 키(서버에서 다시 검증한다).
 * @param resourceLabel 모달에 표시할 대상 유형(예: "베타 신청").
 * @param onCompleted 삭제 성공 후 목록 새로고침 콜백.
 * @param filterSummary 일괄 삭제 모달에 표시할 현재 필터 조건 설명.
 */
export function useAdminSoftDelete(
  resource: SoftDeleteResource,
  resourceLabel: string,
  onCompleted: () => void,
  filterSummary?: string
): UseAdminSoftDelete {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [singleTarget, setSingleTarget] = useState<SoftDeleteTarget | null>(null);
  const [bulkTargets, setBulkTargets] = useState<SoftDeleteTarget[] | null>(null);
  const [reason, setReason] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SoftDeleteOperationResult | null>(null);

  const closeModals = useCallback(() => {
    setSingleTarget(null);
    setBulkTargets(null);
    setReason("");
    setConfirmPhrase("");
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setPageSelection = useCallback((ids: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const runDelete = useCallback(
    async (targets: SoftDeleteTarget[]) => {
      // 중복 클릭 방지 — busy 동안에는 재실행하지 않는다.
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch("/api/admin/trash/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource, ids: targets.map((t) => t.id), reason: reason.trim() }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setLastResult({
            requested: targets.length,
            deletedCount: 0,
            skippedCount: 0,
            failedIds: targets.map((t) => t.id),
            error: data.error || "삭제에 실패했습니다.",
          });
          return;
        }

        setLastResult({
          requested: data.requested ?? targets.length,
          deletedCount: data.deletedCount ?? 0,
          skippedCount: data.skippedCount ?? 0,
          failedIds: (data.failed ?? []).map((f: { id: string }) => f.id),
        });
        setSelected(new Set());
        closeModals();
        onCompleted();
      } catch {
        setLastResult({
          requested: targets.length,
          deletedCount: 0,
          skippedCount: 0,
          failedIds: targets.map((t) => t.id),
          error: "네트워크 오류가 발생했습니다.",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, closeModals, onCompleted, reason, resource]
  );

  const activeTargets = useMemo(
    () => (singleTarget ? [singleTarget] : (bulkTargets ?? [])),
    [singleTarget, bulkTargets]
  );

  const reasonValid = reason.trim().length > 0;
  const bulkPhraseValid = confirmPhrase.trim() === BULK_DELETE_CONFIRM_PHRASE;

  const modals = (
    <>
      {singleTarget && (
        <ModalShell title={`${resourceLabel} 삭제`} onClose={busy ? undefined : closeModals}>
          <div style={infoBoxStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>삭제 대상 유형: {resourceLabel}</div>
            <div>식별 정보: {singleTarget.identity}</div>
            {singleTarget.summary && <div>내용: {singleTarget.summary}</div>}
            <div>현재 상태: {singleTarget.status || "-"}</div>
          </div>
          <p style={noticeStyle}>
            삭제 후 일반 목록에서는 보이지 않으며, 30일 동안 휴지통에서 복구할 수 있습니다.
          </p>
          <ReasonField value={reason} onChange={setReason} disabled={busy} />
          <ModalActions
            onCancel={closeModals}
            onConfirm={() => runDelete([singleTarget])}
            confirmLabel={busy ? "삭제 중..." : "삭제 실행"}
            confirmDisabled={!reasonValid || busy}
            busy={busy}
          />
        </ModalShell>
      )}

      {bulkTargets && (
        <ModalShell title={`${resourceLabel} 일괄 삭제`} onClose={busy ? undefined : closeModals}>
          <div style={infoBoxStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>전체 삭제 예정 건수: {bulkTargets.length}건</div>
            <div>
              유형별 건수: {resourceLabel} {bulkTargets.length}건
            </div>
            <div>현재 필터 조건: {filterSummary || "필터 없음(전체)"}</div>
            <div>복구 가능 기간: 삭제 후 30일</div>
          </div>
          <p style={noticeStyle}>
            부모·아이·가족 계정, 대화·미션·리포트·황금열쇠/결제 원장 등 제외 대상 데이터는 삭제되지 않습니다.
            삭제 후 일반 목록에서는 보이지 않으며, 30일 동안 휴지통에서 복구할 수 있습니다.
          </p>
          <ReasonField value={reason} onChange={setReason} disabled={busy} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              확인 문구 입력 (필수) — <code>{BULK_DELETE_CONFIRM_PHRASE}</code>
            </label>
            <input
              type="text"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={BULK_DELETE_CONFIRM_PHRASE}
              disabled={busy}
              style={inputStyle}
            />
          </div>
          <ModalActions
            onCancel={closeModals}
            onConfirm={() => runDelete(bulkTargets)}
            confirmLabel={busy ? "삭제 중..." : `${bulkTargets.length}건 삭제 실행`}
            confirmDisabled={!reasonValid || !bulkPhraseValid || busy}
            busy={busy}
          />
        </ModalShell>
      )}

      {lastResult && (
        <ModalShell title="일괄 작업 결과" onClose={() => setLastResult(null)}>
          {lastResult.error ? (
            <div style={{ ...infoBoxStyle, background: "#fef2f2", color: "#991b1b" }}>{lastResult.error}</div>
          ) : (
            <div style={infoBoxStyle}>
              <div>요청: {lastResult.requested}건</div>
              <div style={{ fontWeight: 700 }}>삭제 성공: {lastResult.deletedCount}건</div>
              <div>
                건너뜀(이미 삭제됨/대상 없음): {lastResult.skippedCount}건
              </div>
              <div>실패: {lastResult.failedIds.length}건</div>
            </div>
          )}
          {lastResult.failedIds.length > 0 && (
            <>
              <p style={noticeStyle}>실패한 항목만 다시 시도할 수 있습니다.</p>
              <ModalActions
                onCancel={() => setLastResult(null)}
                onConfirm={() => {
                  const retryTargets = activeTargets.filter((t) => lastResult.failedIds.includes(t.id));
                  setLastResult(null);
                  if (retryTargets.length === 1) setSingleTarget(retryTargets[0]);
                  else if (retryTargets.length > 1) setBulkTargets(retryTargets);
                }}
                confirmLabel="실패 건 재시도"
                confirmDisabled={busy}
                busy={busy}
              />
            </>
          )}
          {lastResult.failedIds.length === 0 && (
            <button type="button" onClick={() => setLastResult(null)} style={primaryButtonStyle}>
              확인
            </button>
          )}
        </ModalShell>
      )}
    </>
  );

  return {
    selectedIds: Array.from(selected),
    isSelected,
    toggleSelected,
    setPageSelection,
    clearSelection,
    requestDelete: (target) => {
      setReason("");
      setBulkTargets(null);
      setSingleTarget(target);
    },
    requestBulkDelete: (targets) => {
      if (targets.length === 0) return;
      setReason("");
      setConfirmPhrase("");
      setSingleTarget(null);
      setBulkTargets(targets);
    },
    busy,
    lastResult,
    dismissResult: () => setLastResult(null),
    modals,
  };
}

/** 목록 위에 붙이는 선택 건수 + 선택 삭제 바. */
export function SoftDeleteSelectionBar({
  selectedCount,
  totalCount,
  allSelected,
  onSelectAll,
  onClear,
  onBulkDelete,
  disabled,
}: {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
  onClear: () => void;
  onBulkDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--admin-border)",
        background: "var(--admin-surface)",
        marginBottom: 12,
        fontSize: 13,
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={allSelected && totalCount > 0}
          onChange={(e) => onSelectAll(e.target.checked)}
          disabled={disabled || totalCount === 0}
        />
        현재 목록 전체 선택 ({totalCount}건)
      </label>
      <span style={{ fontWeight: 700 }}>선택 {selectedCount}건</span>
      {selectedCount > 0 && (
        <button type="button" onClick={onClear} style={{ ...dangerButtonStyle, border: "1px solid var(--admin-border)", color: "var(--admin-text-secondary)" }}>
          선택 해제
        </button>
      )}
      <button
        type="button"
        onClick={onBulkDelete}
        disabled={disabled || selectedCount === 0}
        style={{
          ...dangerButtonStyle,
          background: selectedCount === 0 ? "#f3f4f6" : "#dc2626",
          color: selectedCount === 0 ? "#9ca3af" : "#fff",
          border: "none",
          cursor: selectedCount === 0 ? "not-allowed" : "pointer",
        }}
      >
        선택 삭제
      </button>
    </div>
  );
}

/** 행 체크박스. */
export function SoftDeleteRowCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
    />
  );
}

// ── 내부 프리미티브 ────────────────────────────────────────────────────────

const infoBoxStyle: React.CSSProperties = {
  background: "#fef2f2",
  color: "#7f1d1d",
  padding: 12,
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 12,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const noticeStyle: React.CSSProperties = { fontSize: 13, color: "#4b5563", marginBottom: 12, lineHeight: 1.5 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "none",
  background: "var(--admin-primary)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      aria-modal="true"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#dc2626", marginBottom: 16 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ReasonField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
      <label style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>삭제 사유 (필수)</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="삭제 사유를 입력하세요"
        disabled={disabled}
        autoFocus
        style={inputStyle}
      />
    </div>
  );
}

function ModalActions({
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: "#f3f4f6", color: "#374151", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" }}
      >
        취소
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          flex: 1,
          padding: 12,
          borderRadius: 12,
          border: "none",
          background: "#dc2626",
          color: "#fff",
          fontWeight: 700,
          opacity: confirmDisabled ? 0.5 : 1,
          cursor: confirmDisabled ? "not-allowed" : "pointer",
        }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
