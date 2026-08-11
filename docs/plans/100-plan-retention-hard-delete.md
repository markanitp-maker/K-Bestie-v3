# 100 — 플랜 보존기간 자연 만료 hard delete

## 목표

- 활성(`deleted_at IS NULL`) 리포트·요약·메모리 중 플랜 보존기간을 자연히 초과한 행만 bounded batch로 영구 삭제한다.
- Care Start 6개월, Care Insight `(3 + extensionYears) * 12`, Care Premium 1/3/5년 및 `NULL` 무제한을 TypeScript와 SQL에서 동일하게 계산한다.
- 기존 V3 raw/corrected 7일 purge, WITHDRAWN_PENDING 30일 account purge, downgrade soft-delete 스탬프 경로와 격리한다.

## 대상 파일

- 신규 Supabase migration 및 migration 검증 SQL
- `lib/plan/retention.ts`, `lib/plan/retention.test.ts`
- 신규 `lib/batch/planRetentionCleanup.ts` 및 테스트
- 신규 `app/api/batch/plan-retention/worker/route.ts`
- Premium 설정 UI/API의 기존 출시 게이트 내부 보존기간 선택 준비 코드
- `vercel.json`

## 검증

- Dev 적용 전 dry-run count를 기록하고 신규 migration은 Dev에만 적용한다.
- Start/Insight/Premium/무제한·무제한→5년·soft-delete·탈퇴·V3 비간섭 경계를 테스트한다.
- `npx tsc --noEmit`, 관련 테스트, `npm run build`를 통과시킨다.

## 위험 통제

- 삭제 전 참조 FK를 확인하고 필요한 의존 행을 동일 RPC 안에서 먼저 정리한다.
- `deleted_at IS NOT NULL` 행과 Premium `NULL` 가족은 후보 CTE 단계에서 제외한다.
- RPC 실패 시 direct delete fallback을 두지 않고, Production 배포·migration·데이터 삭제는 수행하지 않는다.
