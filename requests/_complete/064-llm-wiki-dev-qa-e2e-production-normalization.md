# 064 - LLM WIKI 실사용 E2E 정상화·Dev 배포·Production 적용

## 1. 작업 목적

현재 LLM WIKI가 DB에 Fact만 적재되는 수준이 아니라, 아래 전체 흐름으로 실제 정상 동작하도록 코드·배포·검증을 완료한다.

```text
아이와 케이의 실제 대화
→ chat_messages 실시간 저장
→ Collection
→ Raw 생성
→ Context Correction
→ corrected_daily_conversations_v3
→ Memory Batch
→ memory_facts
→ memory_evidence
→ memory_embeddings
→ Vector Retrieval
→ Gemini Prompt에 기억 주입
→ 새 미션·자유대화에서 케이가 이전 대화를 기억하여 응답
```

이번 작업은 상태 점검 보고서만 작성하는 작업이 아니다.

Claude Code는 다음을 모두 수행한다.

1. 현재 코드와 Development 배포 상태를 필요한 범위에서 확인한다.
2. LLM WIKI 전체 흐름을 막는 실제 문제를 수정한다.
3. Development에 수정 코드를 배포한다.
4. 기존 QA 계정 TestA·TestB로 실제 UI 기반 E2E를 수행한다.
5. 실패하면 원인을 수정하고 동일 E2E를 다시 실행한다.
6. 모든 Dev E2E가 PASS한 뒤 동일 변경을 Production에 안전하게 배포한다.
7. Production 기존 Memory 데이터를 보존하고 배포 결과를 검증한다.
8. 최종 결과를 실행 증거와 숫자로 보고한다.

---

## 2. 역할 구분

### Antigravity가 이미 수행한 역할

- Production DB의 Memory 데이터 존재 여부를 읽기 전용으로 확인
- 기존 파이프라인 오류의 일부 원인 분석
- `MESSAGE_COUNT_MISMATCH` 발생 사례 확인
- Dev 최신 Context Correction 변경이 실제 배포와 불일치할 가능성 보고

Antigravity의 전체 상태 감사를 다시 반복하지 않는다.

### Claude Code가 수행할 역할

- 코드 수정
- Migration 또는 RPC 수정
- Development 배포
- QA 계정 실사용 E2E
- 실패 원인 수정과 재검증
- Production 안전 배포
- Production 기존 데이터 보존 검증
- 최종 완료 보고

---

## 3. 현재 확인된 상태

현재까지 확인된 내용은 다음과 같다.

```text
Production Memory 데이터 적재: 확인됨
memory_facts 존재: 확인됨
memory_evidence 존재: 확인됨
memory_embeddings 존재: 확인됨
Embedding 모델 gemini-embedding-001: 확인됨
최근 memory_batch completed 사례: 확인됨
```

하지만 다음 항목은 실제 E2E로 확정되지 않았다.

```text
신규 QA 대화에서 Fact 생성
Evidence 연결
Embedding 연결
Vector Retrieval 실제 성공
child_id별 기억 격리
Gemini Prompt 실제 주입
자유대화에서 과거 기억 반영
미션에서 과거 기억 반영
자동 마이크·수동 마이크 동일 연결
V3 우선·Legacy Fallback
동일 날짜 재실행 멱등성
```

따라서 파일 존재 또는 DB 총건수만 확인하고 작업을 종료하면 안 된다.

---

## 4. 작업 시작 전 저장소 보호

작업 시작 직후 `git status`와 현재 브랜치·Commit을 확인한다.

기존에 다른 작업으로 수정된 파일이 있을 수 있다.

특히 다음 파일은 이번 작업과 무관하므로 수정하거나 되돌리지 않는다.

```text
requests/019-parent-dashboard-15char-summary-fix.md
requests/020-daily-weekly-report-modal.md
requests/060-admin-manual-report-child-display-name-login.md
requests/061-admin-retention-client-exception-fix.md
requests/062-admin-retention-drilldown-display-name-login.md
requests/063-admin-retention-all-parent-child-scopes.md
CLAUDE.md
```

실제 경로가 다르면 현재 저장소의 해당 파일을 기준으로 한다.

원칙:

- 기존 미커밋 변경을 임의로 삭제하지 않는다.
- 이번 작업과 관련 없는 파일을 포맷팅하지 않는다.
- 전체 저장소 일괄 정리 금지
- 전체 요청 문서 수정 금지
- 이번 작업 변경 파일만 별도 목록으로 관리
- 작업 종료 시 관련 없는 diff가 추가되지 않아야 한다.

---

## 5. 보안 원칙

다음 값은 평문 출력·하드코딩·로그 저장을 금지한다.

