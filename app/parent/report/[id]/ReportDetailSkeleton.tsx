import { SkeletonBox } from "@/components/Skeleton";

// 리포트 상세 화면(헤더+탭+카드)과 모양을 맞춘 스켈레톤.
// 목록 페이지의 스켈레톤(카드 리스트 모양)을 그대로 재사용하면 실제 상세 레이아웃과
// 달라 화면이 확 바뀌는 것처럼 보였던 문제 때문에 전용으로 분리함.
export function ReportDetailSkeleton() {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-4" style={{ background: "var(--color-k-surface)" }}>
        <span className="w-5" />
        <SkeletonBox className="w-20 h-6" />
        <span className="w-5" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex gap-2 px-4 pt-4 pb-1">
          <SkeletonBox className="w-20 h-9 shrink-0" />
          <SkeletonBox className="w-20 h-9 shrink-0" />
          <SkeletonBox className="w-20 h-9 shrink-0" />
        </div>
        <div className="flex-1 px-4 py-4 flex flex-col gap-4">
          <SkeletonBox className="h-28" />
          <SkeletonBox className="h-28" />
        </div>
      </div>
    </div>
  );
}
