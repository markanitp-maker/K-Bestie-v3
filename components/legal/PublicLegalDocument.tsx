import Link from "next/link";
import type { LegalDocument, LegalRelease } from "@/lib/legal/legalDocuments";
import { LegalDocumentView } from "./LegalDocumentView";

type PublicLegalDocumentProps = {
  document: LegalDocument | null;
  release: LegalRelease;
  unavailableTitle: string;
};

export const PublicLegalDocument = ({ document, release, unavailableTitle }: PublicLegalDocumentProps) => (
  <main className="min-h-dvh w-full px-5 py-10 md:px-10 md:py-16" style={{ background: "var(--color-k-background)" }}>
    <article className="mx-auto max-w-[760px] rounded-3xl bg-white p-5 shadow-sm sm:p-8">
      <Link href="/" className="text-sm font-bold text-[var(--color-k-navy)]">
        ← 돌아가기
      </Link>
      {document ? (
        <>
          <div className="mt-5 border-b border-gray-100 pb-5">
            <h1 className="text-2xl font-extrabold text-gray-900 md:text-3xl">{document.title}</h1>
            <p className="mt-2 text-xs text-gray-500">
              문서 버전 {document.version} · 시행{release === "development-candidate" ? "예정" : ""}일 {document.effectiveDate}
            </p>
            {release === "development-candidate" && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-800">
                개발 환경 검토용 문서입니다 · 프로덕션에는 공개되지 않았습니다
              </p>
            )}
          </div>
          <div className="mt-7">
            <LegalDocumentView document={document} />
          </div>
        </>
      ) : (
        <div className="py-16 text-center">
          <h1 className="text-xl font-extrabold text-gray-900">{unavailableTitle}</h1>
          <p className="mt-3 text-sm text-gray-500">현재 Production에 공개된 신규 문서는 없습니다.</p>
        </div>
      )}
    </article>
  </main>
);
