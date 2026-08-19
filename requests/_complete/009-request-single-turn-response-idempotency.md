# Single Child Turn Response Idempotency — Mission / Free Chat Double Response Fix

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 동일한 하나의 child turn에 대해 canonical K response가 최대 1회만 생성·저장된다.
- Free Chat에서 `respondText()`가 빠르게 중복 진입하거나 동일 turn에 대한 요청이 병렬로 발생해도 `/api/voice/respond`가 동일 child turn에 대해 Gemini response-generation을 중복 실행하지 않는다.
- Mission에서 서버가 이미 저장한 K 응답을 TTS/클라이언트 동기화 경로가 `/api/chat/messages`를 통해 다시 저장하지 않는다.
- Mission / Free Chat 모두 retry, callback 중복, 빠른 입력, STT final 중복 등 클라이언트 측 이상이 발생해도 서버가 최종적으로 동일 child turn의 중복 응답 생성/저장을 차단한다.
- `unclear_audio` 같은 deterministic response도 동일 child turn에서 중복 저장되지 않는다.
- 반대로 설계상 정상인 복수 K 메시지는 유지된다.
  - Mission opening + 첫 질문
  - Mission response + completion
  - Mission completion + reward
  - Safety 안내
  - Free Chat 종료 안내
  - 기타 서로 다른 message purpose/source를 가진 정상 multi-message
- 동일 텍스트 여부가 아니라 canonical `session + child turn + response purpose/source`를 기준으로 멱등성을 보장한다.
- 기존 current-turn context duplication fix와 충돌하지 않는다.
- Development에서 자동 QA 및 대표님 QA를 통과하기 전까지 Production은 변경하지 않는다.
- 최종 상태는 `WAITING_FOR_OWNER_QA`.

### 대표님 테스트 정상 프로세스

#### A. Free Chat 일반 텍스트 입력
1. Development 자유대화에 QA 계정으로 접속한다.
2. “나 지금 학원 끝났어!” 같은 일반 문장을 입력한다.
3. Enter/submit이 빠르게 중복 발생하도록 QA fixture 또는 double-submit 테스트를 실행한다.
4. 화면에 K 말풍선이 1개만 나타나는지 확인한다.
5. DB `chat_messages`에 해당 child turn에 대한 canonical K response가 1건만 저장되는지 확인한다.
6. response-generation Gemini usage event도 1회만 발생하는지 확인한다.

#### B. Free Chat 빠른 연속 입력 / 병렬 callback
7. 짧은 시간에 동일 turn callback을 2회 호출하는 fixture를 실행한다.
8. `/api/voice/respond`가 실제로 2회 도착하더라도 동일 canonical child turn에 대해 응답 생성이 한 번만 확정되는지 확인한다.
9. duplicate 요청은 기존 canonical result 재사용 또는 안전한 no-op 등 현재 구조에 맞는 idempotent 결과를 반환하는지 확인한다.
10. K message가 2개 생성되지 않는지 확인한다.

#### C. Free Chat deterministic response
11. `unclear_audio` fixture에서 동일 child turn을 2회 처리한다.
12. “잘 못 알아들었어...” 같은 deterministic response가 2개 저장되지 않는지 확인한다.
13. Gemini 호출이 0회인 deterministic 경로에서도 멱등성이 적용되는지 확인한다.

#### D. Mission 일반 턴
14. Development Mission에서 질문에 정상 답변한다.
15. `/api/mission/turn`이 K 응답을 저장한 뒤 TTS가 재생되는지 확인한다.
16. TTS 재생을 위해 `sayText()`가 호출되어도 동일 질문이 `/api/chat/messages`를 통해 다시 저장되지 않는지 확인한다.
17. 화면에는 실제 canonical K response가 한 번만 표시되는지 확인한다.

#### E. Mission 정상 multi-message 보존
18. Mission opening → 첫 질문 흐름을 테스트한다.
19. opening과 첫 질문이 설계상 서로 다른 메시지라면 둘 다 정상 유지되는지 확인한다.
20. Mission 완료 시 response + completion + reward가 필요한 케이스를 테스트한다.
21. 서로 다른 purpose/source를 가진 정상 메시지가 idempotency guard에 의해 잘못 제거되지 않는지 확인한다.

#### F. Retry / 재전송
22. 동일 `childTurnId`로 동일 response endpoint를 두 번 호출한다.
23. 두 번째 요청에서 response-generation Gemini가 다시 실행되지 않는지 확인한다.
24. canonical response DB row가 1건만 존재하는지 확인한다.
25. 다른 child turn에는 정상적으로 새 K response가 생성되는지 확인한다.

