import {
  getLegalEnvironment,
  isProductionLegalCandidateApproved,
} from "./environment";
import { CHILD_PII_CANDIDATE } from "./documents/childPrivacyConsent";
import { GUARDIAN_AUTHORITY_CANDIDATE, GUARDIAN_U14_CANDIDATE } from "./documents/guardianConsentDocuments";
import { EVENT_NOTICE_CANDIDATE, MARKETING_CANDIDATE, PARENT_PII_CANDIDATE } from "./documents/parentConsentDocuments";
import { PRIVACY_POLICY_CANDIDATE } from "./documents/privacyPolicy";
import { SERVICE_TERMS_CANDIDATE } from "./documents/serviceTerms";
import type { LegalDocument, LegalDocumentKey, LegalRegistryEntry, LegalRelease } from "./types";

export type { LegalDocument, LegalDocumentKey, LegalRegistryEntry, LegalRelease, LegalSection } from "./types";

export const PRODUCTION_ACTIVE_CONSENT_VERSION = "2026-07-16";
export const DEVELOPMENT_CANDIDATE_VERSION = "2026-08-18";

// Production에 이미 노출·저장 중인 법정대리인 동의문이다. 신규 후보와 분리해 과거 동의
// 이력을 덮어쓰거나 기존 사용자 재동의를 강제하지 않는다.
export const PRODUCTION_ACTIVE_GUARDIAN_DOCUMENT: LegalDocument = {
  key: "guardian_u14",
  title: "법정대리인 개인정보 수집·이용 동의",
  version: PRODUCTION_ACTIVE_CONSENT_VERSION,
  effectiveDate: PRODUCTION_ACTIVE_CONSENT_VERSION,
  required: true,
  sections: [
    {
      id: "legacy-active",
      title: "법정대리인 개인정보 수집·이용 동의",
      paragraphs: [
        "1. 수집 항목: 아이의 이름, 학년, 관심사, AI 친구 '케이'와의 대화 내용(텍스트/음성), 대화 기반으로 생성되는 감정·활동 리포트.",
        "2. 수집 목적: 아이와 AI 친구 '케이'의 대화 서비스 제공, 부모님께 보여드리는 일일/주간 리포트 생성, 서비스 품질 개선.",
        "3. 보유 기간: 가입하신 요금제별 보존기간 동안 보관 후 자동 파기됩니다(요금제 하향 시에도 유예 기간을 두고 있습니다). 자세한 보존기간은 요금제 안내를 참고해 주세요.",
        "4. 만 14세 미만 아동의 개인정보는 법정대리인의 동의 없이 수집하지 않으며, 위 동의는 법정대리인이 자녀를 대신하여 제공하는 것입니다.",
        "5. 동의를 거부할 권리가 있으며, 거부 시 서비스 이용(아이 계정 등록)이 제한될 수 있습니다.",
        "6. 동의 후에도 아래 '동의 철회'를 통해 언제든지 동의를 철회할 수 있습니다. 철회 시 아이 계정을 통한 서비스 이용이 중단됩니다.",
      ],
    },
  ],
};

const PRODUCTION_ACTIVE_PRIVACY_DOCUMENT: LegalDocument = {
  ...PRODUCTION_ACTIVE_GUARDIAN_DOCUMENT,
  key: "privacy_policy",
  title: "개인정보처리방침",
};

const CANDIDATE_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  service_terms: SERVICE_TERMS_CANDIDATE,
  parent_pii: PARENT_PII_CANDIDATE,
  child_pii: CHILD_PII_CANDIDATE,
  guardian_u14: GUARDIAN_U14_CANDIDATE,
  guardian_authority: GUARDIAN_AUTHORITY_CANDIDATE,
  marketing: MARKETING_CANDIDATE,
  event_notice: EVENT_NOTICE_CANDIDATE,
  privacy_policy: PRIVACY_POLICY_CANDIDATE,
};

const PRODUCTION_ACTIVE_DOCUMENTS: Partial<Record<LegalDocumentKey, LegalDocument>> = {
  // 기존 Production에 본문이 있었던 두 경로만 등록한다. 나머지를 신규 본문으로 채우면
  // 법률 검토 전 Production 공개가 되므로 null 상태를 명시적으로 유지한다.
  guardian_u14: PRODUCTION_ACTIVE_GUARDIAN_DOCUMENT,
  privacy_policy: PRODUCTION_ACTIVE_PRIVACY_DOCUMENT,
};

export const LEGAL_DOCUMENT_KEYS = Object.freeze(Object.keys(CANDIDATE_DOCUMENTS) as LegalDocumentKey[]);

export const LEGAL_DOCUMENT_REGISTRY: Readonly<Record<LegalDocumentKey, LegalRegistryEntry>> = Object.freeze(
  LEGAL_DOCUMENT_KEYS.reduce<Record<LegalDocumentKey, LegalRegistryEntry>>((registry, key) => {
    const candidate = CANDIDATE_DOCUMENTS[key];
    registry[key] = Object.freeze({
      key,
      title: candidate.title,
      required: candidate.required,
      productionActiveVersion: PRODUCTION_ACTIVE_CONSENT_VERSION,
      productionActive: PRODUCTION_ACTIVE_DOCUMENTS[key] ?? null,
      developmentCandidate: candidate,
    });
    return registry;
  }, {} as Record<LegalDocumentKey, LegalRegistryEntry>),
);

export const getLegalReleaseForCurrentEnvironment = (): LegalRelease => {
  const environment = getLegalEnvironment();
  if (environment === "development") return "development-candidate";
  if (environment === "production") {
    return isProductionLegalCandidateApproved()
      ? "production-approved-candidate"
      : "production-active";
  }
  return "unavailable";
};

export const getLegalDocument = (key: LegalDocumentKey, release: LegalRelease): LegalDocument | null => {
  const entry = LEGAL_DOCUMENT_REGISTRY[key];
  if (release === "unavailable") return null;
  return release === "production-active" ? entry.productionActive : entry.developmentCandidate;
};

export const getCurrentLegalDocument = (key: LegalDocumentKey): LegalDocument | null =>
  getLegalDocument(key, getLegalReleaseForCurrentEnvironment());

export const legalDocumentToPlainText = (document: LegalDocument): string =>
  [
    `[${document.title}]`,
    ...document.sections.flatMap((section) => [section.title, ...section.paragraphs]),
  ].join("\n\n");
