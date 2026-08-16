# Current Turn Duplication — turn_id 기반 근본 수정

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 자유대화와 미션 모두에서 아이가 한 번 말하면 Gemini response generation 최종 입력에도 현재 아이 발화가 정확히 1번만 들어간다.
- 자유대화에서 `chat_messages`에 현재 child turn이 먼저 저장되더라도 Same-session Memory가 같은 현재 발화를 다시 가져오지 않는다.
- 자유대화의 네트워크/DB 처리 순서에 따라 현재 발화가 1회 또는 최대 3회로 달라지는 Race Condition이 제거된다.
- 미션에서 `start_mission_turn_v3`가 current child turn을 먼저 `finalized`로 저장한 뒤 response를 생성하더라도 Same-session Memory가 현재 발화를 다시 포함하지 않는다.
- 미션에서 현재 발화가 systemInstruction + explicit currentUtterance로 항상 2회 들어가던 구조가 제거된다.
- systemInstruction의 `[Same-session]`에는 현재 child turn이 포함되지 않는다.
- `recentHistory`에도 현재 child turn이 포함되지 않는다.
- `explicit currentUtterance`만 정확히 1회 유지된다.
- 아이가 실제로 같은 말을 반복한 과거 대화는 정상적으로 보존된다.
- 문자열 비교가 아니라 canonical `turn_id` 기준으로 현재 turn만 제외한다.
- 기존 4-tier Memory, Grade Persona, Boredom, Action Selector, Safety, Memory Recall 동작에 회귀가 없다.
- Mission Goal Layer의 Goal 판정용 `assessGoalsFromUtterance()`는 별도 LLM stage로 유지되며 임의 변경하지 않는다.
- Browser STT / GCP STT provider별 우회 로직을 만들지 않는다.
- Owner QA 전까지 Production 코드·DB·env에는 아무 변경도 하지 않는다.

### 대표님 테스트 정상 프로세스

#### 자유대화
1. Development 자유대화에 QA 계정으로 접속한다.
2. 음성으로 일반 문장을 한 번 말한다.
3. K가 해당 말을 두 번 또는 세 번 들은 것처럼 되묻거나 반복 해석하지 않고 한 번의 발화로 자연스럽게 답하는지 확인한다.
4. 이어서 짧은 답변을 여러 번 테스트한다.
   - `응`
   - `몰라`
   - `진짜`
5. 같은 말을 실제로 연속 두 번 말한다.
   - 예: `응` → K 응답 → 다시 `응`
6. 과거 첫 번째 `응`은 대화 History에 남고 현재 `응`만 current turn으로 처리되는지 확인한다.
7. 자유대화를 여러 턴 이어가며 이전 대화 Memory가 정상 유지되는지 확인한다.
8. 음성 입력을 여러 번 반복해도 K가 현재 발화를 중복 해석하지 않는지 확인한다.
9. 키보드 자유대화에서도 기존 대화 흐름에 회귀가 없는지 확인한다.

#### 미션
10. Development 미션에 QA 계정으로 접속한다.
11. 미션 질문에 일반 답변을 한 번 한다.
12. K가 현재 답변을 두 번 받은 것처럼 반응하지 않는지 확인한다.
13. 같은 의미의 짧은 답변을 반복해도 과거 발화는 보존되고 현재 turn만 중복 제거되는지 확인한다.
14. Mission Goal 달성/부분달성/거절 판정이 기존대로 정상인지 확인한다.
15. 미션 완료/진행도/다음 질문 흐름에 회귀가 없는지 확인한다.