#### G. 서로 다른 연속 child turn
26. 아이가 “응”을 두 번 각각 다른 turn으로 말한다.
27. 텍스트가 같아도 `turn_id`가 다르면 각각 정상 처리되는지 확인한다.
28. 문자열 동일성 기반 dedupe가 발생하지 않는지 확인한다.

PASS 기준:
- 동일 child turn의 canonical K response: 최대 1건.
- 동일 child turn의 response-generation Gemini call: 최대 1회.
- deterministic response도 동일 turn에서 최대 1건.
- Mission TTS 경로가 이미 저장된 K response를 다시 DB에 쓰지 않음.
- Free Chat `respondText()` 중복 진입 방어 존재.
- 서버 idempotency가 client guard와 별개로 최종 무결성을 보장.
- 동일 텍스트라도 서로 다른 turn이면 정상 처리.
- Mission opening/completion/reward/Safety 등 정상 multi-message 보존.
- current-turn context duplication 회귀 없음.
- Production 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 긴급 수정 요청
- 우선순위: P1 / HIGH
- 대상:
  - Mission response persistence
  - Free Chat response generation
  - client duplicate-submit guard
  - server response idempotency
- 최근 14일 Production 실제 TRUE_DUPLICATE:
  - 총 24건
  - 영향 아동 8명
  - 영향 세션 17개
  - Mission 5건 / 144 active sessions = 3.47%
  - Free Chat 19건 / 65 active sessions = 29.23%
- 선행 조사:
  - 기존 88 candidate 중 63건은 정상 multi-message로 재분류
  - TRUE_DUPLICATE 24건만 실제 버그로 확정
- Production 변경: 금지
- 구현/QA 환경: Development
- 최종 상태: `WAITING_FOR_OWNER_QA`

## 2. 목표

최근 Production 14-day audit에서 동일 child turn에 대해 K response가 중복 생성 또는 중복 저장되는 실제 결함이 확인됐다.

### Mission 확정 흐름

```text
Child turn
↓
/api/mission/turn
↓
finalizeServerTurn
↓
서버가 K response 저장
↓
client askQuestion()
↓
sttTts.sayText()
↓
/api/chat/messages
↓
같은 질문 또는 질문 일부를 다시 저장
```

대표 사례:
- 같은 child turn 이후 K #1과 K #2가 약 139ms 간격으로 저장
- response-generation LLM은 1회
- K DB row는 2건

### Free Chat 확정 흐름

```text
Single child turn
↓
handleTurnComplete / respondText 중복 진입
↓
/api/voice/respond 병렬 2회
↓
Gemini response-generation 2회
↓
K message 2건 저장
```

대표 사례:
- 동일 child turn에서 33ms, 38ms, 345ms 등 짧은 간격으로 2개의 K response 저장
- 일부는 Gemini 2회
- 일부는 deterministic unclear_audio 2회

이번 요청의 핵심 invariant:

```text
ONE CHILD TURN
→ AT MOST ONE CANONICAL K RESPONSE
```

단, 이 invariant는 “K 메시지를 항상 한 개만 허용한다”는 뜻이 아니다.

서로 다른 purpose/source를 가진 설계상 정상 multi-message는 유지한다.

예:

```text
Mission Opening
+
First Question

Mission Response
+
Completion

Completion
+
Reward
```

따라서 canonical idempotency scope는 단순:

```text
session_id + text
```

가 아니라 최소한:

```text
session_id
+ source child turn id
+ response purpose/source
```

개념을 가져야 한다.

## 3. 요구사항

### 3-1. Canonical Child Turn ID를 response lifecycle 끝까지 유지
Mission과 Free Chat 각각 child turn의 canonical identifier를 확인한다.

Mission:
- `childTurnId`
- `clientTurnId`
- 현재 canonical source

Free Chat:
- 기존 `Turn.id`
- `/api/chat/messages`에 전달되는 `turnId`
- voice/respond history에서 현재 누락되는 경우 포함

원칙:
- 같은 논리적 child utterance는 response-generation과 persistence 전 과정에서 동일 canonical turn ID로 추적 가능해야 한다.
- 텍스트 hash를 canonical ID 대용으로 사용하지 않는다.

### 3-2. Response Purpose / Source 구분
정상 multi-message를 보존하기 위해 assistant message 또는 response lifecycle에서 최소한의 logical purpose/source를 구분한다.

