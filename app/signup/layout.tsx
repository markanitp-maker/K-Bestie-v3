import type { ReactNode } from "react";
import { LegalDocumentsProvider, type LegalDocumentMap } from "@/components/legal/LegalDocumentsProvider";
import {
  getLegalDocument,
  getLegalReleaseForCurrentEnvironment,
  type LegalDocumentKey,
} from "@/lib/legal/legalDocuments";

const SIGNUP_LEGAL_KEYS: LegalDocumentKey[] = [
  "service_terms",
  "parent_pii",
  "child_pii",
  "guardian_u14",
  "guardian_authority",
  "marketing",
  "event_notice",
];

export default function SignupLayout({ children }: { children: ReactNode }) {
  const release = getLegalReleaseForCurrentEnvironment();
  const documents = SIGNUP_LEGAL_KEYS.reduce<LegalDocumentMap>((result, key) => {
    const document = getLegalDocument(key, release);
    if (document) result[key] = document;
    return result;
  }, {});

  return <LegalDocumentsProvider documents={documents}>{children}</LegalDocumentsProvider>;
}
