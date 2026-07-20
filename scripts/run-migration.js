#!/usr/bin/env node
// 사용법: node scripts/run-migration.js
// 사전 조건: .env.local 에 SUPABASE_ACCESS_TOKEN=<PAT> 추가

const fs = require('fs')
const path = require('path')

// ── .env.local 파싱 ──────────────────────────────────────────
const envPath = path.join(__dirname, '../.env.local')
const envVars = {}
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
})

const TOKEN = envVars['SUPABASE_ACCESS_TOKEN']
const { resolveProjectRef } = require('./lib/resolveTarget')
const PROJECT_REF = resolveProjectRef()

if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN 이 .env.local 에 없습니다.')
  process.exit(1)
}

// ── SQL 파일 읽기 ────────────────────────────────────────────
const SQL_FILE = path.join(__dirname, '../supabase/migrations/20260609400000_family_clean_slate.sql')
const sql = fs.readFileSync(SQL_FILE, 'utf8')

// ── Management API 실행 ──────────────────────────────────────
async function runSQL(query, label) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`[${label}] HTTP ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function main() {
  console.log('── 마이그레이션 시작 ──────────────────────────')

  // 전체 SQL 실행
  await runSQL(sql, 'migration')
  console.log('✓ 마이그레이션 적용 완료')

  // ── 검증 1: 테이블 목록 ──────────────────────────────────
  const tables = await runSQL(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
    'verify-tables'
  )
  console.log('\n── 생성된 테이블 ──────────────────────────────')
  tables.forEach(r => console.log('  ✓', r.table_name))

  // ── 검증 2: RLS 활성화 여부 ──────────────────────────────
  const rls = await runSQL(
    `SELECT tablename, rowsecurity FROM pg_tables
     WHERE schemaname = 'public' ORDER BY tablename`,
    'verify-rls'
  )
  console.log('\n── RLS 상태 ───────────────────────────────────')
  rls.forEach(r => console.log(`  ${r.rowsecurity ? '✓' : '✗'} ${r.tablename}`))

  // ── 검증 3: 정책 수 ──────────────────────────────────────
  const policies = await runSQL(
    `SELECT tablename, COUNT(*) as cnt FROM pg_policies
     WHERE schemaname = 'public' GROUP BY tablename ORDER BY tablename`,
    'verify-policies'
  )
  console.log('\n── RLS 정책 수 ────────────────────────────────')
  policies.forEach(r => console.log(`  ${r.tablename}: ${r.cnt}개`))

  // ── 검증 4: 트리거 ───────────────────────────────────────
  const triggers = await runSQL(
    `SELECT trigger_name, event_object_table FROM information_schema.triggers
     WHERE trigger_schema = 'public' OR event_object_schema = 'auth'`,
    'verify-triggers'
  )
  console.log('\n── 트리거 ─────────────────────────────────────')
  triggers.forEach(r => console.log(`  ✓ ${r.trigger_name} on ${r.event_object_table}`))

  console.log('\n── 완료 ───────────────────────────────────────')
}

main().catch(err => {
  console.error('\n✗ 오류:', err.message)
  process.exit(1)
})
