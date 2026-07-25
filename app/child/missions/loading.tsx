import { SkeletonBox } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: "var(--color-k-surface)" }}>
      <div className="shrink-0">
        <div className="flex items-center justify-center px-4 pt-4 pb-2">
          <SkeletonBox className="w-20 h-6" />
        </div>
        <div className="text-center pt-2 pb-4 flex flex-col items-center gap-2">
          <SkeletonBox className="w-40 h-5" />
          <div className="px-6 mt-1 w-full">
            <SkeletonBox className="h-2.5 rounded-full" />
          </div>
        </div>
        <div className="flex justify-center mb-4">
          <SkeletonBox className="w-24 h-24 rounded-full" />
        </div>
      </div>
      <div className="flex-1 min-h-0 px-4 flex flex-col gap-3">
        <SkeletonBox className="h-14 self-start w-2/3" />
      </div>
      <div className="h-24 shrink-0 border-t border-gray-50" />
    </div>
  );
}
