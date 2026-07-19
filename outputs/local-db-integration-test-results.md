# 로컬 임시 DB 통합테스트 결과 (Production 미적용, pglite 사용)

- 엔진: `@electric-sql/pglite`(WASM Postgres) — 이 환경에 Docker/sudo가 없어 로컬 Supabase 스택을 못 띄우므로 대체. RLS/plpgsql SECURITY DEFINER/gen_random_uuid/CREATE ROLE 전부 실제 동작 확인됨.
- base 스키마: Production의 실제 컬럼 정의(information_schema로 조회)를 그대로 반영해 구성(추측 없음). 77개 전체 마이그레이션 히스토리를 재생하지 않고, "현재 Production 스키마 형태 + 신규 마이그레이션 15개"만 검증한 것— 오래된 마이그레이션 다수가 pg_cron/auth 스키마 등 이 엔진에 없는 Supabase 전용 기능에 의존해 무의미한 실패를 낼 수 있어 제외.

## 1. 마이그레이션 적용 결과 (15개, 전부 타임스탬프 순)

| # | 파일 | 결과 |
|---|---|---|
| 1 | 20260725000000_daily_reports_eight_fields.sql | PASS |
| 2 | 20260725100000_plan_retention_extension.sql | PASS |
| 3 | 20260725100000_safety_events_alpha_allowlist.sql | PASS |
| 4 | 20260725110000_admin_audit_log_action_check_restore.sql | PASS |
| 5 | 20260725200000_parent_questions_lifecycle.sql | PASS |
| 6 | 20260725300000_goldkey_reserve_confirm_restore.sql | PASS |
| 7 | 20260725310000_goldkey_reserve_restart_fix.sql | PASS |
| 8 | 20260725500000_batch_schedule_kst_adjust.sql | PASS (cron 문장은 제외 처리) |
| 9 | 20260725600000_account_lifecycle_notifications.sql | PASS |
| 10 | 20260725700000_parent_questions_answer_summary.sql | PASS |
| 11 | 20260726100000_account_lifecycle_outbox.sql | PASS |
| 12 | 20260726200000_insight_extension_purchases.sql | PASS |
| 13 | 20260726210000_purchase_insight_extension_auth_fix.sql | PASS |
| 14 | 20260726220000_insight_retention_extensions_rls.sql | PASS |
| 15 | 20260726230000_purchase_insight_extension_auth_fix_null.sql (신규, 이번 검증 중 발견) | PASS |

**15/15 PASS.**

## 2. "plan_retention_extension.sql의 RLS=0" 실증

| 시점 | `insight_retention_extensions`의 `relrowsecurity` |
|---|---|
| #2 파일(plan_retention_extension.sql) 적용 직후 | **false** |
| #14 파일(insight_retention_extensions_rls.sql) 적용 직후 | **true** |

→ RLS는 2번 파일이 아니라 14번 파일에서 활성화됨이 실제 실행으로 증명됨.

## 3. 신규 테이블 추적표

| 테이블 | RLS 활성화 마이그레이션 | 정책명 | 허용 역할/조건 | 테스트 결과 |
|---|---|---|---|---|
| alpha_safety_text_allowlist | 20260725100000_safety_events_alpha_allowlist.sql | alpha_safety_text_allowlist_service_all | service_role만 | 간접 검증(get_safety_event_child_text 테스트로) |
| gold_key_reservations | 20260725300000_goldkey_reserve_confirm_restore.sql | gold_key_reservations_select_parent_only / _write_service_only | SELECT: 본인가족 부모, WRITE: service_role | 구조 확인(직접 통합테스트 대상 아님) |
| parent_question_quota | 20260725200000_parent_questions_lifecycle.sql(최초 결함), 같은 파일 내 수정본 | parent_question_quota_access | 본인가족 owner_parent/parent | 구조 확인 |
| account_lifecycle_notifications | 20260725600000_account_lifecycle_notifications.sql | Enable ALL for service_role | service_role만 | 구조 확인 |
| insight_extension_purchases | 20260726200000_insight_extension_purchases.sql | insight_extension_purchases_select | 본인가족 owner_parent/parent | 테스트4(IDOR)로 간접 검증 |
| insight_retention_extensions | **20260726220000**_insight_retention_extensions_rls.sql (원래 파일엔 없었음) | insight_retention_extensions_select/insert/update/delete | SELECT:본인가족, 나머지:service_role만 | 테스트2,3 직접 검증 |

## 4. 통합테스트 8종 결과 (전부 실제 SQL 실행, 합성 테스트 데이터만 사용 — 실제 아동 이름 미사용)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | anon 역할 — 6개 신규 테이블 전부 접근 차단 | **PASS** |
| 2 | 타 가족(authenticated) — 다른 가족의 insight_retention_extensions 조회 차단 | **PASS** |
| 3 | 본인 가족 — 자기 insight_retention_extensions 조회 허용 | **PASS** |
| 4 | IDOR — 타 가족 user가 남의 family_id로 purchase_insight_extension 호출 시 차단, 본인 family_id는 허용 | **PASS** (아래 5번 항목 버그 수정 후) |
| 5 | 알파 허용목록 밖 자녀 소속 안전이벤트 — 관리자가 조회해도 NULL | **PASS** |
| 6 | 알파 허용목록 내 자녀+관리자 매칭 — 실제 원문 반환 | **PASS** |
| 7 | 알파 허용목록 밖 관리자 — 허용된 자녀 소속이어도 NULL | **PASS** |
| 8 | safety_events_admin_view 구조 — child_text 컬럼 없음(베타 전면차단 뷰) | **PASS** |

**8/8 PASS.**

## 5. 이번 검증 과정에서 발견한 실제 보안 결함 1건 (수정 완료)

`purchase_insight_extension`(20260726210000 수정본)의 IDOR 방어 조건이 `IF auth.role() != 'service_role' THEN <소유권검사>` 형태였는데, **`auth.role()`이 NULL을 반환하는 경우 `NULL != 'service_role'`도 NULL이 되어 IF문 전체가 FALSE로 취급, 소유권 검사 자체를 건너뛰는 fail-open 버그**였다. `20260726230000_purchase_insight_extension_auth_fix_null.sql`에서 `IS DISTINCT FROM`으로 교체해 NULL도 안전하게(=검사를 강제하도록) 처리하도록 수정, 재검증 완료.

## 6. 종합 판정
**전체 PASS.** 마이그레이션 15개 전부 적용 성공, RLS 활성화 시점 실증 완료, 8개 보안 시나리오 전부 통과. 발견된 fail-open 버그는 수정 후 재검증까지 마침.
