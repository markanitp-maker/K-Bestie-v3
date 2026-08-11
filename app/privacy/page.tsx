import type { Metadata } from "next";
import { PublicLegalDocument } from "@/components/legal/PublicLegalDocument";
import { getLegalDocument, getLegalReleaseForCurrentEnvironment } from "@/lib/legal/legalDocuments";
import { getPwaIcons } from "@/lib/pwaIcons";

const PRIVACY_URL = "https://app.k-bestie.com/privacy";
const PRIVACY_TITLE = "개인정보처리방침 | 내친구 케이";
const PRIVACY_DESCRIPTION =
  "내친구 케이의 아동·보호자 개인정보 처리와 법정대리인 동의 내용을 확인하세요.";
const SOCIAL_IMAGE_URL = getPwaIcons().icon512;

export const metadata: Metadata = {
  title: { absolute: PRIVACY_TITLE },
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: PRIVACY_URL },
  robots: { index: true, follow: true },
  openGraph: {
    title: PRIVACY_TITLE,
    description: PRIVACY_DESCRIPTION,
    url: PRIVACY_URL,
    siteName: "내친구 케이",
    locale: "ko_KR",
    type: "article",
    images: [
      {
        url: SOCIAL_IMAGE_URL,
        width: 512,
        height: 512,
        alt: "내친구 케이",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: PRIVACY_TITLE,
    description: PRIVACY_DESCRIPTION,
    images: [SOCIAL_IMAGE_URL],
  },
};

export default function PrivacyPage() {
  const release = getLegalReleaseForCurrentEnvironment();
  return (
    <PublicLegalDocument
      document={getLegalDocument("privacy_policy", release)}
      release={release}
      unavailableTitle="개인정보처리방침"
    />
  );
}
