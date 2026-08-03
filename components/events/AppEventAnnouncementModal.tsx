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

function won(n?: number): string {
  return `${(n ?? 0).toLocaleString("ko-KR")}원`;
}

// 로그인 이벤트 안내 팝업 — 요청서 §6. 아이/부모 홈 데이터 로딩 완료 직후 마운트한다.
// audience는 서버 판정 결과를 그대로 따른다(클라이언트가 미리 알 필요 없음).
// React Strict Mode 중복 호출 방지를 위해 ref로 in-flight/이미 확인 처리를 가드한다.
export default function AppEventAnnouncementModal() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
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
  }, []);

  const handleAcknowledge = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await fetch("/api/events/announcements/acknowledge", { method: "POST" });
    } catch {
      // 실패해도 다음 로그인에서 재노출되는 것으로 충분 — 여기서 사용자를 막지 않는다.
    } finally {
      setVisible(false);
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
            <ChildAnnouncementBody missionEvent={status.missionEvent} />
          ) : (
            <ParentAnnouncementBody children={status.children ?? []} />
          )}
        </div>
        <div className="px-6 pb-6 pt-2 border-t border-gray-100">
          <button
            onClick={handleAcknowledge}
            disabled={closing}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
            style={{ background: "var(--color-k-orange, #FF9F45)" }}
          >
            {status.audience === "child" ? "이벤트 확인했어요" : "이벤트 확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChildAnnouncementBody({ missionEvent }: { missionEvent?: ChildMissionEventSummary }) {
  const status = missionEvent?.status ?? "not_started";

  return (
    <>
      <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        케이와 더 친해지는 이벤트가 열렸어요!
      </h2>
      {status === "active" || status === "max_completed" ? (
        <div className="text-sm leading-relaxed space-y-1" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>케이와 친해지는 30일 이벤트가 진행 중이에요.</p>
          <p className="font-bold mt-3">
            현재 미션 {missionEvent?.completedCount ?? 0}/60 완료
          </p>
          <p>현재 달성 선물: {won(missionEvent?.currentRewardAmount)}</p>
          {missionEvent?.nextTierRemaining ? (
            <p>다음 단계까지 {missionEvent.nextTierRemaining.remaining}번 남았어요.</p>
          ) : (
            <p>최고 단계를 달성했어요!</p>
          )}
        </div>
      ) : (
        <div className="text-sm leading-relaxed space-y-2" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>첫 미션을 끝까지 완료하면 그 순간부터 30일 이벤트가 시작돼요.</p>
          <p>
            30일 동안 케이와 미션을 완료해 보세요.
            <br />
            10번, 30번, 50번, 60번을 달성할수록 받을 수 있는 선물이 커져요.
          </p>
          <p>
            최종 달성한 가장 높은 단계의 선물 하나를 받아요.
            <br />
            60번을 완료하면 편의점 상품권 10,000원을 받을 수 있어요.
          </p>
          <p>
            8월, 9월, 10월에는 퀴즈 리더보드 이벤트도 진행돼요.
            <br />
            매월 마지막 날 기준 1·2·3등에게 선물을 드려요.
          </p>
        </div>
      )}
    </>
  );
}

function ParentAnnouncementBody({ children: childSummaries }: { children: ParentChildSummary[] }) {
  return (
    <>
      <h2 className="text-lg font-bold mb-3" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        내친구 케이 이벤트 안내
      </h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
        <p>아이들이 케이와 자연스럽게 친해질 수 있도록 두 가지 이벤트를 진행합니다.</p>
        <p className="font-bold mt-3">1. 케이와 친해지는 30일 미션</p>
        <p>
          자녀가 최초 미션을 정상 완료한 순간부터 30일이 시작됩니다.
          <br />
          자녀별로 한 번만 진행되며 30일 종료 후 다시 시작되지 않습니다.
          <br />
          30일 동안 완료한 미션 횟수에 따라 가장 높은 달성 구간의 상품권 1개를 지급합니다.
          <br />
          10회 1,000원 / 30회 3,000원 / 50회 5,000원 / 60회 10,000원
        </p>
        <p className="font-bold mt-3">2. 월별 퀴즈 리더보드</p>
        <p>
          2026년 8월 31일, 9월 30일, 10월 31일 23:59:59 KST 기준으로 월별 순위를 확정합니다.
          <br />
          매월 1위 5,000원 / 2위 3,000원 / 3위 1,000원 상품권을 지급합니다.
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--color-k-sky-blue, #6B8CAE)" }}>
          상품권은 보호자에게 전달하며, 관리자 확인 후 지급 상태를 안내합니다.
        </p>

        {childSummaries.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100 space-y-1">
            {childSummaries.map((c) => (
              <p key={c.childId} className="text-xs">
                <span className="font-bold">{c.name}</span>
                {": "}
                {c.missionEvent.status === "not_started"
                  ? "미션 이벤트 시작 전"
                  : `${c.missionEvent.completedCount ?? 0}/60 완료 · 현재 ${won(c.missionEvent.currentRewardAmount)} 구간`}
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
