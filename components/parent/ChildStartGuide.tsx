"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { clearStore } from "@/lib/store";

export type ChildStartGuideChild = {
  id: string;
  name: string;
  grade?: string | null;
};

type ChildStartGuideProps = {
  children?: ChildStartGuideChild[];
  initialChildId?: string | null;
  onParentHome?: () => void;
  showParentHome?: boolean;
};

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function ChildStartGuide({
  children: providedChildren,
  initialChildId = null,
  onParentHome,
  showParentHome = true,
}: ChildStartGuideProps) {
  const [availableChildren, setAvailableChildren] = useState<ChildStartGuideChild[]>(providedChildren ?? []);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(initialChildId);
  const [username, setUsername] = useState<string | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(providedChildren === undefined);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"address" | "username" | null>(null);
  const [startingChild, setStartingChild] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin.replace("//0.0.0.0", "//localhost"));
  }, []);

  useEffect(() => {
    if (providedChildren !== undefined) {
      setAvailableChildren(providedChildren);
      setLoadingChildren(false);
    }
  }, [providedChildren]);

  useEffect(() => {
    if (providedChildren !== undefined) return;
    let cancelled = false;
    setLoadingChildren(true);
    fetch("/api/parent/children", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "아이 정보를 불러오지 못했습니다.");
        if (!cancelled) setAvailableChildren(data.children ?? []);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingChildren(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providedChildren]);

  useEffect(() => {
    if (initialChildId) {
      setSelectedChildId(initialChildId);
      return;
    }
    if (availableChildren.length === 1) setSelectedChildId(availableChildren[0].id);
  }, [availableChildren, initialChildId]);

  const selectedChild = availableChildren.find((child) => child.id === selectedChildId) ?? null;

  useEffect(() => {
    if (!selectedChildId) {
      setUsername(null);
      return;
    }
    let cancelled = false;
    setLoadingAccount(true);
    setUsername(null);
    setError(null);
    fetch(`/api/child/${encodeURIComponent(selectedChildId)}/account`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "아이 로그인 정보를 불러오지 못했습니다.");
        if (!cancelled) setUsername(data.username ?? null);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingAccount(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChildId]);

  const childLoginUrl = useMemo(() => {
    if (!origin || !username) return "";
    const url = new URL("/login", origin);
    url.searchParams.set("role", "child");
    url.searchParams.set("login_id", username);
    return url.toString();
  }, [origin, username]);

  useEffect(() => {
    if (!childLoginUrl || !qrCanvasRef.current) return;
    void QRCode.toCanvas(qrCanvasRef.current, childLoginUrl, {
      width: 184,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#10315B", light: "#FFFFFF" },
    }).catch(() => setError("QR 코드를 만들지 못했습니다. 웹주소로 접속해 주세요."));
  }, [childLoginUrl]);

  const handleCopy = async (kind: "address" | "username", value: string) => {
    try {
      await copyText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.");
    }
  };

  const handleStartOnThisDevice = async () => {
    if (!childLoginUrl) return;
    setStartingChild(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      clearStore();
      window.location.replace(childLoginUrl);
    } catch {
      setStartingChild(false);
      setError("계정을 안전하게 전환하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  if (loadingChildren) {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center gap-3" aria-live="polite">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#10315B] border-t-transparent" />
        <p className="text-xs text-gray-500">아이 정보를 확인하는 중...</p>
      </div>
    );
  }

  if (availableChildren.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="text-4xl" aria-hidden="true">🧒</span>
        <p className="text-sm font-bold text-gray-800">안내할 아이 정보가 없어요.</p>
        <p className="text-xs text-gray-500">아이 등록 상태를 확인한 뒤 다시 열어 주세요.</p>
        {showParentHome && onParentHome && (
          <button type="button" onClick={onParentHome} className="w-full rounded-xl bg-[#10315B] py-3 text-sm font-bold text-white">
            보호자 홈으로 이동
          </button>
        )}
      </div>
    );
  }

  if (!selectedChild) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <div className="text-center">
          <p className="text-sm font-bold text-gray-500">준비가 끝났어요!</p>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight text-[#10315B]">어떤 아이의 로그인 방법을 볼까요?</h1>
        </div>
        <div className="grid gap-2" role="list">
          {availableChildren.map((child) => (
            <button
              type="button"
              key={child.id}
              onClick={() => setSelectedChildId(child.id)}
              className="min-h-12 rounded-2xl border border-[#10315B]/15 bg-[#F6F8FB] px-4 py-3 text-left text-sm font-bold text-[#10315B] transition active:scale-[0.99]"
            >
              🧒 {child.name}{child.grade ? ` · ${child.grade}` : ""}
            </button>
          ))}
        </div>
        {showParentHome && onParentHome && (
          <button type="button" onClick={onParentHome} className="min-h-11 rounded-xl text-sm font-bold text-gray-500">
            보호자 홈으로 이동
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div>
        <p className="text-sm font-bold text-gray-500">준비가 끝났어요!</p>
        <h1 className="mt-1.5 text-[26px] font-extrabold leading-[1.25] text-[#10315B]">
          이제 아이가 케이를<br className="sm:hidden" /> 시작할 차례예요.
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">아이 기기에서 아래 방법 중 편한 방법으로 접속해 주세요.</p>
      </div>

      {availableChildren.length > 1 && (
        <button type="button" onClick={() => setSelectedChildId(null)} className="text-xs font-bold text-[#E8702A] underline underline-offset-2">
          {selectedChild.name} 선택됨 · 다른 아이 선택
        </button>
      )}

      {loadingAccount ? (
        <div className="flex h-48 items-center justify-center" aria-live="polite">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#10315B] border-t-transparent" />
        </div>
      ) : username ? (
        <>
          <div className="rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
            <canvas
              ref={qrCanvasRef}
              width={184}
              height={184}
              data-qr-value={childLoginUrl}
              aria-label={`${selectedChild.name} 아이 로그인 QR 코드`}
            />
          </div>

          <div className="flex w-full items-center gap-3 text-[11px] font-bold text-gray-400">
            <span className="h-px flex-1 bg-gray-200" /><span>또는</span><span className="h-px flex-1 bg-gray-200" />
          </div>

          <section className="w-full rounded-2xl bg-[#F6F8FB] p-4 text-left">
            <p className="text-xs font-bold text-gray-600">웹사이트 주소로 접속</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-sm font-extrabold text-[#10315B]">{origin ? new URL(origin).host : "app.k-bestie.com"}</code>
              <button type="button" onClick={() => handleCopy("address", childLoginUrl)} className="min-h-9 shrink-0 rounded-lg bg-white px-3 text-[11px] font-bold text-[#10315B] shadow-sm">
                {copied === "address" ? "복사됐어요" : "주소 복사"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">로그인 화면에서 &apos;아이 로그인&apos;을 선택해 주세요.</p>
          </section>

          <section className="w-full rounded-2xl border border-[#E8702A]/20 bg-[#FFF8F3] p-4 text-left">
            <p className="text-xs font-bold text-gray-600">아이 로그인 아이디</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-base font-extrabold text-[#10315B]">{username}</code>
              <button type="button" onClick={() => handleCopy("username", username)} className="min-h-9 shrink-0 rounded-lg bg-white px-3 text-[11px] font-bold text-[#E8702A] shadow-sm">
                {copied === "username" ? "복사됐어요" : "아이디 복사"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">비밀번호는 조금 전에 보호자님이 만든 비밀번호를 사용해요.</p>
          </section>
        </>
      ) : null}

      {error && <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">{error}</p>}

      <div className="flex w-full flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={handleStartOnThisDevice}
          disabled={!username || startingChild}
          className="min-h-12 w-full rounded-2xl bg-[#E8702A] px-4 text-sm font-extrabold text-white shadow-sm disabled:opacity-50"
        >
          {startingChild ? "안전하게 전환하는 중..." : "이 기기에서 아이 시작하기"}
        </button>
        {showParentHome && onParentHome && (
          <button type="button" onClick={onParentHome} className="min-h-11 w-full rounded-xl text-sm font-bold text-gray-500">
            보호자 홈으로 이동
          </button>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-gray-400">보호자님은 리포트와 설정을 확인하고, 아이는 아이 화면에서 케이와 대화해요.</p>
    </div>
  );
}

type ChildStartGuideModalProps = {
  open: boolean;
  onClose: () => void;
  children?: ChildStartGuideChild[];
  initialChildId?: string | null;
};

export function ChildStartGuideModal({ open, onClose, children, initialChildId = null }: ChildStartGuideModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4 py-5"
      role="dialog"
      aria-modal="true"
      aria-label="아이 로그인 방법"
      onClick={onClose}
    >
      <div className="relative max-h-[calc(100dvh-2.5rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white px-5 pb-6 pt-12 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="닫기" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-lg text-gray-600">×</button>
        <ChildStartGuide children={children} initialChildId={initialChildId} showParentHome={false} />
      </div>
    </div>
  );
}
