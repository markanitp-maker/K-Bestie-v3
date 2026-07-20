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
const { resolveProjectRef, getTargetEnv } = require('./lib/resolveTarget');
const PROJECT_REF = resolveProjectRef();
const TARGET_ENV = getTargetEnv();

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.');
  process.exit(1);
}

const sqlPath = process.argv[2] ? require('path').resolve(process.argv[2]) : path.join(__dirname, '../supabase/migrations/20260724200000_fix_owner_succession_guard.sql');
if (!fs.existsSync(sqlPath)) {
  console.error(`ERROR: SQL file not found: ${sqlPath}`);
  process.exit(1);
}

console.log(`=========================================`);
console.log(`적용 대상: ${TARGET_ENV.toUpperCase()} 프로젝트 ${PROJECT_REF}`);
console.log(`파일: ${sqlPath}`);
console.log(`=========================================`);

const query = fs.readFileSync(sqlPath, 'utf8');

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

runSQL(query)
  .then(data => {
    console.log('Migration applied successfully.');
  })
  .catch(err => {
    console.error('✗ 오류:', err.message);
    process.exit(1);
  });
