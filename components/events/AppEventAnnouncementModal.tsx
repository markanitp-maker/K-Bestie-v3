"use client";

import { useEffect, useState, useRef } from "react";

interface ChildMissionEventSummary {
  status: "not_started" | "active" | "max_completed" | "completed";
  completedCount?: number;
  currentRewardAmount?: number;
  nextTierRemaining?: { nextTier: number; remaining: number } | null;
  endsAt?: string;
}

interface ChildStatusResponse {
  shouldShow: boolean;
  audience: "child";
  announcementKey?: string;
  announcementVersion?: number;
  missionEvent?: ChildMissionEventSummary;
}

interface ParentChildSummary {
  childId: string;
  name: string;
  missionEvent: ChildMissionEventSummary;
}

interface ParentStatusResponse {
  shouldShow: boolean;
  audience: "parent";
  announcementKey?: string;
  announcementVersion?: number;
  children?: ParentChildSummary[];
}

interface NoShowResponse {
  shouldShow: false;
  audience?: undefined;
}

type StatusResponse = ChildStatusResponse | ParentStatusResponse | NoShowResponse;

// 로그인 이벤트 안내 팝업 — 요청서 §6. 아이/부모 홈 데이터 로딩 완료 직후 마운트한다.
// audience는 서버 판정 결과를 그대로 따른다(클라이언트가 미리 알 필요 없음).
// React Strict Mode 중복 호출 방지를 위해 ref로 in-flight/이미 확인 처리를 가드한다.
export default function AppEventAnnouncementModal({
  manualOpen = false,
  manualAudience = "child",
  onClose,
}: {
  manualOpen?: boolean;
  manualAudience?: "child" | "parent";
  onClose?: () => void;
} = {}) {
  const [status, setStatus] = useState<StatusResponse | null>(
    manualOpen ? { shouldShow: true, audience: manualAudience } : null
  );
  const [visible, setVisible] = useState(manualOpen);
  const [closing, setClosing] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (manualOpen) {
      setVisible(true);
      setStatus({ shouldShow: true, audience: manualAudience });
      return;
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch("/api/events/announcements/status")
      .then((r) => (r.ok ? r.json() : { shouldShow: false }))
      .then((data: StatusResponse) => {
        setStatus(data);
        if (data.shouldShow) setVisible(true);
      })
      .catch(() => {
        // 팝업 조회 실패가 로그인 자체를 막지 않는다(§6.1) — 조용히 숨긴다.
      });
  }, [manualAudience, manualOpen]);

  const handleAcknowledge = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await fetch("/api/events/announcements/acknowledge", { method: "POST" });
    } catch {
      // 실패해도 다음 로그인에서 재노출되는 것으로 충분 — 여기서 사용자를 막지 않는다.
    } finally {
      setVisible(false);
      setClosing(false);
      if (onClose) onClose();
    }
  };

  if (!visible || !status?.shouldShow) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="overflow-y-auto px-6 pt-6 pb-4">
          {status.audience === "child" ? (
            <ChildAnnouncementBody />
          ) : (
            <ParentAnnouncementBody />
          )}
        </div>
        <div className="px-6 pb-6 pt-2 border-t border-gray-100">
          <button
            onClick={handleAcknowledge}
            disabled={closing}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
            style={{ background: "var(--color-k-orange, #FF9F45)" }}
          >
            {manualOpen ? "닫기" : (status.audience === "child" ? "이벤트 확인했어요" : "이벤트 확인")}
          </button>
        </div>
      </div>
    </div>
  );
}

// 이벤트 규칙 설명 전용 — 개인 진행률(N/60, 현재 단계 등)은 아이 홈의 "케이와
// 친해지는 30일" 카드에서만 보여준다(여기서는 표시하지 않음, 형진님 2026-08-04 지시).
function ChildAnnouncementBody() {
  return (
    <>
      <h2 className="text-lg font-bold mb-4" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        케이와 더 친해지는 이벤트가 열렸어요!
      </h2>

      {/* 이벤트 1 카드 */}
      <div
        className="rounded-2xl p-3 mb-3"
        style={{ background: "#FFF3E0", border: "1px solid rgba(255,159,69,0.3)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ background: "var(--color-k-orange, #FF9F45)" }}
          >
            1
          </span>
          <p className="text-sm font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
            이벤트 1. 케이와 친해지는 30일
          </p>
        </div>

        <div className="text-sm leading-relaxed space-y-1" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>미션을 하면서 30일 동안 케이와 더 친해져요.</p>
          <p>많이 참여할수록 더 좋은 상품을 받을 수 있어요.</p>
        </div>
      </div>

      {/* 이벤트 2 카드 */}
      <div
        className="rounded-2xl p-3 mb-3"
        style={{ background: "#E9F3FF", border: "1px solid rgba(107,140,174,0.3)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ background: "var(--color-k-sky-blue, #6B8CAE)" }}
          >
            2
          </span>
          <p className="text-sm font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
            이벤트 2. 퀴즈 리더보드 도전
          </p>
        </div>

        <div className="text-sm leading-relaxed space-y-1" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>퀴즈 점수를 쌓아 친구들과 순위에 도전해요.</p>
          <p>높은 순위를 하면 상품을 받을 수 있어요.</p>
        </div>
      </div>

      {/* 이벤트 3 카드 — 확률과 관리자 one-shot 정책은 아이에게 노출하지 않는다. */}
      <div
        className="rounded-2xl p-3"
        style={{ background: "#FFF8D9", border: "1px solid rgba(245,158,11,0.3)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white bg-amber-500"
          >
            3
          </span>
          <p className="text-sm font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
            이벤트 3. 매일 출석 황금열쇠 룰렛
          </p>
        </div>
        <div className="text-sm leading-relaxed space-y-1" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>매일 출석하면 하루 한 번 룰렛에 참여할 수 있어요.</p>
          <p>황금열쇠를 모아서 퀴즈에 더 많이 도전해보세요!</p>
        </div>
      </div>

      <p className="mt-3 text-center text-sm font-bold" style={{ color: "var(--color-k-orange, #FF9F45)" }}>
        재미있게 참여해보자!
      </p>
    </>
  );
}

function ParentAnnouncementBody() {
  return (
    <>
      <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        내친구 케이 이벤트 안내
      </h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        <p>
          아이들이 케이와 더 즐겁게 만나고 꾸준히 참여할 수 있도록 다양한 이벤트를 진행하고 있어요.
          이벤트에 참여하고 목표를 달성하면 다양한 상품도 받을 수 있습니다.
        </p>
        <p className="font-bold mt-3">1. 케이와 친해지는 30일</p>
        <p>30일 동안 케이와 미션을 꾸준히 완료하며 목표에 도전해요. 미션 달성 정도에 따라 상품을 받을 수 있습니다.</p>
        <p className="font-bold mt-3">2. 월별 퀴즈 리더보드</p>
        <p>매달 퀴즈 점수를 모아 친구들과 순위에 도전해요. 상위 순위를 달성한 아이에게 상품을 제공합니다.</p>
        <p className="font-bold mt-3">3. 매일 출석 황금열쇠 룰렛</p>
        <p>매일 접속하면 룰렛을 돌려 황금열쇠를 받을 수 있어요. 모은 황금열쇠로 퀴즈에 더 많이 도전할 수 있습니다.</p>
        <p className="font-semibold mt-4">아이들이 재미있게 참여하고 목표에 도전할 수 있도록 많이 응원해 주세요!</p>
      </div>
    </>
  );
}
