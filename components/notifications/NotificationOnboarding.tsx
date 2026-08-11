"use client";

import { useEffect, useState } from "react";
import { usePushSubscription } from "@/lib/notifications/usePushSubscription";
import { shouldShowNotificationOnboarding, shouldShowNotificationRecovery } from "@/lib/notifications/policy";
import { logAuthFlowEvent } from "@/lib/analytics/authFlowClient";

export function NotificationOnboarding({ role }: { role: "parent" | "child" }) {
  const { permission, status, loading, requestAndSubscribe, defer } = usePushSubscription();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const showModal = Boolean(status && shouldShowNotificationOnboarding({ loading, dismissed, permission, onboardingCompleted: status.onboardingCompleted }));
  const showRecovery = shouldShowNotificationRecovery({ loading, modalVisible: showModal, permission });
  const denied = permission === "denied";
  const unsupported = permission === "unsupported";

  useEffect(() => {
    if (showModal) void logAuthFlowEvent("notification_onboarding_view");
  }, [showModal]);

  const enable = async () => {
    setBusy(true);
    const result = await requestAndSubscribe();
    setBusy(false);
    if (result === "granted") {
      void logAuthFlowEvent("notification_permission_granted");
      setDismissed(true);
    } else if (result === "denied") {
      void logAuthFlowEvent("notification_permission_denied");
    }
  };
  const later = async () => { setDismissed(true); await defer(); };

  return (
    <>
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="notification-title">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <div className="mb-3 text-4xl" aria-hidden>🔔</div>
            <h2 id="notification-title" className="text-xl font-extrabold text-[#172A46]">
              {status?.isExistingUser ? "새로운 알림 기능이 추가됐어요" : role === "parent" ? "매일 아침 아이의 하루를 확인하세요" : "미션이 시작되면 알려줄게요"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              {status?.isExistingUser
                ? role === "parent" ? "매일 오전 7시, 아이의 리포트가 준비되면 알려드려요." : "미션을 시작할 시간이 되면 케이가 알려줘요."
                : role === "parent" ? "아이의 활동 리포트가 준비되면 오전 7시에 알려드려요. 출근 준비 중에도 아이의 어제 활동과 변화를 바로 확인할 수 있어요." : "오늘 할 수 있는 미션이 시작되면 케이가 알려줘요. 중요한 미션을 놓치지 않도록 알림을 켜주세요."}
            </p>
            <button onClick={enable} disabled={busy} className="mt-6 h-12 w-full rounded-2xl bg-[#FF7A59] font-bold text-white disabled:opacity-50">
              {busy ? "설정 중…" : status?.isExistingUser ? "알림 받기" : role === "parent" ? "아침 리포트 알림 받기" : "미션 알림 받기"}
            </button>
            <button onClick={later} className="mt-2 h-11 w-full rounded-2xl font-semibold text-gray-500">{status?.isExistingUser ? "나중에" : "나중에 설정하기"}</button>
          </div>
        </div>
      )}
      {showRecovery && (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-[#172A46]">
          <div className="flex items-center justify-between gap-3">
            <p>{unsupported ? "현재 브라우저에서 이용중이에요. \"앱 설치하기\" 후 더 편리한 앱 환경에서 이용해 보세요." : denied ? "알림이 차단되어 있어요." : role === "parent" ? "아침 리포트 알림이 꺼져 있어요. 아이의 리포트가 준비되면 알려드릴까요?" : "미션 알림이 꺼져 있어요. 시작 시간을 놓치지 않도록 알림을 켜주세요."}</p>
            {!denied && !unsupported && <button onClick={enable} disabled={busy} className="shrink-0 rounded-xl bg-[#FF7A59] px-3 py-2 font-bold text-white">알림 켜기</button>}
          </div>
          {denied && <><p className="mt-1 text-xs text-gray-600">주소창의 사이트 설정 → 알림 → 허용으로 변경한 뒤 앱으로 돌아와 주세요.</p><button onClick={() => window.location.reload()} className="mt-2 text-xs font-bold text-[#C2410C] underline">권한 다시 확인</button></>}
        </div>
      )}
    </>
  );
}