PASS 기준:
- 자유대화 Gemini response generation 최종 입력에서 현재 child utterance가 의미적으로 정확히 1회만 존재한다.
- 미션 Gemini response generation 최종 입력에서도 현재 child utterance가 의미적으로 정확히 1회만 존재한다.
- 자유대화 DB current turn이 먼저 저장된 경우와 아직 저장되지 않은 경우 모두 최종 prompt 구조가 동일하다.
- 미션은 current child turn이 DB에 이미 저장된 상태에서도 systemInstruction `[Same-session]`에 current turn이 없다.
- `recentHistory`에 current turn이 없다.
- `explicit currentUtterance`는 1회 존재한다.
- 동일 문자열의 과거 정상 발화는 삭제되지 않는다.
- Same-session History 개수가 불필요하게 줄지 않는다.
- Mission Goal Layer의 별도 Goal 판정 LLM은 정상 유지된다.
- 기존 Memory/Boredom/Action/Safety 흐름에 회귀가 없다.
- Production 변경 없이 Development 검증 상태로 종료한다.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 수정 요청
- 우선순위: CRITICAL
- 대상 프로젝트: `/mnt/e/VibeCoding/K-Bestie-v3`
- 개발 주체: K-Bestie-v3 메인 앱 Claude Code
- 적용 대상: Shared K Conversation Engine / Same-session Memory / Free Chat `/api/voice/respond` / Mission v3 Adapter 및 turn route
- Free Chat 적용 경로: `useVoiceChat` → `app/chat/page.tsx` → `/api/voice/respond` → K Conversation Engine
- Mission 적용 경로: `/api/mission/v3/turn` → `start_mission_turn_v3` → Mission Adapter → K Conversation Engine
- 제외: Gemini 모델 교체, STT provider 정책 변경, Mission Goal Layer 로직 변경, Production 배포
- 배포 원칙: Development 구현 및 QA 우선
- 최종 상태: `WAITING_FOR_OWNER_QA`

## 2. 목표

자유대화와 미션에서 공통으로 발생하는 “현재 child turn의 Same-session Memory 재유입” 문제를 Shared K Conversation Engine 수준에서 canonical `turn_id`로 제거한다.

### 자유대화 현재 문제

```text
아이 현재 발화
  → /api/chat/messages 저장 요청
  → /api/voice/respond 동시 요청
      → Same-session DB 조회

DB 저장이 먼저 끝난 경우:

sameSession
  → CURRENT_UTTERANCE 포함

Gemini response generation 최종 입력
  → systemInstruction [Same-session]  CURRENT_UTTERANCE 1회
  → recentHistory                     CURRENT_UTTERANCE 1회
  → explicit currentUtterance         CURRENT_UTTERANCE 1회

TOTAL = 최대 3회
```

자유대화는 `/api/chat/messages`와 `/api/voice/respond`가 병렬로 진행되므로 DB hit/miss에 따라 중복 여부가 달라지는 Race Condition이다.

### 미션 현재 문제

```text
아이 현재 발화
  → start_mission_turn_v3 RPC
  → chat_messages에 turn_status='finalized'로 먼저 저장
  → RPC 완료 후 respondToMissionTurn()
  → Same-session DB 조회
  → CURRENT_UTTERANCE 항상 포함

currentUtteranceAlreadyInSession=true
  → recentHistory에서는 current 제거
  → memoryFragment에는 current 남음

Gemini response generation 최종 입력
  → systemInstruction [Same-session]  CURRENT_UTTERANCE 1회
  → recentHistory                     CURRENT_UTTERANCE 0회
  → explicit currentUtterance         CURRENT_UTTERANCE 1회

TOTAL = 항상 2회
```

미션은 Race가 아니라 current turn 저장 → response 생성 순서가 보장되므로 current turn이 Same-session에 항상 들어오는 구조적 중복이다.

### 최종 목표

```text
FREE_CHAT / MISSION 공통

아이 현재 발화
  → canonical currentTurnId 확보
  → Same-session 조회/가공 단계에서 currentTurnId row 제외
  → memoryFragment = 이전 대화만
  → recentHistory = 이전 대화만
  → explicit currentUtterance = 현재 발화 1회

Gemini response generation 최종 입력
  → CURRENT_UTTERANCE 정확히 1회
```

