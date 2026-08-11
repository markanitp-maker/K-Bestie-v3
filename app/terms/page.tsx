import type { Metadata } from "next";
import { PublicLegalDocument } from "@/components/legal/PublicLegalDocument";
import { getLegalDocument, getLegalReleaseForCurrentEnvironment } from "@/lib/legal/legalDocuments";

export const metadata: Metadata = {
  title: "서비스 이용약관 | 내친구 케이",
  description: "내친구 케이 서비스 이용약관을 확인하세요.",
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  const release = getLegalReleaseForCurrentEnvironment();
  return (
    <PublicLegalDocument
      document={getLegalDocument("service_terms", release)}
      release={release}
      unavailableTitle="서비스 이용약관"
    />
  );
}
