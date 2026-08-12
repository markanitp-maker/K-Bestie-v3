
결론부터 말하면 **Production은 정상 상태가 아닙니다.**

- 안서아·안서현: 7/29~8/1 데이터가 `cutover_at` 때문에 수집 대상에서 제외됐고, 8/2 수동 실행도 다운스트림 연결이 깨졌습니다.
- 윤도원: 8/2 수집은 됐지만 Context Correction에서 `MESSAGE_COUNT_MISMATCH`로 영구 실패했습니다.
- 윤도건: 8/2 전체 파이프라인 정상 통과했습니다.
- 8/3은 아직 자동 수집 시각 전이므로 장애 판정 대상이 아닙니다.

아래를 Claude Code에 전달하면 됩니다.

---

# 045 - Production V3 파이프라인 장애 수정 및 누락 데이터 복구

## 작업 목적

Antigravity의 Production 읽기 전용 점검에서 확인된 장애만 수정한다.

전체 상태 감사를 다시 하지 말고, 아래에서 확정된 문제를 코드·Migration·배포에 반영한 뒤 대상 계정과 날짜만 재처리한다.

## 확정된 장애

### 1. 과거 데이터 수집 제외

`pipeline_v3_control.cutover_at`이 다음 시각으로 설정되어 있었다.

```text
2026-08-01 20:46:53 UTC
2026-08-02 05:46:53 KST
```

이 때문에 해당 시점 이전의 메시지는 V3 Collection 대상에서 제외됐다.

영향:

```text
안서아: 2026-07-29 ~ 2026-08-01
안서현: 2026-07-29 ~ 2026-08-01
```

### 2. 관리자 수동 실행 오케스트레이션 오류

2026-08-02 기준:

- 안서아: `collection_2`는 실행됐지만 Context Correction·Memory Batch·Daily Report가 정상 Enqueue되지 않음
- 안서현: 앞단 결과가 없는 상태에서 Daily Report만 단독으로 실행되어 `processing` 또는 실패 상태로 정체됨

관리자 화면의 `collect_and_generate`가 기존 Job 상태에 따라 필요한 다음 단계를 보장하지 못하고 있다.

### 3. 윤도원 Context Correction 영구 실패

2026-08-02 윤도원 데이터:

- Collection 완료
- 약 68개 메시지
- Context Correction에서 Gemini 반환 결과 일부 누락
- 입력 메시지 수와 반환 메시지 수 불일치
- `MESSAGE_COUNT_MISMATCH`
- `PERMANENT_ERROR`
- 이후 Memory Batch와 Daily Report도 실패

### 4. 정상 비교 대상

2026-08-02 윤도건 데이터:

- 약 30개 메시지
- Collection
- Context Correction
- Memory Batch
- Daily Report

전체 정상 통과했다.

---

# 1. Context Correction 대량 메시지 처리 수정

대상:

```text
lib/batch/contextCorrectionV3.ts
```

또는 실제 Production Context Correction Worker 구현 파일.

## 요구사항

하루 전체 Context Correction은 논리적으로 한 번 실행하되, 입력 메시지가 많으면 내부적으로 안전하게 나누어 처리한다.

권장 방식:

```text
하루 전체 Raw
→ 메시지 ID와 순서 고정
→ 20~30개 단위 또는 토큰 예산 기준 Chunk
→ Chunk별 Gemini 보정
→ source_message_id 기준 병합
→ 하루 Corrected 최종본 1건 저장
```

필수 조건:

- 배열 순서만으로 원문과 응답을 연결하지 않음
- `source_message_id` 또는 동등한 고유 ID로 매핑
- Gemini가 반환하지 않은 메시지는 원문 유지
- 케이 메시지도 누락하지 않음
- 원래 메시지 순서 유지
- Chunk 간 메시지 중복 금지
- 최종 Corrected 메시지 수와 Raw 메시지 수 일치
- Gemini가 알 수 없는 ID를 반환하면 무시하고 마스킹 로그 기록
- 같은 ID를 중복 반환하면 한 건만 사용하고 경고 기록
- 일부 Chunk 실패 시 이미 완료된 Chunk를 중복 저장하지 않음
- 동일 Job 재시도 시 멱등성 보장

다음 검증은 제거하거나 변경한다.

```text
전체 입력 개수 !== Gemini 반환 개수
→ 즉시 PERMANENT_ERROR
```

대신 다음으로 처리한다.

```text
정상 반환 메시지
→ 보정 결과 사용

누락 메시지
→ 원문 Fallback

전체 메시지 병합 완료
→ Corrected 저장
```

