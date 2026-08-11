import type { Metadata } from "next";
import HomeHubClient from "@/components/landing/HomeHubClient";
import { UTM_KEYS, type PreservedLandingParams } from "@/lib/landing/preservedHref";
import { getPwaIcons } from "@/lib/pwaIcons";

const PRESERVED_PARAM_KEYS = [...UTM_KEYS, "returnUrl"] as const;

const HOME_URL = "https://app.k-bestie.com/";
const HOME_TITLE = "내친구 케이 | 아이의 하루를 이해하고 대화를 이어주는 AI 소통 서비스";
const HOME_DESCRIPTION =
  "아이는 AI 친구 케이와 이야기하고, 부모는 아이의 하루와 오늘의 대화거리를 확인합니다. 부모와 아이의 다음 대화를 이어주는 AI 소통 서비스 내친구 케이를 만나보세요.";
const SOCIAL_IMAGE_URL = getPwaIcons().icon512;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: HOME_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: HOME_URL,
    siteName: "내친구 케이",
    locale: "ko_KR",
    type: "website",
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
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [SOCIAL_IMAGE_URL],
  },
};

const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "내친구 케이",
  alternateName: "K-Bestie",
  url: HOME_URL,
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const preservedParams: PreservedLandingParams = {};
  for (const key of PRESERVED_PARAM_KEYS) {
    const raw = params[key];
    // URLSearchParams.get()과 동일하게, 값이 중복(배열)이면 첫 값을 채택한다.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value) preservedParams[key] = value;
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteStructuredData).replace(/</g, "\\u003c"),
        }}
      />
      <HomeHubClient preservedParams={preservedParams} />
    </>
  );
}
