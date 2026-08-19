import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 019 — Vercel Cron 은 GET 으로 부른다. 2026-08-20 02:01 실측: 크론이 돌았는데
// 라우트가 POST 만 노출해 Run 이 하나도 안 만들어졌다.
// vercel.json 에 등록된 크론 경로는 반드시 GET 을 노출해야 한다.
test("vercel.json 의 모든 크론 경로가 GET 핸들러를 노출한다", () => {
  const root = process.cwd();
  const cfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    crons?: Array<{ path: string }>;
  };
  const crons = cfg.crons ?? [];
  assert.ok(crons.length > 0, "vercel.json 에 크론이 없다");

  const missing: string[] = [];
  for (const cron of crons) {
    // 쿼리스트링을 떼고 라우트 파일 경로로 바꾼다.
    const routePath = cron.path.split("?")[0].replace(/^\//, "");
    const file = join(root, "app", routePath, "route.ts");
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      missing.push(`${cron.path} (route.ts 없음: ${file})`);
      continue;
    }
    // GET 을 내보내는 두 가지 형태를 모두 인정한다 —
    //   export async function GET(...)      (대부분의 라우트)
    //   export const GET = handleWorker     (plan-retention/worker 가 이 형태다)
    // 처음에 앞쪽만 봐서 정상 라우트를 결함으로 잡았다.
    const exposesGet =
      /export\s+async\s+function\s+GET\b/.test(source) ||
      /export\s+(?:const|let|var)\s+GET\s*=/.test(source);
    if (!exposesGet) {
      missing.push(`${cron.path} (GET 핸들러 없음)`);
    }
  }
  assert.deepEqual(missing, [], `크론이 호출할 수 없는 경로: ${missing.join(", ")}`);
});
