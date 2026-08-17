import Link from "next/link";

type ReportPeriod = "daily" | "weekly";

interface ReportPeriodTabsProps {
  activePeriod: ReportPeriod;
}

const PERIOD_TABS: Array<{ period: ReportPeriod; label: string; href: string }> = [
  { period: "daily", label: "일간", href: "/parent/report" },
  { period: "weekly", label: "주간", href: "/parent/report/weekly" },
];

export const ReportPeriodTabs = ({ activePeriod }: ReportPeriodTabsProps) => (
  <nav className="mx-auto w-full max-w-[var(--content-max-width,var(--max-width-app,480px))] px-4 pb-2 pt-4" aria-label="리포트 기간">
    <div className="grid h-16 grid-cols-2 overflow-hidden rounded-[18px] border border-[var(--color-k-border)] bg-white p-1 shadow-sm">
      {PERIOD_TABS.map((tab) => {
        const isActive = tab.period === activePeriod;

        return (
          <Link
            key={tab.period}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-w-0 items-center justify-center rounded-[14px] text-lg font-extrabold transition-colors ${
              isActive
                ? "bg-k-navy text-white"
                : "text-[var(--color-k-navy)] active:bg-[var(--color-k-navy-tint)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  </nav>
);
