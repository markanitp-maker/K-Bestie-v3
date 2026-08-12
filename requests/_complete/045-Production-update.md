# Request: Ralph Mode 진입 전 Deep Interview (Production 배포 최종 심사)

## 목적

현재 Dev 환경에서는 V3 Pipeline(Collection → Context Correction → Memory Batch → Daily Report → Cleanup → Retention)가 구현되었고 Dev E2E 검증까지 완료되었다.

이제 실제 Production 환경으로 전환하려고 한다.

Production에는 실제 사용자 데이터가 존재한다.

따라서 이번 작업의 목표는 **배포가 아니라 Production 배포 가능 여부를 스스로 끝까지 검증하는 Deep Interview**이다.

아래 질문에 모두 답변한 뒤,

- Blocker = 0
- High = 0
- Ralph Mode 진입 가능

판정을 받기 전에는 절대로 Production 변경을 시작하지 않는다.

---

# 역할

너는 이번 프로젝트의 마지막 Gate Reviewer이다.

코드를 작성하는 개발자가 아니라

Production 전환 승인위원이라고 생각하고

최대한 의심하면서 검토하라.

"아마 괜찮다."

라는 답변은 허용하지 않는다.

반드시

- 근거
- 확인한 코드
- 확인한 Migration
- 확인한 DB 객체
- 실제 확인 결과

를 같이 제시한다.

---

# Section 1

## Dev 구현 완료 여부

아래 항목이 정말 구현 완료되었는가?

- Collection V3
- Context Correction
- Memory Batch
- Daily Report
- Cleanup
- Retention
- pipeline_v3_control
- Manual Reporting
- Admin API
- Pulse API
- Status API

각 항목마다

- 구현 여부
- 코드 위치
- 마지막 검증 결과

를 작성하라.

---

# Section 2

## Dev E2E

Dev에서 실제 검증한 항목은 무엇인가.

단순 Unit Test는 제외한다.

실제로 확인한 것만 작성한다.

예)

✓ collect

✓ generate

✓ collect_and_generate

✓ Memory 실패 후 Report 진행

✓ Cleanup

✓ Retention

✓ Idempotency

✓ Fixture Cleanup

등

실제 실행한 것만 적는다.

---

# Section 3

## Production 영향 분석

Production에는

- 실제 부모
- 실제 아이
- 실제 대화
- 실제 리포트

가 존재한다.

이번 배포가

기존 데이터에 어떤 영향을 줄 수 있는가.

항목별로

- 영향 없음

- 영향 가능

- 반드시 확인 필요

로 구분하라.

---

# Section 4

## Migration

Production에서 실행될 Migration 전체를 분석하라.

각 Migration마다

- 신규 생성

- ALTER

- DROP

- DELETE

- UPDATE

- DATA MIGRATION

여부를 작성한다.

DROP / DELETE / UPDATE가 있다면

실행 이유를 설명하라.

---

# Section 5

## Rollback

이번 작업에서

Rollback 가능한 것

Rollback 불가능한 것

을 구분하라.

특히

Production 데이터

Production Migration

Cron

Edge Function

Environment

Git

각각에 대해 설명하라.

---

# Section 6

## 가장 위험한 작업

이번 Production 배포에서

가장 위험한 작업 Top10을 작성하라.

각 항목마다

- 위험 이유

- 발생 가능성

- 영향도

- 예방책

을 작성한다.

---

# Section 7

## 실제 사용자 데이터

아래 질문에 답하라.

이번 배포가

실제 부모 데이터

실제 아이 데이터

실제 대화

실제 리포트

실제 Memory

를

삭제

변경

초기화

덮어쓰기

할 가능성이 있는가?

가능성이 있다면

무조건 Blocker로 지정한다.

---

# Section 8

## Cron

기존 Cron과

신규 Cron이

중복 실행될 가능성은 없는가.

Legacy Cron은

언제

어떻게

비활성화되는가.

---

# Section 9

## Cutover

pipeline_v3_control

enabled=false

상태에서

Production을 먼저 배포하는 것이 안전한가.

true로 바꾸는 시점은 언제인가.

---

# Section 10

## Smoke Test

Production 배포 후

실제 사용자 계정을 사용하지 않고

무엇을 테스트할 것인가.

순서를 작성하라.

---

# Section 11

## 최종 Gate

아래 항목을 모두 YES / NO 로 답하라.

- Migration 안전성

- 데이터 안전성

- Cron 안전성

- Edge Function 안전성

- Rollback 계획 존재

- Secret 확인 완료

- Production Drift 없음

- Dev Drift 없음

- E2E 완료

- Smoke Test 준비 완료

---

# Section 12

## Ralph Mode 진입 판정

아래 셋 중 하나만 선택한다.

① Ralph Mode 진입 가능

② Blocker 해결 후 가능

③ Production 배포 금지

그리고 반드시

Blocker

High

Medium

Low

를 표로 정리한다.

---

# 중요

이번 단계에서는

절대로

- Commit

- Push

- Migration 실행

- Edge Function Deploy

- Production Deploy

- Cron 등록

- Environment 수정

- pipeline_v3_control 변경

을 하지 않는다.

이번 작업은

**Production 배포를 시작하기 위한 마지막 Deep Interview**이다.

모든 답변은 실제 코드와 실제 프로젝트 상태를 근거로 작성한다.