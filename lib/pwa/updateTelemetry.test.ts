import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidCanonicalRoute,
  validatePwaTelemetryMetadata,
  validatePwaTelemetryBody,
  PWA_SW_STATES,
  PWA_CHECK_TRIGGERS,
  PWA_UPDATE_REASONS,
  PWA_UPDATE_PHASES,
  PWA_STALE_SIGNATURES,
  PWA_RECOVERY_ACTIONS,
  PWA_UPDATE_ERROR_CODES,
  PWA_UPDATE_EVENT_TYPES,
} from "./updateTelemetry.js";

test("isValidCanonicalRoute allows only canonical ASCII absolute routes", () => {
  // Valid routes
  const validRoutes = [
    "/",
    "/child/home",
    "/parent",
    "/parent/home",
    "/login",
    "/offline",
    "/chat",
    "/child/missions",
    "/user/profile-123",
  ];
  for (const route of validRoutes) {
    assert.equal(isValidCanonicalRoute(route), true, `Should accept valid route: ${route}`);
  }

  // Invalid routes
  const invalidRoutes = [
    "", // empty
    "child/home", // no leading slash
    "//child/home", // double slash
    "/child//home", // double slash inside
    "/child\\home", // backslash
    "/child/home?tab=1", // query
    "/child/home#anchor", // hash
    "/child/home ", // space at end
    "/child/ home", // space inside
    "/http://evil.com", // protocol / colon
    "https://app.k-bestie.com/home", // absolute URL
    "/child/../parent", // dot segment
    "/child/./home", // dot segment
    "/child/..", // dot segment
    "/child/.", // dot segment
    "/.", // dot segment
    "/..", // dot segment
    "/child/%2fhome", // percent encoded slash
    "/child/%2Fhome",
    "/child/%5chome", // percent encoded backslash
    "/child/%3fquery", // percent encoded ?
    "/child/%23hash", // percent encoded #
    "/child/%0ahome", // percent encoded newline
    "/child/%20home", // percent encoded space
    "/child/%2e%2e/home", // percent encoded dot
  ];

  for (const route of invalidRoutes) {
    assert.equal(isValidCanonicalRoute(route), false, `Should reject invalid route: ${route}`);
  }
});

test("validatePwaTelemetryMetadata accepts all valid enums and numeric ranges", () => {
  for (const sw_state of PWA_SW_STATES) {
    const res = validatePwaTelemetryMetadata({ sw_state });
    assert.equal(res.ok, true);
  }
  for (const trigger of PWA_CHECK_TRIGGERS) {
    const res = validatePwaTelemetryMetadata({ trigger });
    assert.equal(res.ok, true);
  }
  for (const reason of PWA_UPDATE_REASONS) {
    const res = validatePwaTelemetryMetadata({ reason });
    assert.equal(res.ok, true);
  }
  for (const phase of PWA_UPDATE_PHASES) {
    const res = validatePwaTelemetryMetadata({ phase });
    assert.equal(res.ok, true);
  }
  for (const stale_signature of PWA_STALE_SIGNATURES) {
    const res = validatePwaTelemetryMetadata({ stale_signature });
    assert.equal(res.ok, true);
  }
  for (const recovery_action of PWA_RECOVERY_ACTIONS) {
    const res = validatePwaTelemetryMetadata({ recovery_action });
    assert.equal(res.ok, true);
  }
  for (const error_code of PWA_UPDATE_ERROR_CODES) {
    const res = validatePwaTelemetryMetadata({ error_code });
    assert.equal(res.ok, true);
  }

  // Valid numeric ranges
  assert.equal(
    validatePwaTelemetryMetadata({
      retry_count: 0,
      attempt: 10,
      check_interval_ms: 86400000,
    }).ok,
    true,
  );
  assert.equal(
    validatePwaTelemetryMetadata({
      retry_count: 5,
      attempt: 1,
      check_interval_ms: 0,
    }).ok,
    true,
  );
});

test("validatePwaTelemetryMetadata rejects invalid enums, numbers, types, and nested structures", () => {
  // Invalid enum strings
  assert.equal(validatePwaTelemetryMetadata({ sw_state: "invalid_state" }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ trigger: "unknown_trigger" }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ phase: "unknown_phase" }).ok, false);

  // Type mismatch for enums
  assert.equal(validatePwaTelemetryMetadata({ sw_state: 123 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ sw_state: true }).ok, false);

  // Out of range numbers
  assert.equal(validatePwaTelemetryMetadata({ retry_count: -1 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ retry_count: 11 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ attempt: -1 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ attempt: 15 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ check_interval_ms: -100 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ check_interval_ms: 86400001 }).ok, false);

  // Non-integer numbers
  assert.equal(validatePwaTelemetryMetadata({ retry_count: 2.5 }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ attempt: 1.1 }).ok, false);

  // String types for numeric fields
  assert.equal(validatePwaTelemetryMetadata({ retry_count: "2" }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ check_interval_ms: "60000" }).ok, false);

  // NaN / Infinity
  assert.equal(validatePwaTelemetryMetadata({ retry_count: NaN }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ retry_count: Infinity }).ok, false);

  // Unknown keys
  assert.equal(validatePwaTelemetryMetadata({ unknown_prop: "value" }).ok, false);

  // Nested structures
  assert.equal(validatePwaTelemetryMetadata({ sw_state: { nested: true } }).ok, false);
  assert.equal(validatePwaTelemetryMetadata({ phase: ["checking"] }).ok, false);
});