자유대화는 DB Race ordering과 무관하게, 미션은 선저장 구조와 무관하게 항상 동일한 prompt 구조가 되어야 한다.

## 3. 요구사항

### 3-1. 공통 canonical currentTurnId 사용
현재 child turn을 식별할 때 문자열 비교를 사용하지 않는다.

Free Chat과 Mission 모두 기존에 이미 존재하는 canonical ID를 사용한다.

Free Chat:
- `Turn.id`
- `/api/chat/messages`의 `turnId`
- DB `chat_messages.turn_id`

Mission:
- request의 `clientTurnId`
- `start_mission_turn_v3`가 저장하는 `chat_messages.turn_id`
- `fetchRecentMissionHistory()`가 이미 current turn 제외에 사용하는 `currentTurnId`

새 UUID를 별도로 만들지 않는다.

예:

```text
turn_id=A / 아이: 응
turn_id=B / 아이: 응  ← 현재 turn
```

`currentTurnId=B`라면:
- A는 보존
- B만 Same-session에서 제외

### 3-2. Free Chat `/api/voice/respond`에서 currentTurnId 전달
`app/api/voice/respond/route.ts`의 history parsing에서 현재 Turn.id가 Engine까지 전달될 수 있도록 한다.

확인된 현재 상태:
- client `transcriptRef.current`에는 Turn.id가 존재
- `/api/chat/messages`에도 같은 Turn.id가 turnId로 전달
- `voice/respond/route.ts`의 `HistoryTurn` 타입은 현재 `{ role, text }`만 정의
- 따라서 Engine까지 ID 전달 계약이 끊겨 있음

요구:
- `HistoryTurn`에 optional `id?: string`
- validation 시 id 보존
- 마지막 child turn의 `id`를 `currentTurnId`로 추출
- `respondWithEngine()` 입력으로 전달

### 3-3. Mission에서 기존 clientTurnId를 Engine까지 전달
Mission은 canonical currentTurnId가 이미 존재한다.

확인된 현재 상태:
- `/api/mission/v3/turn` body에 `clientTurnId`가 존재
- `start_mission_turn_v3`는 `chat_messages.turn_id = clientTurnId`로 저장
- `fetchRecentMissionHistory()`는 이미 `currentTurnId: clientTurnId`를 받아 Goal 판정 history에서 current turn을 제외
- 하지만 `respondToMissionTurn()` → shared K Conversation Engine에는 `currentTurnId`가 전달되지 않음

요구:
- Mission response generation 경로에서도 동일 `clientTurnId`를 canonical `currentTurnId`로 Shared Engine에 전달
- `child_message_id` UUID와 `clientTurnId`를 혼동하지 말 것
- `sourceTurnId`의 기존 의미가 별도라면 임의 변경하지 말 것

### 3-4. EngineInput에 currentTurnId 추가
`lib/k-conversation/types.ts`의 `EngineInput`에 다음 optional field를 추가한다.

```typescript
currentTurnId?: string;
```

기존 `currentUtteranceAlreadyInSession` 필드는 다른 경로와 compatibility가 있으므로 임의 삭제하지 않는다.

### 3-5. Relationship Memory까지 currentTurnId 전달
`lib/k-conversation/memory/index.ts`를 통해 `currentTurnId`가 Same-session 조회까지 전달되도록 한다.

최종적으로:

```text
respond()
→ loadRelationshipMemory()
→ fetchSameSessionTurns(..., currentTurnId)
```

경로가 Free Chat과 Mission 모두에서 성립해야 한다.

### 3-6. Same-session Source에서 current turn 제외
`lib/k-conversation/memory/sameSession.ts`에서 현재 turn을 Same-session Source 자체에서 제외한다.

조건:

```text
row.turn_id !== currentTurnId
```

