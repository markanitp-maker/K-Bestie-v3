"use client";

interface VoiceInputModeSwitchProps {
  isAuto: boolean;
  onChange: (mode: "auto" | "manual") => void;
  className?: string;
}

export function VoiceInputModeSwitch({ isAuto, onChange, className }: VoiceInputModeSwitchProps) {
  return (
    <div
      className={`inline-flex flex-col items-center gap-2 p-1.5 bg-gray-100/80 rounded-2xl border border-gray-200 shadow-inner shrink-0 ${className ?? ""}`}
    >
      <button
        onClick={() => onChange("auto")}
        aria-pressed={isAuto}
        aria-label="자동으로 말하기"
        className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl text-[12px] font-bold transition-all duration-300 ease-out cursor-pointer border-2 ${
          isAuto 
            ? "bg-[#1a6b5a] text-white border-[#1a6b5a] shadow-sm" 
            : "bg-white text-gray-500 border-transparent hover:text-gray-700"
        }`}
      >
        <span>자동</span>
      </button>
      <button
        onClick={() => onChange("manual")}
        aria-pressed={!isAuto}
        aria-label="버튼 눌러 말하기"
        className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl text-[12px] font-bold transition-all duration-300 ease-out cursor-pointer border-2 ${
          !isAuto 
            ? "bg-[#1a6b5a] text-white border-[#1a6b5a] shadow-sm" 
            : "bg-white text-gray-500 border-transparent hover:text-gray-700"
        }`}
      >
        <span>수동</span>
      </button>
    </div>
  );
}
