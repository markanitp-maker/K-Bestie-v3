# Request 069 — 미션 Turn 원자적 저장·재시도·완료/황금열쇠 정합성 강화

## 0. 작업 목적

현재 미션 대화는 아이/케이 메시지를 `POST /api/chat/messages`로 fire-and-forget 저장하고, 미션 진행률은 별도 `POST /api/mission/answer`에서 처리한다.

이 구조 때문에 실제 아이 발화가 여러 번 발생해도 일부 `chat_messages`만 저장되거나, 메시지 저장 실패와 미션 진행 상태가 서로 불일치할 수 있다.

2026-08-06 Production에서 안서현 Phase 2 세션이 생성된 뒤 `chat_messages = 0`, `mission_progress = IN_PROGRESS(0/10)`으로 남았고, 이 사건의 과거 HTTP 원시 로그는 보존되지 않아 정확한 직접 원인은 확정할 수 없었다. 다만 현재 코드에서 `saveMessage()`가 fire-and-forget으로 동작하여 부분 메시지 유실 가능성이 구조적으로 존재함은 확정되었다.

이번 작업의 목표는 다음과 같다.

- 아이 발화가 서버 DB에 저장되지 않으면 해당 턴을 절대 확정하지 않는다.
- 아이 발화 10건 중 일부만 저장되는 구조를 제거한다.
- 미션 진행률과 `chat_messages` 정합성을 보장한다.
- 마지막 턴은 `COMPLETED + 황금열쇠`까지 서버에서 일관되게 확정한다.
- 네트워크 실패 시 현재 턴만 안전하게 재시도한다.
- 동일 턴 재전송 시 메시지/진행률/황금열쇠 중복이 0건이어야 한다.
- PWA 종료/백그라운드/네트워크 전환에도 미확정 턴이 유실되지 않게 한다.
- 다음 유사 장애 발생 시 원인을 역추적할 수 있는 최소 telemetry를 남긴다.

## 1. 절대 원칙

### 1.1 서버 저장 성공 전 다음 질문 진행 금지

현재:
```text
아이 발화
→ saveMessage() fire-and-forget
→ /api/mission/answer
→ 다음 질문
```

변경:
```text
아이 발화
→ 서버 Turn 처리
→ DB 저장 성공 확인
→ progress 확정
→ 케이 응답 확정
→ 서버 SUCCESS
→ 다음 질문
```

### 1.2 DB에 없는 대화는 완료된 턴으로 인정하지 않는다

아이 발화가 UI에서 보였더라도 서버에 child turn이 확정 저장되지 않았다면:
- `valid_answer_count` 증가 금지
- 다음 질문 진행 금지
- `COMPLETED` 전환 금지
- 황금열쇠 지급 금지
- 완료/황금열쇠 팝업 표시 금지

### 1.3 마지막 턴 완료와 황금열쇠 정합성

마지막 유효 답변에서 반드시 다음이 모두 확정되어야 한다.

```text
마지막 child turn 저장 성공
+
required valid answer count 충족
+
mission_progress.status = COMPLETED
+
gold_keys 지급 성공 또는 기존 지급 idempotent 확인
=
완료 UI + 황금열쇠 UI 허용
```

`COMPLETED`와 `gold_keys`는 서로 불일치하지 않도록 동일 DB Transaction/RPC에서 원자적으로 처리하는 방안을 우선 적용한다.

## 2. 권장 아키텍처

신규 서버 API 중심으로 통합한다.

```text
POST /api/mission/turn
```

현재 미션 Turn 책임이 분산된:
```text
POST /api/chat/messages
POST /api/mission/answer
POST /api/mission/respond
```
를 단일 Turn 처리 흐름으로 통합한다.

단, `/api/chat/messages` GET 등 다른 기능이 사용하는 기존 경로는 영향도를 확인하고 필요한 기능만 유지한다.

## 3. 한 Turn 목표 처리 흐름

```text
아이 발화/STT 완료
↓
클라이언트 pending turn 임시 보관
↓
POST /api/mission/turn
↓
인증 + session 검증
↓
동일 client_turn_id 처리 여부 확인
↓
아이 chat_message 저장
↓
답변 validation
↓
mission progress 처리
↓
케이 응답 생성
↓
케이 chat_message 저장
↓
일반 Turn이면 FINALIZED
↓
마지막 Turn이면:
  COMPLETED + gold_keys 원자 확정
↓
통합 SUCCESS 응답
↓
클라이언트 pending turn 삭제
↓
케이 응답 재생
↓
다음 질문
```

