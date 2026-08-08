import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.js";

test("생성 SW는 사용자 메시지 handler 한 곳에서만 skipWaiting을 실행한다", async () => {
  const response = await GET();
  const source = await response.text();
  assert.equal(source.match(/self\.skipWaiting\(\)/g)?.length, 1);
  assert.match(source, /event\.data\.type === "SKIP_WAITING"/);

  const installBlock = source.slice(
    source.indexOf('self.addEventListener("install"'),
    source.indexOf('self.addEventListener("activate"')
  );
  assert.doesNotMatch(installBlock, /self\.skipWaiting\(\)/);
});

test("SW 응답은 build별 shell cache와 no-cache 정책을 유지한다", async () => {
  const response = await GET();
  const source = await response.text();
  assert.match(source, /kbestie-shell-/);
  assert.match(response.headers.get("cache-control") || "", /no-cache/);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal(response.headers.get("service-worker-allowed"), "/");
});