예시 개념:
- `TURN_RESPONSE`
- `MISSION_OPENING`
- `MISSION_COMPLETION`
- `REWARD`
- `SAFETY`
- `SESSION_LIMIT`
- 기타 기존 message source

실제 enum/type은 현재 구조를 확인 후 최소 변경한다.

새 거대한 메시지 타입 시스템을 만드는 것은 금지한다.

### 3-3. Server-side Idempotency가 최종 Source of Truth
클라이언트 guard만으로 해결하지 않는다.

최종 무결성은 서버가 보장해야 한다.

동일:
- session
- child turn
- response purpose

에 대해 이미 canonical response가 존재하거나 processing 중이면:
- duplicate LLM generation 차단
- duplicate deterministic generation 차단
- duplicate assistant persistence 차단

동시 요청 race에서도 원자적으로 동작해야 한다.

### 3-4. Free Chat respondText In-flight Guard
`hooks/useVoiceChat.ts`의 `respondText()` 또는 현재 동등 함수에서 동일 child turn에 대한 중복 비동기 진입을 방지한다.

주의:
- 단순 global `responding=true` 때문에 다음 정상 child turn까지 막아서는 안 된다.
- canonical turn 기준 guard를 우선한다.
- 서로 다른 turn은 필요 시 순차 또는 기존 정책대로 처리 가능해야 한다.
- 빠른 입력 문제를 아이 탓으로 처리하지 않는다.

### 3-5. Free Chat /api/voice/respond Idempotency
현재 `/api/voice/respond`가 `sessionId + history`만으로 호출되고 current turn identity가 부족하다면 canonical current turn ID를 전달하도록 보강한다.

동일 current turn에 대한 duplicate request에서:
- 두 번째 Gemini generation 금지
- 이미 완료된 canonical response가 있다면 현재 architecture에 맞는 safe response 재사용 가능
- processing 중이면 중복 실행하지 않음

구체적 locking/storage 방식은 현재 DB/route architecture를 확인 후 선택한다.

### 3-6. deterministic response도 동일 guard 적용
다음처럼 Gemini를 호출하지 않는 경로도 동일 child turn idempotency 대상이다.

예:
- `unclear_audio`
- 기타 canned Free Chat reaction
- deterministic safety/reaction response 중 TURN_RESPONSE 성격인 것

단, Safety event 자체의 별도 정책과 충돌하지 않도록 기존 Safety source/purpose를 구분한다.

### 3-7. Mission persistence ownership 단일화
Mission에서 동일 canonical response를:
- 서버 `finalizeServerTurn`
- client `sttTts.sayText`
가 둘 다 저장하는 구조를 제거한다.

원칙:

```text
ONE CANONICAL RESPONSE
→ ONE PERSISTENCE OWNER
```

TTS는 재생 책임과 DB persistence 책임을 분리한다.

이미 서버에서 저장된 K response를 단순히 말하기 위해 `sayText()`를 호출할 때:
- `/api/chat/messages`에 assistant message를 다시 쓰면 안 된다.

### 3-8. TTS와 Persistence 분리
현재 `sttTts.sayText()`가 “말하기 + 스크롤백 DB 저장”을 동시에 담당한다면:
- 이미 persisted된 response를 발화하는 경로
- 새 assistant message를 생성/저장하고 발화하는 경로
를 구분해야 한다.

실제 API/함수명은 기존 구조를 확인하여 최소 수정한다.

### 3-9. Mission 정상 message sequence 보존
다음은 duplicate가 아니다.

- opening + question
- response + completion
- completion + reward
- Safety + required follow-up
- 서로 다른 source/purpose의 의도된 system message

idempotency guard가 이들을 제거하지 않도록 해야 한다.

### 3-10. 동일 텍스트 다른 Turn 허용
예:

```text
Turn A: 아이 “응”
Turn B: 아이 “응”
```

텍스트가 같아도 turn ID가 다르면 둘 다 독립 처리한다.

금지:
- assistant content equality dedupe
- child text equality dedupe
- 최근 N초 안 같은 문자열이면 drop

### 3-11. Processing 중 race 처리
동일 canonical key로 거의 동시에 두 요청이 들어오는 경우:

```text
Request #1
Request #2
```

둘 다:
“기존 row가 아직 없으니 생성”
하면 race가 그대로 남는다.

따라서 processing/creation 단계에서 원자적 guard가 필요하다.

