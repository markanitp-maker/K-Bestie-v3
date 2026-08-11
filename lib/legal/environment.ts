import type { LegalDocumentKey } from "./types";

export type LegalEnvironment = "development" | "production" | "unavailable";

export const getLegalEnvironment = (): LegalEnvironment => {
  const target = process.env.NEXT_PUBLIC_SUPABASE_TARGET;
  if (target === "dev") return "development";
  if (target === "prod") return "production";
  return "unavailable";
};

export const isDevelopmentLegalCandidate = (): boolean => getLegalEnvironment() === "development";

export const isProductionLegalCandidateApproved = (): boolean =>
  getLegalEnvironment() === "production" &&
  process.env.NEXT_PUBLIC_LEGAL_DOCS_APPROVED_FOR_PRODUCTION === "true";

// Production에는 기존에 본문이 공개돼 있던 guardian 문서만 상세보기를 유지한다.
// Candidate 본문 자체는 이 client-safe 모듈에 import하지 않는다.
export const isLegalDetailAvailable = (key: LegalDocumentKey): boolean =>
  isDevelopmentLegalCandidate() ||
  (getLegalEnvironment() === "production" &&
    (isProductionLegalCandidateApproved() || key === "guardian_u14"));
