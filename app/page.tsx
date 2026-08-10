import type { Metadata } from "next";
import HomeHubClient from "@/components/landing/HomeHubClient";
import { getPwaIcons } from "@/lib/pwaIcons";

const HOME_URL = "https://app.k-bestie.com/";
const HOME_TITLE = "내친구 케이 | 아이와 부모를 잇는 AI 소통 서비스";
const HOME_DESCRIPTION =
  "내친구 케이는 초등학생 아이와 AI 친구 케이의 대화를 부모에게 필요한 요약과 오늘의 대화거리로 연결하는 가족 소통 서비스입니다.";
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

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteStructuredData).replace(/</g, "\\u003c"),
        }}
      />
      <HomeHubClient />
    </>
  );
}