구현 방식은 현재 architecture에 맞춰 선택하되:
- DB unique constraint
- transaction/advisory lock
- idempotency table
- atomic claim
등 중 기존 인프라에 가장 적합한 최소 방식을 사용한다.

추측 API를 만들지 않는다.

### 3-12. 완료된 Response 재호출
네트워크 retry로 동일 요청이 다시 오더라도:
- Gemini 재호출 금지
- 새 assistant row 생성 금지

가능하면 기존 canonical result를 반환하거나 현재 route contract에 맞는 idempotent success를 반환한다.

### 3-13. 실패 후 Retry 의미 구분
첫 번째 요청이 실제로 response 생성 전에 실패한 경우까지 무조건 차단해서는 안 된다.

구분 필요:
- PROCESSING
- COMPLETED
- FAILED/RETRYABLE

실제 상태 표현은 현재 architecture를 따른다.

완료된 turn만 절대 재생성 금지.

### 3-14. Usage Event 중복 방지
동일 child turn duplicate request가 차단되면:
- response-generation LLM usage event도 중복 생성되지 않아야 한다.
- embedding/goal assessor 등 별도 lifecycle event를 response-generation duplicate로 오인하지 않는다.

### 3-15. Child message persistence는 별도 검증
이번 Production audit에서는 주요 현상이 assistant duplicate지만, 구현 중 다음도 회귀 확인한다.

- child turn이 1건인데 assistant만 2건이었던 기존 문제 해결
- child row 자체를 잘못 drop하지 않음
- `/api/chat/messages` child persistence 기존 흐름 유지

### 3-16. Current-turn duplication fix 유지
기존 수정된:

```text
system memory = 0
recentHistory = 0
explicit current = 1
```

원칙과 충돌하지 않는다.

이번 요청은 prompt context duplication이 아니라 response lifecycle duplication을 해결하는 요청이다.

### 3-17. Mission / Free Chat 원인 분리 유지
Mission과 Free Chat의 Root Cause는 서로 다르다.

Mission:
- persistence ownership 이원화

Free Chat:
- client duplicate entry + server idempotency 부재

공용 멱등성 개념은 활용할 수 있으나, 억지로 하나의 거대한 shared response pipeline으로 합치지 않는다.

### 3-18. Observability
Dev QA에서 최소한 다음 correlation이 가능해야 한다.

- sessionId
- childTurnId
- responsePurpose/source
- idempotency decision
  - CLAIMED
  - ALREADY_PROCESSING
  - REUSED_COMPLETED
  - NORMAL
- response-generation call count

raw child conversation을 신규 telemetry에 복제하지 않는다.

## 4. 기존 구조 확인

구현 전에 현재 HEAD를 확인한다.

### Production 조사에서 확정된 수치
최근 14일 candidate:
- 88건

재분류:
- TRUE_DUPLICATE 24
- LEGIT_MULTI_MESSAGE 63
- AMBIGUOUS 1

실제 영향:
- children 8
- sessions 17

Mission:
- 5 duplicate incidents
- 5 sessions
- active session 대비 3.47%

Free Chat:
- 19 duplicate incidents
- 12 sessions
- active session 대비 29.23%

### Mission 확인 파일/함수
- `app/child/missions/page.tsx`
- `finalizeServerTurn`
- `askQuestion`
- `askQuestionRef`
- `sttTts.sayText`
- `/api/mission/turn`
- `/api/mission/respond`가 현재 사용되는 경우
- `/api/chat/messages`
- assistant `saveMessage`
- Mission completion/reward message path

확정 조사 흐름:

```text
/api/mission/turn
→ server persists K #1

client askQuestion()
→ sttTts.sayText()
→ /api/chat/messages
→ K #2 persists
```

### Free Chat 확인 파일/함수
- `hooks/useVoiceChat.ts`
- `respondText`
- `respondingRef`
- `handleTurnComplete`
- `/api/voice/respond`
- `/api/chat/messages`
- `app/chat/page.tsx`
- STT final callback
- text submit
- retry/reconnect callback

확정 조사 흐름:

```text
same child turn
→ respondText #1
→ respondText #2
→ /api/voice/respond x2
→ response generation x2
→ K rows x2
```

### 기존 대표 Production 패턴
Mission:
- `PREFIX_SUFFIX_DUPLICATE`
- response LLM 1 + K rows 2

Free Chat:
- `DIFFERENT_RESPONSE`
- `EXACT_DUPLICATE`
- `NEAR_DUPLICATE`
- Gemini 2회 또는 deterministic response 2회

