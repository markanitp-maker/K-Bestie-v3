import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");

test("내 접수 목록은 인증 사용자 소유권과 공개 필드 whitelist를 사용한다", () => {
  const fields = listSource.match(/const SUPPORT_LIST_FIELDS = "([^"]+)"/)?.[1] ?? "";
  assert.match(fields, /user_response/);
  assert.match(fields, /body/);
  assert.doesNotMatch(fields, /admin_note|contact_email|device_info|guardian_id|user_id|child_id/);
  const getBlock = listSource.slice(listSource.indexOf("export async function GET"), listSource.indexOf("async function linkAttachments"));
  assert.match(getBlock, /if \(!user\).*401/);
  assert.match(getBlock, /\.eq\("user_id", user\.id\)/);
  assert.match(getBlock, /\.is\("deleted_at", null\)/);
  assert.match(getBlock, /effective_role: scope\?\.role/);
});

test("상세 API는 request와 attachment 모두 user_id 소유권을 검증하고 타인은 404로 숨긴다", () => {
  const fields = detailSource.match(/\.select\("([^"]*user_response[^"]*)"\)/)?.[1] ?? "";
  assert.match(fields, /user_response/);
  assert.doesNotMatch(fields, /admin_note|contact_email|device_info|guardian_id|user_id|child_id/);
  assert.ok((detailSource.match(/\.eq\("user_id", user\.id\)/g) ?? []).length >= 2);
  assert.match(detailSource, /if \(!supportRequest\).*404/);
  assert.match(detailSource, /createSignedUrl\(attachment\.storage_path, 3600\)/);
  assert.match(detailSource, /effective_role: scope\?\.role/);
  assert.doesNotMatch(detailSource, /Promise\.all\(/);
});
