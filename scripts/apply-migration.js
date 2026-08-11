#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const TOKEN = envVars['SUPABASE_ACCESS_TOKEN'];
const { resolveProjectRef, getTargetEnv, assertProdConfirmed } = require('./lib/resolveTarget');
const {
  detectDestructiveStatements,
  detectTransactionControlStatements,
  computeChecksum,
  ensureTrackingTableSQL,
  lookupSQL,
  recordAppliedSQL,
} = require('./lib/migrationSafety');
const PROJECT_REF = resolveProjectRef();
const TARGET_ENV = getTargetEnv();

assertProdConfirmed();

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}

// 2026-08-11 사고 대응: 인자 없이 실행하면 임의의 기본 파일을 조용히 적용하던
// 과거 동작을 제거한다 — 파일 경로를 반드시 명시하지 않으면 즉시 중단한다.
if (!process.argv[2]) {
  console.error('ERROR: 적용할 마이그레이션 파일 경로를 명시하세요.');
  console.error('예시: node scripts/apply-migration.js supabase/migrations/<파일>.sql');
  process.exit(1);
}

const sqlPath = require('path').resolve(process.argv[2]);
if (!fs.existsSync(sqlPath)) {
  console.error(`ERROR: SQL file not found: ${sqlPath}`);
  process.exit(1);
}

const filename = path.basename(sqlPath);
const query = fs.readFileSync(sqlPath, 'utf8');
const checksum = computeChecksum(query);
const forceRerun = process.argv.includes('--force');

// 2026-08-11 사고 대응: DROP TABLE/TRUNCATE 등 파괴적 SQL은 어떤 플래그로도
// 우회할 수 없다 — 항상 거부한다. 대표님 명시 승인 하에 사람이 직접
// Supabase SQL Editor에서 내용을 확인하며 실행해야 한다(CLAUDE.md 안전장치).
const destructive = detectDestructiveStatements(query);
if (destructive.length > 0) {
  console.error('=========================================');
  console.error('⛔ 파괴적 SQL 패턴이 감지되어 이 스크립트로는 실행할 수 없습니다.');
  console.error(`감지된 패턴: ${destructive.join(', ')}`);
  console.error('이 스크립트는 파괴적 마이그레이션을 절대 자동 실행하지 않습니다(대표님 승인 없는 데이터 삭제 금지).');
  console.error('대표님 명시 승인을 받은 뒤 Supabase SQL Editor에서 사람이 직접 내용을 확인하며 실행하세요.');
  console.error('=========================================');
  process.exit(1);
}

// 게이트① 3라운드 지적: 파일 자체에 BEGIN/COMMIT이 있으면 파일의 COMMIT 시점에
// 변경이 먼저 확정돼, 뒤에 이어붙이는 적용기록 INSERT가 실패해도 "적용됐지만
// 기록 안 됨" 상태가 재발한다. 이 스크립트는 이미 다중 문장을 하나의 암묵적
// 트랜잭션으로 보내 원자성을 제공하므로, 파일에 트랜잭션 제어문을 넣을 필요가
// 없다 — 있으면 거부하고 제거를 안내한다.
const txControl = detectTransactionControlStatements(query);
if (txControl.length > 0) {
  console.error('=========================================');
  console.error('⛔ 이 파일에 트랜잭션 제어문(BEGIN/COMMIT)이 포함되어 있어 실행할 수 없습니다.');
  console.error(`감지됨: ${txControl.join(', ')}`);
  console.error('이 스크립트는 마이그레이션 SQL과 적용기록을 하나의 암묵적 트랜잭션으로 원자적으로 처리합니다.');
  console.error('파일에서 BEGIN;/COMMIT; 문장을 제거한 뒤 다시 실행하세요(PL/pgSQL 함수 본문의 BEGIN...END;는 무관합니다).');
  console.error('=========================================');
  process.exit(1);
}

console.log(`=========================================`);
console.log(`적용 대상: ${TARGET_ENV.toUpperCase()} 프로젝트 ${PROJECT_REF}`);
if (TARGET_ENV === 'prod') {
  console.log(`⚠️  운영(PRODUCTION) 환경에 마이그레이션을 적용합니다`);
}
console.log(`파일: ${sqlPath}`);
console.log(`=========================================`);

async function runSQL(q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : { success: true };
}

async function main() {
  await runSQL(ensureTrackingTableSQL());

  const lookupResult = await runSQL(lookupSQL(filename, TARGET_ENV));
  const previouslyApplied = Array.isArray(lookupResult) ? lookupResult[0] : null;

  if (previouslyApplied && !forceRerun) {
    console.error('=========================================');
    console.error(`⛔ 이 파일은 ${TARGET_ENV.toUpperCase()}에 이미 적용된 기록이 있습니다.`);
    console.error(`   적용 시각: ${previouslyApplied.applied_at}`);
    console.error(`   내용 일치 여부: ${previouslyApplied.checksum === checksum ? '동일' : '변경됨(다른 checksum)'}`);
    console.error('재실행하려면 정말 의도한 것인지 확인 후 --force 플래그를 명시하세요.');
    console.error('=========================================');
    process.exit(1);
  }

  // 게이트① 지적: 마이그레이션 실행과 적용기록 INSERT를 별도 HTTP 호출로 나누면
  // 그 사이 프로세스/네트워크 장애 시 "적용됐지만 미기록" 상태가 남아 다음 실행이
  // --force 없이도 통과해버린다. 하나의 query 문자열로 합쳐 한 번의 HTTP 호출로
  // 보낸다 — Postgres는 세미콜론으로 구분된 다중 문장을 명시적 BEGIN/COMMIT이 없으면
  // 하나의 암묵적 트랜잭션으로 실행하므로(simple query protocol), 마이그레이션 SQL
  // 자체가 트랜잭션 제어문을 포함하지 않는 한 이 방식으로 원자성이 보장된다.
  await runSQL(`${query}\n${recordAppliedSQL(filename, TARGET_ENV, checksum)}`);
  console.log('Migration applied successfully.');
}

main().catch((err) => {
  console.error('✗ 오류:', err.message);
  process.exit(1);
});
