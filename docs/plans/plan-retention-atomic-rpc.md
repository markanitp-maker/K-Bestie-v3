# 플랜 보존기간(retention) 원자화 재설계

> 근거: 채팅 직접 지시(요청서 없음, 2026-08-11) "개인정보 플랜 보존기간 자연 만료 hard delete"의
> 2연속 게이트① 반려(하드룰 §12-C). patch 방식으로는 새 동시성 구멍이 계속 나와, 근본 재설계로 전환한다.
> 작성: 메인 Claude (Opus, xhigh) — 여러 모듈 통합 판단(하드룰 1 예외).

## 0. 지금까지 반려 이력

1라운드(커밋 `7817eae` 리뷰): C1(가족별 premium_retention_years 미전달로 무제한 오판정), S1(참조행만 지워지고 본 리포트가 남는 동시성 창).
2라운드(C1/S1 수정 리뷰): 새 레이스 2건 — 다운그레이드 커밋~stampRetention 사이 창에서 자연만료 purge가 활성 행을 유예 없이 즉시 hard delete.
3라운드(2단계 stamp→purge 재설계 리뷰): [복잡] 4건 —
  a) daily_reports phase 2: 참조행(evidence_card_links/report_views) 삭제 후 본행 재확인 사이에 restore가 끼어들면 참조행만 유실.
  b) phase 2가 현재 tier/premium_retention_years를 재확인하지 않아, 무제한(Premium NULL) 가족의 과거 스탬프 행도 hard delete 대상이 될 수 있음(weekly/child_memory도 동일).
  c) retentionStamp.ts의 세션→메시지, 리포트, 위클리 UPDATE들이 트랜잭션이 아니라 부분 실패 시 불일치 상태로 수렴하지 않음.
  d) API 라우트가 tier를 먼저 커밋한 뒤 retention 함수를 호출 — 실패해도 tier는 이미 바뀌어 있고, 재시도는 `oldTier===newTier`로 즉시 성공해 스탬프를 다시 시도하지 않음.

공통 원인: **"tier 변경 → 보존기간 재계산 → 스탬프/복구 → (별도 시점) 자연만료 purge"가 전부 별개의 비트랜잭션 Supabase 호출로 쪼개져 있다.** TS 레이어에서 여러 라운드트립을 짜맞추는 한, 패치할 때마다 새 창이 생긴다.

## 1. 설계 원칙

- **plan tier 변경과 retention 스탬프를 하나의 Postgres 함수(단일 트랜잭션)로 묶는다.** TS 레이어는 이 RPC를 호출만 한다 — 두 단계로 나눠 호출하지 않는다.
- **자연만료 purge(주기 배치)도 "그 시점의 실제 tier/family 정책"을 매번 다시 조회하는 단일 SQL 문으로 판정한다.** 이전에 스탬프됐다는 사실 자체가 아니라, "지금도 여전히 만료 대상인가"를 hard delete 직전에 재확인한다.
- **참조행(evidence_card_links/report_views) 삭제와 본행 삭제를 같은 문장에서 원자적으로 묶는다** — 가능하면 FK `ON DELETE CASCADE`로 전환해 본행 DELETE 한 문장이 참조행까지 함께 지우도록 한다(참조행을 먼저 지우고 본행을 나중에 지우는 2단계 자체를 없앤다).
- **무제한(Premium, premium_retention_years IS NULL) 가족은 purge 함수의 모든 단계(stamp든 hard-delete든)에서 원천적으로 대상 집합에 들지 않아야 한다** — "과거에 스탬프됐음"이 아니라 "지금 정책상 대상인가"로 매번 재필터링.

## 2. 신규 RPC

### 2.1 `apply_plan_tier_change(p_child_id uuid, p_new_tier int, p_active_pack_count int)`

