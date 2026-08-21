-- hairstyle 등록 되돌리기.
--
-- 주의: 이미 hairstyle 세션·티켓이 생겼다면 FK 때문에 DELETE 가 실패한다.
-- 그 경우 행을 지우지 말고 노출만 끄는 아래 UPDATE 를 쓴다(데이터는 보존).

UPDATE play_registry
SET is_active = false, is_visible = false, updated_at = now()
WHERE play_id = 'hairstyle';

-- 참조가 전혀 없을 때만 완전 삭제한다.
DELETE FROM play_registry pr
WHERE pr.play_id = 'hairstyle'
  AND NOT EXISTS (SELECT 1 FROM play_execution_tickets t WHERE t.play_id = 'hairstyle')
  AND NOT EXISTS (SELECT 1 FROM k_play_sessions s WHERE s.play_type = 'hairstyle');
