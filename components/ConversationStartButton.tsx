import React from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ConversationStartButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/**
 * 미션 / 자유대화 시작하기·이어하기 공용 CTA 버튼 (Request 072)
 *
 * - 주황색 Filled 배경 (`bg-[var(--color-k-orange)]`)
 * - 외곽 밝은 흰색 프레임 + 부드러운 그림자
 * - 흰색 재생(▶) 아이콘 + 흰색 볼드 텍스트
 * - 말풍선 꼬리 없음
 */
export const ConversationStartButton = React.forwardRef<
  HTMLButtonElement,
  ConversationStartButtonProps
>(({ label, className, disabled, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        "relative z-20 w-[86%] max-w-[350px] mx-auto min-h-[88px] shrink-0",
        "bg-[var(--color-k-orange)] text-white rounded-[20px]",
        "shadow-[0_0_0_4px_rgba(255,255,255,0.85),0_8px_24px_rgba(211,102,29,0.3)]",
        "flex items-center justify-center gap-[10px] px-[20px]",
        "cursor-pointer active:scale-95 disabled:opacity-50 transition-transform",
        className
      )}
      {...props}
    >
      <Play
        className="w-[clamp(20px,5.5vw,24px)] h-[clamp(20px,5.5vw,24px)] fill-white text-white shrink-0"
        aria-hidden="true"
      />
      <span className="text-white text-[clamp(22px,6vw,26px)] font-[700] leading-none">
        {label}
      </span>
    </button>
  );
});

ConversationStartButton.displayName = "ConversationStartButton";
