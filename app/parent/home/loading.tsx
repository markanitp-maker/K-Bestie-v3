import { SkeletonBox } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-4" style={{ background: "var(--color-k-surface)" }}>
        <SkeletonBox className="w-20 h-6" />
        <SkeletonBox className="w-16 h-5" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8">
        <SkeletonBox className="h-[72px] mb-6" />
        <SkeletonBox className="w-28 h-5 mb-3" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBox key={i} className="h-24" />
          ))}
        </div>
      </div>
      <div className="h-16 shrink-0 border-t" style={{ borderColor: "#f3f4f6" }} />
    </div>
  );
}
