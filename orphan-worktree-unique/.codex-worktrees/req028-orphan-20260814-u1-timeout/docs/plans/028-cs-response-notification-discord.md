# Request 028 — CS 관리자 답변·사용자 알림·Discord 연동

## 범위와 기존 Source of Truth

- `support_requests`와 기존 `inquiry | suggestion | bug`, `open | in_progress | resolved | closed` 값을 재사용한다.
- 관리자 내부 메모 `admin_note`와 사용자 공개 답변을 별도 컬럼으로 유지한다.
- 상태 변경 이력은 기존 `admin_audit_log` 흐름을 보존한다.
- 사용자 알림은 기존 `notifications` inbox와 Push 구독/전송 유틸을 재사용한다.
- 랜딩 guest 문의는 사용자 inbox/Push 대상이 아니며 Discord 접수 알림만 보낸다.
- Discord는 DB 저장 성공 뒤 fail-open으로 호출하고 개인정보·본문·첨부 URL·secret을 절대 기록하지 않는다.
- Dev에서만 migration·배포·QA한다. Production DB/env/deploy는 금지한다.

## 데이터 흐름

1. 사용자 또는 랜딩에서 기존 `/api/support`로 접수한다.
2. 신규 DB row가 실제 생성된 요청만 Discord webhook에 최소 메타데이터를 보낸다. 멱등 재응답은 다시 보내지 않는다.
3. 관리자가 기존 상세 drawer에서 상태, 내부 메모, 공개 답변을 저장한다.
4. DB RPC가 row lock, 순차 상태 전환, audit, inbox idempotency를 한 트랜잭션에서 처리한다.
5. API는 RPC가 새로 만든 notification만 기존 Push로 best-effort 전송한다.
6. 사용자는 자신의 접수 목록/상세에서 공개 상태와 답변만 본다. `admin_note`는 API 응답에 포함하지 않는다.

## 구현 단위

### U1 — DB 계약과 원자적 알림 (순차 선행, 10분)

- 대상: `supabase/migrations/20260814100000_support_request_responses_notifications.sql`
- 공개 답변/답변 메타데이터를 additive로 추가한다.
- 기존 관리자 단건·일괄 상태 전환을 보존하면서 새 RPC에서 audit와 inbox notification을 원자 처리한다.
- 답변 버전 및 상태별 idempotency key로 중복 알림을 막는다.
- service-role 전용 EXECUTE와 기존 RLS를 보존한다.
- 완료 조건: SQL 정적 계약 테스트, schema/RLS/권한 검증.

### U2 — 서버 알림·Discord 유틸 및 관리자 API (U1 후, 10분)

- 대상: `lib/support/notifications.ts`, `lib/support/discord.ts`, `app/api/admin/support-requests/[id]/route.ts`, `app/api/admin/support-requests/bulk-status/route.ts`, 관련 테스트.
- RPC 반환 notification만 Push하며 실패는 CS 저장을 되돌리지 않는다.
- Discord payload는 유형, 접수번호, 출처, 접수시각, 관리자 상세 링크만 포함한다.
- 완료 조건: secret/PII 미노출, fail-open, 단건·일괄 중복 알림 방지 테스트.

### U3 — 사용자 소유 접수 API (U1과 병렬 가능, 10분)

- 대상: `app/api/support/route.ts`, `app/api/support/[id]/route.ts`, `lib/support/*`, 관련 테스트.
- 로그인 사용자의 본인 목록/상세만 반환하며 다른 사용자 ID는 404로 숨긴다.
- 응답 whitelist로 `admin_note`, device/IP/fingerprint, 다른 identity를 제외한다.
- 기존 landing/authenticated POST와 첨부 계약을 보존한다.
- 완료 조건: parent/child 소유권, guest 401, 타인 접근 차단, 기존 POST 회귀 테스트.

### U4 — 사용자 목록·상세 UI (U3 후, 10분)

- 대상: `app/support/requests/page.tsx`, `app/support/requests/[id]/page.tsx`, `components/KChatbotWidget.tsx` 또는 실제 기존 챗봇 진입 컴포넌트, 관련 테스트.
- 역할별 상태/답변 문구를 제공하고 알림 target URL을 상세 페이지와 일치시킨다.
- 완료 조건: 목록/상세/빈 상태/답변 없음/답변 있음/첨부/알림 deep link 검증.

### U5 — 관리자 공개 답변 UI와 상세 바로가기 (U2 후, 10분)

- 대상: `app/admin/customer-requests/page.tsx`, `app/api/admin/support-requests/route.ts`, 관련 테스트.
- 내부 메모와 공개 답변 입력을 분리하고 Discord 관리자 링크 query로 해당 접수를 찾고 연다.
- 완료 조건: 기존 필터/일괄 처리 유지, 공개 답변과 내부 메모 오염 없음.

### U6 — Discord 접수 연결 및 환경 계약 (U2 후, 10분)

- 대상: `app/api/support/route.ts`, `.env.local.example`, 관련 테스트.
- 새로 insert된 접수만 webhook 호출, webhook 실패/미설정은 접수 성공 유지.
- 완료 조건: inquiry/suggestion/bug와 landing/parent_app/child_app, 멱등 재시도, PII 0건 테스트.

## 게이트

1. 각 위험 diff(DB·권한·알림)는 구현자와 다른 Codex 정적 리뷰를 통과한다.
2. TypeScript, focused Node tests, diff-check를 통과한다.
3. Dev migration을 먼저 적용한 뒤 Dev deploy한다.
4. agy E2E로 사용자 접수→Discord→관리자 처리→inbox/Push→상세 deep link를 확인한다.
5. 실제 Discord webhook secret이나 관리자 로그인 세션이 없으면 해당 항목만 Owner QA 대기로 남기고 PASS로 위장하지 않는다.

## 위험과 차단 조건

- 다른 사용자 접수/답변 또는 `admin_note` 노출은 즉시 BLOCKED.
- DB 저장 실패를 Discord 성공처럼 보이거나 Discord 실패가 접수를 rollback하면 BLOCKED.
- 답변/상태 retry 또는 일괄 처리에서 중복 inbox/Push가 발생하면 BLOCKED.
- Production 변경은 Owner의 별도 명시 승인 전 금지한다.