```text
SUPABASE_SERVICE_ROLE_KEY
Production DB 비밀번호
Development DB 비밀번호
CRON_SECRET
Vertex AI API Key
Google Cloud 인증 토큰
QA 계정 비밀번호
세션 쿠키
Access Token
Refresh Token
```

필수 원칙:

- 기존 환경변수, Vercel Secrets, Google Cloud ADC, Secret Manager만 사용
- Secret 값은 존재 여부만 확인
- 명령어 출력에 Secret 값이 나타나지 않도록 처리
- 임시 스크립트에 Secret 직접 기록 금지
- 아이 대화 원문 전체를 로그에 출력 금지
- 보고서에는 child_id·parent_id 등 식별값을 일부 마스킹

---

## 6. 대상 환경과 QA 계정

### Development

```text
QA 부모 계정: 기존 Development QA 부모 계정
TestA 로그인 ID: testa@kbestie.local
TestB 로그인 ID: testb@kbestie.local
```

각 로그인 ID에 실제 연결된 다음 값을 확인한다.

```text
parent_id
family_id
child_id
아이 표시 이름
계정 활성 상태
사용 가능한 Dev 앱 URL
사용 가능한 Dev 관리자 URL
Development Supabase 프로젝트
Development Vercel 프로젝트
현재 Dev 배포 Commit SHA
로컬 HEAD Commit SHA
```

비밀번호는 기존 안전한 환경변수 또는 QA 자격증명 저장소에서 불러온다.

계정이 없거나 자격증명이 준비되지 않았다면 새 Production 계정을 만들지 않는다. 기존 Dev 테스트 계정을 찾고 대체 계정 사용 사유를 보고한다.

### Production

Production에서는 실제 테스트 대화를 만들지 않는다.

Production 작업은 다음으로 제한한다.

- Dev PASS 변경 배포
- 기존 Memory 데이터 보존 스냅샷
- Migration 적용
- 배포 Commit 확인
- 기존 데이터와 최근 Job 읽기 전용 검증
- 정상 사용자의 대화 원문 출력 금지

---

## 7. 완료해야 하는 전체 범위

다음 항목을 모두 완료한다.

```text
1. Context Correction 대량 메시지 안정화
2. 관리자 수동 전체 파이프라인 오케스트레이션
3. Memory Batch 입력 및 멱등성
4. Fact·Evidence·Embedding 무결성
5. Vector Retrieval
6. child_id별 검색 격리
7. 자유대화 Prompt 주입
8. 미션 Prompt 주입
9. 자동 마이크·수동 마이크 경로
10. V3 Memory 우선·Legacy Fallback
11. 동일 날짜 재실행 멱등성
12. 부모 리포트 실제 조회
13. Development 배포 및 E2E
14. Production 안전 배포
15. Production 기존 Memory 보존
```

---

# Part A. 구현 상태 확인 및 필요한 코드 수정

## 8. Development 배포와 로컬 코드 정합성

다음만 필요한 범위에서 확인한다.

```text
현재 Dev 배포 Commit
로컬 HEAD
Context Correction 최신 변경 포함 Commit
Memory Batch 최신 변경 포함 Commit
Vector Retrieval 최신 변경 포함 Commit
미션·자유대화 Prompt 주입 변경 포함 Commit
관리자 collect_and_generate 변경 포함 Commit
```

단순히 로컬에 파일이 존재한다는 이유로 Dev 또는 Production에 배포됐다고 판단하지 않는다.

Dev 배포가 오래된 경우:

1. 어떤 변경이 배포에 빠졌는지 정확히 기록한다.
2. 해당 변경을 코드 리뷰한다.
3. 미완성 또는 잘못된 부분을 먼저 수정한다.
4. Development에 배포한다.
5. 배포 Commit과 로컬 Commit 일치를 확인한다.

---

## 9. Context Correction 대량 메시지 처리

주요 대상 파일:

```text
lib/batch/contextCorrectionV3.ts
```

실제 런타임 구현 경로가 다르면 실제 파일을 기준으로 수정한다.

### 필수 구현

하루 전체 보정은 하나의 논리 Job으로 유지한다.

Gemini 호출은 메시지 수 또는 토큰 예산에 따라 안전하게 나눈다.

```text
Raw 전체 메시지
→ source_message_id와 display_sequence 고정
→ 토큰 예산 산정
→ 20~30개 수준 또는 안전한 토큰 크기로 Chunk 분리
→ Chunk별 Gemini 호출
→ source_message_id 기준 병합
→ 누락 메시지 원문 Fallback
→ 원래 순서 복원
→ Corrected 하루 결과 1건 저장
```

### 금지 구현

```text
배열 인덱스만으로 원문과 Gemini 결과 연결
입력 수와 반환 수가 다르면 전체 PERMANENT_ERROR
Gemini가 반환하지 않은 메시지 삭제
아이 메시지만 보존하고 케이 메시지 누락
Chunk 결과를 곧바로 중복 INSERT
```

