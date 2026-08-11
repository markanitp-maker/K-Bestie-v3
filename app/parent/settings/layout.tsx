import type { ReactNode } from "react";
import { LegalDocumentsProvider } from "@/components/legal/LegalDocumentsProvider";
import { getLegalDocument, getLegalReleaseForCurrentEnvironment } from "@/lib/legal/legalDocuments";

export default function ParentSettingsLayout({ children }: { children: ReactNode }) {
  const release = getLegalReleaseForCurrentEnvironment();
  const guardianDocument = getLegalDocument("guardian_u14", release);

  return (
    <LegalDocumentsProvider documents={guardianDocument ? { guardian_u14: guardianDocument } : {}}>
      {children}
    </LegalDocumentsProvider>
  );
}
