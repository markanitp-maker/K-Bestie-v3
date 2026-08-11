export type RelationshipCalendarStage = "W1" | "W2" | "W3" | "W4";

export type RelationshipCalendarSource = {
  relationship_started_at: string | Date | null;
};

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const toKstDateSerial = (value: Date): number => {
  const parts = KST_DATE_FORMATTER.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Date.UTC(year, month - 1, day);
};

export const calculateRelationshipCalendarStage = (
  source: RelationshipCalendarSource,
  asOf: Date = new Date(),
): RelationshipCalendarStage | null => {
  const relationshipStartedAt = source.relationship_started_at;
  if (relationshipStartedAt === null) return null;

  const startedAt = relationshipStartedAt instanceof Date
    ? relationshipStartedAt
    : new Date(relationshipStartedAt);

  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(asOf.getTime())) {
    return null;
  }
  if (asOf.getTime() < startedAt.getTime()) return null;

  const elapsedCalendarDays = Math.floor(
    (toKstDateSerial(asOf) - toKstDateSerial(startedAt)) / 86_400_000,
  );
  if (elapsedCalendarDays < 0) return null;

  const week = Math.min(4, Math.floor(elapsedCalendarDays / 7) + 1);
  return `W${week}` as RelationshipCalendarStage;
};
