-- Migration: 20260726200000_mbti_platform_bridge.sql
--
-- 목적: 플랫폼(K-Bestie-v3) ↔ 독립 MBTI 프로젝트(E:\VibeCoding\mbti) 연결 구조
-- (.omc/specs/deep-interview-mbti-platform-connection.md, 2026-07-26 딥 인터뷰 확정)의
-- DB 계층. 두 개의 신규 테이블 + 세 개의 신규 RPC를 추가한다. 기존 gold_key_ledger,
-- gold_key_reservations, k_play_sessions 스키마는 전혀 건드리지 않는다(데이터 보존형).
--
-- ── 설계 요약 ────────────────────────────────────────────────────────────────
-- play_registry: 플랫폼이 소유하는 놀이 "표시/운영" 메타데이터만(딥 인터뷰 ⑦). 실제
--   upstream URL·서명 비밀값은 여기 저장하지 않는다(서버 전용 env + next.config.ts
--   rewrite 설정에만 존재).
-- play_execution_tickets: 1회용 실행 티켓(딥 인터뷰 ③). 발급(issued) → 서버간 교환
--   (exchanged, MBTI 서버가 playSessionId를 받는 시점) → 준비완료(ready, MBTI가 실제로
--   화면을 띄울 수 있다고 확인한 시점 — 이 시점에만 황금열쇠 confirm, 딥 인터뷰 ⑤)의
--   3단계 상태 전이를 갖는다. exchanged 상태에서 일정 시간 안에 ready가 오지 않으면
--   (또는 issued 상태에서 만료되면) restore 대상이다.
--
-- ── confirm 타이밍에 대한 정확한 해석 ───────────────────────────────────────────
-- 딥 인터뷰 Round 5 답변은 "티켓 교환 정상 완료 + playSessionId 발급 + 실행 준비 완료"를
-- 한 시점처럼 서술했지만, Round 3의 restore 트리거 목록에 "정해진 시간 안에 실행 준비
-- 완료 신호가 오지 않는 경우"가 별도로 명시돼 있어 "교환"과 "준비완료 신호"를 서로 다른
-- 두 단계로 보는 것이 더 정확하다(교환 자체는 성공했지만 그 직후 MBTI 서버 초기화가
-- 실패하는 경우까지 restore 대상에 포함되기 때문). 그래서 exchange(세션 발급, 예약은
-- 아직 'reserved' 유지) → ready(실제 confirm) 2단계로 구현한다.
--
-- ── pg_cron 사용하지 않음 ────────────────────────────────────────────────────
-- 만료 판정은 별도 cron 등록 없이, 티켓을 조회/조작하는 모든 RPC 안에서 lazy하게
-- "expires_at이 지났는데 아직 issued/exchanged면 즉시 restore + expired 처리"를
-- 수행한다(자기치유형). CLAUDE.md STOP 조건("pg_cron 실제 등록")을 피하기 위한
-- 의도적 설계다 — 나중에 배치 정리가 필요하면 이 로직을 감싸는 cron을 별도 승인 받아
-- 추가할 수 있다.

