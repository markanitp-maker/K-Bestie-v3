// public 스키마 마이그레이션 회귀 가드.
//
// 2026-08-19 Supabase Security Advisor 가 `rls_disabled_in_public` 로 두 테이블을 잡았다:
// public.client_version_events, public.turn_timing_events. 둘 다 서버 service_role 로만
// 쓰는 계측 테이블인데 RLS 가 꺼진 채 anon/authenticated 에게 GRANT ALL 이 남아 있었다.
// 새 테이블을 추가할 때 같은 실수가 반복되지 않도록 마이그레이션 파일 자체를 검사한다.
//
// 이 테스트는 DB 에 접속하지 않는다 — 마이그레이션 SQL 만 본다. 그래서 CI 어디서나 돈다.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/**
 * RLS 를 켜지 않아도 되는 테이블.
 *
 * profiles: 20260607000000_phase1_schema.sql 에서 만들었다가 이후 구조 개편으로 사라졌다.
 * Production/Dev 어디에도 존재하지 않는다(2026-08-19 확인). 과거 파일을 고치지 않기 위해
 * 예외로 둔다. 새 항목을 여기 추가하려면 "왜 RLS 가 필요 없는지"를 근거와 함께 적어야 한다.
 */
const RLS_EXEMPT_TABLES = new Set<string>(["profiles"]);

const readAllMigrations = (): string => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return files.map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")).join("\n");
};

const collect = (sql: string, pattern: RegExp): Set<string> => {
  const found = new Set<string>();
  for (const match of sql.matchAll(pattern)) found.add(match[1]);
  return found;
};

const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi;
const ENABLE_RLS = /ALTER\s+TABLE\s+(?:public\.)?"?(\w+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
const CREATE_POLICY = /CREATE\s+POLICY\s+[^\n]*?\s+ON\s+(?:public\.)?"?(\w+)"?/gi;
const REVOKE_FROM_PUBLIC_ROLES =
  /REVOKE\s+[\w\s,]+?\s+ON\s+(?:TABLE\s+)?(?:public\.)?"?(\w+)"?\s+FROM\s+[^;]*?(?:anon|authenticated)/gi;

test("public 테이블은 전부 RLS 를 켠다", () => {
  const sql = readAllMigrations();
  const created = collect(sql, CREATE_TABLE);
  const rlsEnabled = collect(sql, ENABLE_RLS);

  const missing = [...created].filter(
    (table) => !rlsEnabled.has(table) && !RLS_EXEMPT_TABLES.has(table)
  );

  assert.deepEqual(
    missing.sort(),
    [],
    `RLS 를 켜지 않은 테이블이 있다. 마이그레이션에 ALTER TABLE ... ENABLE ROW LEVEL SECURITY 를 넣거나, ` +
      `서버 전용이라 정말 필요 없다면 RLS_EXEMPT_TABLES 에 근거와 함께 추가하라: ${missing.join(", ")}`
  );
});

test("anon/authenticated 에 GRANT 한 테이블은 policy 가 있거나 권한을 회수했다", () => {
  // GRANT 만 있고 policy 도 REVOKE 도 없으면, RLS 를 켜도 "권한은 있는데 정책이 없는" 어긋난
  // 상태가 남는다. 실제로 turn_timing_events 가 그 상태였다.
  const sql = readAllMigrations();
  const policied = collect(sql, CREATE_POLICY);
  const revoked = collect(sql, REVOKE_FROM_PUBLIC_ROLES);

  const grantedToPublicRoles = new Set<string>();
  const grantPattern = /GRANT\s+[\w\s,]+?\s+ON\s+(?:TABLE\s+)?(?:public\.)?"?(\w+)"?\s+TO\s+([\w\s,"]+?);/gi;
  for (const match of sql.matchAll(grantPattern)) {
    const roles = match[2].toLowerCase();
    if (roles.includes("anon") || roles.includes("authenticated")) {
      grantedToPublicRoles.add(match[1]);
    }
  }

  const dangling = [...grantedToPublicRoles].filter(
    (table) => !policied.has(table) && !revoked.has(table)
  );

  assert.deepEqual(
    dangling.sort(),
    [],
    `anon/authenticated 권한만 있고 policy 도 REVOKE 도 없는 테이블이 있다: ${dangling.join(", ")}`
  );
});

test("이번 핫픽스 대상 두 테이블은 RLS 가 켜져 있고 권한이 회수돼 있다", () => {
  const sql = readAllMigrations();
  const rlsEnabled = collect(sql, ENABLE_RLS);
  const revoked = collect(sql, REVOKE_FROM_PUBLIC_ROLES);

  for (const table of ["client_version_events", "turn_timing_events"]) {
    assert.ok(rlsEnabled.has(table), `${table} 에 ENABLE ROW LEVEL SECURITY 가 없다`);
    assert.ok(revoked.has(table), `${table} 의 anon/authenticated 권한 회수가 없다`);
  }
});
