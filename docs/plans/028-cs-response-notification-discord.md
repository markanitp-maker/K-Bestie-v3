# Request 028 — CS 관리자 답변·사용자 알림·Discord 연동

## Source of Truth와 범위

- 기존 `support_requests`, 접수 유형, 상태, `admin_audit_log`, 통합 `notifications`, Push 인프라를 재사용한다.
- 공개 답변은 `admin_note`와 분리한다. guest landing은 inbox/Push 대상이 아니다.
- Discord는 신규 DB 저장 뒤 fail-open으로 호출하며 본문·이메일·가족 식별자·첨부 URL·secret을 보내지 않는다.
- Production DB/env/deploy는 금지하고 Dev에서만 검증한다.

## 데이터 흐름

접수 DB 저장 → 신규 insert만 Discord → 관리자 상태/메모/공개답변 저장 RPC → audit와 inbox를 같은 트랜잭션에서 기록 → 새 notification만 기존 Push → 본인 소유 목록/상세에서 공개 상태·답변 확인.

## 10분 작업 단위

1. U1A DB 단건 계약: 공개 답변 컬럼과 단건 RPC v2, row lock/순차 상태/audit/inbox idempotency.
2. U1B DB 일괄 계약·정적 테스트: bulk v2와 notification 식별자 반환, 권한/회귀 계약 고정.
3. U2 서버 유틸·관리자 API: RPC 새 notification만 Push, Discord 최소 payload/fail-open.
4. U3 사용자 API: 본인 목록/상세 whitelist, 타인 접근 404, landing/auth POST 회귀 보존.
5. U4 사용자 UI: 목록/상세, 역할별 문구, 챗봇 내 접수 진입, 알림 deep link.
6. U5 관리자 UI: 내부 메모/공개 답변 분리, Discord query 상세 바로가기.
7. U6 접수 Discord 연결·환경 계약: 신규 insert만 webhook, `.env.local.example` placeholder, 멱등/PII 테스트.

## 게이트

- 위험 diff는 별도 Codex 정적 리뷰, 이후 타입체크/focused tests/diff-check.
- Dev migration 선적용 후 Dev deploy와 agy E2E.
- 다른 사용자 데이터/admin_note 노출, Discord로 PII 노출, retry 중복 알림, Discord 실패의 접수 rollback은 BLOCKED.
- 실제 Discord secret 또는 관리자 세션 부재 항목은 Owner QA 대기로 명시한다.