### 필수 오류 처리

- JSON 파싱 실패 Chunk는 제한 횟수 재시도
- 재시도 실패 시 해당 Chunk의 메시지를 원문 Fallback
- 반환되지 않은 `source_message_id`는 원문 Fallback
- 존재하지 않는 ID 반환은 무시하고 마스킹 경고
- 중복 ID 반환은 한 건만 사용
- 최종 메시지 수는 Raw와 동일
- 기존 `MESSAGE_COUNT_MISMATCH`는 복구 가능한 상태로 처리
- 동일 Job 재실행 시 Corrected 중복 생성 금지
- 부분 저장 후 실패 시 재실행해도 최종 결과가 중복되지 않아야 함

### 테스트 대상

```text
20~35개 일반 메시지
60~80개 대량 메시지
Gemini 일부 결과 누락
Chunk JSON 파싱 실패
동일 source_message_id 중복 반환
알 수 없는 source_message_id 반환
```

---

## 10. 관리자 `collect_and_generate` 오케스트레이션

Development 관리자 화면의 다음 기능이 실제 전체 파이프라인을 실행해야 한다.

```text
수집 후 리포트 즉시 생성
collect_and_generate
```

정상 순서:

```text
Source 메시지 확인
→ 누락 Collection 실행
→ Raw 완성 확인
→ Context Correction
→ Memory Batch
→ Daily Report
```

### 단계별 재사용

```text
Collection completed
→ 재수집하지 않고 Raw 검증 후 다음 단계

Raw 존재
→ 삭제·재생성하지 않고 재사용

Context Correction completed
→ Corrected 재사용

Memory Batch completed
→ 기존 Memory 결과 재사용

Daily Report completed
→ 기존 Report 재사용
```

### 실패 단계 재개

- 기존 실패 이력 삭제 금지
- 새 `execution_id` 생성
- 완료된 단계 재사용
- 최초 실패 단계부터 재처리
- 동일 Job 중복 생성 금지
- 장기 `processing` Job 감지
- 재시도 횟수와 마지막 오류 기록

### 잘못된 단독 실행 차단

다음 상태에서 Daily Report만 단독 실행하면 안 된다.

```text
Raw 없음
Corrected 없음
Context Correction 실패
```

Memory Batch 실패는 별도 기록하되 Corrected가 정상이라면 Daily Report는 계속 생성할 수 있어야 한다.

---

## 11. Memory Batch 입력

Memory Batch 입력은 반드시 다음이다.

```text
corrected_daily_conversations_v3
corrected_daily_conversation_messages_v3
```

확인 및 수정:

- 같은 `child_id`
- 같은 `business_date`
- Correction `completed`
- Corrected 생성 완료 후 Memory 시작
- Raw 직접 입력 금지
- 다른 아이 Corrected 참조 금지
- 같은 날짜의 과거 버전과 최신 버전 혼용 금지
- 멱등성 키에 `child_id + business_date + version` 또는 동등한 기준 사용

---

## 12. Fact·Evidence·Embedding 생성

### Fact

확인 및 수정:

- 올바른 `child_id`
- 원문에 없는 정보 생성 방지
- 동일 의미 Fact 과도한 중복 방지
- 검색 가능 상태
- 생성 출처와 버전 추적
- 같은 날짜 재실행 멱등성

### Evidence

모든 검색 대상 Fact는 최소 1개 Evidence와 연결한다.

확인:

- 올바른 Fact ID
- 올바른 Corrected 또는 Source 메시지
- 다른 아이 메시지 참조 금지
- 존재하지 않는 메시지 참조 금지
- 중복 Evidence 금지
- 고아 Evidence 금지

### Embedding

모든 검색 대상 Fact에 Embedding을 생성한다.

```text
모델: gemini-embedding-001
```

확인:

- Fact ID 연결
- `child_id` 연결
- NULL Vector 금지
- Vector 차원 일치
- 중복 Embedding 금지
- 고아 Embedding 금지
- 재실행 시 기존 Embedding 재사용

---

## 13. Vector Retrieval 런타임 연결

현재 런타임이 실제 사용하는 검색 구현을 특정한다.

알려진 후보:

```text
lib/memory/vectorRetrieval.ts
```

실제 호출 경로가 다르면 실제 파일·함수·RPC를 기준으로 한다.

필수 확인 및 수정:

```text
Query Text
→ gemini-embedding-001 Query Embedding
→ child_id 조건
→ memory_facts Vector 검색
→ Similarity/Ranking
→ Top-K 선택
→ Prompt Memory Context 전달
```

### 필수 보안 조건

