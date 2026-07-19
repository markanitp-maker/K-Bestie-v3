# Production 반영 실행계획 (Phase1~5, 코드 작성만 완료 / 미적용 상태)

이 문서는 **실행하지 않은 계획**입니다. 아래 순서·방법은 형진님 승인 후 실제 적용 시 참고용이며, 이 세션에서는 어떤 마이그레이션도 Production에 적용하지 않았습니다.

## 1. 적용 순서 (파일명 타임스탬프 순 = 의존성 순서와 일치)

Supabase 마이그레이션 컨벤션(타임스탬프 오름차순 적용)을 그대로 따르면 의존성 문제가 없습니다. 아래 14개 파일을 **이 순서 그대로** 적용하면 됩니다.

| # | 파일 | 의존성 | 비고 |
|---|---|---|---|
| 1 | `20260725000000_daily_reports_eight_fields.sql` | 없음 | daily_reports 8항목 컬럼 추가(ADD COLUMN IF NOT EXISTS — 재실행 안전) |
| 2 | `20260725100000_plan_retention_extension.sql` | 없음 | insight_retention_extensions 테이블 생성, families.premium_retention_years 추가 |
| 3 | `20260725100000_safety_events_alpha_allowlist.sql` | 없음 (2와 순서 무관, 동일 타임스탬프) | 알파 allowlist, fail-closed 함수, admin_audit_log 컬럼 추가+제약 임시 제거 |
| 4 | `20260725110000_admin_audit_log_action_check_restore.sql` | **3 이후 필수** | 3에서 제거한 제약을 신규 값 포함해 복원 — 반드시 3 다음에 실행 |
| 5 | `20260725200000_parent_questions_lifecycle.sql` | 없음 | parent_question_quota 테이블, parent_questions 상태머신 컬럼 |
| 6 | `20260725300000_goldkey_reserve_confirm_restore.sql` | 없음 | gold_key_reservations, reserve/confirm/restore 함수 |
| 7 | `20260725310000_goldkey_reserve_restart_fix.sql` | **6 이후 필수** | 6의 함수를 재시작 지원 버전으로 교체 |
| 8 | `20260725500000_batch_schedule_kst_adjust.sql` | 없음(개념상 1과 연관) | **cron.alter_job 실행문은 주석 처리됨 — 파일 상단에 "실행 금지" 명시. 수동 검토 후 실행 필요** |
| 9 | `20260725600000_account_lifecycle_notifications.sql` | 없음 | account_lifecycle_notifications 테이블(RLS 포함) |
| 10 | `20260725700000_parent_questions_answer_summary.sql` | 5 이후 권장 | parent_questions.child_answer_summary 컬럼 |
| 11 | `20260726100000_account_lifecycle_outbox.sql` | **9 이후 필수** | 9의 테이블에 retry_count/next_retry_at/template_key 추가 |
| 12 | `20260726200000_insight_extension_purchases.sql` | **2 이후 필수** | insight_extension_purchases 테이블 + purchase_insight_extension 함수(초기버전) |
| 13 | `20260726210000_purchase_insight_extension_auth_fix.sql` | **12 이후 필수** | 12의 함수를 IDOR 수정 버전으로 교체 |
| 14 | `20260726220000_insight_retention_extensions_rls.sql` | **2 이후 필수** | 2에서 누락됐던 RLS를 뒤늦게 추가(검증 과정에서 발견) |

**결론**: 타임스탬프 순서대로(1→14) 그대로 적용하면 모든 의존성이 자동으로 만족됩니다. 별도 순서 조정 불필요.

## 2. 멱등성 확인
- 컬럼 추가는 전부 `ADD COLUMN IF NOT EXISTS` 또는 신규 테이블의 `CREATE TABLE IF NOT EXISTS` 사용 — 재실행해도 안전
- 함수는 전부 `CREATE OR REPLACE FUNCTION` — 재실행 안전
- 단, `#4`(제약 복원)는 `DROP CONSTRAINT IF EXISTS` 후 재생성이라 안전, `#7/#13`은 `DROP FUNCTION IF EXISTS` 후 재생성이라 안전
- 정책(`CREATE POLICY`)은 `IF NOT EXISTS` 문법이 없으므로 **재실행 시 "already exists" 에러 발생 가능** — 재실행이 필요한 상황이면 해당 정책만 `DROP POLICY IF EXISTS` 후 재적용 필요(1회성 적용이면 문제 없음)