### Source of Truth 확인
현재 DB/schema에서:
- assistant row가 source child turn을 직접 참조하는 필드가 있는지
- turn_id 의미
- canonical response key
- unique constraint
- active transaction semantics
를 먼저 확인한다.

필요한 migration이 발생한다면 Development migration으로만 작성하고 Production에는 적용하지 않는다.

## 5. 금지사항
- Production deploy 금지
- Production migration 금지
- Production env 변경 금지
- Production 데이터 수정 금지
- 기존 duplicate Production row delete/update 금지
- 클라이언트 debounce 하나만 넣고 완료 처리 금지
- global `isResponding`으로 모든 다음 정상 turn을 막는 방식 금지
- 문자열 equality 기반 dedupe 금지
- 같은 텍스트의 서로 다른 child turn drop 금지
- Mission opening/completion/reward를 duplicate로 제거 금지
- TTS 재생 자체를 제거하여 문제를 숨기는 방식 금지
- 응답 persistence를 client와 server 양쪽에 계속 둔 채 timestamp 조건으로 회피 금지
- fixed delay / arbitrary timeout으로 race를 숨기는 방식 금지
- 현재 current-turn context fix 롤백 금지
- Mission과 Free Chat을 무리하게 단일 거대 response pipeline으로 refactor 금지
- 실제 가족 계정 자동화 테스트 금지
- raw conversation 신규 로그 저장 금지
- Owner QA 전 Production 변경 금지

## 6. 모호성 처리
- Mission의 실제 canonical persistence owner가 조사 문서와 현재 HEAD에서 다르면 현재 HEAD를 Source of Truth로 사용한다.
- assistant message에 response purpose/source 컬럼이 이미 있으면 재사용한다.
- 별도 컬럼 없이 기존 metadata JSON으로 안정적으로 표현 가능하면 불필요한 schema 확장을 피한다.
- server idempotency를 구현할 기존 primitive가 있으면 재사용한다.
- 동일 turn에서 정상 multi-message를 구분할 canonical source가 이미 있으면 새 enum을 중복 생성하지 않는다.
- Free Chat에서 currentTurnId가 route contract까지 아직 전달되지 않는다면 기존 `Turn.id`를 canonical source로 연결하는 최소 변경을 우선한다.
- LLM usage event가 request correlation을 완전히 지원하지 않는다면 Dev용 최소 correlation을 추가하되 PII를 저장하지 않는다.
- 기존 baseline test failure는 이번 변경 회귀와 분리 보고한다.
- DB migration이 필요하면 Dev용 migration 파일 작성까지만 하고 Production 적용은 하지 않는다.

## 7. QA

### 7-1. Free Chat duplicate respondText
동일 `currentTurnId`로 `respondText()`를 거의 동시에 2회 호출.

기대:
- client duplicate entry guard
- response endpoint canonical processing 1회
- response-generation 1회
- assistant row 1개

### 7-2. Free Chat duplicate API direct
client guard를 우회하여 `/api/voice/respond` 동일 turn request 2회 병렬 호출.

기대:
- server-side idempotency가 차단
- LLM 1회
- assistant persistence 1회

### 7-3. Free Chat deterministic duplicate
동일 turn `unclear_audio` 요청 2회.

기대:
- deterministic assistant response 1개
- Gemini 0
- duplicate persistence 0

### 7-4. Free Chat distinct rapid turns
서로 다른 turn id로 매우 빠르게 2개 child turn 발생.

기대:
- 둘 다 정상 처리
- 이전 turn의 guard가 다음 turn을 drop하지 않음

### 7-5. 동일 텍스트 다른 turn
“응” / “응”을 서로 다른 turn ID로 처리.

기대:
- 둘 다 독립 response 가능
- text equality dedupe 없음

### 7-6. Mission server response + TTS
`/api/mission/turn`이 K response 저장 후 TTS 실행.

기대:
- canonical assistant row 1개
- TTS 정상 재생
- `/api/chat/messages` assistant duplicate 없음

### 7-7. Mission PREFIX_SUFFIX 기존 재현
기존 대표 구조:
- server full reaction+question
- client question-only sayText

기대:
- 질문-only duplicate row 생성 0
- 화면 canonical message 1개 또는 기존 설계상 올바른 표시
- TTS 정상

### 7-8. Mission opening
Opening + first question이 설계상 두 메시지이면 둘 다 유지.

기대:
- 정상 multi-message 2개
- duplicate guard 오탐 없음

