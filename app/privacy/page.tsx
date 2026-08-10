import Link from "next/link";
import type { Metadata } from "next";
import { CONSENT_DOCUMENT_TEXT, CONSENT_DOCUMENT_VERSION } from "@/lib/plan/consentDocument";

const PRIVACY_URL = "https://app.k-bestie.com/privacy";
const PRIVACY_TITLE = "개인정보처리방침 | 내친구 케이";
const PRIVACY_DESCRIPTION =
  "내친구 케이의 아동·보호자 개인정보 처리와 법정대리인 동의 내용을 확인하세요.";

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
        url: "https://app.k-bestie.com/icons/icon-512.png",
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
    images: ["https://app.k-bestie.com/icons/icon-512.png"],
  },
};

// 회원가입 시 실제로 보여주는 법정대리인 동의문(lib/plan/consentDocument.ts)을 그대로
// 노출한다 — 별도 약관 문서가 없어 새로 작성하지 않고 기존 실제 문서를 재사용한다.
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh w-full px-5 md:px-10 py-10 md:py-16" style={{ background: "var(--color-k-background)" }}>
      <article className="max-w-[720px] mx-auto">
        <Link href="/" className="text-sm font-bold" style={{ color: "var(--color-k-navy)" }}>
          ← 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl md:text-3xl font-extrabold" style={{ color: "var(--color-k-text-primary)" }}>
          개인정보처리방침
        </h1>
        <p className="mt-1 text-xs" style={{ color: "var(--color-k-text-secondary)" }}>
          문서 버전 {CONSENT_DOCUMENT_VERSION}
        </p>
        <pre
          className="mt-6 whitespace-pre-wrap text-sm md:text-[15px] leading-relaxed font-sans"
          style={{ color: "var(--color-k-text-primary)" }}
        >
          {CONSENT_DOCUMENT_TEXT}
        </pre>
      </article>
    </main>
  );
}
