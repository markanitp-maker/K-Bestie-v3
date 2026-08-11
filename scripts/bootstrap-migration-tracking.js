#!/usr/bin/env node
// 게이트① 2라운드 지적: _migration_apply_log는 최초 생성 시 비어 있어, 이미 실제로
// 적용된 마이그레이션 파일도 apply-migration.js 관점에서는 "미적용"으로 보여 재실행
// 방지가 완성되지 않는다(파괴적 SQL 자체는 플래그 무관 항상 차단이라 그 부분은 이미
// 안전하지만, 비파괴적 파일의 의도치 않은 재실행 방지는 이 부트스트랩이 있어야
// 완전해진다). 이 스크립트는 1회성이다 — supabase/migrations/*.sql(하위 rollback/
// 제외) 전체를 "지금 시점 기준 이미 적용됨"으로 기록만 한다. SQL을 실행하지 않는다.
//
// 사용법: node scripts/bootstrap-migration-tracking.js --target=dev|prod

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
const { computeChecksum, ensureTrackingTableSQL, TRACKING_TABLE } = require('./lib/migrationSafety');

const PROJECT_REF = resolveProjectRef();
const TARGET_ENV = getTargetEnv();
assertProdConfirmed();

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}

async function runSQL(q) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : { success: true };
}

async function main() {
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => fs.statSync(path.join(migrationsDir, f)).isFile()); // rollback/ 하위 디렉터리 제외

  console.log(`${TARGET_ENV.toUpperCase()} 대상 부트스트랩: ${files.length}개 파일`);

  await runSQL(ensureTrackingTableSQL());

  const rows = files.map((filename) => {
    const content = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    const checksum = computeChecksum(content);
    return { filename, checksum };
  });

  const values = rows
    .map((r) => `('${r.filename.replace(/'/g, "''")}', '${TARGET_ENV}', '${r.checksum}', now())`)
    .join(',\n');

  const insertSQL = `INSERT INTO ${TRACKING_TABLE} (filename, target_env, checksum, applied_at)
VALUES
${values}
ON CONFLICT (filename, target_env) DO NOTHING;`;

  await runSQL(insertSQL);
  console.log('부트스트랩 완료.');
}

main().catch((err) => {
  console.error('✗ 오류:', err.message);
  process.exit(1);
});