JSON 출력이 잘리거나 파싱되지 않은 Chunk는 재시도 대상으로 처리하되, 무조건 `PERMANENT_ERROR`로 확정하지 않는다.

---

# 2. 관리자 `collect_and_generate` 오케스트레이션 수정

관리자 리포트 수동 실행 API와 UI 동작을 수정한다.

대상 동작:

```text
즉시 대화 수집
즉시 리포트 생성
수집 후 리포트 즉시 생성
```

## `수집 후 리포트 즉시 생성`

반드시 다음 순서로 동작해야 한다.

```text
Collection 1·2 상태 확인
        ↓
필요한 Collection 실행
        ↓
Raw 완성 확인
        ↓
Context Correction
        ↓
Memory Batch
        ↓
Daily Report
```

## 이미 완료된 단계 처리

```text
Collection completed
→ 다시 수집하지 않고 다음 누락 단계 Enqueue

Context Correction completed
→ Memory Batch와 Daily Report 누락 여부 확인

Memory Batch failed
→ Memory 실패 기록
→ Daily Report는 계속 실행

Daily Report completed
→ 중복 리포트 생성 금지
```

## 실패 Job 처리

기존 `PERMANENT_ERROR` Job을 그대로 반환하고 끝내지 말고, 관리자 수동 재실행에서는 명시적으로 새 실행을 만들거나 안전하게 상태를 초기화해 재처리할 수 있어야 한다.

단:

- 완료된 Job은 재실행하지 않음
- 동일 실행의 중복 Job 생성 금지
- 새 `execution_id`를 사용
- 기존 실패 이력은 삭제하지 않음
- 재시도 이력을 추적 가능하게 유지

## 잘못된 단독 실행 방지

다음 상태에서는 Daily Report를 단독 실행하지 않는다.

```text
Raw 없음
Corrected 없음
Context Correction 실패
```

대신 관리자 화면에 다음처럼 표시한다.

```text
Context Correction 재처리 필요
Memory Batch 대기
Daily Report 대기
```

---

# 3. 파이프라인 단계 의존성 수정

단계별 전이는 다음 규칙으로 고정한다.

```text
Collection 2 완료
→ Context Correction Enqueue

Context Correction 완료
→ Memory Batch Enqueue
→ Daily Report 실행 준비

Memory Batch 완료
→ Daily Report 실행 또는 완료 유지

Memory Batch 실패
→ 실패 기록
→ Daily Report는 계속 실행

Context Correction 실패
→ Memory Batch와 Daily Report 실행 금지
→ blocked 또는 waiting 상태로 기록
```

Context Correction 실패 때문에 Memory와 Report를 모두 `PERMANENT_ERROR`로 만드는 대신, 실제 실패 단계와 대기 단계를 구분한다.

예:

```text
Context Correction: failed
Memory Batch: blocked_by_context_correction
Daily Report: blocked_by_context_correction
```

관리자 재실행에서 Correction이 성공하면 차단된 후속 단계를 이어서 실행한다.

---

# 4. `pipeline_v3_control.cutover_at` 정리

Production의 `cutover_at`을 무조건 과거 날짜로 변경해 전체 데이터를 다시 수집하지 않는다.

## 앞으로의 자동 처리

현재 이후 신규 메시지는 정상적으로 수집되도록 V3 설정을 유지한다.

## 과거 누락 데이터

`cutover_at`을 과거로 돌려 전체 메시지를 자동 재수집하지 말고, 아래 대상만 명시적으로 선택 Backfill한다.

```text
안서아
- 2026-07-29
- 2026-07-30
- 2026-07-31
- 2026-08-01
- 2026-08-02

안서현
- 2026-07-29
- 2026-07-30
- 2026-07-31
- 2026-08-01
- 2026-08-02

윤도원
- 2026-08-02
```

윤도건 2026-08-02는 정상 통과했으므로 재처리하지 않는다.

각 날짜별로 실제 `chat_messages`가 존재하는 경우에만 처리한다.

원본 대화가 없는 날짜는 `NO_SOURCE_DATA`로 기록하고 생성하지 않는다.

---

# 5. Production 기존 데이터 보존

다음 기존 데이터를 삭제하거나 전체 재생성하지 않는다.

```text
memory_facts: 5건
memory_evidence: 7건
memory_embeddings: 7건
embedding model: gemini-embedding-001
```

필수 조건:

