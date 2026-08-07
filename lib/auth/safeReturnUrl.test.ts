import assert from "node:assert/strict";
import test from "node:test";
import { safePostAuthReturnUrl, safeReturnUrl } from "./safeReturnUrl";

test("allows an internal path with query and hash", () => {
  assert.equal(safeReturnUrl("/parent/report?tab=week#latest"), "/parent/report?tab=week#latest");
});

test("rejects external, scheme-relative, and script destinations", () => {
  assert.equal(safeReturnUrl("https://evil.example/path"), "/");
  assert.equal(safeReturnUrl("//evil.example/path"), "/");
  assert.equal(safeReturnUrl("javascript:alert(1)"), "/");
  assert.equal(safeReturnUrl("/\\evil.example/path"), "/");
});

test("rejects authentication-loop destinations after login", () => {
  assert.equal(safePostAuthReturnUrl("/login?error=auth"), "/");
  assert.equal(safePostAuthReturnUrl("/signup?step=child"), "/");
  assert.equal(safePostAuthReturnUrl("/signup/legacy?step=child"), "/");
  assert.equal(safePostAuthReturnUrl("/auth/callback?code=fake"), "/");
  assert.equal(safePostAuthReturnUrl("/parent/report?id=1"), "/parent/report?id=1");
});

test("falls back for missing and malformed destinations", () => {
  assert.equal(safeReturnUrl(null), "/");
  assert.equal(safeReturnUrl("parent/home"), "/");
});