## 3. 롤백 계획
- **컬럼 추가류(1,2,5,9,10,11,12,14)**: `ALTER TABLE ... DROP COLUMN`으로 즉시 롤백 가능, 기존 데이터 영향 없음(전부 nullable 신규 컬럼)
- **신규 테이블(2,3,5,6,9,12)**: `DROP TABLE`로 롤백 가능(단, #6/#12는 다른 테이블 FK 참조 있으니 CASCADE 필요 여부 확인)
- **함수 교체(4,7,13)**: 이전 버전 정의를 별도 백업해두고 필요시 재실행. 롤백 파일은 이 세션에서 별도로 만들지 않았으므로, 롤백 필요 시 원본 함수 정의(각 마이그레이션 파일 자체)를 참고해 이전 CREATE OR REPLACE 문 재실행
- **cron 스케줄(8)**: 실행 자체를 보류(파일에 주석 처리됨)했으므로 롤백 이슈 없음

## 4. 예상 영향/리스크
| 영역 | 영향 | 리스크 등급 |
|---|---|---|
| daily_reports 8항목 | 기존 리포트 조회 API/화면 무영향(신규 컬럼 nullable), 과거 리포트는 8항목 전부 null로 표시됨(백필 여부는 별도 결정 필요 — 미결정) | 낮음 |
| safety_events 알파 | **알파 허용목록이 비어있으므로 배포 직후엔 관리자 누구도 원문을 볼 수 없음(fail-closed 기본값)** — 알파 테스트를 시작하려면 `scripts/seed-alpha-safety-allowlist.js`를 `.env.local`에 실제 값 채운 뒤 별도로 직접 실행해야 함. `SAFETY_EVENTS_ALPHA_MODE=true` 환경변수도 별도 설정 필요(미설정 시 원문 열람 기능 자체가 꺼짐) | 낮음(기본값이 안전 방향) |
| parent_questions 라이프사이클 | 기존 질문 등록 API 동작 방식이 바뀜(쿼터 체크 추가) — 배포 직후 부모가 갑자기 "하루 1회 제한"에 걸릴 수 있음 | 중간 |
| 황금열쇠 예약/재시작 | 기존 즉시소모형 API와 병행 존재 — 신규 /api/play/* 라우트만 새 방식 사용, 기존 goldkey 소모 경로는 영향 없음 | 낮음 |
| 계정 알림 | SMTP 미설정 상태 유지 — 실제 메일 발송 없음(시뮬레이션), 사용자 체감 영향 없음 | 없음 |
| Care Insight 확장팩 | 부모 설정 화면에 신규 UI 노출됨 — "결제 연동 준비 중, 임시 무료 적용" 문구 포함되어 있어 오해 소지 있음(형진님 검토 권장) | 중간(UX 커뮤니케이션 리스크) |
| batch_schedule_kst_adjust | **실행 안 함(주석 처리)** — 실제 적용 시 `kbestie-daily-batch` 시각이 04시→03시로 바뀌고 `kbestie-collection-batch`는 신규 등록 필요(현재 Production에 해당 job 없음, 파일 내 주석의 cron.schedule 블록 사용) | 중간(운영 배치 스케줄 변경) |

## 5. 과거 daily_reports 백필 여부 (미결정)
과거에 생성된 daily_reports 행들은 8항목이 전부 `NULL`로 남습니다. 형진님 결정에 따라 이번 스코프에서는 백필하지 않으며, 필요 시 별도 백필 스크립트(과거 chat_messages를 재분석해 8항목 채우기)를 후속 작업으로 진행할 수 있습니다.

## 6. 배포 전 필수 체크리스트
- [ ] `ALPHA_SAFETY_CHILD_ID_1`, `ALPHA_SAFETY_CHILD_ID_2`, `ALPHA_SAFETY_ADMIN_ID` 값 확정 후 `.env.local`에 설정
- [ ] `scripts/seed-alpha-safety-allowlist.js` 실행(알파 테스트 시작 시점에)
- [ ] `SAFETY_EVENTS_ALPHA_MODE=true` 환경변수 설정(알파 기간에만, 베타 전환 시 반드시 제거/false)
- [ ] `supabase/migrations/tests/safety_events_fail_closed_test.sql` Production에서 실행해 fail-closed 동작 확인
- [ ] 베타(외부 가족) 온보딩 전: `SAFETY_EVENTS_ALPHA_MODE` 제거 + admin API가 `safety_events_admin_view` 기본 사용 재확인
- [ ] `20260725500000_batch_schedule_kst_adjust.sql`의 cron 변경문은 별도 검토 후 형진님이 직접 실행