test("validatePwaTelemetryBody enforces strict top-level schema and rejects spoofed fields", () => {
  const validBody = {
    event_id: "11111111-2222-4333-8444-555555555555",
    event_type: "pwa_update_success",
    correlation_id: "22222222-3333-4444-8555-666666666666",
    route: "/child/home",
    current_version: "build-1",
    latest_version: "build-2",
    error_code: null,
    metadata: {
      sw_state: "installed",
      trigger: "mount_ready",
      retry_count: 1,
    },
  };

  const res = validatePwaTelemetryBody(validBody);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.event_id, validBody.event_id);
    assert.equal(res.value.event_type, "pwa_update_success");
    assert.equal(res.value.route, "/child/home");
    assert.equal(res.value.metadata?.sw_state, "installed");
  }

  // Reject spoofed identity fields
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, user_id: "attacker-user" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, actor_id: "attacker-actor" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, child_id: "attacker-child" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, family_id: "attacker-family" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, session_id: "attacker-session" }).ok,
    false,
  );

  // Reject unknown top-level fields
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, extra_random_field: "val" }).ok,
    false,
  );

  // Reject invalid UUIDs
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, event_id: "not-a-uuid" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, correlation_id: "not-a-uuid" }).ok,
    false,
  );

  // Reject invalid event_type
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, event_type: "invalid_event" }).ok,
    false,
  );

  // Reject invalid error_code enum
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, error_code: "invalid_error_code" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, error_code: 12345 }).ok,
    false,
  );

  // Accept valid error_code enum
  for (const code of PWA_UPDATE_ERROR_CODES) {
    assert.equal(
      validatePwaTelemetryBody({ ...validBody, error_code: code }).ok,
      true,
    );
  }

  // Version string safety
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, current_version: "v1.0.0-build.123_abc" }).ok,
    true,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, current_version: "bad version with spaces" }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, current_version: "a".repeat(65) }).ok,
    false,
  );
  assert.equal(
    validatePwaTelemetryBody({ ...validBody, latest_version: "bad\nversion" }).ok,
    false,
  );
  // Conflicting top-level error_code and metadata.error_code
  assert.equal(
    validatePwaTelemetryBody({
      ...validBody,
      error_code: "network_error",
      metadata: { error_code: "install_timeout" },
    }).ok,
    false,
  );

  // Matching top-level and metadata error_code
  const matchingRes = validatePwaTelemetryBody({
    ...validBody,
    error_code: "network_error",
    metadata: { error_code: "network_error" },
  });
  assert.equal(matchingRes.ok, true);
  if (matchingRes.ok) {
    assert.equal(matchingRes.value.error_code, "network_error");
  }

  // Nested-only error_code resolution
  const nestedOnlyRes = validatePwaTelemetryBody({
    ...validBody,
    error_code: null,
    metadata: { error_code: "install_timeout" },
  });
  assert.equal(nestedOnlyRes.ok, true);
  if (nestedOnlyRes.ok) {
    assert.equal(nestedOnlyRes.value.error_code, "install_timeout");
  }
});

test("migration 20260815190000_behavior_events_pwa_update_feature static schema contract", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/20260815190000_behavior_events_pwa_update_feature.sql",
  );

  assert.equal(fs.existsSync(migrationPath), true, "Migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf8");

  // 1. Must use exact constraint name
  assert.match(sql, /behavior_events_feature_check/);

  // 2. Must use NOT VALID then VALIDATE CONSTRAINT
  assert.match(sql, /NOT VALID;/);
  assert.match(sql, /VALIDATE CONSTRAINT behavior_events_feature_check;/);

  // 3. Must preserve all existing features + add pwa_update
  const requiredFeatures = [
    "auth",
    "home",
    "mission",
    "freechat",
    "play",
    "daily_report",
    "weekly_report",
    "monthly_report",
    "conversation_topic",
    "child_management",
    "guardian_settings",
    "subscription",
    "app_session",
    "relationship",
    "pwa_update",
  ];

  for (const feature of requiredFeatures) {
    assert.ok(
      sql.includes(`'${feature}'`),
      `Migration must preserve feature '${feature}' in allowlist`,
    );
  }

  // 4. Must include GRANTs
  assert.match(sql, /GRANT ALL ON public\.behavior_events TO anon, authenticated;/);
  assert.match(sql, /GRANT ALL ON public\.behavior_events TO service_role;/);

  // 5. Must NOT contain dangerous DROP TABLE, TRUNCATE, or DELETE
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
  assert.doesNotMatch(sql, /UPDATE public\.behavior_events/i);
});
