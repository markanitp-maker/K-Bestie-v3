import { SkeletonBox } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-4" style={{ background: "var(--color-k-surface)" }}>
        <span className="w-5" />
        <SkeletonBox className="w-20 h-6" />
        <span className="w-10 h-5" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}
