import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnUrl } from "./safeReturnUrl";

test("allows an internal path with query and hash", () => {
  assert.equal(safeReturnUrl("/parent/report?tab=week#latest"), "/parent/report?tab=week#latest");
});

test("rejects external, scheme-relative, and script destinations", () => {
  assert.equal(safeReturnUrl("https://evil.example/path"), "/");
  assert.equal(safeReturnUrl("//evil.example/path"), "/");
  assert.equal(safeReturnUrl("javascript:alert(1)"), "/");
});

test("falls back for missing and malformed destinations", () => {
  assert.equal(safeReturnUrl(null), "/");
  assert.equal(safeReturnUrl("parent/home"), "/");
});