중요:
- 문자열 equality로 제거 금지
- currentTurnId가 없는 경우 임의로 마지막 child turn 삭제 금지
- child_id + session_id scope 유지
- finalized turn 조회 정책 유지

### 3-7. Same-session LIMIT 보존
현재 Same-session 최대 조회 개수가 N일 경우 current turn 제거 후에도 가능한 경우 이전 finalized turns N개가 유지되어야 한다.

금지 예:

```text
LIMIT 6
→ current row 제거
→ 과거 5개만 남음
```

허용 가능한 방식:
- DB query에서 currentTurnId 제외 후 LIMIT N
- 또는 N+1 조회 → currentTurnId filter → slice(N)

실제 구현 방식은 기존 Supabase query 구조를 확인한 후 가장 작은 수정으로 선택한다.

### 3-8. memoryFragment에서 current turn 제거
현재 `memoryFragment = formatRelationshipMemory(memorySnapshot)`은 `filterRecentHistory()`보다 먼저 생성된다.

따라서 `currentUtteranceAlreadyInSession=true`만 적용해서는 systemInstruction 중복이 제거되지 않는다.

수정 후:

```text
memorySnapshot.sameSession = previous turns only
```

이어야 하며:

```text
[Same-session] 이번 세션 최근 대화:
```

안에 current child turn이 들어가면 안 된다.

Free Chat과 Mission 모두 동일하게 적용한다.

### 3-9. recentHistory에서 current turn 제거
Same-session Source에서 이미 current turn이 제거된 상태이므로 `recentHistory`에도 current child turn이 없어야 한다.

최종 contents:

```text
previous history...
+
explicit currentUtterance 1회
```

만 유지한다.

### 3-10. explicit currentUtterance 1회 유지
`responseGenerator`의 마지막 user message로 currentUtterance를 전달하는 현재 기본 구조는 유지한다.

현재 발화를 아예 제거하면 안 된다.

최종 occurrence:

```text
system memory = 0
recentHistory = 0
explicit current = 1
TOTAL = 1
```

### 3-11. `currentUtteranceAlreadyInSession=true` 단독 수정 금지

Free Chat DB hit:

```text
현재:
system 1 + history 1 + explicit 1 = 3

flag=true만 적용:
system 1 + history 0 + explicit 1 = 2
```

Mission:

```text
현재 이미 flag=true:
system 1 + history 0 + explicit 1 = 2
```

따라서 flag만 추가/유지하는 것으로 완료 처리하지 않는다.

### 3-12. Boredom 회귀 방지
Boredom은 기존 Same-session child utterances와 currentUtterance를 함께 사용한다.

수정 후에도:

```text
previous child utterances
+
currentUtterance 정확히 1회
```

가 평가되어야 한다.

확인:
- current utterance 0회 금지
- current utterance 2회 금지
- 기존 boredom threshold/결정 로직 임의 변경 금지

### 3-13. Mission Goal Layer 별도 LLM 유지
Mission은 `assessGoalsFromUtterance()`를 통해 Goal 만족 여부를 별도 LLM stage에서 판정한다.

이 호출에서 currentUtterance가 한 번 사용되는 것은 정상이다.

구분:
- Goal assessment LLM: 별도 목적의 정상 호출
- Response generation LLM: 이번 중복 제거 대상

금지:
- Goal assessment 호출을 response generation 중복으로 오인하여 제거
- Mission Goal satisfaction / completion / priority 로직 변경
- parent_question / Goal Layer prompt 계약 임의 변경

### 3-14. Mission 전용 history와 shared Same-session history 혼동 금지
Mission에는 두 history source가 존재한다.

1. `fetchRecentMissionHistory()`
   - Goal assessment용
   - 이미 `currentTurnId`로 current turn 제외

2. `fetchSameSessionTurns()`
   - Shared K Conversation Engine Memory/Response용
   - 현재 current turn 제외가 없음

