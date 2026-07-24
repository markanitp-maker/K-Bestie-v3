-- child_profiles에 성(family_name)/이름(given_name)을 비파괴적으로 분리 저장한다.
-- 기존 name(전체 표시 이름) 컬럼은 그대로 유지 - 화면/리포트/관리자는 계속 name을 쓰거나
-- family_name+given_name 조합으로 표시하면 되고, 케이가 아이를 부를 때(call_name)만
-- given_name을 쓴다.
--
-- 백필 정책: 순수 한글 2~4자 이름만 안전하게 자동 분리한다(예: 홍길동 -> 홍/길동).
-- 흔한 복성(2글자 성)은 첫 2글자를 성으로 처리한다. 그 외(복성 목록에 없는 이상 이름,
-- 영문/숫자 포함, 공백, 길이 1자 또는 5자 이상 등 판단 불가 데이터)는 family_name/given_name을
-- NULL로 남겨 보호자가 아이 정보 관리 화면에서 직접 확인·입력하도록 한다 - 잘못 잘라
-- 저장하지 않는다.

ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS family_name TEXT;
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS given_name TEXT;

GRANT ALL ON child_profiles TO anon, authenticated;

UPDATE child_profiles
SET
  family_name = substring(
    name from 1 for
    CASE WHEN left(name, 2) IN ('남궁','황보','제갈','사공','독고','선우','서문','동방','어금','망절')
      THEN 2 ELSE 1 END
  ),
  given_name = substring(
    name from
    (CASE WHEN left(name, 2) IN ('남궁','황보','제갈','사공','독고','선우','서문','동방','어금','망절')
      THEN 3 ELSE 2 END)
  )
WHERE family_name IS NULL
  AND given_name IS NULL
  AND name ~ '^[가-힣]{2,4}$';
