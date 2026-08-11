export type LegalDocumentKey =
  | "service_terms"
  | "parent_pii"
  | "child_pii"
  | "guardian_u14"
  | "guardian_authority"
  | "marketing"
  | "event_notice"
  | "privacy_policy";

export type LegalRelease =
  | "production-active"
  | "development-candidate"
  | "production-approved-candidate"
  | "unavailable";

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
}

export interface LegalDocument {
  key: LegalDocumentKey;
  title: string;
  version: string;
  effectiveDate: string;
  required: boolean;
  sections: LegalSection[];
}

export interface LegalRegistryEntry {
  key: LegalDocumentKey;
  title: string;
  required: boolean;
  productionActiveVersion: string;
  productionActive: LegalDocument | null;
  developmentCandidate: LegalDocument;
}

export interface OverseasProcessor {
  id: string;
  name: string;
  country: string;
  contact: string;
  purpose: string[];
  dataCategories: string[];
  transferTiming: string;
  transferMethod: string;
  retention: string;
  legalBasis: string;
  subprocessorsUrl?: string;
}
