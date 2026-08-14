import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("관리자 인증 확인이 라우트 진입부에 유지된다", () => {
  assert.match(source, /const denied = await requireAdmin\(\);/);
  assert.match(source, /if \(denied\) return denied;/);
});

test("제출자 필터는 parent, child와 함께 guest(비회원)를 허용한다", () => {
  assert.match(source, /!\["parent",\s*"child",\s*"guest"\]\.includes\(role\)/);
  assert.match(source, /query\.eq\("submitter_role",\s*role\)/);
});

test("검색 필터에 contact_email이 escaping 패턴과 함께 포함된다", () => {
  assert.match(source, /contact_email\.ilike\.\$\{pattern\}/);
  assert.match(source, /request_number\.ilike\.\$\{pattern\}/);
  assert.match(source, /subject\.ilike\.\$\{pattern\}/);
  assert.match(source, /body\.ilike\.\$\{pattern\}/);
});

test("비회원(guest) 행 매핑 시 submitter_name은 null이고 submitter_login은 contact_email로 안전하게 매핑된다", () => {
  assert.match(source, /submitter_name:\s*row\.submitter_role === "child"[\s\S]*?: row\.submitter_role === "guest"\s*\?\s*null/);
  assert.match(source, /submitter_login:\s*row\.submitter_role === "child"[\s\S]*?: row\.submitter_role === "guest"\s*\?\s*row\.contact_email \?\? null/);
});

test("규칙 9 및 보안 규칙을 준수한다 (금지 SDK 및 클라이언트 시크릿 부재)", () => {
  assert.doesNotMatch(source, /@google\/generative-ai/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
});