- 기존 Fact ID 유지
- 기존 Evidence 유지
- 기존 Embedding 유지
- 전체 Memory 초기화 금지
- 전체 과거 데이터 재처리 금지
- 대상 아이·날짜만 선택 재처리
- 같은 Fact 중복 생성 금지

---

# 6. 선택 Backfill 실행 순서

코드 수정과 Production 배포가 완료된 후 다음 순서로 실행한다.

## 안서아·안서현 과거 날짜

```text
chat_messages 존재 확인
→ 해당 날짜 Collection
→ Raw 하루 데이터 구성
→ Context Correction
→ Memory Batch
→ Daily Report
```

해당 날짜가 이미 일부 처리됐다면 완료된 데이터를 재생성하지 않고 누락 단계만 이어서 실행한다.

## 윤도원 2026-08-02

기존 Raw가 정상이라면 Collection을 다시 하지 않는다.

```text
기존 Raw 검증
→ 실패 Context Correction 새 실행
→ Memory Batch
→ Daily Report
```

기존 실패 Job은 감사 이력으로 보존한다.

## 안서아·안서현 2026-08-02

기존 Collection·Raw 상태를 활용하고, 누락된 다운스트림부터 이어서 처리한다.

---

# 7. 검증 기준

## 안서아

2026-07-29~2026-08-02 중 원본 대화가 있는 날짜:

- Raw 존재
- Corrected 존재
- Memory Batch 완료
- Daily Report 완료

## 안서현

동일 기준.

## 윤도원

2026-08-02:

- 기존 68개 Raw 메시지 보존
- Corrected 메시지 수 68개
- 누락 메시지는 원문 Fallback
- Memory Batch 완료
- Daily Report 완료
- `MESSAGE_COUNT_MISMATCH` 재발 없음

## 윤도건

2026-08-02 기존 정상 결과 유지:

- 기존 Raw 유지
- 기존 Corrected 유지
- 기존 Memory 유지
- 기존 Report 유지
- 중복 생성 0건

---

# 8. 관리자 화면 결과 표시 개선

현재처럼 모든 후속 단계를 `PERMANENT_ERROR`로 동일 표시하지 않는다.

예:

```text
수집: 완료
수집보정: 실패 — MESSAGE_COUNT_MISMATCH
메모리: 대기 — 수집보정 실패
리포트: 대기 — 수집보정 실패
```

재실행 후:

```text
수집: 기존 완료 사용
수집보정: 재처리 완료
메모리: 완료
리포트: 완료
```

실행 결과에 다음을 표시한다.

- 최초 실패 단계
- 오류 코드
- 오류 요약
- 재시도 여부
- 기존 완료 데이터 재사용 여부
- 생성·건너뜀·실패 건수

---

# 9. 보안 원칙

- Production 서비스 역할 키 출력 금지
- DB 비밀번호 출력 금지
- Secret 하드코딩 금지
- 임시 스크립트에 연결 문자열 저장 금지
- 환경변수 또는 Secret Manager만 사용
- 로그에는 Secret 존재 여부만 출력
- 아이 대화 원문을 전체 로그에 출력하지 않음

---

# 완료 기준

다음이 모두 완료돼야 한다.

```text
안서아 누락 날짜 복구
안서현 누락 날짜 복구
윤도원 2026-08-02 Context Correction 복구
윤도건 기존 정상 데이터 유지
관리자 collect_and_generate 정상 연결
대량 메시지 Context Correction PASS
Memory Batch PASS
Daily Report PASS
기존 Production Memory 데이터 보존
중복 Fact·Evidence·Embedding 0건
```

---

# 최종 보고 형식

## 1. 변경 파일

- 파일 경로
- 변경 내용

## 2. 장애 수정 결과

```text
MESSAGE_COUNT_MISMATCH 수정: PASS / FAIL
관리자 다운스트림 Enqueue 수정: PASS / FAIL
실패 Job 재실행 수정: PASS / FAIL
Memory 실패 시 Report 계속 실행: PASS / FAIL
```

## 3. 계정별 복구 결과

| 이름 | 날짜 | 원본 | Raw | Corrected | Memory | Report | 최종 결과 |
|---|---|---|---|---|---|---|---|

## 4. 윤도원 검증

```text
Raw 메시지:
Corrected 메시지:
원문 Fallback:
중복 메시지:
Memory Facts:
Daily Report:
```

## 5. 기존 데이터 보존

```text
기존 memory_facts:
기존 memory_evidence:
기존 memory_embeddings:
기존 ID 변경:
고아 데이터:
```

## 6. 남은 실패

없으면 다음과 같이 작성한다.

```text
남은 실패 없음
```