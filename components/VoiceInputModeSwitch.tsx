"use client";

interface VoiceInputModeSwitchProps {
  isAuto: boolean;
  onChange: (mode: "auto" | "manual") => void;
  className?: string;
}

export function VoiceInputModeSwitch({ isAuto, onChange, className }: VoiceInputModeSwitchProps) {
  return (
    <div
      className={`inline-flex flex-row items-center p-1 bg-gray-100/80 rounded-full border border-gray-200 shadow-inner shrink-0 ${className ?? ""}`}
    >
      <button
        onClick={() => onChange("auto")}
        aria-pressed={isAuto}
        aria-label="자동으로 말하기"
        className={`px-3 py-1.5 flex items-center justify-center rounded-full text-[12px] font-bold transition-all duration-300 ease-out cursor-pointer ${
          isAuto 
            ? "bg-[var(--color-k-navy)] text-white shadow-sm" 
            : "bg-transparent text-gray-500 hover:text-gray-700"
        }`}
      >
        자동
      </button>
      <button
        onClick={() => onChange("manual")}
        aria-pressed={!isAuto}
        aria-label="버튼 눌러 말하기"
        className={`px-3 py-1.5 flex items-center justify-center rounded-full text-[12px] font-bold transition-all duration-300 ease-out cursor-pointer ${
          !isAuto 
            ? "bg-[var(--color-k-navy)] text-white shadow-sm" 
            : "bg-transparent text-gray-500 hover:text-gray-700"
        }`}
      >
        수동
      </button>
    </div>
  );
}
