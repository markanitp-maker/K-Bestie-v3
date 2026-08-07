export const CUSTOMER_REQUEST_CATEGORIES = ["inquiry", "suggestion", "bug", "voc"] as const;
export const CUSTOMER_REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type CustomerRequestCategory = (typeof CUSTOMER_REQUEST_CATEGORIES)[number];
export type CustomerRequestStatus = (typeof CUSTOMER_REQUEST_STATUSES)[number];

export const CATEGORY_LABELS: Record<CustomerRequestCategory, string> = {
  inquiry: "문의",
  suggestion: "건의",
  bug: "버그",
  voc: "기존 문의·건의",
};

export const STATUS_LABELS: Record<CustomerRequestStatus, string> = {
  open: "신규",
  in_progress: "처리 중",
  resolved: "처리 완료",
  closed: "종료",
};

export function isCustomerRequestCategory(value: unknown): value is CustomerRequestCategory {
  return typeof value === "string" && CUSTOMER_REQUEST_CATEGORIES.includes(value as CustomerRequestCategory);
}

export function isCustomerRequestStatus(value: unknown): value is CustomerRequestStatus {
  return typeof value === "string" && CUSTOMER_REQUEST_STATUSES.includes(value as CustomerRequestStatus);
}

/** 배포 중 이미 열린 구버전 폼도 DB에는 반드시 새 category로만 저장한다. */
export function normalizeSubmissionCategory(value: unknown): Exclude<CustomerRequestCategory, "voc"> | null {
  if (value === "inquiry" || value === "voc") return "inquiry";
  if (value === "suggestion" || value === "feature") return "suggestion";
  if (value === "bug") return "bug";
  return null;
}

export function canTransitionStatus(from: CustomerRequestStatus, to: CustomerRequestStatus): boolean {
  if (from === to) return true;
  return CUSTOMER_REQUEST_STATUSES.indexOf(to) === CUSTOMER_REQUEST_STATUSES.indexOf(from) + 1;
}

/** YYYY-MM-DD를 KST 하루의 UTC 경계로 바꾼다. */
export function kstDateRange(startDate?: string | null, endDate?: string | null) {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from: startDate && valid.test(startDate) ? `${startDate}T00:00:00+09:00` : null,
    toExclusive: endDate && valid.test(endDate)
      ? new Date(new Date(`${endDate}T00:00:00+09:00`).getTime() + 86_400_000).toISOString()
      : null,
  };
}
