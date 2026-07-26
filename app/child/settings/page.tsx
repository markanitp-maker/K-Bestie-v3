"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { LIVE_VOICE_OPTIONS } from "@/lib/plan/liveVoices";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { clearStore } from "@/lib/store";
import KChatbotWidget from "@/components/KChatbotWidget";

export default function ChildSettingsPage() {
  const router = useRouter();
  const [childId, setChildId] = useState<string | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  // 실제 저장된 목소리(서버 기준 진실값). 새로고침/재로그인 시 /api/child/me에서 복원한다.
  const [liveVoiceName, setLiveVoiceName] = useState<string>("Achernar");
  // 임시 선택 상태 — 버튼을 눌러도 저장은 하지 않고 이 값만 바뀐다. 저장 성공 시 liveVoiceName에 반영.
  const [draftVoice, setDraftVoice] = useState<string | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // 저장 결과 안내(성공/실패) — 저장 성공/실패 응답을 확인한 뒤에만 채운다.
  const [voiceFeedback, setVoiceFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { installPrompt, isIOS, isStandalone, handleInstall } = useInstallPrompt();
  // 안드로이드/크롬 설치 프롬프트 결과에 따른 UI 상태(수락/거부)
  const [installState, setInstallState] = useState<"idle" | "accepted" | "dismissed">("idle");

  const onInstallClick = async () => {
    const outcome = await handleInstall();
    if (outcome === "accepted") {
      setInstallState("accepted");
    } else if (outcome === "dismissed") {
      setInstallState("dismissed");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/child/me");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setChildId(data.id ?? null);
        setTier(typeof data.tier === "number" ? data.tier : null);
        if (typeof data.live_voice_name === "string" && data.live_voice_name) {
          setLiveVoiceName(data.live_voice_name);
        }
      } catch {
        // 조회 실패 시 목소리 설정 UI는 노출하지 않음(tier가 null로 남아 자동으로 숨겨짐)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 현재 UI에서 "선택된" 목소리 — 임시 선택(draft)이 있으면 그것을, 없으면 저장값을 보여준다.
  const selectedVoice = draftVoice ?? liveVoiceName;
  // 저장 버튼 활성 조건: 임시 선택이 있고, 그게 이미 저장된 값과 다를 때만.
  const canSave = draftVoice !== null && draftVoice !== liveVoiceName;

  const handlePickVoice = (name: string) => {
    // 저장이 아니라 임시 선택만 변경. 이전 저장 안내는 지운다.
    setDraftVoice(name);
    setVoiceFeedback(null);
  };

  const handleSaveVoice = async () => {
    if (!childId || draftVoice === null || draftVoice === liveVoiceName) return;
    setSavingVoice(true);
    const target = draftVoice;
    try {
      const res = await fetch(`/api/child/${childId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveVoiceName: target }),
      });
      if (res.ok) {
        // DB 저장 응답이 성공한 뒤에만 저장값을 갱신하고 성공 안내를 띄운다.
        setLiveVoiceName(target);
        setDraftVoice(null);
        setVoiceFeedback({ type: "success", text: "케이 목소리가 저장되었습니다. 다음 대화부터 적용됩니다." });
      } else {
        // 저장 실패 — 기존 저장값(선택 상태)을 그대로 유지하고 오류만 안내한다.
        setDraftVoice(null);
        setVoiceFeedback({ type: "error", text: "목소리를 저장하지 못했어. 잠시 후 다시 시도해줘." });
      }
    } catch {
      setDraftVoice(null);
      setVoiceFeedback({ type: "error", text: "목소리를 저장하지 못했어. 잠시 후 다시 시도해줘." });
    } finally {
      setSavingVoice(false);
      setShowConfirm(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    // 공용 기기 위생: 사용자 고유 상태(세션·store·대화 캐시)는 지우되
    // 공유 자산(매니페스트/아이콘/오프라인 셸 = kbestie-shell- 캐시)은 보존한다.
    clearStore();
    router.push("/login");
  };

  return (
    <DemoFrame>
      <div className="relative h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "var(--color-k-surface)" }}
        >
          <Link href="/child/home" className="font-bold text-sm cursor-pointer" style={{ color: "var(--color-k-navy)" }}>
            설정
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {tier === 3 && (
            <div className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: "#f3f4f6" }}
                >
                  🔊
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                    케이 목소리
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                    미션에서 케이가 말할 목소리를 골라보세요
                  </p>
                </div>
              </div>

              {(["female", "male"] as const).map((gender) => (
                <div key={gender} className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-bold" style={{ color: "#9ca3af" }}>
                    {gender === "female" ? "여자" : "남자"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {LIVE_VOICE_OPTIONS.filter((v) => v.gender === gender).map((v) => (
                      <button
                        key={v.name}
                        onClick={() => handlePickVoice(v.name)}
                        disabled={savingVoice}
                        className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors"
                        style={
                          selectedVoice === v.name
                            ? { background: "var(--color-k-navy)", color: "#ffffff" }
                            : { background: "#f3f4f6", color: "var(--color-k-text-primary)" }
                        }
                      >
                        {v.name} ({v.label})
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <button
                onClick={() => { setVoiceFeedback(null); setShowConfirm(true); }}
                disabled={!canSave || savingVoice}
                className="mt-1 px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                style={{ background: "var(--color-k-navy)", color: "#ffffff" }}
              >
                선택한 목소리 저장하기
              </button>

              {voiceFeedback && (
                <p
                  className="text-[12px] font-bold text-center"
                  style={{ color: voiceFeedback.type === "success" ? "var(--color-k-navy)" : "#dc2626" }}
                >
                  {voiceFeedback.text}
                </p>
              )}
            </div>
          )}

          {/* 내친구 케이 설치하기 카드 */}
          <div className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
              style={{ background: "#f3f4f6" }}
            >
              📱
            </div>
            {isStandalone || installState === "accepted" ? (
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                  설치됐어요!
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                  홈 화면에서 케이를 바로 만나요
                </p>
              </div>
            ) : isIOS ? (
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                  내친구 케이 설치하기
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                  공유 버튼을 누르고 '홈 화면에 추가'를 눌러줘
                </p>
              </div>
            ) : (
              <>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                    내친구 케이 설치하기
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                    {installState === "dismissed"
                      ? "괜찮아! 나중에 언제든 설치할 수 있어"
                      : "홈 화면에 케이를 두고 더 쉽게 만나요"}
                  </p>
                </div>
                {installPrompt && (
                  <button
                    onClick={onInstallClick}
                    className="px-3 py-1.5 bg-[var(--color-k-navy)] text-white text-xs font-bold rounded-lg shrink-0 active:scale-95 transition-transform cursor-pointer"
                  >
                    설치하기
                  </button>
                )}
              </>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-center gap-3 cursor-pointer active:opacity-85 transition-opacity w-full text-left"
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
              style={{ background: "#f3f4f6" }}
            >
              🚪
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: "var(--color-k-text-primary)" }}>
                로그아웃
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                다음에 또 만나요
              </p>
            </div>
            <span className="text-sm" style={{ color: "#6b7280" }}>
              →
            </span>
          </button>
        </div>

        {showConfirm && draftVoice && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-6"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => { if (!savingVoice) setShowConfirm(false); }}
          >
            <div
              className="bg-white rounded-2xl px-5 py-5 w-full max-w-xs flex flex-col gap-4 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-bold text-center" style={{ color: "var(--color-k-text-primary)" }}>
                {draftVoice} 목소리로 저장하시겠습니까?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={savingVoice}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 transition-opacity"
                  style={{ background: "#f3f4f6", color: "var(--color-k-text-primary)" }}
                >
                  취소
                </button>
                <button
                  onClick={handleSaveVoice}
                  disabled={savingVoice}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 transition-opacity"
                  style={{ background: "var(--color-k-navy)", color: "#ffffff" }}
                >
                  {savingVoice ? "저장 중…" : "저장"}
                </button>
              </div>
            </div>
          </div>
        )}

        <RealChildNav active="설정" />
      </div>
    
        <KChatbotWidget appSurface="child" />
      </DemoFrame>
  );
}
