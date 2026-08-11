import type { LegalDocument } from "@/lib/legal/legalDocuments";

type LegalDocumentViewProps = {
  document: LegalDocument;
  compact?: boolean;
};

export const LegalDocumentView = ({ document, compact = false }: LegalDocumentViewProps) => (
  <div className={compact ? "space-y-5" : "space-y-7"}>
    {document.sections.map((section) => (
      <section key={section.id} aria-labelledby={`${document.key}-${section.id}`}>
        <h2
          id={`${document.key}-${section.id}`}
          className={compact ? "text-sm font-extrabold text-gray-800" : "text-base font-extrabold text-gray-900"}
        >
          {section.title}
        </h2>
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
