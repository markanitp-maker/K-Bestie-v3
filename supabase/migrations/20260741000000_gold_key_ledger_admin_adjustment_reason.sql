-- 목적: gold_key_ledger.reason CHECK 제약에 'admin_adjustment' 값을 허용 추가.
-- 배경: 2026-07-24 김서아·김서현 잔액을 22개로 보정하며 reason='mission'으로 44건을
-- 삽입했는데(reward_type으로만 구분), 이는 일일 미션 적립 한도 계산 함수
-- (lib/goldkey/ledger.ts의 countEarnedToday(childId, "mission"))가 참조하는 reason
-- 값과 같아 개념적으로 부정확하다(실제 미션 완료 보상이 아님). 전용 reason 값을
-- 추가해 명확히 분리한다 - 이 값은 countEarnedToday가 절대 조회하지 않으므로
-- 일일 한도·출석 로직에 전혀 영향을 주지 않는다.
-- Dev 전용 적용 (Production 미적용).

ALTER TABLE gold_key_ledger DROP CONSTRAINT gold_key_ledger_reason_check;
ALTER TABLE gold_key_ledger ADD CONSTRAINT gold_key_ledger_reason_check
  CHECK (reason IN ('attendance', 'mission', 'admin_adjustment'));

-- 2026-07-24 관리자 보정으로 잘못 reason='mission'으로 들어간 44건
-- (reward_type='admin_balance_correction_20260724'로 표시돼 있던 행)을 정정.
UPDATE gold_key_ledger
SET reason = 'admin_adjustment'
WHERE reward_type = 'admin_balance_correction_20260724'
  AND reason = 'mission';
