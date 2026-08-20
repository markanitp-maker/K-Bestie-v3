-- K-Toon 통합 마이그레이션 A — play별 resume TTL 계약 + comic_book 등록
--
-- 배경 (2026-08-20 READ-ONLY 실측):
--   티켓 경로에서 k_play_sessions 를 만드는 함수는 exchange_play_execution_ticket 하나뿐이고,
--   그 INSERT 는 resume_expires_at 을 설정하지 않아 현재 모든 MBTI 세션이 NULL 이다.
--   살아있는 코드는 NULL 을 "만료 없음"으로 읽는다(api/play/session/route.ts:81-84,
--   20260805190000:139,155) — 실제로 dev/prod 양쪽에 17일 된 in_progress 세션이 있다.
--
--   이 파일은 TTL 을 데이터로 옮기고 comic_book 을 등록하기만 한다.
--   실제 resume_expires_at 세팅은 마이그레이션 B(exchange_play_execution_ticket)에서 한다.
--
-- 범위 제한 (2026-08-20 승인 D1):
--   reserve_gold_keys_for_play / start_new_play_session / consume_play_access 는
--   티켓 경로에서 호출되지 않으므로 이 변경 이유로 수정하지 않는다.
--   특히 reserve_gold_keys_for_play 의 활성 정의는 20260805190000 이며
--   황금열쇠 이중 차감 가드를 담고 있다. 건드리지 않는다.
--
-- 정본 계약: docs/ops/integration-contract.md §1

-- ================================================================
-- 1. play_registry.resume_ttl_hours — play별 이어하기 창
-- ================================================================
ALTER TABLE play_registry
  ADD COLUMN IF NOT EXISTS resume_ttl_hours INTEGER NOT NULL DEFAULT 6
    CHECK (resume_ttl_hours BETWEEN 1 AND 24);

COMMENT ON COLUMN play_registry.resume_ttl_hours IS
  '이어하기(resume) 허용 시간. exchange_play_execution_ticket 이 세션 생성 시
   resume_expires_at = now() + make_interval(hours => 이 값) 으로 쓴다.
   DEFAULT 6 이라 신규 놀이는 기존 의도(6시간)를 그대로 받는다. K-Toon(comic_book)만 5.';

-- 기존 놀이의 정책을 명시적으로 못박는다. DEFAULT 와 같은 값이지만
-- "우연히 기본값"이 아니라 "확정된 정책"임을 데이터로 남긴다.
UPDATE play_registry SET resume_ttl_hours = 6 WHERE play_id = 'mbti';

-- ================================================================
-- 2. comic_book 등록 (K-Toon)
-- ================================================================
-- ⚠️ play_execution_tickets.play_id 가 play_registry(play_id) 를 참조하므로
--    이 행이 없으면 티켓 발급 자체가 FK 위반으로 실패한다.
--
-- is_visible/is_active 는 false 로 시작한다. 공개 스위치는 Phase 5 에서
-- app/child/play/page.tsx 의 comingSoon 해제와 함께 한 번에 켠다.
INSERT INTO play_registry
  (play_id, display_name, description, icon, keys_cost, is_visible, is_active, sort_order, resume_ttl_hours)
VALUES
  ('comic_book', '만화책 읽기', '한 권을 골라 끝까지 읽어요', '📚', 2, false, false, 5, 5)
ON CONFLICT (play_id) DO UPDATE
  SET keys_cost        = EXCLUDED.keys_cost,
      resume_ttl_hours = EXCLUDED.resume_ttl_hours,
      display_name     = EXCLUDED.display_name,
      description      = EXCLUDED.description,
      icon             = EXCLUDED.icon,
      sort_order       = EXCLUDED.sort_order;
-- is_visible/is_active 는 ON CONFLICT 에서 덮어쓰지 않는다 —
-- 이미 공개된 뒤 이 마이그레이션이 재실행돼도 놀이를 끄지 않기 위해서다.

-- ================================================================
-- 3. 검증
-- ================================================================
DO $$
DECLARE
  v_mbti INTEGER;
  v_comic INTEGER;
  v_comic_keys INTEGER;
BEGIN
  SELECT resume_ttl_hours INTO v_mbti FROM play_registry WHERE play_id = 'mbti';
  SELECT resume_ttl_hours, keys_cost INTO v_comic, v_comic_keys
  FROM play_registry WHERE play_id = 'comic_book';

  IF v_mbti IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'mbti resume_ttl_hours 가 6 이 아니다: %', v_mbti;
  END IF;
  IF v_comic IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'comic_book resume_ttl_hours 가 5 가 아니다: %', v_comic;
  END IF;
  IF v_comic_keys IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'comic_book keys_cost 가 2 가 아니다: %', v_comic_keys;
  END IF;
END $$;