이번 수정 대상은 2번 Shared Same-session Source다.

1번 Mission Goal history의 정상 currentTurnId 제외 로직은 유지한다.

### 3-15. STT provider별 우회 금지
Browser STT와 GCP STT의 차이는 Root Cause가 아니다.

실제 Free Chat Race 요인은:
- `/api/chat/messages` 처리시간
- DB commit timing
- `/api/voice/respond` 처리시간
- Same-session select timing
- network/server load

Mission은 save/respond 순차 구조이므로 STT provider와 무관하게 current turn이 DB에 선저장된다.

따라서 Browser/GCP 별도 workaround를 만들지 않는다.

## 4. 기존 구조 확인

작업 전 반드시 다음을 재확인한다.

### Free Chat
- `useVoiceChat.ts`의 Turn.id 생성 방식
- `appendTurn()`에서 child Turn.id가 언제 생성되는지
- `app/chat/page.tsx`의 `handleTurnComplete()`
- `/api/chat/messages`에 전달하는 turnId가 Turn.id와 동일한지
- `respondText()`가 `transcriptRef.current`를 그대로 `/api/voice/respond`에 전달하는지
- `voice/respond/route.ts`의 HistoryTurn parsing 방식
- `/api/chat/messages`와 `/api/voice/respond`의 병렬 실행 구조

### Mission
- `/api/mission/v3/turn`의 `clientTurnId`
- `start_mission_turn_v3` RPC의 child message 저장 순서
- `chat_messages.turn_id = clientTurnId` 여부
- `turn_status='finalized'` 저장 여부
- RPC 완료 후 `respondToMissionTurn()` 실행 순서
- `fetchRecentMissionHistory({ currentTurnId: clientTurnId })`의 current turn 제외 방식
- `missionAdapter.ts`의 `currentUtteranceAlreadyInSession:true`
- Mission Adapter가 Shared Engine에 currentTurnId를 현재 전달하지 않는 구조
- `sourceTurnId`와 `clientTurnId`의 역할 차이

### Shared Engine
- `EngineInput` 현재 타입
- `loadRelationshipMemory()` input 계약
- `fetchSameSessionTurns()`의 SELECT 컬럼
- `turn_status='finalized'` 조건
- Same-session LIMIT
- `formatRelationshipMemory(memorySnapshot)` 호출 시점
- `filterRecentHistory()` 호출 시점
- `responseGenerator`의 final contents 구성
- `buildBoredomUtterances()`가 currentUtterance를 처리하는 방식
- Same-day / Recent Episode / Long-term Memory와 Same-session 분리 구조

확정된 조사 결과:
- Free Chat은 `/api/chat/messages`와 `/api/voice/respond`를 병렬로 시작한다.
- Free Chat은 DB current turn이 Same-session 조회 전에 commit되면 현재 발화가 system + history + explicit로 최대 3회 들어간다.
- Free Chat은 DB miss 시 explicit 1회만 들어가므로 race-dependent다.
- Mission은 `start_mission_turn_v3` RPC가 current child turn을 `finalized`로 먼저 저장한 뒤 response를 생성한다.
- Mission은 sameSession DB hit가 구조적으로 항상 발생한다.
- Mission은 `currentUtteranceAlreadyInSession:true`로 recentHistory에서는 current를 제거하지만 memoryFragment에는 남아 response generation prompt에 항상 2회 들어간다.
- `memoryFragment`는 `filterRecentHistory()` 이전에 만들어진다.
- Mission Goal assessment history는 이미 `clientTurnId`로 current turn을 정상 제외한다.
- Browser/GCP provider latency는 Free Chat 두 fetch 간 상대 Race의 직접 원인으로 볼 수 없다.

이 사실과 실제 현재 코드가 다르면 임의 수정하지 말고 변경된 구조를 먼저 보고한다.

## 5. 금지사항

