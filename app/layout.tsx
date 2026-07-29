import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoViewProvider } from "@/app/demo/components/DemoViewContext";
import { getPwaIcons } from "@/lib/pwaIcons";

const pwaIcons = getPwaIcons();

export const metadata: Metadata = {
  title: "내친구 케이",
  description: "아이의 마음을 듣는 AI 친구, 케이",
  manifest: "/manifest.json",
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
      </body>
    </html>
  );
}