## 4. 외부 LLM 호출과 DB Transaction 분리

Gemini/LLM/STT/TTS 같은 외부 API를 PostgreSQL Transaction 내부에서 장시간 유지하지 않는다.

권장 흐름:
```text
1. child turn 수신 및 idempotency 검증
2. 필요한 서버 validation 수행
3. child message / turn processing 상태 안전 저장
4. DB transaction 종료
5. Gemini 응답 생성
6. 최종 DB transaction
   - K message
   - question 상태
   - progress
   - 마지막 턴이면 COMPLETED
   - 마지막 턴이면 gold_keys
7. SUCCESS 반환
```

원칙:
- 외부 API를 DB lock 안에서 오래 기다리지 않는다.
- 클라이언트에 SUCCESS를 주기 전 서버 데이터는 정합 상태여야 한다.
- 실패한 중간 상태는 재시도 가능해야 한다.

## 5. Turn 멱등성

각 아이 답변에 재시도에도 변하지 않는 논리적 Turn ID를 사용한다.

기존 `turn_id`의 실제 의미와 UNIQUE 구조를 먼저 확인하고:
- 그대로 써도 안전하면 기존 `turn_id` 사용
- 다른 의미와 충돌하면 `client_turn_id` 또는 동등한 별도 키 도입

동일 턴이 네트워크 재시도로 3번 들어와도:
```text
child chat_message 추가 = 1건
valid_answer_count 증가 = 1회
K response logical turn = 1개
gold_keys 지급 = 최대 1개
```
여야 한다.

## 6. 마지막 Turn 완료 Transaction

완료 조건에 도달한 턴에서는 다음을 동일한 서버 확정 흐름으로 처리한다.

```text
child turn 정상 저장 확인
↓
valid_answer_count = requiredCount
↓
DB Transaction 시작
  mission_progress.status = COMPLETED
  completion timestamp/state 확정
  gold_keys idempotent 지급
DB Transaction commit
↓
서버가 DB 상태 확인
↓
HTTP 200
  completed = true
  rewardStatus = awarded | already_earned
```

하나라도 실패하면 `completed = true`를 클라이언트에 반환하지 않는다.

## 7. 황금열쇠 UI Source of Truth

클라이언트 로컬 상태만으로 황금열쇠 팝업을 띄우지 않는다.

다음 서버 응답일 때만 표시한다.
```text
ok = true
completed = true
rewardStatus = awarded | already_earned
```

서버가 성공을 확정하지 못하면:
- 완료 모달 금지
- 황금열쇠 획득 모달 금지
- 진행 완료 처리 금지

## 8. 실패 및 재시도 UX

DB 저장 실패 시 미션 전체를 처음부터 다시 시작시키지 않는다. 실패한 현재 Turn만 재시도한다.

자동 재시도 대상:
- Network Error
- timeout
- 429
- 500
- 502
- 503
- 504

권장:
```text
1차 시도
→ 실패
→ 짧은 backoff
→ 2차
→ 실패
→ 짧은 backoff
→ 3차
→ 실패
→ 사용자 재시도 UI
```

최종 실패 시 다음 질문으로 넘어가지 않고 현재 턴 유지:
```text
대화를 저장하는 중 문제가 생겼어요.
연결을 확인하고 다시 시도해 주세요.

[다시 시도]
```

아이에게 서버/DB/네트워크 같은 기술 용어는 노출하지 않는다.

## 9. PWA Pending Turn 보호

`sessionStorage`만 사용하지 않는다.

```text
PWA/탭 강제 종료
→ sessionStorage 소실 가능
→ 서버 전송 전 마지막 아이 발화 유실
```

미확정 Turn은 짧은 TTL의 IndexedDB 등 persistent storage 사용을 검토하고 구현한다.

보관 원칙:
- 서버 확인 전인 현재 미확정 Turn만 최소 보관
- 원문 장기 저장 금지
- 서버 SUCCESS 즉시 삭제
- TTL 초과 시 자동 정리
- 로그에 원문 출력 금지

## 10. 앱 재진입 Recovery

```text
pending turn 존재
↓
서버에 동일 client_turn_id 재전송 또는 상태 확인
↓
이미 처리됨
  → 서버 상태로 UI 동기화
  → local pending 삭제
↓
미처리
  → 동일 Turn 재전송
↓
성공
  → local pending 삭제
  → 정상 진행
```