- Production deploy 금지
- Production DB migration 금지
- Production env 변경 금지
- Production 데이터 수정 금지
- 문자열 equality 기반 dedupe 금지
- text hash 기반 dedupe 금지
- 새로운 random UUID를 currentTurnId로 생성 금지
- Free Chat `/api/chat/messages` 저장을 Gemini 응답 이후로 옮기는 방식 금지
- Mission `start_mission_turn_v3` 저장 순서 변경 금지
- arbitrary `sleep`, `delay`, debounce로 Race 숨기기 금지
- Browser STT 전용 workaround 금지
- GCP STT 전용 workaround 금지
- `currentUtteranceAlreadyInSession:true`만 추가하고 완료 처리 금지
- currentTurnId가 없을 때 마지막 child history를 임의 삭제 금지
- 기존 4-tier Memory 구조 변경 금지
- Grade Persona 변경 금지
- Action Selector 정책 변경 금지
- Mission Goal Layer 변경 금지
- `assessGoalsFromUtterance()` 제거/통합 금지
- Mission completion / Goal satisfaction 계약 변경 금지
- 아이 대화 원문을 신규 telemetry/log에 저장 금지
- raw Gemini prompt 신규 저장 금지
- 실제 가족 계정 자동화 테스트 금지
- QA 테스트 계정만 자동화 테스트에 사용

## 6. 모호성 처리

- 현재 코드가 조사 시점 이후 변경되어 Free Chat Turn.id 흐름이 달라졌다면 먼저 현재 canonical ID Source를 보고하고 동일 목표를 만족하는 최소 수정으로 진행한다.
- Mission의 `clientTurnId`, `child_message_id`, `sourceTurnId`가 서로 다른 목적을 갖고 있으면 임의 통합하지 말고 current turn exclusion에는 `chat_messages.turn_id`와 동일한 canonical `clientTurnId`를 사용한다.
- `fetchSameSessionTurns()`에서 DB WHERE 방식으로 currentTurnId 제외가 어렵다면 조회 후 in-memory filter를 사용할 수 있으나 Same-session LIMIT가 감소하지 않도록 보완한다.
- `currentUtteranceAlreadyInSession`이 다른 경로에서 아직 필요하면 제거하지 않는다.
- Same-session row 타입에 `turn_id` 추가가 다른 Memory 코드에 영향을 주면 최소 범위의 타입 확장으로 처리한다.
- 기존 baseline test가 이미 실패 중이면 이번 변경으로 새로 실패한 것과 기존 실패를 분리 보고한다.
- 실제 Prompt 내부 occurrence를 자동 테스트로 직접 검사하기 어려우면 raw prompt logging을 추가하지 말고 test helper 또는 구조적 assertion으로 검증한다.
- Mission Goal assessment LLM과 response generation LLM을 서로 다른 stage로 분리해서 테스트/보고한다.
- Production 환경 차이가 발견되더라도 Owner 승인 없이 Production에 적용하지 않는다.

## 7. QA

### 7-1. Free Chat — DB current turn 선저장
1. QA child/session의 Same-session fixture에 이전 child/K turns를 생성한다.
2. 현재 child turn도 `turn_id=X`로 이미 finalized된 상태를 만든다.
3. `currentTurnId=X`로 Engine을 실행한다.
4. Same-session 결과에 X가 없는지 확인한다.
5. memoryFragment에 current utterance가 없는지 확인한다.
6. recentHistory에 current utterance가 없는지 확인한다.
7. explicit currentUtterance만 1회 존재하는지 확인한다.

PASS:
```text
system 0
history 0
explicit 1
TOTAL 1
```

### 7-2. Free Chat — DB current turn 미저장
1. Same-session DB에 이전 turns만 둔다.
2. 동일 currentUtterance/currentTurnId로 Engine 실행.
3. final prompt 구조를 확인한다.

PASS:
- DB hit case와 final prompt semantics 동일
- current utterance 1회

