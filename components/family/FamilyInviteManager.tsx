"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type Invite = { id: string; invite_url: string; created_at: string; expires_at: string };

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement("textarea");
  area.value = value;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function FamilyInviteManager({ familyId }: { familyId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | null>(null);
  const [showQr, setShowQr] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/families/${familyId}/one-time-invites`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || "초대 정보를 불러오지 못했습니다.");
    else setInvite(body.invites?.[0] ?? null);
    setLoading(false);
  }, [familyId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!showQr || !invite || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, invite.invite_url, { width: 196, margin: 1, errorCorrectionLevel: "M" });
  }, [showQr, invite]);

  async function createInvite() {
    setLoading(true); setError(null);
    const response = await fetch(`/api/families/${familyId}/one-time-invites`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || "초대 링크를 만들지 못했습니다.");
    else setInvite(body.invite);
    setLoading(false);
  }

  async function revokeInvite() {
    if (!invite || !window.confirm("이 초대 링크를 취소할까요? 취소 후에는 다시 사용할 수 없습니다.")) return;
    setLoading(true); setError(null);
    const response = await fetch(`/api/families/${familyId}/one-time-invites/${invite.id}/revoke`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || "초대를 취소하지 못했습니다.");
    else { setInvite(null); setShowQr(false); }
    setLoading(false);
  }

  async function shareInvite() {
    if (!invite) return;
    if (navigator.share) {
      await navigator.share({ title: "내친구 케이 가족 초대", text: "내친구 케이 가족 구성원으로 참여해 주세요.", url: invite.invite_url });
      return;
    }
    await copyText(invite.invite_url);
    setCopied("link");
  }

  if (loading) return <p className="text-[11px] text-gray-500 py-2">가족 초대를 확인하고 있어요...</p>;
  return (
    <div className="mt-2 pt-3 border-t border-gray-100 flex flex-col gap-3">
      <div>
        <p className="text-xs font-bold text-gray-800">가족 구성원 초대</p>
        <p className="text-[10px] text-gray-500 mt-1">이메일 없이 1회용 링크를 공유해 주세요. Google 또는 Kakao 계정으로 참여할 수 있습니다.</p>
      </div>
      {!invite ? (
        <button type="button" onClick={createInvite} className="min-h-11 rounded-xl bg-[var(--color-k-navy)] text-white text-xs font-bold">+ 가족 구성원 초대하기</button>
      ) : (
        <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-3 flex flex-col gap-3">
          <div>
            <p className="text-xs font-bold text-gray-900">초대 대기 중</p>
            <p className="text-[10px] text-gray-500 mt-1">만료: {new Date(invite.expires_at).toLocaleString("ko-KR")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={shareInvite} className="min-h-10 rounded-xl bg-[var(--color-k-orange)] text-white text-xs font-bold">공유하기</button>
            <button type="button" onClick={async () => { await copyText(invite.invite_url); setCopied("link"); }} className="min-h-10 rounded-xl bg-white border border-gray-200 text-xs font-bold">{copied === "link" ? "복사됐어요" : "링크 복사"}</button>
            <button type="button" onClick={() => setShowQr((value) => !value)} className="min-h-10 rounded-xl bg-white border border-gray-200 text-xs font-bold">QR 코드</button>
            <button type="button" onClick={revokeInvite} className="min-h-10 rounded-xl bg-white border border-red-100 text-red-600 text-xs font-bold">초대 취소</button>
          </div>
          {showQr && <div className="bg-white rounded-xl p-3 flex justify-center"><canvas ref={canvasRef} aria-label="가족 초대 QR 코드" /></div>}
        </div>
      )}
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
