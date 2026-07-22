"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CONVERSATION_MODES, MODE_LABELS, type ConversationMode } from "@/lib/plan/conversationMode";

// A~E 대화방식 테스트 선택 UI (Plan01 §6). 테스트 계정(is_test_account=true)에만 노출.
// 서버 게이팅: /api/child/test-mode 가 403이면 일반 계정 → 접근 차단 화면.
// 선택값은 서버 override로 저장(tier 무변경) → 새로고침해도 유지, '테스트 종료' 시 제거.
export default function TestModesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ok" | "denied">("loading");
  const [selected, setSelected] = useState<ConversationMode | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/child/test-mode")
      .then(async (r) => {
        if (r.status === 200) {
          const d = await r.json();
          setSelected(d.selectedMode ?? null);
          setStatus("ok");
        } else {
          setStatus("denied");
        }
      })
      .catch(() => setStatus("denied"));
  }, []);

  const selectMode = async (mode: ConversationMode) => {
    setSaving(true);
    try {
      const res = await fetch("/api/child/test-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const d = await res.json();
        setSelected(d.selectedMode ?? null);
      }
    } finally {
      setSaving(false);
    }
  };

  const endTest = async () => {
    setSaving(true);
    try {
      await fetch("/api/child/test-mode", { method: "DELETE" });
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>불러오는 중…</div>;
  }

  if (status === "denied") {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ fontSize: 40, marginBottom: 12 }}>🔒</p>
        <p style={{ fontWeight: 700, color: "#1e1e2d" }}>접근 권한이 없어요</p>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>이 화면은 테스트 계정에서만 사용할 수 있어요.</p>
        <button
          onClick={() => router.replace("/child/home")}
          style={{ marginTop: 20, padding: "10px 18px", borderRadius: 12, border: "none", background: "#1a6b5a", color: "white", fontWeight: 700, cursor: "pointer" }}
        >
          홈으로
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px" }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1e1e2d", marginBottom: 4 }}>대화 방식 테스트 (A~E)</h1>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
        테스트 계정 전용 · 선택한 방식은 요금제(tier)를 바꾸지 않는 테스트 세션 설정으로만 저장돼요.
      </p>
      <p style={{ fontSize: 12, color: "#1a6b5a", fontWeight: 700, marginBottom: 16 }}>
        현재 선택: {selected ? `${selected}안 — ${MODE_LABELS[selected]}` : "없음"}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {CONVERSATION_MODES.map((m) => {
          const active = selected === m;
          return (
            <button
              key={m}
              disabled={saving}
              onClick={() => selectMode(m)}
              style={{
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: 14,
                border: active ? "2px solid #1a6b5a" : "1px solid #e5e7eb",
                background: active ? "rgba(26,107,90,0.08)" : "white",
                cursor: saving ? "wait" : "pointer",
              }}
            >
              <span style={{ fontWeight: 800, color: "#1a6b5a", marginRight: 8 }}>{m}안</span>
              <span style={{ fontSize: 13, color: "#1e1e2d" }}>{MODE_LABELS[m]}</span>
              {active && <span style={{ float: "right", color: "#1a6b5a", fontWeight: 700 }}>✓ 선택됨</span>}
            </button>
          );
        })}
      </div>

      {(selected === "C" || selected === "D" || selected === "E") && (
        <button
          onClick={() => router.push("/child/missions")}
          style={{ marginTop: 16, width: "100%", padding: "13px", borderRadius: 12, border: "none", background: "#1a6b5a", color: "white", fontWeight: 800, cursor: "pointer" }}
        >
          {selected}안으로 미션 시작 →
        </button>
      )}
      {(selected === "A" || selected === "B") && (
        <p style={{ marginTop: 16, fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
          {selected}안 실행은 준비 중이에요. (현재 C·D·E안만 실행 가능, A·B안은 준비 중)
        </p>
      )}

      <button
        onClick={endTest}
        disabled={saving || !selected}
        style={{
          marginTop: 20,
          width: "100%",
          padding: "12px",
          borderRadius: 12,
          border: "1px solid #dc2626",
          background: "white",
          color: "#dc2626",
          fontWeight: 700,
          cursor: saving || !selected ? "not-allowed" : "pointer",
          opacity: saving || !selected ? 0.5 : 1,
        }}
      >
        테스트 종료 (선택 해제)
      </button>

      <button
        onClick={() => router.replace("/child/home")}
        style={{ marginTop: 10, width: "100%", padding: "12px", borderRadius: 12, border: "none", background: "#f3f4f6", color: "#374151", fontWeight: 700, cursor: "pointer" }}
      >
        홈으로
      </button>
    </div>
  );
}
