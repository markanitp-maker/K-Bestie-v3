"use client";

import { useDemoView } from "./DemoViewContext";

export function ViewToggle({
  orientation = "horizontal",
}: {
  orientation?: "horizontal" | "vertical";
}) {
  const { view, setView } = useDemoView();

  return (
    <div
      className={`flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-1.5 py-1.5 shadow-md border border-[#f3f4f6] ${
        orientation === "vertical" ? "flex-col rounded-2xl" : ""
      }`}
    >
      <button
        onClick={() => setView("tablet")}
        className={`px-3 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
          view === "tablet" ? "bg-[var(--color-k-navy)] text-white" : "text-[#6b7280]"
        }`}
      >
        태블릿
      </button>
      <button
        onClick={() => setView("mobile")}
        className={`px-3 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
          view === "mobile" ? "bg-[var(--color-k-navy)] text-white" : "text-[#6b7280]"
        }`}
      >
        스마트폰
      </button>
    </div>
  );
}
