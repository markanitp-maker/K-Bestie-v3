#!/usr/bin/env node
// 사용법: node scripts/run-join-requests-migration.js
const fs = require('fs')
const path = require('path')

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

const SQL_FILE = path.join(__dirname, '../supabase/migrations/20260612000000_family_join_requests.sql')
const sql = fs.readFileSync(SQL_FILE, 'utf8')

async function runSQL(query, label) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`[${label}] HTTP ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function main() {
  console.log('── 마이그레이션 실행 ──────────────────────────')
  await runSQL(sql, 'migration')
  console.log('✓ family_join_requests 마이그레이션 적용 완료')

  // 검증 1: 테이블 존재
  const tables = await runSQL(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name='family_join_requests'`,
    'verify-table'
  )
  console.log('\n── 테이블 확인 ────────────────────────────────')
  if (tables.length > 0) console.log('  ✓ family_join_requests 존재')
  else console.log('  ✗ 테이블 없음 (오류)')

  // 검증 2: 컬럼
  const cols = await runSQL(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='family_join_requests'
     ORDER BY ordinal_position`,
    'verify-cols'
  )
  console.log('\n── 컬럼 ───────────────────────────────────────')
  cols.forEach(c => console.log(`  ✓ ${c.column_name} (${c.data_type}, nullable:${c.is_nullable})`))

  // 검증 3: RLS 활성화 + 정책
  const rls = await runSQL(
    `SELECT rowsecurity FROM pg_tables
     WHERE schemaname='public' AND tablename='family_join_requests'`,
    'verify-rls'
  )
  console.log('\n── RLS 상태 ───────────────────────────────────')
  console.log(`  ${rls[0]?.rowsecurity ? '✓' : '✗'} RLS 활성화: ${rls[0]?.rowsecurity}`)

  const policies = await runSQL(
    `SELECT policyname, cmd FROM pg_policies
     WHERE schemaname='public' AND tablename='family_join_requests'
     ORDER BY policyname`,
    'verify-policies'
  )
  console.log('\n── RLS 정책 ───────────────────────────────────')
  policies.forEach(p => console.log(`  ✓ ${p.policyname} (${p.cmd})`))

  // 검증 4: 인덱스
  const indexes = await runSQL(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND tablename='family_join_requests'
     ORDER BY indexname`,
    'verify-indexes'
  )
  console.log('\n── 인덱스 ─────────────────────────────────────')
  indexes.forEach(i => console.log(`  ✓ ${i.indexname}`))

  // 검증 5: 오너가 자기 가족 신청만 조회 가능한지 RLS 정책 내용 확인
  const rlsDetail = await runSQL(
    `SELECT policyname, qual FROM pg_policies
     WHERE schemaname='public' AND tablename='family_join_requests' AND cmd='SELECT'`,
    'verify-rls-select'
  )
  console.log('\n── SELECT RLS 정책 상세 ───────────────────────')
  rlsDetail.forEach(p => console.log(`  ${p.policyname}:\n    ${p.qual}`))

  console.log('\n── 완료 ───────────────────────────────────────')
}

main().catch(err => {
  console.error('\n✗ 오류:', err.message)
  process.exit(1)
})