### 7-9. Mission completion
Turn response + completion + reward.

기대:
- 각 purpose당 필요한 canonical message 유지
- 동일 purpose 중복 없음

### 7-10. Retry after completed
동일 canonical request를 완료 뒤 다시 호출.

기대:
- Gemini 재호출 없음
- duplicate DB insert 없음
- idempotent success/reuse

### 7-11. Concurrent race
동일 idempotency key로 서버에 실제 병렬 요청.

기대:
- atomic claim 1개만 성공
- duplicate processing 없음

### 7-12. Failed first attempt
첫 요청을 response 생성 전 retryable failure로 fixture 처리 후 재시도.

기대:
- retry 가능
- 영구적으로 locked 상태가 되지 않음
- 최종 canonical response 1개

### 7-13. Current-turn context regression
Mission / Free Chat response prompt에서:
- current in system memory 0
- recentHistory 0
- explicit 1

기존 contract 유지.

### 7-14. Usage events
동일 turn duplicate request:
- response LLM usage 1회
- goal assessor/embedding 등 별도 event 정상

### 7-15. Session continuity
duplicate guard 후에도:
- chat_session_id 유지
- 다음 child turn 정상
- TTS 정상
- UI loading state 정상
- barge-in/STT 기존 동작 회귀 없음

### 7-16. Regression
Mission:
- opening
- goal flow
- next question
- completion
- reward
- Safety

Free Chat:
- text
- voice
- short utterance
- deterministic reaction
- Memory
- Play Skill
- Safety
- TTS

Quality:
- unit tests
- integration tests
- typecheck
- lint
- build

## 8. 완료조건
- 동일 canonical child turn + response purpose에 대해 response-generation 최대 1회.
- 동일 canonical child turn + response purpose에 대해 assistant persistence 최대 1건.
- Free Chat `respondText()` 동일 turn 중복 진입 방어 완료.
- client guard를 우회해도 `/api/voice/respond` server idempotency가 중복 generation을 차단.
- deterministic response도 동일 turn 중복 저장 없음.
- Mission canonical K response persistence owner가 하나로 통일됨.
- Mission TTS 재생 경로가 이미 저장된 assistant message를 다시 저장하지 않음.
- Mission PREFIX_SUFFIX duplicate 재현 테스트 통과.
- Mission opening/completion/reward 정상 multi-message 유지.
- retry 후 Gemini 재호출 없음.
- 병렬 동일 request race에서 atomic idempotency 보장.
- retryable failure 후 정상 재시도 가능.
- 동일 텍스트의 다른 turn은 정상 처리.
- current-turn context duplication fix 유지.
- existing Safety/Play/Memory/Mission Goal 회귀 없음.
- 최근 Production 24건 패턴을 커버하는 regression tests 추가.
- typecheck/lint/build 결과 보고.
- Development 배포 및 QA 완료.
- Owner QA 전 Production 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 9. 완료보고

### Root Cause
Mission:
- 최초 divergence:
- 기존 duplicate persistence 구조:

Free Chat:
- 최초 divergence:
- 기존 duplicate generation 구조:

### 변경 파일
-

### Canonical Turn / Response Identity
- Mission child turn source:
- Free Chat child turn source:
- response purpose/source:
- final idempotency key:

### Mission
- canonical persistence owner:
- TTS/persistence 분리 방식:
- PREFIX_SUFFIX duplicate 차단 방식:
- opening/completion/reward 보존 방식:

### Free Chat
- respondText turn guard:
- `/api/voice/respond` server idempotency:
- duplicate request behavior:
- deterministic response guard:

### Atomicity
- processing claim 방식:
- completed response handling:
- retryable failure handling:
- DB/schema 변경:
- Development migration:

### QA
- Free Chat duplicate respondText:
- Free Chat duplicate direct API:
- unclear_audio duplicate:
- distinct rapid turns:
- same text different turns:
- Mission server + TTS:
- Mission prefix/suffix:
- Mission opening:
- Mission completion/reward:
- completed retry:
- concurrent race:
- failed/retry:
- current-turn context regression:
- usage events:

### Regression
- Mission:
- Free Chat:
- Safety:
- Memory:
- Play Skill:
- TTS/STT:

### Build
- unit:
- integration:
- typecheck:
- lint:
- build:

### 배포
- Development URL:
- Production changed: NO
- Production migration applied: NO
- 최종 상태: `WAITING_FOR_OWNER_QA`
- commit:
