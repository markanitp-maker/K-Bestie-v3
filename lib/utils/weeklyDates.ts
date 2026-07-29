export function getKstDateObj(date?: Date): Date {
  const now = date || new Date();
  // If we just want the current KST time represented as UTC to use UTC methods:
  const kstTime = now.getTime() + (9 * 60 * 60 * 1000);
  return new Date(kstTime);
}

export function getCurrentKstDateStr(): string {
  const kst = getKstDateObj();
  return kst.toISOString().split("T")[0];
}

export function getWeekBoundsKst(dateStr?: string) {
  const d = dateStr ? new Date(dateStr + "T00:00:00Z") : getKstDateObj();
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const diffToSat = dow === 6 ? 0 : -dow - 1;
  
  const sat = new Date(d);
  sat.setUTCDate(d.getUTCDate() + diffToSat);
  
  const fri = new Date(sat);
  fri.setUTCDate(sat.getUTCDate() + 6);

  const fmt = (dt: Date) => dt.toISOString().split("T")[0];
  return { weekStart: fmt(sat), weekEnd: fmt(fri) };
}

export function getDaysSinceStart(weekStartStr: string, currentKstDateStr: string) {
  const start = new Date(weekStartStr + "T00:00:00Z");
  const curr = new Date(currentKstDateStr + "T00:00:00Z");
  const diffTime = curr.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
  return Math.max(1, diffDays + 1); // 1-indexed (Saturday = 1일째)
}
