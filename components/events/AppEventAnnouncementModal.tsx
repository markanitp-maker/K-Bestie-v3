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
export default function AppEventAnnouncementModal({
  manualOpen = false,
  onClose,
}: {
  manualOpen?: boolean;
  onClose?: () => void;
} = {}) {
  const [status, setStatus] = useState<StatusResponse | null>(
    manualOpen ? { shouldShow: true, audience: "child" } : null
  );
  const [visible, setVisible] = useState(manualOpen);
  const [closing, setClosing] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (manualOpen) {
      setVisible(true);
      setStatus({ shouldShow: true, audience: "child" });
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
  }, [manualOpen]);

  const handleAcknowledge = async () => {
    if (closing) return;
    setClosing(true);
    try {
      if (!manualOpen) {
        await fetch("/api/events/announcements/acknowledge", { method: "POST" });
      }
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
        className="rounded-2xl p-4 mb-4"
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
          <p>첫 미션을 끝까지 완료하면 시작돼요.</p>
          <p>30일 동안 미션을 완료한 횟수에 따라 선물을 받아요.</p>
        </div>

        <div className="mt-3 space-y-1 text-sm font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>10번 이상 완료 → 상품권 1,000원</p>
          <p>30번 이상 완료 → 상품권 3,000원</p>
          <p>50번 이상 완료 → 상품권 5,000원</p>
          <p>60번 완료 → 상품권 10,000원</p>
        </div>

        <p className="text-xs mt-3" style={{ color: "var(--color-k-sky-blue, #6B8CAE)" }}>
          여러 선물을 모두 받는 것이 아니라 30일 동안 달성한 가장 높은 단계의 선물 1개를 받아요.
        </p>
      </div>

      {/* 이벤트 2 카드 */}
      <div
        className="rounded-2xl p-4 mb-4"
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

        <p className="text-sm leading-relaxed" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          8월, 9월, 10월마다 퀴즈 점수 순위를 새로 겨뤄요.
        </p>

        <div className="mt-3 space-y-1 text-sm font-bold" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
          <p>1등 → 상품권 5,000원</p>
          <p>2등 → 상품권 3,000원</p>
          <p>3등 → 상품권 1,000원</p>
        </div>

        <p className="text-xs mt-3" style={{ color: "var(--color-k-sky-blue, #6B8CAE)" }}>
          한 달이 끝나면 그 달 순위가 정해지고, 다음 달에는 점수가 0점부터 다시 시작돼요.
        </p>
      </div>

      {/* 이벤트 3 카드 — 확률과 관리자 one-shot 정책은 아이에게 노출하지 않는다. */}
      <div
        className="rounded-2xl p-4"
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
          <p>매일 출석하면 하루 한 번 룰렛을 돌릴 수 있어요.</p>
          <p>황금열쇠를 모아서 퀴즈에 더 많이 도전해보세요!</p>
        </div>
        <p className="text-xs mt-3 font-semibold text-amber-800">
          꽝 · 한번 더 · 황금열쇠 +1 · +3 · +5 · +7 · +9
        </p>
      </div>
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
        <p>아이들이 케이와 자연스럽게 친해질 수 있도록 세 가지 이벤트를 진행합니다.</p>
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
        <p className="font-bold mt-3">3. 매일 출석 황금열쇠 룰렛</p>
        <p>
          아이 계정으로 매일 접속하면 KST 기준 하루 한 번 룰렛에 참여할 수 있습니다.
          <br />
          획득한 황금열쇠는 아이가 퀴즈에 다시 도전할 때 사용할 수 있습니다.
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
