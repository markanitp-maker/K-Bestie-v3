"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LegalDocument, LegalDocumentKey } from "@/lib/legal/types";

export type LegalDocumentMap = Partial<Record<LegalDocumentKey, LegalDocument>>;

const LegalDocumentsContext = createContext<LegalDocumentMap>({});

type LegalDocumentsProviderProps = {
  children: ReactNode;
  documents: LegalDocumentMap;
};

export const LegalDocumentsProvider = ({ children, documents }: LegalDocumentsProviderProps) => (
  <LegalDocumentsContext.Provider value={documents}>{children}</LegalDocumentsContext.Provider>
);

export const useLegalDocument = (key: LegalDocumentKey): LegalDocument | null =>
  useContext(LegalDocumentsContext)[key] ?? null;
