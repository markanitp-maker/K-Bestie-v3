-- scripts/056_identify_internal_test_accounts.sql
-- 대상: k-bestie-v3-prod (Production)
-- 주의: 이 스크립트는 직접 실행하지 않고, 대표 승인 후 안전하게 Production 환경에 적용해야 합니다.

-- 1. 부모 계정 식별 및 is_internal_test 설정
UPDATE family_members
SET is_internal_test = true
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE email IN ('qa-parent@kbestie.local', 'markanitp@gmail.com')
);

-- 2. 아이 계정 식별 및 is_internal_test 설정
-- 아이 계정은 auth.users에 email로 존재하며, family_members를 거쳐 child_profiles에 연결됩니다.
UPDATE child_profiles
SET is_internal_test = true
WHERE member_id IN (
  SELECT fm.id 
  FROM family_members fm
  JOIN auth.users au ON fm.user_id = au.id
  WHERE au.email IN (
    'testa@kbestie.local', 
    'testb@kbestie.local',
    'psa160202@kbestie.local',
    'psh160202@kbestie.local',
    'psd160202@kbestie.local'
  )
);
