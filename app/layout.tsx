import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoViewProvider } from "@/app/demo/components/DemoViewContext";
import { getPwaIcons } from "@/lib/pwaIcons";

const pwaIcons = getPwaIcons();

export const metadata: Metadata = {
  metadataBase: new URL("https://app.k-bestie.com"),
  title: "내친구 케이",
  description: "아이의 마음을 듣는 AI 친구, 케이",
  manifest: "/manifest.json",
  verification: {
    other: {
      "naver-site-verification": "4763684a599d70ff5241478e30f86dab458d7e0b",
    },
  },
  openGraph: {
    title: "내친구 케이",
    description: "아이의 마음을 듣는 AI 친구, 케이",
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
    description: "아이의 마음을 듣는 AI 친구, 케이",
    images: [pwaIcons.icon512],
  },
  robots: {
    index: true,
    follow: true,
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "var(--color-k-navy)",
};

import { PwaServiceWorker } from "@/components/PwaServiceWorker";
import { NotificationBadgeSync } from "@/components/notifications/NotificationBadgeSync";

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
      </body>
    </html>
  );
}
