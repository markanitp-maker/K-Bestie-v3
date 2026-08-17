"use client";

export type MissionBlockReason = "before_open" | "closed" | "unavailable";

export interface MissionTimeModalProps {
  open: boolean;
  reason: MissionBlockReason;
  onClose: () => void;
}

export const MISSION_HOURS_TEXT = "오전 9시 ~ 밤 11시 50분";
export const MISSION_DAILY_LIMIT_TEXT = "미션은 하루에 딱 한 번만 할 수 있어요.";

const REASON_MESSAGES: Record<
  MissionBlockReason,
  { title: string; subtitle?: string }
> = {
  before_open: {
    title: "아직 미션 시간이 아니에요",
    subtitle: "오전 9시에 다시 만나요!",
  },
  closed: {
    title: "오늘 미션 시간이 끝났어요",
    subtitle: "내일 다시 만나요!",
  },
  unavailable: {
    title: "지금은 미션을 할 수 없어요",
  },
};

export default function MissionTimeModal({
  open,
  reason,
  onClose,
}: MissionTimeModalProps) {
  if (!open) return null;

  const content = REASON_MESSAGES[reason] || REASON_MESSAGES.unavailable;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[clamp(280px,calc(var(--frame-w,100vw)*0.85),340px)] bg-white rounded-[24px] shadow-2xl p-6 flex flex-col items-center text-center"
        style={{ border: "1px solid rgba(0, 0, 0, 0.05)" }}
      >
        <div className="text-5xl mb-3 select-none">⏰</div>

        <h2 className="text-[19px] font-extrabold text-[var(--color-k-navy,#1A2B4C)] leading-snug break-keep">
          {content.title}
        </h2>

        {content.subtitle && (
          <p className="text-[14px] font-bold text-[var(--color-k-orange,#FF9F45)] mt-1.5 break-keep">
            {content.subtitle}
          </p>
        )}

        <div
          className="w-full rounded-[18px] p-3.5 mt-4 text-[13px] leading-relaxed break-keep space-y-1"
          style={{
            background: "#F5F8FC",
            border: "1px solid rgba(107, 140, 174, 0.2)",
          }}
        >
          <p className="font-semibold text-[var(--color-k-navy,#1A2B4C)]">
            미션 시간: {MISSION_HOURS_TEXT}
          </p>
          <p className="text-[12px] text-gray-500">
            {MISSION_DAILY_LIMIT_TEXT}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3.5 mt-5 rounded-2xl font-bold text-white text-[15px] active:scale-[0.98] transition-transform cursor-pointer shadow-md"
          style={{ background: "var(--color-k-orange, #FF9F45)" }}
        >
          알겠어
        </button>
      </div>
    </div>
  );
}
