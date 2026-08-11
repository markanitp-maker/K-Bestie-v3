// 기존 import 경로를 쓰는 동의 저장 API의 비파괴 호환 레이어다. 저장 버전과 본문은
// Legal Registry가 현재 환경에서 공개한 guardian 문서에서 함께 결정한다.
import { getCurrentLegalDocument, legalDocumentToPlainText } from "@/lib/legal/legalDocuments";

const currentConsentDocument = getCurrentLegalDocument("guardian_u14");

if (!currentConsentDocument) {
  throw new Error("현재 환경에 공개 가능한 법정대리인 동의 문서가 없습니다.");
}

export const CONSENT_DOCUMENT_VERSION = currentConsentDocument.version;
export const CONSENT_DOCUMENT_TEXT = legalDocumentToPlainText(currentConsentDocument);
