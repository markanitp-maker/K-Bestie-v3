"use client";

import { useState, useEffect } from "react";
import { AdminPageHeader } from "@/components/admin/shell/AdminPageHeader";

type PushSubscriptionStatus = "알림 등록됨" | "구독 없음" | "권한 거부" | "구독 만료 또는 해제됨";

type PushTestChild = {
  id: string;
  name: string | null;
  username: string;
  grade: string | null;
  parentEmail: string;
  isTest: true;
  pushSubscriptionStatus: PushSubscriptionStatus;
};

type PushTestResponse = {
  childName?: string | null;
  code?: string;
  error?: string;
  successfulSubscriptions?: number;
  failedSubscriptions?: number;
};

const providerErrorMessage = (code: string | undefined) => {
  const messages: Record<string, string> = {
    PUSH_401: "푸시 인증 설정을 확인해 주세요.",
    PUSH_403: "푸시 인증 설정이 구독 정보와 일치하지 않습니다.",
    PUSH_410: "푸시 구독이 만료되었습니다. QA 기기에서 알림을 다시 등록해 주세요.",
    NO_SUBSCRIPTION: "활성 푸시 구독이 없습니다.",
  };
  return code && messages[code] ? `${code}\n${messages[code]}` : "요청을 처리하지 못했습니다.";
};

