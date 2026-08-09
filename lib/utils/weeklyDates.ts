export interface WeekBounds {
  weekStart: string;
  weekEnd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getKstDateObj(date?: Date): Date {
  const now = date || new Date();
  // If we just want the current KST time represented as UTC to use UTC methods:
  const kstTime = now.getTime() + (9 * 60 * 60 * 1000);
  return new Date(kstTime);
}

export function getCurrentKstDateStr(date?: Date): string {
  return formatUtcDate(getKstDateObj(date));
}

/** KST business date가 속한 토요일~금요일 주간 경계. */
export function getWeekBoundsKst(dateStr?: string): WeekBounds {
  const d = dateStr ? new Date(dateStr + "T00:00:00Z") : getKstDateObj();
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const diffToSat = dow === 6 ? 0 : -dow - 1;
  
  const sat = new Date(d);
  sat.setUTCDate(d.getUTCDate() + diffToSat);
  
  const fri = new Date(sat);
  fri.setUTCDate(sat.getUTCDate() + 6);

  return { weekStart: formatUtcDate(sat), weekEnd: formatUtcDate(fri) };
}

/** 토요일 06:00 KST 주간 배치가 생성해야 할 직전 완료 주간 경계. */
export function getCompletedWeekBoundsForRunDateKst(runDate: string): WeekBounds {
  const currentWeek = getWeekBoundsKst(runDate);
  const currentStart = new Date(`${currentWeek.weekStart}T00:00:00Z`);
  const previousStart = new Date(currentStart.getTime() - 7 * DAY_MS);
  const previousEnd = new Date(previousStart.getTime() + 6 * DAY_MS);
  return {
    weekStart: formatUtcDate(previousStart),
    weekEnd: formatUtcDate(previousEnd),
  };
}

export function getDaysSinceStart(weekStartStr: string, currentKstDateStr: string) {
  const start = new Date(weekStartStr + "T00:00:00Z");
  const curr = new Date(currentKstDateStr + "T00:00:00Z");
  const diffTime = curr.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
  return Math.max(1, diffDays + 1); // 1-indexed (Saturday = 1일째)
}
