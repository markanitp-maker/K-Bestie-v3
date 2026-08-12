# LLM Wiki Memory Batch V3 QA 복구 및 Dev 검증 인계 요청

## 목적

Antigravity에서 중단된 LLM Wiki Memory Batch V3 QA를 Claude Code가 인계받아 Dev 환경에서만 복구하고 검증한다.

이번 작업의 목표는 다음과 같다.

- Antigravity가 추가한 보안 위반 코드 원복
- Dev DB 실제 스키마를 기준으로 QA 데이터 생성 로직 수정
- Memory Batch V3 핵심 E2E 검증
- 동일 오류 반복 실행 방지
- Production 환경 무변경 보장

## 절대 금지사항

- Production 코드, DB, Secret, Edge Function, Cron, 데이터 변경 금지
- Production 대상 Migration, 배포, Backfill 실행 금지
- Secret, API Key, Service Role Key, 비밀번호, 토큰 평문 하드코딩 금지
- Secret 값 로그 출력 금지
- Secret 값 임시파일 저장 금지
- 오류 발생 때마다 필수 컬럼을 하나씩 추측하여 추가하는 방식 금지
- 다른 Dev 기능 데이터 임의 삭제 금지
- 동일 성격의 실패를 근거 없이 반복 실행 금지

## 1. 보안 위반 코드 복구

먼저 `lib/batch/memoryV3.ts`를 점검한다.

Antigravity가 추가한 다음 항목을 모두 제거한다.

- 하드코딩된 Dev URL
- 하드코딩된 `BATCH_SECRET`
- 인증 우회 코드
- 테스트 편의를 위해 강제로 삽입한 인증값

원래의 환경변수 기반 인증 방식으로 복구한다.

Secret은 기존 `.env.local`, Supabase Dev Secrets 또는 기존 보안 환경변수에서 런타임에만 읽는다.

보고서에는 Secret 이름만 표시하고 실제 값은 절대 출력하지 않는다.

## 2. Dev DB 실제 스키마 일괄 확인

다음 테이블의 실제 스키마를 추측 없이 한 번에 조회한다.

- `raw_daily_conversations_v3`
- `raw_daily_conversation_messages_v3`
- `corrected_daily_conversations_v3`
- `corrected_daily_conversation_messages_v3`
- `pipeline_jobs`

각 테이블에서 다음을 확정한다.

- 전체 컬럼명
- 데이터 타입
- `NOT NULL`
- `DEFAULT`
- `UNIQUE`
- `PRIMARY KEY`
- `FOREIGN KEY`
- `CHECK`
- 인덱스
- 실제 부모·자식 관계

스키마 확인이 끝나기 전에는 QA 테스트 데이터를 다시 삽입하지 않는다.

## 3. QA 스크립트 수정

대상 파일:

- `e2e/qa-042-memory-batch-v3.spec.ts`

수정 기준:

- 존재하지 않는 `updated_at` 등 잘못 추가된 컬럼 제거
- 실제 스키마에 존재하는 필수 컬럼을 한 번에 반영
- 부모 Raw 레코드를 먼저 생성
- Corrected 부모 레코드 생성
- Corrected Message 자식 레코드 생성
- 실제 FK 관계 준수
- 유효한 UUID 사용
- `child_id`, `business_date`, `session_id`, `source_message_id`, `created_at` 등 실제 필수 필드 정확히 반영
- 동일 테스트 재실행 시 충돌하지 않도록 테스트 전용 고유 식별자 사용
- 테스트 시작 전 해당 테스트가 생성한 데이터만 정리
- 다른 Dev 데이터는 삭제하지 않음
- 테스트 종료 후 생성한 더미 데이터와 파생 Memory 데이터만 정리 가능하도록 구성

## 4. QA 실행 제한

1차 QA는 아래 항목만 검증한다.

1. 테스트 데이터 Setup 성공
2. Memory Batch Edge Function 호출 성공
3. `pipeline_jobs` 상태 전이 확인
4. `memory_facts` 생성
5. `memory_evidence` 생성
6. `memory_embeddings` 생성
7. Embedding 모델이 `gemini-embedding-001`인지 확인
8. 동일 대상 재실행 시 중복 생성 0건
9. Memory Batch 완료 후 Daily Report Job 전이 확인

실패 시 규칙:

- 첫 번째 실패 후 즉시 재실행하지 않는다.
- 실패 원인을 스키마, 코드, DB 상태 기준으로 한 번에 분석한다.
- 수정 근거를 기록한 뒤 한 번만 수정한다.
- QA 실행은 최대 2회까지만 허용한다.
- 두 번째 실행도 실패하면 즉시 중단한다.
- 두 번째 실패 이후 자동 수정이나 반복 실행을 하지 않는다.

## 5. Dev 스키마 변경 및 재배포 제한

다음 작업이 필요하면 먼저 이유와 영향 범위를 보고하고 승인을 기다린다.

- 추가 Migration 실행
- Dev DB 스키마 변경
- Edge Function 재배포
- Dev Secret 변경
- Cron 변경

승인 없이 수행 가능한 범위는 다음으로 제한한다.

- 보안 위반 코드 원복
- QA 스크립트 수정
- 읽기 전용 스키마 확인
- 기존 Dev 환경을 이용한 제한된 QA 실행

## 6. 성공 판정 기준

다음 조건을 모두 만족해야 PASS로 판정한다.

- 테스트 Setup 성공
- Memory Batch 호출 성공
- 대상 Job이 정상 상태로 전이
- Fact 생성 성공
- 모든 신규 Fact에 Evidence 연결
- 모든 신규 Fact에 Embedding 연결
- Embedding 모델이 모두 `gemini-embedding-001`
- 고아 Evidence 0건
- 고아 Embedding 0건
- 동일 대상 재실행 후 Fact 증가 0건
- 동일 대상 재실행 후 Evidence 증가 0건
- 동일 대상 재실행 후 Embedding 증가 0건
- Daily Report Job 정상 전이
- Production 영향 0건

## 7. 완료 보고 형식

최종 보고서는 아래 순서로 작성한다.

### 복구한 보안 위반 코드

- 변경 파일
- 제거한 하드코딩 항목
- 복구한 환경변수 사용 방식
- Secret 값 미노출 확인

### 확인한 실제 스키마

- 테이블별 필수 컬럼
- 주요 제약조건
- 부모·자식 관계
- 기존 QA 오류의 정확한 원인

### 수정 파일

- 파일 경로
- 수정 내용
- 수정 이유

### 1차 실행 결과

- PASS 또는 FAIL
- 실행 단계
- 실패 시 정확한 원인
- DB 전후 건수

### 재실행 결과

- 재실행 여부
- 수정 근거
- PASS 또는 FAIL
- 동일 오류 반복 여부

### DB 전후 건수

- `memory_facts`
- `memory_evidence`
- `memory_embeddings`
- `memory_entities`
- `memory_relations`
- 관련 `pipeline_jobs`

### 멱등성 결과

- 첫 실행 생성 건수
- 두 번째 실행 추가 생성 건수
- 중복 건수
- 고아 레코드 건수

### 남은 결함

- 현재 남은 오류
- 수정 필요 파일
- 추가 승인 필요 작업

### Production 영향 없음 확인

- Production 코드 변경 없음
- Production DB 변경 없음
- Production Secret 변경 없음
- Production Function 배포 없음
- Production Cron 변경 없음
- Production 데이터 변경 없음