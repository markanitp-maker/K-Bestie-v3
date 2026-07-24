-- Migration: 20260723150000_mbti_completion_events.sql
--
-- [K-Bestie-v3 이관 기록, 2026-07-25] 이 파일은 원래 별도 mbti 저장소
-- (/mnt/e/VibeCoding/mbti)에서 작성·적용된 것을 MBTI 네이티브 통합(/play/mbti,
-- app/api/mbti/complete) 작업 시 이 저장소로 복사해 이력을 남긴 것이다.
-- 두 저장소가 같은 Supabase 프로젝트(Dev ref mkrsaaedxqrcrktapaus)를 공유하므로
-- 테이블은 이미 존재한다(run-query.js로 information_schema 조회해 확인 완료) —
-- 이 파일을 다시 실행하지 않는다. K-Bestie-v3의 lib/report/recordMbtiCompletionEvent.ts
-- 가 이 테이블에 쓴다.
--
-- 상태: 대표 명시 승인 후 2026-07-23 Dev Supabase(ref mkrsaaedxqrcrktapaus)에 적용 완료.
-- Prod(ref fetvnhhjicndmxvhrffk)에는 반영되지 않았으며, 별도 승인 없이는 반영하지 않는다.
-- 리뷰어(architect) 승인 완료(CLAUDE.md §16 — 공유 DB 스키마 확장),
-- same as 20260723100000_mbti_free_trial_coupons.sql.
--
-- 목적: US-012(부모 리포트 전달) — "놀이 완료 → 부모에게 알림" 경로가 기존 스키마에 전혀 없음을
-- US-000/US-012 조사에서 확인. 이 파일은 그 경로의 MBTI 쪽 절반(이벤트 기록)만 이 레포(별도 Vercel
-- 프로젝트)의 권한 범위 안에서 추가한다. 반대쪽 절반(그 이벤트를 부모 화면에 실제로 보여주는 소비
-- 로직)은 K-Bestie-v3 레포에 있고 이번 작업 범위 밖이다 — 아래 "다운스트림 연동" 절 참고.
--
-- ================================================================
-- 설계 근거 — 왜 daily_reports에 직접 INSERT하지 않는가 (K-Bestie-v3 읽기전용 조사 결과)
-- ================================================================
-- K-Bestie-v3/supabase/migrations/20260607000000_phase1_schema.sql 확인 결과:
--   CREATE TABLE daily_reports (
--     ...
--     session_id UUID NOT NULL REFERENCES chat_sessions(id),
--     ...
--   );
-- session_id가 NOT NULL이고 chat_sessions(id)만 참조하는 경직된 FK다. MBTI 완료는
-- k_play_sessions(놀이 세션)에서 일어나고 chat_sessions와 무관하므로, 이 제약을 어기지 않고는
-- daily_reports에 MBTI 결과 행을 직접 넣을 수 없다. 그 제약을 완화(NOT NULL 해제/FK 변경)하는 것은
-- daily_reports의 "기존 컬럼 스키마 변경"에 해당해 prd.json US-012 acceptance criteria 4번
-- ("daily_reports 테이블 자체의 기존 컬럼 스키마는 변경하지 않음")과 정면으로 충돌한다.
-- K-Bestie-v3/lib/batch/generateDailyReports.ts 확인 결과 배치는 채팅 메시지를 Gemini로 요약해
-- dashboard_cards 8개 필드(school_academy_life 등, 20260725000000_daily_reports_eight_fields.sql)를
-- 채우는데, MBTI 최종 유형은 이미 결정론적 점수 로직의 산출물이라(SPEC.md §1 "AI 사용 범위: MBTI
-- 판정 = 점수 합산 로직(AI 무관)") 같은 방식의 AI 요약이 필요하지도, 적절하지도 않다.
--
-- 결론: "신규 전용 리포트 테이블 생성 금지"(US-012 AC 1번)라는 제약과 "daily_reports 기존 컬럼
-- 불변"(AC 4번)이라는 제약이 동시에 있는 상태에서, daily_reports에 물리적으로 끼워 넣을 방법이
-- 없다. 따라서 이 마이그레이션은 daily_reports를 대체하는 "리포트" 테이블이 아니라, daily_reports
-- 파이프라인이 (또는 그와 나란히 부모 화면 API가) 나중에 읽어가는 얇은 이벤트 아웃박스 1개만
-- 추가한다 — 그 자체로는 부모에게 보여지는 리포트가 아니라 리포트 생성을 위한 입력 신호일 뿐이다
-- (chat_messages가 daily_reports 배치의 입력 신호인 것과 같은 관계).
--
-- ================================================================
-- 다운스트림 연동 (이 레포 범위 밖 — K-Bestie-v3에 별도 PR 필요, 여기서는 실행/수정하지 않음)
-- ================================================================
-- 권장안: generateDailyReports.ts의 야간 배치(chat_sessions 기준)에 억지로 끼워 넣기보다,
-- K-Bestie-v3/app/api/parent/reports/route.ts(부모가 리포트 목록을 읽는 GET API)가 daily_reports와
-- "나란히" mbti_completion_events를 childId로 조회해 응답에 합쳐 내려주는 편이 더 적합하다:
--   - MBTI 결과는 이미 확정된 값이라 야간 배치(가공/요약)를 기다릴 이유가 없다(완료 즉시 부모가 볼
--     수 있는 편이 오히려 더 정확한 UX).
--   - daily_reports.session_id의 NOT NULL FK를 건드릴 필요가 전혀 없다(응용 계층 병합이므로).
-- 의사코드(문서화 목적, 이 파일에서 실행하지 않음 — 실제 반영은 K-Bestie-v3 레포에서 별도 승인 후):
--   const { data: mbtiEvents } = await supabase
--     .from("mbti_completion_events")
--     .select("id, mbti_type, occurred_at")
--     .in("child_id", [childId]);
--   // reports 배열에 daily_reports와 동일한 모양(summary_line 격)으로 합쳐서 반환
-- 이 절은 리뷰어가 US-012 AC 1번("배치 경로에 반영되는 연동 코드 존재")을 판단할 때 참고할 설계
-- 문서이며, 실제 K-Bestie-v3 코드 변경은 그 레포의 자체 리뷰 게이트를 다시 통과해야 한다.
--
-- ================================================================
-- 1. mbti_completion_events — MBTI 완료 이벤트 아웃박스 (프로젝트 접두사 mbti_)
-- ================================================================
-- 아이 문항별 답변 원문은 절대 저장하지 않는다(SPEC.md §3.4 "아이 문항별 답변 원문 노출 금지").
-- 저장하는 것은 오직 "누가·언제·최종 유형이 무엇으로 나왔는가" — 결과 유형과 요약에 필요한 최소
-- 정보뿐이다. 양육 팁 본문 자체도 여기 저장하지 않는다(lib/data/typeProfiles.ts의 정적 데이터에서
-- mbti_type 키로 언제든 재구성 가능하므로 중복 저장하지 않음 — 데이터는 한 곳에서만 유지).
CREATE TABLE mbti_completion_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id      UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  -- k_play_sessions(id) 참조 + UNIQUE로 세션당 이벤트 정확히 0~1개를 DB 레벨에서 보증한다
  -- (동시에 완료 요청이 경합해도 completed/route.ts는 CAS로 이긴 요청 1개에서만 이 이벤트를
  -- 기록하므로 중복이 나올 일이 없지만, 방어적으로 한 번 더 막는다).
  session_id    UUID NOT NULL UNIQUE REFERENCES k_play_sessions(id) ON DELETE CASCADE,
  mbti_type     TEXT NOT NULL CHECK (
    mbti_type IN (
      'ISTJ','ISFJ','ISTP','ISFP','INFJ','INTJ','INFP','INTP',
      'ENFP','ENFJ','ENTP','ENTJ','ESFP','ESFJ','ESTP','ESTJ'
    )
  ),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = 아직 다운스트림(부모 화면/배치)에서 소비되지 않음. 소비 시점에 그 쪽에서 채운다.
  -- 이 레포는 이 컬럼을 쓰기만 하고 채우지 않는다(소비자 책임).
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mbti_completion_events_child_id
  ON mbti_completion_events (child_id);

CREATE INDEX idx_mbti_completion_events_unprocessed
  ON mbti_completion_events (occurred_at)
  WHERE processed_at IS NULL;

COMMENT ON TABLE mbti_completion_events IS
  'MBTI 놀이 완료 시 부모 리포트 파이프라인이 소비할 최소 이벤트(child_id, mbti_type, 시각)만 기록.
   문항별 답변 원문·양육 팁 본문은 절대 저장하지 않는다(SPEC.md §3.4). 그 자체로는 부모 화면에
   직접 노출되는 "리포트"가 아니라 daily_reports/부모 API가 읽어가는 입력 신호다.';

-- ================================================================
-- 2. RLS — mbti_free_trial_coupons와 동일한 패턴
--    (service_role 전체 허용, 부모는 자기 가족 자녀 것만 SELECT, anon 접근 불가, 쓰기는 service_role 전용)
-- ================================================================
ALTER TABLE mbti_completion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mbti_completion_events_select_parent_only"
  ON mbti_completion_events FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = mbti_completion_events.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

CREATE POLICY "mbti_completion_events_write_service_only"
  ON mbti_completion_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- GEMINI.md §10 컨벤션: 테이블 생성 시 GRANT ALL ... TO anon, authenticated 포함.
-- 실제 행 접근은 위 RLS 정책이 제한하므로(anon은 두 정책 모두에서 걸러짐) 이 GRANT 자체가 접근을
-- 넓히지 않는다 — mbti_free_trial_coupons와 동일한 프로젝트 표준 패턴을 그대로 따른 것뿐이다.
GRANT ALL ON public.mbti_completion_events TO anon, authenticated;
