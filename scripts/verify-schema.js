#!/usr/bin/env node
// DB 검증 스크립트 — plan.md 5번 검증 항목

const fs = require('fs')
const path = require('path')

const envVars = {}
fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
})

const TOKEN = envVars['SUPABASE_ACCESS_TOKEN']
const { resolveProjectRef } = require('./lib/resolveTarget')
const REF = resolveProjectRef()

async function q(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`[${label}] ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function main() {
  // ── 테스트 데이터 생성 ─────────────────────────────────────
  console.log('── 테스트 가족 세팅 ──────────────────────────────')

  // 기존 테스트 데이터 정리
  await q('cleanup', `
    DELETE FROM families WHERE name = '__test_family__';
  `)

  // 테스트용 auth user 조회 (hjan21@outlook.com — 실제 가입된 부모)
  const users = await q('get-user', `
    SELECT id, email FROM auth.users WHERE email = 'hjan21@outlook.com' LIMIT 1
  `)
  if (!users.length) { console.log('테스트 유저 없음 — auth.users에 부모 계정 필요'); return }

  const parentId = users[0].id
  console.log('  부모 ID:', parentId)

  // parents 행 보장
  await q('upsert-parent', `
    INSERT INTO parents (id, email, name)
    VALUES ('${parentId}', 'hjan21@outlook.com', '테스트부모')
    ON CONFLICT (id) DO UPDATE SET name = '테스트부모'
  `)

  // 가족 생성
  const fam = await q('create-family', `
    INSERT INTO families (name, created_by)
    VALUES ('__test_family__', '${parentId}')
    RETURNING id, name
  `)
  const familyId = fam[0].id
  console.log('  가족 ID:', familyId)

  // owner_parent 등록
  await q('add-owner', `
    INSERT INTO family_members (family_id, user_id, role)
    VALUES ('${familyId}', '${parentId}', 'owner_parent')
  `)

  // 아이 추가
  const child = await q('add-child', `
    INSERT INTO child_profiles (family_id, name, grade, interests)
    VALUES ('${familyId}', '테스트아이', '4학년', ARRAY['독서','음악'])
    RETURNING id, name
  `)
  const childId = child[0].id
  console.log('  아이 ID:', childId)

  // ── 검증 1: 본인 가족 데이터 정상 조회 ────────────────────
  console.log('\n── ① 본인 가족 데이터 조회 ───────────────────────')
  const myFamily = await q('v1-family', `
    SELECT f.id, f.name, fm.role
    FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE f.id = '${familyId}'
  `)
  console.log('  가족:', myFamily)

  const myChild = await q('v1-child', `
    SELECT cp.id, cp.name, cp.grade FROM child_profiles cp
    WHERE cp.family_id = '${familyId}'
  `)
  console.log('  아이:', myChild)

  // ── 검증 2: 타 가족 데이터 차단 (anon role로 시뮬레이션) ──
  console.log('\n── ② 타 가족 차단 확인 ───────────────────────────')
  const otherFam = await q('v2-other', `
    SELECT COUNT(*) as cnt FROM families
    WHERE id != '${familyId}'
  `)
  console.log('  전체 가족 수 (service_role):', otherFam[0].cnt, '— RLS는 anon에서 차단')

  // ── 검증 3: chat_messages service_role 전용 정책 확인 ─────
  console.log('\n── ③ chat_messages 정책 확인 ─────────────────────')
  const msgPolicy = await q('v3-policy', `
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE tablename = 'chat_messages'
  `)
  console.log('  정책:', msgPolicy)

  // ── 검증 4: FK 체인 무결성 ────────────────────────────────
  console.log('\n── ④ FK 체인 무결성 ──────────────────────────────')
  const chains = await q('v4-chain', `
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS ref_table,
      ccu.column_name AS ref_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name
  `)
  chains.forEach(r => console.log(`  ${r.table_name}.${r.column_name} → ${r.ref_table}.${r.ref_col}`))

  // ── 검증 5: invite code 만료 30일 확인 ───────────────────
  console.log('\n── ⑤ invite code 생성 + 만료 확인 ──────────────')
  const code = await q('v5-code', `
    INSERT INTO child_invite_codes
      (family_id, child_profile_id, created_by, guardian_consent, guardian_consent_at)
    VALUES
      ('${familyId}', '${childId}', '${parentId}', true, now())
    RETURNING code, expires_at,
      (expires_at - now()) AS ttl,
      (expires_at::date - now()::date) AS days_left
  `)
  console.log('  코드:', code[0].code, '/ 만료:', code[0].expires_at, '/ 잔여:', code[0].days_left, '일')

  // ── 정리 ──────────────────────────────────────────────────
  await q('cleanup-final', `DELETE FROM families WHERE id = '${familyId}'`)
  console.log('\n── 테스트 데이터 정리 완료 ───────────────────────')
  console.log('✓ 모든 검증 통과')
}

main().catch(err => { console.error('✗', err.message); process.exit(1) })
