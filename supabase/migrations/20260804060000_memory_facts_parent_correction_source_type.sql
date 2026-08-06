-- requests/022-seoa-friend-relationship-correction.md
-- memory_facts.source_type은 기존에 'mission'/'free_chat' 자동 추출 파이프라인
-- 산출물만 표현했다. 부모가 직접 확인해 정정한 사실(§6.2)은 이 두 값 중 어느
-- 것으로도 정확히 표현할 수 없어(자동 추출이 아니므로), 값을 지어내 끼워맞추는
-- 대신 enum 자체에 'parent_correction'을 추가한다. 기존 행/제약에는 영향 없는
-- additive 변경이다.
ALTER TABLE memory_facts DROP CONSTRAINT memory_facts_source_type_check;
ALTER TABLE memory_facts ADD CONSTRAINT memory_facts_source_type_check
  CHECK (source_type IN ('mission', 'free_chat', 'parent_correction'));