- SQL 또는 RPC 단계에서 `child_id` 제한
- 전역 검색 후 애플리케이션에서 느슨하게 필터링 금지
- 다른 아이 Fact 반환 금지
- Cache가 있다면 `child_id` 또는 사용자 범위로 분리

### 설정 기록

최종 보고서에 다음을 남긴다.

```text
Retrieval 함수명
호출 파일
RPC/API
Embedding 모델
Top-K
Similarity threshold
child_id 필터 위치
```

---

## 14. 자유대화 Prompt 주입

자유대화의 실제 서버 런타임 경로를 확인한다.

다음 경로에서 모두 Memory Retrieval이 적용돼야 한다.

```text
자유대화 자동 마이크
자유대화 수동 마이크
자유대화 재진입 또는 세션 복원
```

필수 흐름:

```text
아이 발화
→ 관련 Memory 검색
→ Prompt용 기억 Context 구성
→ Gemini 요청
→ 케이 응답
```

확인 및 수정:

- 올바른 `child_id`
- 현재 발화와 관련 있는 Fact만 주입
- 전체 Memory 무차별 주입 금지
- Prompt 토큰 예산 제한
- Fact의 출처 문구를 사용자에게 그대로 노출하지 않음
- 다른 아이 Memory 금지
- 검색 실패가 전체 대화를 실패시키지 않도록 안전한 Fallback
- Retrieval 로그에는 Fact ID·건수 등 메타데이터만 기록
- 아이 대화 원문 전체와 완성 Prompt 로그 출력 금지

---

## 15. 미션 Prompt 주입

다음 미션 경로를 실제 코드 기준으로 확인한다.

```text
일반 미션
자동 마이크
수동 마이크
미션 시작 메모리 인사
미션 중 짧은 반응
일반 응답 생성
```

모든 관련 런타임 경로가 공통 Memory Retrieval을 사용해야 한다.

확인 및 수정:

- 특정 미션 경로에만 Memory 적용되고 다른 경로는 누락되는 문제 방지
- 미션 답변 유효성·안전성 분류 Prompt와 기억 Context를 혼동하지 않음
- 기억은 대화 응답 생성 Prompt에만 적절히 포함
- 다른 아이 기억 금지
- V3 검색 실패 시 안전한 Legacy Fallback

---

## 16. V3 우선·Legacy Fallback

확정 정책:

```text
V3 Memory 결과가 1건 이상 있음
→ V3 결과만 사용

V3 Memory 결과가 없음
→ Legacy child_memory Fallback

V3와 Legacy 동시 중복 주입 금지
```

확인 및 수정:

- V3 Fact가 있는데 Legacy도 항상 호출되는 구조 제거
- 동일 의미 기억이 두 번 Prompt에 들어가지 않도록 처리
- V3 검색 오류와 V3 검색 결과 0건을 구분
- 오류 시 대화 자체가 중단되지 않도록 처리
- 다른 아이 Legacy Memory 금지

---

# Part B. Development 배포 및 실제 QA E2E

## 17. Development 배포

코드 수정 후 다음을 수행한다.

1. 타입 검사
2. 관련 단위 테스트
3. 관련 통합 테스트
4. Migration 검증
5. Development DB에 필요한 Migration 적용
6. Development Vercel 배포
7. Worker 또는 Edge Function이 별도 배포 대상이면 함께 배포
8. Dev 배포 Commit과 예상 Commit 일치 확인
9. Dev 앱 Health Check
10. Dev 관리자 페이지 접근 확인

전체 저장소의 무관한 실패를 이번 작업 결과로 혼동하지 말고, 관련 테스트 결과를 별도로 보고한다.

---

## 18. E2E 실행 방식

실제 Development UI를 사용한다.

권장:

```text
Playwright 또는 기존 브라우저 자동화
```

필수 원칙:

- QA 계정으로 실제 로그인
- 실제 아이 화면 사용
- 실제 관리자 화면 사용
- DB 직접 INSERT로 대화 생성 금지
- DB 직접 Job 생성 금지
- DB 직접 Fact 생성 금지
- 관리자 UI를 우회하여 API만 호출하는 방식으로 전체 E2E를 대체 금지

음성 입력만 가능한 구간에서 자동화가 어려우면, 기존 Development QA용 입력 기능이 실제 음성 전사 이후와 동일한 서버 런타임을 통과하는지 확인한 뒤 사용한다. 별도 가짜 DB 삽입은 금지한다.

---

## 19. 테스트 전 스냅샷

TestA·TestB의 테스트 전 상태를 기록한다.

### TestA

```text
당일 chat_messages 수
당일 Raw 수
당일 Corrected 수
전체 memory_facts 수
전체 memory_evidence 수
전체 memory_embeddings 수
당일 daily_reports 수
최근 Memory Job
```

### TestB

```text
전체 memory_facts 수
전체 memory_evidence 수
전체 memory_embeddings 수
최근 Memory Job
```

