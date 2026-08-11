import type { LegalDocument } from "@/lib/legal/legalDocuments";

type LegalDocumentViewProps = {
  document: LegalDocument;
  compact?: boolean;
};

export const LegalDocumentView = ({ document, compact = false }: LegalDocumentViewProps) => (
  <div className={compact ? "space-y-5" : "space-y-7"}>
    {document.sections.map((section) => (
      <section key={section.id} aria-labelledby={`${document.key}-${section.id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id={`${document.key}-${section.id}`}
            className={compact ? "text-sm font-extrabold text-gray-800" : "text-base font-extrabold text-gray-900"}
          >
            {section.title}
          </h2>
          {section.reviewRequired && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
              LEGAL_REVIEW_REQUIRED
            </span>
          )}
        </div>
        <div className={`${compact ? "mt-2 text-xs" : "mt-3 text-sm"} space-y-2 leading-relaxed text-gray-700`}>
          {section.paragraphs.map((paragraph, index) => (
            <p key={`${section.id}-${index}`} className="whitespace-pre-wrap break-words">
              {paragraph}
            </p>
          ))}
        </div>
      </section>
    ))}
  </div>
);