### 7-3. Free Chat — 동일 발화 반복
1. 과거 child turn A에 `"응"` 저장.
2. K 응답 저장.
3. 현재 child turn B도 `"응"`으로 저장.
4. currentTurnId=B 실행.

PASS:
- A의 `"응"` 보존
- B만 Same-session Source에서 제외
- explicit current `"응"` 1회
- text equality dedupe 없음

### 7-4. Mission — current turn 선저장 구조
1. Mission QA turn을 `clientTurnId=X`로 시작한다.
2. `start_mission_turn_v3`가 `chat_messages.turn_id=X`, `turn_status='finalized'`로 저장하는지 확인한다.
3. 저장 완료 후 Mission response generation을 실행한다.
4. Shared Same-session Memory에서 X가 제외되는지 확인한다.
5. memoryFragment에 current utterance가 없는지 확인한다.
6. recentHistory에 current utterance가 없는지 확인한다.
7. explicit currentUtterance만 1회 존재하는지 확인한다.

PASS:
```text
system 0
history 0
explicit 1
TOTAL 1
```

### 7-5. Mission — Goal assessment 회귀
1. 동일 Mission turn으로 `assessGoalsFromUtterance()` 실행 경로 확인.
2. Goal SATISFIED / PARTIAL / DECLINED 등 기존 판정 흐름 테스트.
3. Mission 전용 `fetchRecentMissionHistory()`가 currentTurnId를 기존대로 제외하는지 확인.

PASS:
- Goal assessment LLM 정상
- current turn history exclusion 정상
- response generation dedupe 수정 때문에 Goal 판정이 깨지지 않음
- Goal Layer/Completion 흐름 회귀 없음

### 7-6. Same-session LIMIT
1. 최대 N개보다 많은 이전 finalized turns 준비.
2. 현재 turn까지 포함한 DB hit 상태 구성.
3. currentTurnId 제외 후 Same-session 조회.

PASS:
- current turn 제외
- 가능한 경우 이전 finalized turns N개 유지
- N-1로 감소하지 않음
- Free Chat/Mission 모두 동일

### 7-7. 다른 child / 다른 session
- 동일한 turn_id 문자열을 다른 child/session에 구성
- current child/session 조회에 영향 없는지 확인

### 7-8. Boredom
- 수정 전/후 동일 정상 History fixture 사용
- current utterance가 Boredom 입력에 정확히 1회 포함되는지 확인
- 기존 판정에 불필요한 회귀 없는지 확인

### 7-9. 4-tier Memory
- Same-session 외 Same-day / Recent Episode / Long-term Memory가 기존대로 로드되는지 확인
- currentTurnId exclusion이 Same-session 외 Memory를 삭제하지 않는지 확인

### 7-10. Free Chat Development 실사용
1. QA 계정으로 자유대화 접속.
2. 일반 음성 발화 5회 이상 테스트.
3. 짧은 답변 테스트.
4. 동일 문장 반복 테스트.
5. 키보드 입력도 테스트.

확인:
- K가 현재 발화를 두 번/세 번 말한 것으로 오해하지 않음
- 이전 대화 기억 정상
- 답변 누락 없음
- 응답 생성 정상

### 7-11. Mission Development 실사용
1. QA 계정으로 Mission 접속.
2. 일반 답변 5턴 이상 진행.
3. 짧은 답변/반복 답변 테스트.
4. Goal 진행 상태 확인.
5. Mission 완료까지 가능한 경우 진행.

확인:
- K가 현재 답변을 두 번 받은 것처럼 반응하지 않음
- Goal 판정 정상
- 다음 질문/완료 흐름 정상
- Memory/Persona 정상

### 7-12. 회귀 테스트
다음 실행:
- k-conversation
- Same-session Memory
- 4-tier Memory
- Free Chat voice/respond route
- Mission v3 turn route
- Mission Adapter
- Mission Goal assessor
- responseGenerator
- Grade Persona
- Boredom
- Action Selector
- Memory Recall
- Safety
- TypeScript typecheck
- lint
- build

