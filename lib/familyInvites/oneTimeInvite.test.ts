import assert from "node:assert/strict";
import test from "node:test";
import {
  allowFamilyInviteLookup,
  createInviteCredentials,
  credentialHash,
  decodeInviteContext,
  deriveInviteCredentials,
  encodeInviteContext,
  normalizeInviteCode,
} from "./oneTimeInvite";

process.env.FAMILY_INVITE_SIGNING_SECRET = "unit-test-family-invite-secret-with-sufficient-length";

test("raw token/code are deterministic from an opaque nonce but only hashes are stored", () => {
  const invite = createInviteCredentials();
  const derived = deriveInviteCredentials(invite.inviteId, invite.nonce);
  assert.equal(derived.token, invite.token);
  assert.equal(derived.code, invite.code);
  assert.equal(credentialHash({ token: invite.token }), invite.tokenHash);
  assert.equal(credentialHash({ code: invite.code }), invite.codeHash);
  assert.equal(invite.token.includes(invite.inviteId), false);
  assert.match(invite.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test("link and code contexts normalize to one credential without exposing family or role", () => {
  const token = "a".repeat(43);
  assert.deepEqual(decodeInviteContext(encodeInviteContext({ token })), { token });
  assert.deepEqual(decodeInviteContext(encodeInviteContext({ code: "abcd-2345" })), { code: "ABCD2345" });
  assert.equal(normalizeInviteCode("ab-cd 2345"), "ABCD2345");
  assert.equal(credentialHash({ code: "invalid" }), null);
});

test("public invite lookup applies a bounded per-key window", () => {
  const key = `test-${Date.now()}`;
  for (let count = 0; count < 20; count += 1) assert.equal(allowFamilyInviteLookup(key, 1_000), true);
  assert.equal(allowFamilyInviteLookup(key, 1_000), false);
  assert.equal(allowFamilyInviteLookup(key, 61_001), true);
});
