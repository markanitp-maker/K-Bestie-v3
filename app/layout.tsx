import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoViewProvider } from "@/app/demo/components/DemoViewContext";
import { getPwaIcons } from "@/lib/pwaIcons";

const pwaIcons = getPwaIcons();

export const metadata: Metadata = {
  metadataBase: new URL("https://app.k-bestie.com"),
  title: "내친구 케이",
  description: "아이와 부모를 잇는 AI 소통 서비스, 내친구 케이",
  manifest: "/manifest.json",
  verification: {
    other: {
      "naver-site-verification": "4763684a599d70ff5241478e30f86dab458d7e0b",
    },
  },
  // 모든 인증·개인화 route는 이 안전한 기본값을 상속한다. 검색 공개가 확인된
  // `/`와 `/privacy`만 각 page metadata에서 index/follow를 명시적으로 덮어쓴다.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  icons: {
    icon: [
      { url: pwaIcons.favicon16, sizes: "16x16", type: "image/png" },
      { url: pwaIcons.favicon32, sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: pwaIcons.appleTouchIcon180, sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "내친구 케이",
  },
  openGraph: {
    title: "내친구 케이",
    url: "https://app.k-bestie.com",
    siteName: "내친구 케이",
    locale: "ko_KR",
    type: "website",
    images: [
      {
        url: pwaIcons.icon512,
        width: 512,
        height: 512,
        alt: "내친구 케이",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "내친구 케이",
    images: [pwaIcons.icon512],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Android Chrome은 기본값(resizes-visual)에서 키보드가 올라와도 레이아웃 뷰포트를
  // 줄이지 않아 100dvh 컨테이너 아래가 키보드 뒤에 남고, 그 배경이 입력창과 키보드
  // 사이 공백으로 보인다(071). resizes-content는 키보드 크기만큼 레이아웃 뷰포트를
  // 줄여 이 문제를 브라우저 차원에서 해소한다. iOS는 이 값을 무시하므로
  // useKeyboardConversationViewport의 실측 높이 보정이 계속 담당한다.
  interactiveWidget: "resizes-content",
  themeColor: "var(--color-k-navy)",
};

import { PwaServiceWorker } from "@/components/PwaServiceWorker";
import { NotificationBadgeSync } from "@/components/notifications/NotificationBadgeSync";
import { AppSessionTracking } from "@/hooks/useAppSessionTracking";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <DemoViewProvider>{children}</DemoViewProvider>
        <PwaServiceWorker />
        <NotificationBadgeSync />
        <AppSessionTracking />
      </body>
    </html>
  );
}
