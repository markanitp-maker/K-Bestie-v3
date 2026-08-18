-- ==============================================================================
-- 2026-08-18 자유대화 황금열쇠 미지급 보상 지급
--
-- 사고: chat_messages.raw_transcript 컬럼이 프로덕션에 없어 자유대화 메시지 저장이
-- 전부 500 으로 실패했다(PGRST204). 097 STT 재해석 코드는 배포됐는데 마이그레이션이
-- 프로덕션에 적용되지 않았다. 어제 374건 저장 → 오늘 0건.
--
-- 황금열쇠 지급 조건은 chat_messages 의 아이 발화를 세는 것이라, 메시지가 하나도
-- 안 남아 "의미 발화 3개 미만"으로 판정돼 아무도 못 받았다.
-- 30분 넘게 대화한 안서아도 못 받았다.
--
-- 대표 지시(2026-08-18): "금일 자유대화 진행한 사용자 전부 찾아서 황금열쇠를 즉시 지급"
--
-- 대상: 오늘(KST) free_chat 세션이 있는 실계정 아이. 테스트 계정은 제외한다.
-- 아이 잘못이 아니므로 턴 수 조건을 따지지 않는다 — 턴 집계 자체가 사고의 영향권이다.
--
-- 중복 방지: 오늘 이미 freechat_daily_engagement 를 받은 아이는 제외한다.
-- 잔액 상한: 활성 22개 상한을 지킨다(정상 지급 로직과 동일).
-- ==============================================================================

INSERT INTO public.gold_key_ledger (
  child_id,
  reason,
  expires_at,
  reward_type,
  source_session_id,
  business_date
)
SELECT DISTINCT ON (c.id)
  c.id,
  'freechat',
  now() + interval '7 days',
  'freechat_daily_engagement',
  s.id,
  (now() AT TIME ZONE 'Asia/Seoul')::date
FROM public.chat_sessions s
JOIN public.child_profiles c ON c.id = s.child_id
WHERE s.session_type = 'free_chat'
  AND (s.started_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
  AND COALESCE(c.is_test_account, false) = false
  AND COALESCE(c.is_internal_test, false) = false
  -- 오늘 이미 받은 아이는 건너뛴다
  AND NOT EXISTS (
    SELECT 1 FROM public.gold_key_ledger g
    WHERE g.child_id = c.id
      AND g.reward_type = 'freechat_daily_engagement'
      AND g.business_date = (now() AT TIME ZONE 'Asia/Seoul')::date
  )
  -- 활성 잔액 상한 22개를 지킨다
  AND (
    SELECT count(*) FROM public.gold_key_ledger g2
    WHERE g2.child_id = c.id
      AND g2.consumed = false
      AND g2.expires_at > now()
  ) < 22
ORDER BY c.id, s.turn_count DESC, s.started_at DESC;
