const crypto = require('crypto');

// 2026-08-11 사고 대응: 6월 9일자 1회성 초기화 마이그레이션
// (20260609400000_family_clean_slate.sql, DROP TABLE ... CASCADE로 가족/아이/
// 대화 테이블 전체를 비움)이 apply-migration.js에 "이미 적용됐는지" 추적이
// 전혀 없어 재실행되며 개발 서버 데이터가 전부 삭제됐다. 대표님 지시
// ("절대 내 허락 없이 데이터를 삭제하는 미친짓은 하면 안 된다")에 따라
// 이 파일은 두 겹의 안전장치를 제공한다: (1) 파괴적 SQL 패턴은 플래그로도
// 우회 불가 — 항상 실행을 거부한다. (2) 이미 적용된 파일의 재실행은
// --force 없이는 거부한다.

const DESTRUCTIVE_PATTERNS = [
  { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP SCHEMA', re: /\bDROP\s+SCHEMA\b/i },
  { name: 'DROP DATABASE', re: /\bDROP\s+DATABASE\b/i },
  { name: 'TRUNCATE', re: /\bTRUNCATE\b/i },
  { name: 'DELETE FROM', re: /\bDELETE\s+FROM\b/i },
  { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  // 게이트① 2라운드 지적: 아래 4개가 원래 denylist에 빠져 있어 "파괴적 SQL은 항상
  // 거부"라는 보장이 성립하지 않았다.
  { name: 'DROP OWNED', re: /\bDROP\s+OWNED\b/i },
  { name: 'DROP TYPE', re: /\bDROP\s+TYPE\b/i },
  // 동적 EXECUTE는 문자열로 조립된 SQL을 실행해 정적 정규식 검사를 원천적으로
  // 우회할 수 있다 — 이 스크립트로는 파괴적 여부를 판정할 수 없으므로 안전한
  // 방향으로 항상 차단한다(사람이 직접 검토 후 실행).
  { name: 'EXECUTE(dynamic)', re: /\bEXECUTE\s+(format\s*\(|'|")/i },
  // WHERE 절 없는 UPDATE는 테이블 전체를 덮어써 사실상 데이터 파기와 동급이다.
  // 세미콜론으로 문장을 나눠 문장 단위로 WHERE 존재 여부를 검사한다(다음 UPDATE/
  // 세미콜론 전까지 WHERE가 없으면 위반으로 판정).
  { name: 'UPDATE without WHERE', re: /\bUPDATE\s+(?:ONLY\s+)?[\w.]+\s+SET\b(?:(?!\bWHERE\b|;).)*;/is },
];

// 게이트① 리뷰 지적: 키워드 사이에 SQL 주석을 끼우면(`DROP/*x*/TABLE`,
// `DROP -- x\nTABLE`) 원래 정규식을 우회할 수 있었다. 실제 SQL 문장 토큰만
// 보도록 주석을 먼저 제거한 뒤 검사한다. 문자열 리터럴 안의 `--`/`/*`는
// 구분하지 않지만, 그 경우 최악에도 과탐지(더 안전한 방향)만 발생하고
// 우회(과소탐지)로는 이어지지 않는다.
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function detectDestructiveStatements(sql) {
  const withoutComments = stripSqlComments(sql);
  return DESTRUCTIVE_PATTERNS.filter((pattern) => pattern.re.test(withoutComments)).map((pattern) => pattern.name);
}

// 게이트① 3라운드 지적: apply-migration.js는 마이그레이션 SQL과 적용기록 INSERT를
// 하나의 query 문자열로 합쳐 한 번의 HTTP 호출로 보내 원자성을 확보한다(Postgres
// simple query protocol의 암묵적 트랜잭션). 그런데 파일 자체에 이미 BEGIN/COMMIT이
// 들어있으면 파일의 COMMIT 시점에 그 변경이 먼저 확정돼버려, 뒤에 이어붙인 기록
// INSERT가 실패해도 "적용됐지만 기록 안 됨" 상태가 재발한다. 이런 파일은 애초에
// 거부하고, 트랜잭션 제어문 없이 다시 작성하도록 안내한다(스크립트가 이미 암묵적
// 트랜잭션을 제공하므로 파일에 BEGIN/COMMIT을 넣을 필요가 없다).
function detectTransactionControlStatements(sql) {
  // 주의: PL/pgSQL 함수 본문의 `BEGIN ... END;` 블록 구문과 절대 혼동하면 안 된다.
  // 그 블록의 BEGIN 뒤에는 항상 실행문이 오지 세미콜론이 바로 오지 않는다 — 반면
  // 최상위 트랜잭션 시작 `BEGIN;`은 세미콜론이 바로 뒤따른다. 이 차이로 구분한다.
  const withoutComments = stripSqlComments(sql);
  const found = [];
  if (/\bBEGIN\s*;/i.test(withoutComments)) found.push('BEGIN');
  if (/\bCOMMIT\s*;/i.test(withoutComments)) found.push('COMMIT');
  return found;
}

function computeChecksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

const TRACKING_TABLE = 'public._migration_apply_log';

// 게이트① 2라운드 지적: 이 테이블에 AGENTS.md §11의 일반 규약(GRANT ALL TO anon,
// authenticated)을 그대로 적용하면 앱단(PostgREST) 클라이언트가 이 로그를 직접
// 변조해 재실행 방지를 우회할 수 있다. 이 테이블은 Management API(서비스 등급
// PAT)로만 다루는 내부 운영 도구용 테이블이라 앱에서 접근할 이유가 전혀
// 없으므로, 이 한 테이블에 한해 GRANT ALL 관례를 의도적으로 따르지 않는다 —
// RLS를 켜고 정책을 하나도 만들지 않아 기본 거부(anon/authenticated 접근 불가,
// service_role만 RLS를 우회해 접근 가능)로 둔다.
function ensureTrackingTableSQL() {
  return `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
  filename text NOT NULL,
  target_env text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (filename, target_env)
);
ALTER TABLE ${TRACKING_TABLE} ENABLE ROW LEVEL SECURITY;
-- 게이트① 3라운드 지적: RLS만으로는 TRUNCATE를 막지 못하고(TRUNCATE는 RLS 대상이
-- 아님), anon SELECT가 권한오류가 아닌 빈 배열이었다는 사실 자체가 테이블 생성 시
-- Supabase 기본 ALTER DEFAULT PRIVILEGES로 인한 잔여 권한이 있을 수 있음을 시사한다.
-- PUBLIC/anon/authenticated 권한을 명시적으로 전부 회수해 RLS와 무관하게 원천 차단한다.
REVOKE ALL ON ${TRACKING_TABLE} FROM PUBLIC, anon, authenticated;`;
}

function lookupSQL(filename, targetEnv) {
  const escapedFilename = filename.replace(/'/g, "''");
  const escapedTarget = targetEnv.replace(/'/g, "''");
  return `SELECT checksum, applied_at FROM ${TRACKING_TABLE} WHERE filename = '${escapedFilename}' AND target_env = '${escapedTarget}';`;
}

function recordAppliedSQL(filename, targetEnv, checksum) {
  const escapedFilename = filename.replace(/'/g, "''");
  const escapedTarget = targetEnv.replace(/'/g, "''");
  const escapedChecksum = checksum.replace(/'/g, "''");
  return `INSERT INTO ${TRACKING_TABLE} (filename, target_env, checksum, applied_at)
VALUES ('${escapedFilename}', '${escapedTarget}', '${escapedChecksum}', now())
ON CONFLICT (filename, target_env) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();`;
}

module.exports = {
  detectDestructiveStatements,
  detectTransactionControlStatements,
  computeChecksum,
  ensureTrackingTableSQL,
  lookupSQL,
  recordAppliedSQL,
  TRACKING_TABLE,
};