같은 답변에 새 `turn_id`를 생성하여 중복 처리하지 않는다.

## 11. 입력 경로 전수 적용

다음 모든 미션 입력 경로가 동일한 Turn persistence 정책을 사용해야 한다.

- 자동 음성
- 수동 음성
- 키보드/텍스트 입력
- Live
- 비Live
- STT 기반
- Dev/Production의 현재 mission mode 전부

특정 모드만 기존 fire-and-forget을 계속 사용하면 실패 처리한다.

## 12. K 응답 저장

아이 메시지만 보장하고 K 메시지는 fire-and-forget으로 남겨두지 않는다.

최종 서버 Turn 응답을 성공 처리하려면 해당 logical Turn의 필요한 K 응답 저장도 확정되어야 한다.

K 응답 생성 실패가 발생하면 기존 정책에 맞는 fallback/retry를 적용하되, DB에 저장되지 않은 K 응답을 finalized Turn으로 취급하지 않는다.

## 13. 기존 API 처리

다음 기존 경로의 사용처를 전수 조사한다.
```text
/api/chat/messages
/api/mission/answer
/api/mission/respond
```

미션에서는 신규 Turn API를 source of truth로 전환한다.

단:
- 자유대화
- 부모 대화
- 관리자
- history 조회

등 다른 기능이 동일 API를 사용하면 함부로 제거하지 않는다.

## 14. 최소 운영 Telemetry

대화 원문을 별도 telemetry에 복제하지 않는다.

권장 이벤트:
```text
MISSION_SESSION_STARTED
TURN_RECEIVED
CHILD_MESSAGE_PERSISTED
TURN_PROCESSING
MISSION_PROGRESS_UPDATED
K_MESSAGE_PERSISTED
TURN_FINALIZED
TURN_RETRY
TURN_FAILED
MISSION_COMPLETED
REWARD_GRANTED
```

최소 메타데이터:
```text
timestamp
session_id
client_turn_id
masked child_id
event_type
status
error_code
attempt_count
```

금지:
- 아이 발화 원문 로그
- API key
- token
- service role key
- 비밀번호
- 민감 Secret

## 15. 운영 진단 가능성

다음처럼 장애 위치가 서버 기록만으로 확인 가능해야 한다.

```text
세션 시작
→ Turn 1 수신
→ child 저장 성공
→ progress 성공
→ K 저장 성공
→ Turn finalized

Turn 4
→ TURN_RECEIVED
→ CHILD_MESSAGE_PERSIST_FAILED
→ retry 3회
→ TURN_FAILED
```

## 16. 성능 요구사항

안정성을 얻기 위해 불필요한 체감 지연을 추가하지 않는다.

목표:
- 현재 다중 HTTP 왕복을 통합 Turn API 1회 중심으로 축소
- DB write 성공 확인은 서버 요청 안에서 처리
- 불필요한 polling 금지
- 클라이언트가 매 턴 DB를 별도 SELECT해서 확인하는 구조 금지

즉:
```text
매 Turn DB 재조회
```
가 아니라:
```text
서버가 Turn commit을 책임지고 SUCCESS 반환
```
구조로 구현한다.

## 17. DB/RPC 설계 원칙

실제 Repository와 Production/Dev schema를 먼저 확인한 뒤 구현한다.

RPC 이름은 실제 기존 패턴을 확인 후 결정한다.

반드시 보장:
- idempotency
- row lock/concurrency
- progress 중복 증가 방지
- completion 중복 방지
- reward 중복 지급 방지

## 18. Dev 필수 장애 주입 QA

### QA-1 정상 10턴
- child message 전부 저장
- 필요한 K message 전부 저장
- progress 정확히 10
- COMPLETED 정확히 1회
- gold_keys 정확히 1회

### QA-2 3번째 Turn DB 저장 강제 실패
- progress는 2에서 멈춤
- 다음 질문 진행 금지
- 재시도 UI
- 재시도 성공 후 progress = 3
- 중복 message 없음

### QA-3 일부 Turn 네트워크 실패
10턴 중 2, 5, 7번째 요청 실패 주입.
- 자동 재시도
- 최종 DB child logical turn 10개 모두 존재
- 일부만 저장된 상태로 완료되는 현상 0

### QA-4 동일 Turn 3회 동시 재전송
- child message = 1
- progress +1
- K logical response 중복 없음
- reward 영향 없음

