import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPMENT_CANDIDATE_VERSION,
  LEGAL_DOCUMENT_KEYS,
  LEGAL_DOCUMENT_REGISTRY,
  PRODUCTION_ACTIVE_CONSENT_VERSION,
  getLegalDocument,
} from "./legalDocuments";
import { OVERSEAS_PROCESSORS } from "./processors";

test("development registry contains all seven consents and the privacy policy", () => {
  assert.deepEqual([...LEGAL_DOCUMENT_KEYS].sort(), [
    "child_pii",
    "event_notice",
    "guardian_authority",
    "guardian_u14",
    "marketing",
    "parent_pii",
    "privacy_policy",
    "service_terms",
  ]);

  for (const key of LEGAL_DOCUMENT_KEYS) {
    const document = getLegalDocument(key, "development-candidate");
    assert.ok(document);
    assert.equal(document.key, key);
    assert.equal(document.version, DEVELOPMENT_CANDIDATE_VERSION);
    assert.ok(document.title.length > 0);
    assert.ok(document.sections.length > 0);
    assert.ok(document.sections.every((section) => section.paragraphs.length > 0));
  }
});

test("production active version remains unchanged and candidate text is not promoted", () => {
  assert.equal(PRODUCTION_ACTIVE_CONSENT_VERSION, "2026-07-16");
  assert.ok(
    LEGAL_DOCUMENT_KEYS.every(
      (key) => LEGAL_DOCUMENT_REGISTRY[key].productionActiveVersion === PRODUCTION_ACTIVE_CONSENT_VERSION,
    ),
  );
  assert.equal(LEGAL_DOCUMENT_REGISTRY.guardian_u14.productionActive?.version, PRODUCTION_ACTIVE_CONSENT_VERSION);
  assert.equal(LEGAL_DOCUMENT_REGISTRY.privacy_policy.productionActive?.version, PRODUCTION_ACTIVE_CONSENT_VERSION);
  assert.equal(LEGAL_DOCUMENT_REGISTRY.service_terms.productionActive, null);
  assert.notEqual(
    LEGAL_DOCUMENT_REGISTRY.guardian_u14.productionActive,
    LEGAL_DOCUMENT_REGISTRY.guardian_u14.developmentCandidate,
  );
});

test("review-sensitive sections expose the LEGAL_REVIEW_REQUIRED marker", () => {
  const reviewedSections = LEGAL_DOCUMENT_KEYS.flatMap((key) =>
    LEGAL_DOCUMENT_REGISTRY[key].developmentCandidate.sections.filter((section) => section.reviewRequired),
  );
  assert.ok(reviewedSections.length > 0);
  assert.ok(
    reviewedSections.every((section) =>
      section.paragraphs.some((paragraph) => paragraph.includes("LEGAL_REVIEW_REQUIRED")),
    ),
  );
});

test("overseas processors have one config per provider and unresolved legal facts are marked", () => {
  assert.deepEqual(OVERSEAS_PROCESSORS.map((processor) => processor.id).sort(), ["google", "supabase", "vercel"]);
  assert.equal(new Set(OVERSEAS_PROCESSORS.map((processor) => processor.id)).size, OVERSEAS_PROCESSORS.length);
  assert.ok(OVERSEAS_PROCESSORS.every((processor) => processor.legalBasis.includes("LEGAL_REVIEW_REQUIRED")));
});
