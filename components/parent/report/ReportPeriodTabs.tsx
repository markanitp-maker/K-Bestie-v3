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
  <nav className="w-full max-w-[var(--max-width-app)] mx-auto px-4 pt-4 pb-1" aria-label="리포트 기간">
    <div className="grid h-14 grid-cols-2 overflow-hidden rounded-2xl border border-[var(--color-k-border)] bg-white p-1 shadow-sm">
      {PERIOD_TABS.map((tab) => {
        const isActive = tab.period === activePeriod;

        return (
          <Link
            key={tab.period}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center justify-center rounded-xl text-base font-bold ${
              isActive
                ? "bg-k-navy text-white"
                : "text-[var(--color-k-text-secondary)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  </nav>
);
