# 027 랜딩 문의 기존 CS 통합 계획

## 범위와 결정

- 기존 `support_requests`와 `/api/support`를 재사용한다.
- 기존 출처 필드 `app_surface`에 `landing`을 기록하고, 익명 회신 주소만 `contact_email` 컬럼으로 추가한다.
- 익명 랜딩 제출은 `user_id`, `guardian_id`, `child_id`를 모두 `NULL`로 고정하고 클라이언트 식별값을 받지 않는다.
- 기존 접수번호·카테고리·상태(`open`)·idempotency 구조를 유지한다.
- 첨부는 현재 인증 사용자 전용이므로 랜딩에는 추가하지 않는다.

## 구현 단위

1. `supabase/migrations/20260814090000_support_requests_landing_contact.sql`, `app/api/support/route.ts`, 관련 테스트
   - nullable `contact_email` 추가 및 service-role 권한 유지
   - 로그인 사용자 기존 경로 보존
   - 익명 `landing` 전용 이메일/내용/요청 크기/멱등/rate-limit 검증
2. `components/landing/LandingSupportInquiryModal.tsx`, `components/landing/BetaLandingPage.tsx`
   - Footer 버튼과 접근 가능한 모달, 실패 시 입력 유지, 성공 시 접수번호 표시
3. `app/admin/customer-requests/page.tsx`, `app/api/admin/support-requests/route.ts`
   - nullable 제출자와 랜딩 출처·이메일을 목록/상세에서 안전하게 표시

## 검증

- QA-3: DB 스키마, 익명 쓰기 경계, rate-limit, 기존 인증 접수 회귀가 직접 영향받는다.
- 타입체크, 관련 Node 테스트, Dev migration dependency/적용, 비로그인 랜딩 E2E, 관리자 조회, 기존 앱 CS API 회귀를 수행한다.
- Production DB·Production 배포는 대표 승인 전 금지한다.