ID 목록 또는 해시를 보관하여 테스트 후 중복과 변경 여부를 비교한다.

기존 데이터를 삭제하지 않는다.

---

## 20. TestA 기억 생성 대화

TestA 아이 계정으로 Development 앱에 로그인한다.

다음 기억 후보를 실제 대화에 자연스럽게 포함한다.

```text
1. 내가 요즘 제일 좋아하는 음식은 바질치킨피자야.
2. 이번 토요일에는 가족과 국립과학관에 갈 거야.
3. 학교에서 민준이랑 로봇 자동차를 만들었어.
4. 요즘 토성과 우주 탐사에 관심이 많아.
```

한 번에 네 문장을 모두 넣지 않는다.

대화를 여러 턴으로 나누어 진행한다.

조건:

```text
아이 발화 최소 15개
케이 응답 최소 15개
총 메시지 최소 35개
기억 후보 네 가지 모두 포함
무의미한 동일 문장 반복 금지
```

가능하면 총 메시지를 60개 이상으로 확장하여 대량 Context Correction도 함께 검증한다.

대량 테스트를 별도 TestA 세션 또는 TestB 이외의 기존 Dev QA 계정으로 분리해도 된다. 단, TestB는 아이 간 격리 검증용이므로 TestA 기억을 TestB에 생성하지 않는다.

---

## 21. Source 저장 검증

대화 직후 실제 DB 결과를 확인한다.

```text
chat_sessions
chat_messages
```

필수 비교:

```text
아이 메시지 수
케이 메시지 수
전체 메시지 수
session_id
session_type
created_at 순서
display_sequence
collected_at NULL 수
다른 아이 메시지 혼입 수
```

PASS:

```text
아이 메시지 > 0
케이 메시지 > 0
전체 메시지 >= 35
다른 아이 혼입 = 0
순서 오류 = 0
```

---

## 22. 관리자 UI 수동 실행

Development 관리자 화면에서 다음을 실제 클릭한다.

```text
대상 아이: TestA 실제 아이
대상 날짜: 테스트 당일 KST
작업: 수집 후 리포트 즉시 생성
```

브라우저 Network에서 다음을 기록한다.

```text
요청 URL
HTTP Method
HTTP Status
action
child_id
business_date
execution_id
응답 결과
```

Secret·쿠키·토큰은 기록하지 않는다.

---

## 23. Job 상태 추적

최대 10분 동안 10~15초 간격으로 다음을 확인한다.

```text
Collection
Context Correction
Memory Batch
Daily Report
```

각 Job:

```text
job_id
execution_id
job_type
status
attempt_count
created_at
started_at
completed_at
error_code
error_summary
```

정상:

```text
pending
→ processing
→ completed
```

10분 이상 `processing`이면 `STUCK_PROCESSING`으로 판정하고 원인을 수정한 뒤 다시 실행한다.

---

## 24. Raw 검증

다음을 숫자로 비교한다.

```text
수집 대상 Source 메시지 수
Raw 메시지 수
Raw 레코드 수
중복 source_message_id
누락 source_message_id
다른 아이 메시지
```

PASS:

```text
Raw 레코드 = 1
Raw 메시지 = 수집 대상 Source 메시지
중복 = 0
누락 = 0
다른 아이 혼입 = 0
```

---

## 25. Corrected 검증

다음을 숫자로 비교한다.

```text
Raw 메시지 수
Corrected 메시지 수
중복 Corrected 메시지
누락 Corrected 메시지
원문 Fallback 메시지
Chunk 수
MESSAGE_COUNT_MISMATCH
```

PASS:

```text
Raw 메시지 수 = Corrected 메시지 수
중복 = 0
누락 = 0
Context Correction = completed
MESSAGE_COUNT_MISMATCH = 없음
```

60개 이상 대량 메시지에서도 동일 기준을 통과해야 한다.

---

## 26. LLM WIKI 신규 생성 검증

테스트 전후를 비교한다.

```text
memory_facts
memory_evidence
memory_embeddings
```

기억 후보별 확인:

```text
바질치킨피자 선호
국립과학관 일정
민준이와 로봇 자동차
토성과 우주 탐사 관심
```

필수 기준:

- 최소 2개 이상의 의미 있는 신규 Fact
- 대화에 없는 환각 Fact 0
- 다른 아이 Fact 0
- 동일 의미 중복 Fact 0
- 검색 대상 Fact의 Evidence 누락 0
- 검색 대상 Fact의 Embedding 누락 0
- 고아 Evidence 0
- 고아 Embedding 0
- Embedding 모델 `gemini-embedding-001`

Fact 0건은 이번 테스트에서는 FAIL이다. 명확한 기억 후보를 넣었기 때문이다.

---

## 27. Vector Retrieval 직접 검증