-- ================================================================
-- 1. play_registry — 놀이 표시/운영 메타데이터
-- ================================================================
CREATE TABLE play_registry (
  play_id       TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,
  keys_cost     INTEGER NOT NULL CHECK (keys_cost > 0),
  is_visible    BOOLEAN NOT NULL DEFAULT true,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE play_registry IS
  '독립 놀이 앱의 표시/운영 메타데이터만 보관한다(딥 인터뷰 ⑦). 실제 upstream URL,
   basePath, 서버 인증키·서명 비밀값은 여기 저장하지 않는다 — 서버 전용 환경변수와
   next.config.ts의 rewrite 설정에서만 관리한다. is_visible/is_active/sort_order/
   keys_cost 변경은 플랫폼 재배포 없이 즉시 반영되는 것이 목적이다.';

ALTER TABLE play_registry ENABLE ROW LEVEL SECURITY;

-- 목록 조회(활성 놀이 표시)는 로그인 사용자 누구나 가능, 쓰기는 service_role만.
CREATE POLICY "play_registry_select_authenticated"
  ON play_registry FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "play_registry_write_service_only"
  ON play_registry FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.play_registry TO authenticated;
GRANT ALL ON public.play_registry TO service_role;

CREATE OR REPLACE FUNCTION public.set_play_registry_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_play_registry_updated_at
  BEFORE UPDATE ON play_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_play_registry_updated_at();

-- 시드: MBTI 1행 (기존 k_play_sessions.keys_cost CHECK 제약과 동일하게 3으로 맞춘다)
INSERT INTO play_registry (play_id, display_name, description, icon, keys_cost, is_visible, is_active, sort_order)
VALUES ('mbti', 'MBTI 성격 유형', '나는 어떤 동물 친구일까?', '🔮', 3, true, true, 10);

-- ================================================================
-- 2. play_execution_tickets — 1회용 실행 티켓
-- ================================================================
CREATE TABLE play_execution_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_token      TEXT NOT NULL,
  play_id          TEXT NOT NULL REFERENCES play_registry(play_id),
  child_id         UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  reservation_id   UUID REFERENCES gold_key_reservations(id),
  play_session_id  UUID REFERENCES k_play_sessions(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'issued'
                     CHECK (status IN ('issued', 'exchanged', 'ready', 'expired')),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  exchanged_at     TIMESTAMPTZ,
  ready_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE play_execution_tickets IS
  '1회용 실행 티켓(딥 인터뷰 ③). ticket_token은 브라우저에는 Secure+HttpOnly 쿠키로만
   전달되고 URL·쿼리스트링·localStorage·클라이언트 JS에는 절대 노출하지 않는다. MBTI
   서버는 이 토큰을 서버간 호출(exchange)로 정확히 1회 교환한다. status: issued(발급
   직후) → exchanged(MBTI 서버가 세션을 받음) → ready(MBTI가 실행 준비 완료를 알림,
   reservation_id가 있으면 이 시점에 황금열쇠 confirm) 또는 expired(만료/실패로 인해
   restore됨). reservation_id가 NULL이면 "이어하기" 티켓이다 — 이미 이전에 confirm된
   기존 in_progress 세션을 재개하는 것뿐이라 새로 예약·차감할 황금열쇠가 없다(신규 시작
   과 달리 이 함수 밖에서 reserve_gold_keys_for_play를 호출하지 않는다).';

CREATE UNIQUE INDEX uidx_play_execution_tickets_token ON play_execution_tickets (ticket_token);
CREATE INDEX idx_play_execution_tickets_reservation ON play_execution_tickets (reservation_id);
CREATE INDEX idx_play_execution_tickets_expiring ON play_execution_tickets (expires_at) WHERE status IN ('issued', 'exchanged');

ALTER TABLE play_execution_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "play_execution_tickets_service_only"
  ON play_execution_tickets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.play_execution_tickets TO service_role;

CREATE TRIGGER trg_play_execution_tickets_updated_at
  BEFORE UPDATE ON play_execution_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_k_play_sessions_updated_at();

-- ================================================================
-- 3. issue_play_execution_ticket — 티켓 발급(사용자용 API가 호출)
-- ================================================================
-- 예약(reserve_gold_keys_for_play)은 이 함수 밖에서 이미 완료됐다고 가정한다(호출부가
-- reservation_id를 갖고 들어옴) — 기존 reserve 로직을 그대로 재사용하기 위함.
CREATE OR REPLACE FUNCTION public.issue_play_execution_ticket(
  p_ticket_token TEXT,
  p_play_id TEXT,
  p_child_id UUID,
  p_reservation_id UUID,
  p_ttl_seconds INTEGER DEFAULT 90
) RETURNS TABLE (
  ticket_id UUID,
  expires_at TIMESTAMPTZ,
  reason TEXT
) AS $$
DECLARE
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  v_expires := now() + make_interval(secs => p_ttl_seconds);

  INSERT INTO play_execution_tickets (ticket_token, play_id, child_id, reservation_id, status, expires_at)
  VALUES (p_ticket_token, p_play_id, p_child_id, p_reservation_id, 'issued', v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_expires, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.issue_play_execution_ticket(TEXT, TEXT, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_play_execution_ticket(TEXT, TEXT, UUID, UUID, INTEGER) TO service_role;

-- ================================================================
-- 4. exchange_play_execution_ticket — 서버간 1회 교환(MBTI 서버 전용 API가 호출)
-- ================================================================
-- 예약(gold key)은 여기서 confirm하지 않는다 — "ready" 신호가 와야 confirm된다(위 설계
-- 요약 참고). 이 함수는 티켓을 소비(exchanged)하고 k_play_sessions 행을 만들거나
-- 재사용할 뿐이다. 만료된 issued 티켓은 여기서 발견되면 즉시 restore+expired 처리하고
-- 실패를 반환한다(lazy 만료).
CREATE OR REPLACE FUNCTION public.exchange_play_execution_ticket(
  p_ticket_token TEXT
) RETURNS TABLE (
  success BOOLEAN,
  ticket_id UUID,
  play_session_id UUID,
  child_id UUID,
  progress_state JSONB,
  reason TEXT
) AS $$
DECLARE
  v_ticket RECORD;
  v_session_id UUID;
  v_progress_state JSONB;
BEGIN
  SELECT * INTO v_ticket
  FROM play_execution_tickets
  WHERE ticket_token = p_ticket_token
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::UUID, NULL::JSONB, 'not_found'::text;
    RETURN;
  END IF;

  -- lazy 만료 처리: issued 상태로 기한이 지났으면 즉시 restore
  IF v_ticket.status = 'issued' AND v_ticket.expires_at <= now() THEN
    PERFORM public.restore_gold_key_reservation(v_ticket.reservation_id);
    UPDATE play_execution_tickets SET status = 'expired' WHERE id = v_ticket.id;
    RETURN QUERY SELECT false, v_ticket.id, NULL::UUID, NULL::UUID, NULL::JSONB, 'expired'::text;
    RETURN;
  END IF;

  IF v_ticket.status <> 'issued' THEN
    RETURN QUERY SELECT false, v_ticket.id, NULL::UUID, NULL::UUID, NULL::JSONB, ('invalid_status:' || v_ticket.status)::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_ticket.child_id::text));

  -- k_play_sessions: 기존 in_progress 세션 재사용 또는 신규 생성(등록 메타데이터로부터
  -- keys_cost 조회). confirm은 여기서 하지 않으므로 gold_key_ledger는 건드리지 않는다.
  SELECT id, progress_state INTO v_session_id, v_progress_state
  FROM k_play_sessions
  WHERE child_id = v_ticket.child_id AND play_type = v_ticket.play_id AND status = 'in_progress'
  FOR UPDATE;

  IF v_session_id IS NULL THEN
    INSERT INTO k_play_sessions (child_id, play_type, keys_cost, status, started_at, expires_at)
    SELECT v_ticket.child_id, v_ticket.play_id, pr.keys_cost, 'in_progress', now(), now() + interval '6 hours'
    FROM play_registry pr WHERE pr.play_id = v_ticket.play_id
    RETURNING id, progress_state INTO v_session_id, v_progress_state;
  END IF;

  UPDATE play_execution_tickets
  SET status = 'exchanged', exchanged_at = now(), play_session_id = v_session_id
  WHERE id = v_ticket.id;

  RETURN QUERY SELECT true, v_ticket.id, v_session_id, v_ticket.child_id, v_progress_state, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.exchange_play_execution_ticket(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exchange_play_execution_ticket(TEXT) TO service_role;

-- ================================================================
-- 5. mark_play_execution_ticket_ready — 실행 준비 완료(MBTI 서버 전용 API가 호출) → confirm
-- ================================================================
CREATE OR REPLACE FUNCTION public.mark_play_execution_ticket_ready(
  p_ticket_token TEXT,
  p_ready_timeout_seconds INTEGER DEFAULT 30
) RETURNS TABLE (
  success BOOLEAN,
  reason TEXT
) AS $$
DECLARE
  v_ticket RECORD;
  v_confirm_success BOOLEAN;
  v_confirm_reason TEXT;
BEGIN
  SELECT * INTO v_ticket
  FROM play_execution_tickets
  WHERE ticket_token = p_ticket_token
  FOR UPDATE;

  IF v_ticket IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  -- lazy 만료 처리: exchanged 상태로 교환 후 ready 타임아웃을 넘겼으면 restore
  IF v_ticket.status = 'exchanged'
     AND v_ticket.exchanged_at IS NOT NULL
     AND v_ticket.exchanged_at + make_interval(secs => p_ready_timeout_seconds) <= now()
  THEN
    PERFORM public.restore_gold_key_reservation(v_ticket.reservation_id);
    UPDATE play_execution_tickets SET status = 'expired' WHERE id = v_ticket.id;
    RETURN QUERY SELECT false, 'ready_timeout'::text;
    RETURN;
  END IF;

  IF v_ticket.status <> 'exchanged' THEN
    RETURN QUERY SELECT false, ('invalid_status:' || v_ticket.status)::text;
    RETURN;
  END IF;

  -- reservation_id가 NULL이면 "이어하기" 티켓 — 이미 예전에 confirm된 기존 세션을
  -- 재개하는 것뿐이라 새로 confirm할 예약이 없다(위 테이블 코멘트 참고).
  IF v_ticket.reservation_id IS NOT NULL THEN
    SELECT success, reason INTO v_confirm_success, v_confirm_reason
    FROM public.confirm_gold_key_reservation(v_ticket.reservation_id);

    IF NOT v_confirm_success THEN
      RETURN QUERY SELECT false, ('confirm_failed:' || v_confirm_reason)::text;
      RETURN;
    END IF;
  END IF;

  UPDATE play_execution_tickets
  SET status = 'ready', ready_at = now()
  WHERE id = v_ticket.id;

  RETURN QUERY SELECT true, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.mark_play_execution_ticket_ready(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_play_execution_ticket_ready(TEXT, INTEGER) TO service_role;

-- ================================================================
-- 6. play_internal_event_idempotency — 서버전용 진행/완료/닫기/오류 API의 중복 방지
-- ================================================================
-- 딥 인터뷰 Round 8(구현전 보강 3번): 서버전용 API 호출에 idempotencyKey 검증 적용.
-- 같은 idempotencyKey로 재요청이 오면 최초 처리 결과를 그대로 반환하고 부작용을
-- 반복하지 않는다.
CREATE TABLE play_internal_event_idempotency (
  idempotency_key  TEXT PRIMARY KEY,
  play_session_id  UUID NOT NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN ('progress', 'complete', 'close', 'error')),
  response_body    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE play_internal_event_idempotency IS
  'MBTI 서버 전용 내부 API(progress/complete/close/error)의 idempotencyKey 중복 방지.
   응답 본문을 캐싱해 재요청 시 동일 응답을 그대로 반환한다.';

CREATE INDEX idx_play_internal_event_idempotency_session
  ON play_internal_event_idempotency (play_session_id, created_at DESC);

ALTER TABLE play_internal_event_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "play_internal_event_idempotency_service_only"
  ON play_internal_event_idempotency FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.play_internal_event_idempotency TO service_role;