## 8. 완료조건

- Shared K Conversation Engine에 canonical currentTurnId 계약이 추가된다.
- Free Chat은 기존 Turn.id를 currentTurnId로 사용한다.
- `/api/chat/messages` turn_id와 `/api/voice/respond` currentTurnId가 동일하다.
- Mission은 기존 `clientTurnId`를 currentTurnId로 사용한다.
- Mission `chat_messages.turn_id`와 Engine currentTurnId가 동일하다.
- current turn이 Same-session Source에서 turn_id 기준으로 제외된다.
- Free Chat systemInstruction `[Same-session]`에 current turn이 포함되지 않는다.
- Mission systemInstruction `[Same-session]`에도 current turn이 포함되지 않는다.
- Free Chat recentHistory에 current turn이 포함되지 않는다.
- Mission recentHistory에 current turn이 포함되지 않는다.
- explicit currentUtterance가 Free Chat/Mission 모두 정확히 1회 유지된다.
- Free Chat DB hit / DB miss Race ordering과 관계없이 최종 prompt 구조가 동일하다.
- Mission 선저장 구조에서도 최종 prompt occurrence가 1회다.
- 과거 동일 문자열의 정상 발화가 보존된다.
- 문자열 기반 dedupe가 추가되지 않는다.
- Same-session LIMIT가 감소하지 않는다.
- Boredom 입력에서 current utterance가 정확히 1회다.
- Same-day / Recent Episode / Long-term Memory에 회귀가 없다.
- Grade Persona / Action Selector / Safety / Memory Recall 회귀가 없다.
- Mission Goal assessment / Goal satisfaction / Completion 로직에 회귀가 없다.
- Free Chat 정상 대화 테스트 통과.
- Mission 정상 대화 테스트 통과.
- 자동 테스트 통과.
- typecheck/lint/build 결과 보고.
- Development 검증 완료.
- Owner QA 전 Production 코드/DB/env 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 9. 완료보고

완료 후 다음을 보고한다.

- 최종 Root Cause
- Free Chat Root Cause
- Mission Root Cause
- 변경 파일 목록
- Shared canonical currentTurnId 계약
- Free Chat canonical currentTurnId Source
- Mission canonical currentTurnId Source
- `/api/chat/messages` turn_id 전달 방식
- `/api/voice/respond` currentTurnId 전달 방식
- Mission turn route → Mission Adapter → Engine currentTurnId 전달 방식
- EngineInput 변경 내용
- Relationship Memory 전달 방식
- Same-session current turn 제외 방식
- Same-session LIMIT 보존 방식

Free Chat 수정 전 DB hit prompt occurrence:
- system memory
- recentHistory
- explicit current
- total

Free Chat 수정 전 DB miss prompt occurrence:
- system memory
- recentHistory
- explicit current
- total

Free Chat 수정 후 prompt occurrence:
- system memory
- recentHistory
- explicit current
- total

Mission 수정 전 prompt occurrence:
- system memory
- recentHistory
- explicit current
- total

Mission 수정 후 prompt occurrence:
- system memory
- recentHistory
- explicit current
- total

추가 보고:
- 동일 문자열 반복 발화 보존 테스트 결과
- Same-session LIMIT 테스트 결과
- Boredom 회귀 테스트 결과
- 4-tier Memory 회귀 테스트 결과
- Free Chat 실제 QA 결과
- Mission 실제 QA 결과
- Mission Goal assessment 회귀 테스트 결과
- Mission completion 회귀 테스트 결과
- unit/integration test 결과
- typecheck 결과
- lint 결과
- build 결과
- Dev 배포 URL
- Production 변경 여부: NO
- 최종 상태: `WAITING_FOR_OWNER_QA`
- 작업 커밋