앱 런타임이 실제 사용하는 동일 함수·API·RPC를 사용한다.

TestA `child_id`로 다음 검색을 실행한다.

```text
내가 좋아하는 음식
이번 토요일에 어디 가기로 했지
학교에서 친구랑 무엇을 만들었지
요즘 무엇에 관심이 있지
```

PASS:

```text
4개 검색 중 최소 3개에서 관련 Fact가 Top-K에 포함
다른 아이 Fact 반환 = 0
```

기록:

```text
검색어
관련 Fact ID
Top-K 순위
Similarity
child_id
다른 아이 혼입
```

Fact 본문 전체와 아이 원문 전체는 보고서에 출력하지 않는다.

---

## 28. TestB 아이 간 기억 격리

TestB `child_id`로 TestA와 동일한 검색어 네 개를 실행한다.

PASS:

```text
TestA Fact ID 노출 = 0
TestA Fact 내용 노출 = 0
교차 child_id 결과 = 0
```

한 건이라도 노출되면 즉시 `CHILD_MEMORY_ISOLATION_FAIL`로 처리하고 코드 수정 후 재검증한다.

---

## 29. 자유대화 실제 기억 회상

TestA로 새로운 자유대화 세션을 시작한다.

기억 내용을 다시 알려주지 않고 다음을 질문한다.

```text
내가 좋아하는 음식 기억나?
이번 토요일에 어디 가기로 했는지 기억해?
학교에서 친구랑 무엇을 만들었다고 했지?
내가 요즘 관심 있다고 한 게 뭐였지?
```

각 질문마다 확인:

```text
Retrieval 호출
child_id
검색 Fact 수
검색 Fact ID
Prompt에 전달된 기억 수
memorySource
응답에 기억 반영
왜곡
다른 아이 정보
```

PASS:

- 4개 중 최소 3개 질문에서 관련 기억 반영
- 다른 아이 기억 0
- 사실 왜곡 0
- Retrieval 실패 때문에 대화 중단 없음

완성 Prompt와 아이 원문 전체는 로그에 출력하지 않는다.

---

## 30. 미션 실제 기억 회상

TestA로 새로운 미션 대화를 실행한다.

자연스럽게 다음 중 두 개 이상을 확인한다.

```text
내가 좋아하는 음식도 기억해?
이번 주말에 어디 가는지 기억나?
내가 요즘 관심 있는 걸 기억해?
```

확인:

```text
미션 API 경로
Retrieval 호출
child_id
V3 Fact
Prompt 주입
응답 기억 반영
다른 아이 기억
```

PASS:

- 미션 경로 Retrieval 호출
- 관련 Fact 검색
- 응답에 기억 반영
- 다른 아이 기억 0

---

## 31. 자동 마이크·수동 마이크

자동 마이크와 수동 마이크가 다른 경로라면 각각 검증한다.

확인:

```text
자동 마이크 요청 경로
수동 마이크 요청 경로
공통 응답 생성 함수
각 경로의 Retrieval 호출
각 경로의 Prompt 주입
```

둘 중 하나라도 누락되면 수정 후 재검증한다.

---

## 32. V3 우선·Legacy Fallback E2E

TestA에 V3 Fact가 존재하는 상태에서 확인한다.

```text
memorySource = V3
Legacy child_memory 동시 호출 없음
동일 의미 중복 주입 없음
```

V3 Fact가 없는 기존 Dev QA 아이가 있다면 기존 데이터로 Legacy Fallback도 확인한다.

새 DB 데이터를 직접 만들지 않는다.

---

## 33. 멱등성 재실행

같은 TestA·같은 날짜로 관리자 UI의 `수집 후 리포트 즉시 생성`을 다시 실행한다.

재실행 전후 비교:

```text
Raw 레코드
Raw 메시지
Corrected 레코드
Corrected 메시지
memory_facts
memory_evidence
memory_embeddings
daily_reports
```

PASS:

```text
Raw 중복 증가 = 0
Corrected 중복 증가 = 0
동일 의미 Fact 증가 = 0
Evidence 중복 증가 = 0
Embedding 중복 증가 = 0
Report 중복 증가 = 0
기존 ID 변경 = 0
```

완료된 단계는 재사용 또는 `SKIPPED_ALREADY_COMPLETED`와 동등한 방식으로 처리한다.

---

## 34. 부모 리포트 실제 조회

TestA 부모 계정으로 Development 앱에 로그인한다.

확인:

```text
오늘 일일 리포트 목록 표시
대상 아이 이름
report_date
리포트 상세 열림
빠른 요약
상세 보기
추천 가이드
빈 내용 여부
DB와 화면 일치
```

LLM WIKI 테스트의 직접 핵심은 아니지만 동일 수동 파이프라인이 Daily Report까지 정상 완료되는지 확인한다.

---

## 35. 실패 시 반복 원칙

어느 단계든 FAIL이면 다음을 수행한다.

```text
최초 실패 단계 확정
→ 관련 Job·로그 확인
→ 실제 원인 수정
→ 관련 단위·통합 테스트
→ Development 재배포
→ 동일 QA E2E 처음부터 재실행
```

DB에 결과를 직접 만들어 후속 테스트를 통과시키면 안 된다.

작업 완료 조건은 “원인 보고”가 아니라 실제 E2E PASS이다.

---

# Part C. Production 안전 적용

## 36. Production 적용 전 조건

다음 항목이 모두 PASS하기 전에는 Production에 배포하지 않는다.

```text
Context Correction 일반 메시지 PASS
Context Correction 60개 이상 PASS
Memory Batch PASS
Fact·Evidence·Embedding PASS
Vector Retrieval PASS
아이 격리 PASS
자유대화 기억 반영 PASS
미션 기억 반영 PASS
자동·수동 마이크 PASS
V3 우선 정책 PASS
멱등성 PASS
부모 리포트 조회 PASS
```

---

## 37. Production 데이터 보존 스냅샷

Production 배포 직전에 읽기 전용으로 다음을 기록한다.

```text
memory_facts 총수 및 기존 ID 목록 또는 해시
memory_evidence 총수 및 기존 ID 목록 또는 해시
memory_embeddings 총수 및 기존 ID 목록 또는 해시
Embedding 모델 분포
고아 Evidence
고아 Embedding
최근 Memory Job
```

과거 감사의 숫자를 무조건 기준으로 사용하지 말고 배포 직전 실제 값을 기준으로 한다.

기존 Production Memory 데이터 삭제·초기화·전체 재생성 금지.

---

## 38. Production 배포 순서

```text
1. DB 백업 또는 복구 지점 확인
2. 관련 Migration 적용
3. 앱·API 배포
4. Worker·Edge Function 별도 배포
5. Production 배포 Commit 확인
6. Health Check
7. 최근 기존 Memory Job 읽기 전용 확인
8. 기존 Fact·Evidence·Embedding ID 보존 비교
9. Retrieval 코드가 실제 배포 Commit에 포함됐는지 확인
10. 오류 로그와 장기 processing Job 확인
```

Production에서 TestA·TestB 대화를 새로 만들지 않는다.

---

## 39. Production 배포 후 검증

확인:

```text
기존 Fact ID 삭제 0
기존 Evidence ID 삭제 0
기존 Embedding ID 삭제 0
Embedding 모델 변경 오류 0
고아 Evidence 증가 0
고아 Embedding 증가 0
기존 완료 Job 변경 0
Production 오류율 급증 없음
```

Production의 실제 신규 자동 파이프라인 결과는 이후 정상 사용 데이터에서 확인하되, 이번 작업에서는 배포 코드·DB 보존·최근 Job 상태를 검증한다.

---

# Part D. 금지사항

## 40. 절대 금지

- 원인만 보고하고 종료
- Development 배포 없이 로컬 코드만 테스트
- Production부터 바로 배포
- DB 직접 Fact 삽입
- DB 직접 Job 상태 변경
- DB 직접 Report 생성
- Production 테스트 대화 생성
- 기존 Production Memory 전체 삭제
- 전체 과거 데이터 무차별 Backfill
- 다른 아이 Memory 조회 허용
- V3와 Legacy Memory 중복 주입
- Secret 평문 출력
- 완성 Prompt 로그 출력
- 아이 원문 대화 전체 로그 출력
- 관련 없는 요청 문서 수정
- 관련 없는 코드 포맷팅
- Antigravity 전체 감사를 다시 반복

---

# 41. 완료 기준

다음이 모두 충족돼야 작업 완료다.

```text
Development 최신 코드 배포
TestA 실제 로그인
신규 대화 35개 이상 생성
chat_messages 저장
관리자 UI collect_and_generate
Collection 완료
Raw 무결성
Context Correction 완료
60개 이상 대량 메시지 완료
MESSAGE_COUNT_MISMATCH 없음
Memory Batch 완료
의미 있는 신규 Fact 생성
Evidence 연결
Embedding 연결
gemini-embedding-001
Vector Retrieval 성공
TestB 아이 격리 성공
자유대화 기억 반영
미션 기억 반영
자동 마이크 Memory 적용
수동 마이크 Memory 적용
V3 우선
Legacy 중복 주입 없음
동일 날짜 재실행 중복 0
부모 리포트 조회
Production 안전 배포
Production 기존 Memory 보존
```

---

# 42. 최종 보고 형식

보고서 첫 줄:

```text
LLM WIKI 전체 정상
```

모든 항목이 PASS가 아닐 경우 다음 중 하나를 사용한다.

```text
LLM WIKI 생성만 정상
LLM WIKI 검색 실패
LLM WIKI Prompt 주입 실패
LLM WIKI 자유대화 반영 실패
LLM WIKI 미션 반영 실패
LLM WIKI 아이 격리 실패
LLM WIKI 일부 실패
LLM WIKI 전체 실패
```

## 42.1 변경 파일

| 파일 | 변경 내용 | Dev 배포 | Production 배포 |
|---|---|---|---|

## 42.2 Migration

```text
Migration 파일:
Dev 적용:
Production 적용:
Rollback:
```

## 42.3 Development 환경

```text
Dev 앱:
Dev 관리자:
Dev Supabase:
Dev 배포 Commit:
TestA child_id:
TestB child_id:
business_date:
```

## 42.4 TestA 신규 대화

```text
세션:
아이 메시지:
케이 메시지:
전체 메시지:
기억 후보 포함:
저장 결과:
```

## 42.5 Job 결과

| 단계 | Job ID | Execution ID | 상태 | Attempt | 오류 |
|---|---|---|---|---:|---|
| Collection | | | | | |
| Context Correction | | | | | |
| Memory Batch | | | | | |
| Daily Report | | | | | |

## 42.6 Raw·Corrected

```text
Source 메시지:
Raw 메시지:
Corrected 메시지:
Raw 누락:
Corrected 누락:
중복:
Fallback:
Chunk 수:
MESSAGE_COUNT_MISMATCH:
```

## 42.7 LLM WIKI 생성

```text
신규 Fact:
신규 Evidence:
신규 Embedding:
Embedding 모델:
Evidence 없는 Fact:
Embedding 없는 Fact:
중복 Fact:
고아 Evidence:
고아 Embedding:
다른 아이 혼입:
```

## 42.8 기억 후보별 결과

| 기억 후보 | Fact 생성 | 검색 | 자유대화 반영 | 미션 반영 |
|---|---|---|---|---|
| 바질치킨피자 | | | | |
| 국립과학관 | | | | |
| 민준이와 로봇 자동차 | | | | |
| 토성과 우주 탐사 | | | | |

## 42.9 Vector Retrieval

| 검색어 | 관련 Fact | 순위 | Similarity | 다른 아이 혼입 | 결과 |
|---|---|---:|---:|---|---|

## 42.10 아이 격리

```text
TestB에서 TestA Fact ID 노출:
TestB에서 TestA Fact 내용 노출:
교차 child_id 결과:
격리 결과:
```

## 42.11 실제 대화 반영

```text
자유대화 Retrieval:
자유대화 Prompt 주입:
자유대화 응답 기억 반영:

미션 Retrieval:
미션 Prompt 주입:
미션 응답 기억 반영:

자동 마이크:
수동 마이크:
```

## 42.12 V3·Legacy

```text
V3 우선:
Legacy Fallback:
V3·Legacy 동시 주입:
memorySource:
```

## 42.13 멱등성

```text
Raw 중복:
Corrected 중복:
Fact 중복:
Evidence 중복:
Embedding 중복:
Report 중복:
기존 ID 변경:
```

## 42.14 부모 리포트

```text
리포트 Job:
리포트 레코드:
부모 목록:
상세 모달:
빠른 요약:
상세 보기:
추천 가이드:
```

## 42.15 Production 보존

```text
배포 전 Fact:
배포 후 Fact:
기존 Fact ID 삭제:
기존 Evidence ID 삭제:
기존 Embedding ID 삭제:
고아 Evidence 증가:
고아 Embedding 증가:
Production 배포 Commit:
```

## 42.16 최종 단계별 판정

```text
Context Correction: PASS / FAIL
Memory Batch: PASS / FAIL
Fact: PASS / FAIL
Evidence: PASS / FAIL
Embedding: PASS / FAIL
Vector Retrieval: PASS / FAIL
아이 격리: PASS / FAIL
자유대화 기억 반영: PASS / FAIL
미션 기억 반영: PASS / FAIL
자동 마이크: PASS / FAIL
수동 마이크: PASS / FAIL
V3 우선 정책: PASS / FAIL
멱등성: PASS / FAIL
부모 리포트: PASS / FAIL
Dev 배포: PASS / FAIL
Production 배포: PASS / FAIL
Production 데이터 보존: PASS / FAIL
전체 결과: PASS / FAIL
```

## 42.17 남은 문제

없으면 다음과 같이 작성한다.

```text
남은 문제 없음
```

남은 문제가 있으면 다음을 작성한다.

```text
최초 실패 단계:
확정 원인:
재현 계정:
business_date:
session_id:
execution_id:
job_id:
error_code:
error_summary:
수정 대상 파일:
수정 대상 RPC/Migration:
다음 조치:
```