- `child_profiles.tier` UPDATE + 유효 보존기간 재계산 + 초과분 스탬프(다운그레이드) 또는 유예 내 복구(재상향)를 **한 함수, 한 트랜잭션**으로 수행.
- `app/api/child/[id]/plan/route.ts`, `app/api/admin/plan-change-requests/[id]/approve/route.ts`는 현재의 "RPC로 tier 변경 → TS에서 stampRetention/restoreRetention 별도 호출" 2단계를 이 단일 RPC 호출로 교체한다.
- 실패 시 전체 트랜잭션이 롤백되므로 "tier만 바뀌고 스탬프는 안 된" 상태 자체가 발생하지 않는다 — 4-d 문제 해결.
- `lib/plan/retentionStamp.ts`의 세션→메시지, 리포트, 위클리 갱신 로직을 SQL로 이식(같은 함수 내부, 순수 UPDATE들 — PL/pgSQL이므로 자동으로 같은 트랜잭션) — 4-c 문제 해결.

### 2.2 `purge_plan_retention_*_batch` (기존 3개 함수, 재설계)

- 여전히 2단계(stamp 신규 만료분 → 30일 이상 경과분 hard delete) 구조는 유지하되:
  - **phase 2 대상 선정 쿼리에 eligible_children 조인을 다시 포함**시켜, `effective_months IS NOT NULL`(무제한 가족 제외)이고 그 가족이 지금도 여전히 유효 보존기간을 초과 상태인 행만 선택한다(재상향으로 이미 보존기간 안에 들어온 행은 phase 2에서 자동 제외).
  - **daily_reports**: 참조행 삭제 + 본행 삭제를 별도 DELETE 두 문장으로 두지 않는다. 대신 `evidence_card_links.daily_report_id`, `report_views.report_id`에 `ON DELETE CASCADE` FK가 걸려 있는지 먼저 확인하고(신규 migration에서 없으면 추가), 본행 DELETE 한 문장만 실행해 참조행은 DB가 알아서 함께 지우게 한다 — 4-a 문제 해결.

## 3. 서브 태스크 분할

| 서브 태스크 | 내용 | 담당 |
|---|---|---|
| R1 | `apply_plan_tier_change` RPC 신규 migration 작성(tier 변경 + retention 계산 + 스탬프/복구 통합) | Codex Sol([복잡], DB) |
| R2 | 위 RPC로 두 API 라우트 교체, `lib/plan/retentionStamp.ts`의 export를 얇은 래퍼로 축소(또는 미사용 시 삭제 — 호출부 전수 확인 후 판단) | Codex Sol |
| R3 | `evidence_card_links`/`report_views` FK를 `ON DELETE CASCADE`로 전환(또는 이미 그런지 확인), purge 3개 함수를 eligible_children 재조인 방식으로 재작성 | Codex Sol([복잡], DB) |
| R4 | 기존 `supabase/migrations/tests/plan_retention_hard_delete_verification.sql` 및 신규 검증 스크립트를 2단계+원자화 설계에 맞게 재작성(1라운드 stamp만 발생, 30일 경과 fixture만 hard delete, 무제한 가족 완전 불가침 확인) | Codex Terra/Sol |
| R5 | Dev DB 적용 + Dev 전용 시나리오 실증(다운그레이드 중 오류 주입, 재상향 동시 실행, 무제한 가족 회귀 없음) | Claude 직접 지시 → agy 또는 Codex 실행 |

## 4. 완료 기준

- R1~R4 게이트① 통과(claude-review 또는 codex-rv Sol).
- R5 Dev 실증 시나리오 전부 통과, 증거(SQL 출력/로그) 확보.
- 100(법적 동의) 문서가 실제 물리 보존기간(스탬프 시점 + 30일)과 정합하도록 함께 확정(별도 100 작업과 연계, 이 문서 범위 밖이지만 배포 순서상 선행 확인 필요).
- **모든 기준 통과 전까지 이 RPC들의 Production 배포·적용 금지.**