export default function PushTestTab() {
  const [childId, setChildId] = useState("");
  const [selectedChildInfo, setSelectedChildInfo] = useState<Pick<PushTestChild, "name" | "username" | "pushSubscriptionStatus"> | null>(null);
  
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState<number | null>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PushTestChild[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const hasActiveSubscription = selectedChildInfo?.pushSubscriptionStatus === "알림 등록됨";

  useEffect(() => {
    if (!isModalOpen) return;
    
    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/admin/push-test/children-search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json() as { children?: PushTestChild[] };
        if (res.ok) {
          setSearchResults(data.children || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery, isModalOpen]);
  
  const handleTest = async (missionType: 1 | 2) => {
    if (!childId.trim()) {
      alert("아이를 선택하세요.");
      return;
    }
    
    setLoading(missionType);
    setStatus("발송 중...");
    try {
      const res = await fetch("/api/admin/push-test/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: childId.trim(), missionType }),
      });
      const data = await res.json() as PushTestResponse;
      if (res.ok) {
        setStatus(`발송 성공\n아이: ${data.childName || selectedChildInfo?.name || "이름 미등록"}\n미션: ${missionType}\n성공 구독: ${data.successfulSubscriptions ?? 0}\n실패 구독: ${data.failedSubscriptions ?? 0}`);
      } else {
        setStatus(`발송 실패\n${providerErrorMessage(data.code)}`);
      }
    } catch (error: unknown) {
      setStatus(`오류: ${error instanceof Error ? error.message : "요청을 처리하지 못했습니다."}`);
    } finally {
      setLoading(null);
    }
  };

  const handleSelectChild = (child: PushTestChild) => {
    setChildId(child.id);
    setSelectedChildInfo({ name: child.name, username: child.username, pushSubscriptionStatus: child.pushSubscriptionStatus });
    setIsModalOpen(false);
  };

  return (
    <div>
      <AdminPageHeader title="미션 푸시 발송 테스트" description="특정 아이에게 미션 1/2 시작 푸시 알림을 즉시 발송합니다." />
      
      <div style={{ background: "var(--admin-surface)", padding: 24, borderRadius: 12, border: "1px solid var(--admin-border)", maxWidth: 600 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--admin-text-secondary)", marginBottom: 8 }}>
            테스트 대상 아이
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--admin-border)", fontSize: 14, background: "var(--admin-bg)" }}>
              {selectedChildInfo ? `선택된 아이: ${selectedChildInfo.name || "이름 미등록"} (${selectedChildInfo.username}) · ${selectedChildInfo.pushSubscriptionStatus}` : "선택 안 됨"}
            </div>
            <button 
              onClick={() => {
                setIsModalOpen(true);
                setSearchQuery("");
                setSearchResults([]);
              }}
              style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "var(--admin-primary)", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              아이 검색
            </button>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <button 
            onClick={() => handleTest(1)}
            disabled={loading !== null || !childId || !hasActiveSubscription}
            style={{ 
              flex: 1,
              padding: "12px", 
              background: "var(--admin-primary)", 
              color: "white", 
              borderRadius: 8, 
              border: "none",
              fontWeight: 700,
              cursor: (loading !== null || !childId || !hasActiveSubscription) ? "not-allowed" : "pointer",
              opacity: (loading !== null || !childId || !hasActiveSubscription) ? 0.7 : 1
            }}
          >
            {loading === 1 ? "발송 중..." : "미션 1 즉시 발송"}
          </button>
          <button 
            onClick={() => handleTest(2)}
            disabled={loading !== null || !childId || !hasActiveSubscription}
            style={{ 
              flex: 1,
              padding: "12px", 
              background: "var(--admin-focus)", 
              color: "var(--admin-primary)", 
              borderRadius: 8, 
              border: "1px solid var(--admin-primary)",
              fontWeight: 700,
              cursor: (loading !== null || !childId || !hasActiveSubscription) ? "not-allowed" : "pointer",
              opacity: (loading !== null || !childId || !hasActiveSubscription) ? 0.7 : 1
            }}
          >
            {loading === 2 ? "발송 중..." : "미션 2 즉시 발송"}
          </button>
        </div>

        {selectedChildInfo && !hasActiveSubscription && (
          <p style={{ margin: "-12px 0 16px", fontSize: 12, color: "var(--admin-danger, #b91c1c)" }}>
            활성 푸시 구독이 없어 발송할 수 없습니다. QA 기기에서 알림을 다시 등록해 주세요.
          </p>
        )}
        
        {status && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--admin-text-secondary)", marginBottom: 8 }}>
              실행 결과
            </div>
            <pre style={{ 
              background: "var(--admin-bg)", 
              padding: 16, 
              borderRadius: 8, 
              fontSize: 12,
              border: "1px solid var(--admin-border)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all"
            }}>
              {status}
            </pre>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setIsModalOpen(false)} />
          <div style={{ position: "relative", width: 500, background: "var(--admin-surface)", borderRadius: 12, padding: 24, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>푸시 테스트 대상 선택</h3>
            <input 
              placeholder="이름 또는 아이디 검색" 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--admin-border)", fontSize: "14px", marginBottom: 16, outline: "none", width: "100%", boxSizing: "border-box" }}
            />
            
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--admin-border)", borderRadius: "6px", background: "var(--admin-bg)", minHeight: 200 }}>
              {isSearching ? (
                <div style={{ padding: 16, textAlign: "center", color: "var(--admin-text-secondary)", fontSize: 13 }}>검색 중...</div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "var(--admin-text-secondary)", fontSize: 13 }}>결과가 없습니다.</div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {searchResults.map((child) => (
                    <li 
                      key={child.id}
                      onClick={() => handleSelectChild(child)}
                      style={{ 
                        padding: "12px 16px", 
                        borderBottom: "1px solid var(--admin-border)", 
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "var(--admin-surface)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{child.name || "이름없음"} <span style={{ color: "var(--admin-text-secondary)", fontSize: 13 }}>({child.username || "아이디없음"})</span> <span style={{ color: "var(--admin-primary)", fontSize: 12 }}>[테스트]</span></span>
                        <span style={{ fontSize: 12, background: "var(--admin-border)", padding: "2px 6px", borderRadius: 4 }}>{child.grade || "학년미상"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--admin-text-secondary)" }}>
                        부모 계정: {child.parentEmail || "알 수 없음"} · 푸시: {child.pushSubscriptionStatus}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button 
                type="button" 
                onClick={() => setIsModalOpen(false)} 
                style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--admin-border)", background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