### QA-5 마지막 Turn gold_keys 실패
- 완료 UI 금지
- 황금열쇠 UI 금지
- `COMPLETED + reward 없음` 불일치 상태 금지
- 재시도 후 정상 1회 완료/지급

### QA-6 마지막 Turn 직후 앱 강제 종료
- pending Turn 유실 없음
- 재접속 후 서버 상태 동기화
- 동일 Turn 중복 처리 없음

### QA-7 Wi-Fi ↔ LTE / Offline 전환
- 현재 Turn 보존
- 다음 질문 조기 진행 없음
- 재연결 후 동일 Turn 재전송
- DB 데이터 완전성 유지

### QA-8 K message 저장 실패
- 불완전 Turn을 finalized로 처리하지 않음
- 서버 retry/recovery 가능
- UI/DB 불일치 없음

### QA-9 모든 입력 모드
자동 음성 / 수동 음성 / 텍스트 / Live / 비Live 각각 동일 정합성 검증.

### QA-10 Slow Network
- 데이터 유실 0
- 중복 0
- 정상 retry
- 사용자에게 기술 오류 메시지 노출 없음

## 19. 회귀 테스트

반드시 확인:
- 미션 Phase 1
- 미션 Phase 2
- 이어하기
- 질문 순환
- 기본 질문/예비 질문
- 유효 답변 10개 완료
- 자동/수동 음성
- 키보드 전환
- Live/비Live
- 황금열쇠 1회 지급
- 출석 황금열쇠와 충돌 없음
- 미션 이벤트 카운트
- `chat_messages` Collection
- 17:55 Phase 1 Collection
- 23:55 Phase 2 Finalization
- Context Correction
- Memory Batch
- Daily Report
- LLM Wiki 원천 데이터 누락 없음

## 20. Production 배포 조건

Dev 필수 QA가 모두 PASS하기 전 Production 배포 금지.

Production 적용 시:
1. 기존 Production 데이터 삭제/재작성 금지
2. migration은 기존 데이터 보존 방식
3. 기존 완료 mission/gold_keys 수정 금지
4. 배포 후 QA 전용 계정으로 실제 미션 E2E 확인
5. Turn별 persistence 확인
6. completed/reward 일치 확인
7. telemetry 기록 확인
8. Collection/Report 파이프라인 회귀 확인

## 21. 보안 원칙

- Production service role key 평문 하드코딩 금지
- API key 하드코딩 금지
- token/비밀번호 로그 출력 금지
- 임시 파일에 Secret 저장 금지
- 기존 환경변수 / Vercel Secret / Supabase Secret 등 런타임 보안 경로 사용
- 로그에는 Secret 및 아이 대화 원문 출력 금지

## 22. 작업 진행 방식

작업을 작은 단계로 나누어 순차 진행한다.

각 단계마다:
- 목표
- 실행 항목
- 성공 기준
- 실패 기준
- 검증 방법

성공하면 별도 승인 대기 없이 다음 단계로 진행한다.

실패하면:
```text
원인 분석
→ 수정
→ 동일 단계 재검증
→ PASS
```
후 다음 단계로 이동한다.

## 23. 최종 완료 보고

반드시 포함:
1. 변경 전 실제 Turn 흐름
2. 변경 후 실제 Turn 흐름
3. 수정/신규 파일 목록
4. migration/RPC 목록
5. idempotency 구현 방식
6. retry/PWA recovery 방식
7. COMPLETED + gold_keys 원자성 증거
8. Dev 장애 주입 QA 결과
9. 회귀 테스트 결과
10. Production 배포 결과
11. Production QA 계정 E2E 결과
12. 데이터 유실 0 / 중복 0 증거
13. telemetry 동작 증거
14. 남은 위험 요소

# 최종 성공 기준

다음 상황이 구조적으로 불가능해야 한다.

```text
아이 발화 10건
→ 서버에는 1~2건만 저장
→ 미션은 완료
```

```text
chat_messages 저장 실패
→ progress 증가
→ 다음 질문 이동
```

```text
DB COMPLETED 없음
→ 완료 UI 표시
```

```text
gold_keys 지급 없음
→ 황금열쇠 획득 UI 표시
```

그리고 네트워크 장애가 발생해도:
```text
현재 Turn 안전 보존
→ 동일 Turn 재시도
→ 저장 성공
→ 다음 진행
```
이 보장되어야 한다.
