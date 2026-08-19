# 미션 LLM Fallback 긴급 핫픽스 v1

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

미션에서 아이가 질문에 정상적으로 답했는데 케이가 10~25초 이상 오래 생각한 뒤
`“응, 듣고 있어. 더 얘기해줄래?”`라고 응답하여 같은 답을 다시 요구하는 장애를 제거한다.

핵심 원칙은 다음과 같다.

- 아이의 발화가 서버에 정상 전달되고 Goal/유효성 판정이 끝났다면, 자연어 응답 생성 실패 때문에 같은 답을 다시 요구하지 않는다.
- 미션에서 LLM 자연어 생성이 실패하더라도 미션 진행 상태와 별 게이지는 보존한다.
- 미션용 fallback은 자유대화용 fallback과 분리한다.
- 미션용 fallback은 `계속 말해줘/더 말해줘/듣고 있어` 형태를 사용하지 않는다.
- LLM 실패 시에도 미션 엔진이 이미 알고 있는 현재 상태와 다음 질문 후보를 이용해 deterministic하게 다음 질문으로 진행한다.
- 실시간 음성 대화에서 수십 초 지연이 발생하지 않도록 retry budget을 제한한다.
- 1차 실패 원인을 정확히 구분할 수 있도록 attempt별 실패 사유를 로깅한다.

### 대표님 테스트 정상 프로세스

#### 시나리오 A — 정상 미션 답변

1. 케이가 미션 질문을 한다.
2. 아이가 의미 있는 완성 답변을 한다.
3. 서버에서 STT final text가 정상 전달된다.
4. Goal/유효성 판정이 정상 처리된다.
5. 별 게이지가 기존 정책대로 반영된다.
6. 케이가 자연스럽게 다음 질문을 한다.
7. `“더 얘기해줄래?”` fallback은 출력되지 않는다.

PASS 기준:
- 정상 답변 뒤 같은 답을 다시 요구하지 않는다.
- 다음 질문으로 정상 진행된다.
- 별 게이지가 누락되지 않는다.

#### 시나리오 B — LLM 응답 생성 1차 실패

1. 미션 답변을 정상 수신한다.
2. Goal/유효성 판정이 완료된다.
3. responseGenerator의 1차 LLM 호출을 의도적으로 실패시킨다.
4. 제한된 retry budget 안에서 재시도한다.
5. 재시도 성공 시 정상 자연어 질문을 반환한다.

PASS 기준:
- 전체 응답 시간이 실시간 대화 허용 범위를 넘지 않는다.
- 3초 + 5초 식의 장시간 backoff가 누적되지 않는다.

#### 시나리오 C — 모든 LLM 자연어 생성 실패

1. 미션 답변을 정상 수신한다.
2. Goal/유효성 판정은 성공한다.
3. responseGenerator의 모든 LLM 호출을 실패시킨다.
4. 자유대화용 공용 fallback을 사용하지 않는다.
5. 미션 엔진이 이미 보유한 다음 질문/Seed-Fallback 방향을 사용해 deterministic한 미션 fallback을 만든다.
6. 아이에게 새로운 질문을 명확히 제시한다.

예:

```text
아이: 엄마 아빠가 밥도 해주고 빨래도 해줘.
케이: 가족들이 많이 도와줬구나. 그럼 다음 달의 너에게 기대하는 모습은 뭐야?
```

PASS 기준:
- `응, 듣고 있어. 더 얘기해줄래?`
- `계속 말해줘`
- `더 얘기해줘`

등 이미 완료된 답변을 미완성으로 취급하는 문구가 나오지 않는다.

#### 시나리오 D — 실제 제보 재현 케이스

다음 답변을 그대로 E2E 테스트한다.

```text
그냥 돌봐 주는 것
엄마 아빠가 돌봐준거
잘하기!
즐거운 기분!
```

PASS 기준:
- 모든 답변에서 동일 답변 재요구 없이 다음 미션 질문으로 진행
- 정상 Goal/별 게이지 반영
- 비정상 장시간 대기 없음

---

## 1. 상태 / 우선순위 / 대상

- 상태: 긴급 핫픽스
- 우선순위: BLOCKER / CRITICAL
- 대상 프로젝트: K-Bestie-v3
- 개발 주체: Claude Code
- 적용 대상:
  - Mission V3
  - `/api/mission/v3/turn`
  - `lib/mission-v3/missionAdapter.ts`
  - `lib/k-conversation/responseGenerator.ts`
  - K Conversation Engine의 retry/fallback 처리
  - 미션 응답 latency 및 오류 로깅
- 제외 대상:
  - STT/VAD 값 변경
  - 미션 질문 정책 전면 재설계
  - 친구되기 장벽 제거 전체 작업
  - 놀이 SKILL
  - 성장정보
  - 별 게이지/황금열쇠 정책 자체 변경
  - LLM 모델 교체를 전제로 한 대규모 아키텍처 변경

---

## 2. 목표

실제 Production 조사에서 최근 7일 동안 아래 장애가 확인되었다.

- 총 6건
- 실제 아이 2명
- 실제 미션 세션 2개
- 6건 모두 완성된 정상 답변 뒤 발생
- 응답 지연 12.8초 ~ 26.8초
- 모두 Mission V3 경로에서 발생

대표 흐름:

```text
아이 정상 답변
→ Goal/유효성 판정 정상
→ engine.respond()
→ generateResponse()
→ LLM 1차 실패
→ sleep(3000)
→ LLM 2차 실패
→ sleep(5000)
→ LLM 3차 실패
→ 공용 FALLBACK_TEXT
→ "응, 듣고 있어. 더 얘기해줄래?"
```

정확한 Source:

```text
lib/k-conversation/responseGenerator.ts

const FALLBACK_TEXT = "응, 듣고 있어. 더 얘기해줄래?";
```

문제는 두 개다.

### 문제 1 — Retry latency

실시간 대화인데 `[0, 3000, 5000]` retry delay가 누적되어 아이가 10~25초 이상 기다리게 된다.

### 문제 2 — Fallback 의미 오류

미션에서는 아이의 답변이 이미 완료됐고 Goal 판정도 끝났는데, 자유대화형 공용 fallback이 아이에게 “더 말하라”고 요구한다.

즉 자연어 생성 실패가 미션 진행 상태까지 깨뜨리고 있다.

TO-BE:

```text
아이 정상 답변
→ Goal/유효성 판정
→ 별 게이지/mission state 확정
→ 자연어 응답 생성 시도
   ├─ 성공 → 정상 응답
   └─ 실패 → Mission deterministic fallback
             → 이미 결정된 다음 질문으로 진행
```

---

## 3. 요구사항

### 3-1. 자유대화와 미션 Fallback 분리

현재 `responseGenerator.ts`의 단일 공용 fallback 사용 여부를 재확인하고, 미션에서 다음 문구를 사용하지 않게 한다.

금지:

```text
응, 듣고 있어. 더 얘기해줄래?
계속 말해줘.
더 말해줘.
계속 얘기해줄래?
```

아이의 답변이 완료된 미션 턴에서는 위 계열 문구를 절대 반환하지 않는다.

자유대화의 fallback 정책은 이번 핫픽스 범위에서 불필요하게 변경하지 않는다.

### 3-2. Mission deterministic fallback 추가

미션 자연어 생성이 최종 실패하면 LLM에 다시 의존하지 않고 미션 상태에서 deterministic fallback을 구성한다.

우선 사용 순서:

```text
1. missionAdapter가 이미 결정한 next question / question direction
2. 현재 Goal에 맞는 Seed/Fallback 질문
3. mission state에 존재하는 다음 안전한 질문
```

Fallback은 최소:

```text
짧은 acknowledgement + 다음 미션 질문
```

형태여야 한다.

예:

```text
그렇구나. 다음 달의 너에게 기대하는 모습은 뭐야?
```

단 acknowledgement 생성 때문에 다시 LLM을 호출하지 않는다.

### 3-3. Mission state와 자연어 생성 성공 여부 분리

Goal assessment, 의미 있는 답변 판정, 별 게이지 진행, mission progress가 자연어 생성 성공 여부에 종속되지 않게 한다.

정상 답변이 이미 처리된 경우:

```text
LLM generation fail
≠
아이 답변 무효
```

로 처리한다.

자연어 생성 실패로 인해:

- 동일 답변 재요구
- 같은 질문 재출제
- 별 게이지 롤백
- mission progress 롤백

이 발생하면 안 된다.

### 3-4. Retry Budget 단축

현재 확인된:

```text
RETRY_DELAYS_MS = [0, 3000, 5000]
```

를 실시간 미션 대화에 그대로 적용하지 않는다.

정책 목표:

- 전체 응답 latency를 실시간 음성 대화 범위로 제한
- 재시도 횟수는 최대 1~2회
- retry delay는 수백 ms ~ 1초 수준에서 제한
- 총 retry budget을 명시적으로 관리

정확한 최종값은 Claude Code가 현재 timeout 설정 및 실제 API latency를 확인한 뒤 결정한다.

단순히 `[0,500,1000]`을 기계적으로 적용하지 말고:

```text
attempt timeout
+
retry delay
+
총 retry budget
```

을 함께 계산한다.

### 3-5. 총 응답시간 SLO 추가

미션 응답은 실시간 대화 UX 기준의 SLO를 정의한다.

권장 목표:

```text
정상 응답: 가능한 한 2~4초 이내
실패/재시도 포함: 장시간 10초 이상 대기 금지
```

정확한 기준은 현재 Production baseline과 API latency를 측정해 정한다.

최종 실패 시 기다리게 하지 말고 deterministic fallback으로 즉시 진행한다.

### 3-6. Attempt별 실패 원인 로깅

현재 `all retries exhausted`만으로는 1차 실패 원인을 확정할 수 없다.

attempt별로 최소 다음을 구분해 로깅한다.

```text
attempt number
elapsed_ms
failure_type
model
mode
route
```

failure_type 예:

```text
TIMEOUT
HTTP_5XX
EMPTY_RESPONSE
PROMPT_LEAK_DETECTED
INVALID_RESPONSE
NETWORK_ERROR
UNKNOWN
```

아동 대화 원문 전체를 오류 로그에 새로 남기지 않는다.

필요한 경우 session/turn correlation id만 사용한다.

### 3-7. Prompt Leak Detector 영향 확인

`detectPromptLeak` 또는 동등 검증이 정상 응답을 실패로 오판하는지 확인한다.

- `[` 문자 단독 등 너무 넓은 조건으로 정상 응답을 버리는지
- 실제 6건 실패와 연결되는 로그가 있는지
- false positive가 확인되면 최소 범위로 튜닝

증거 없이 detector를 삭제하지 않는다.

### 3-8. Prompt 길이/013 패치 원인 단정 금지

Antigravity 조사에서 다음은 LIKELY로만 판정됐다.

```text
013 친구되기 엔진 v1 이후 prompt 합성이 길어져
LLM 실패율이 증가했을 가능성
```

따라서 이번 핫픽스에서 프롬프트를 무조건 축소하지 않는다.

먼저 attempt별 실패 로그를 통해 실제 원인을 분리한다.

다만 `missionAdapter.ts`의 adapterInstruction에 명백한 중복/불필요 지침이 있고 안전하게 축약 가능하다면 최소 수정은 허용한다.

### 3-9. 실제 제보 문구 재발 방지

코드 및 E2E에서 다음 문구를 재발 방지 대상으로 고정한다.

```text
응, 듣고 있어. 더 얘기해줄래?
응 듣고있어 계속 말해줘
계속 말해줘
더 얘기해줄래?
```

정확 일치뿐 아니라 동등한 의미의 미션 fallback도 검사한다.

### 3-10. Mission V3 실제 실행경로 기준 수정

이번 장애는 다음 경로에서 확인됐다.

```text
/api/mission/v3/turn
→ respondToMissionTurn()
→ missionAdapter
→ engine.respond()
→ generateResponse()
```

다른 레거시 미션 경로를 수정하고 실제 V3 경로를 놓치는 일이 없어야 한다.

개발 전 실제 UI가 현재 어떤 endpoint를 호출하는지 재확인한다.

### 3-11. Safety 유지

Fallback 핫픽스 때문에 기존 Safety를 우회하지 않는다.

고위험 safety 응답이 필요한 상황에서는 deterministic mission fallback보다 Safety가 우선한다.

우선순위:

```text
SAFETY
→ 정상 Mission response
→ Mission deterministic fallback
```

---

## 4. 기존 구조 확인

### 4-1. 실제 발생 경로

READ-ONLY 조사 결과:

```text
app/api/mission/v3/turn/route.ts
→ lib/mission-v3/missionAdapter.ts
→ lib/k-conversation/index.ts
→ lib/k-conversation/responseGenerator.ts
```

### 4-2. 현재 Fallback

확인된 코드:

```typescript
const FALLBACK_TEXT = "응, 듣고 있어. 더 얘기해줄래?";
```

모든 retry 실패 후 반환된다.

### 4-3. Retry

확인된 구조:

```text
1차 attempt
→ 실패
→ 3초 대기
→ 2차 attempt
→ 실패
→ 5초 대기
→ 3차 attempt
→ 실패
→ fallback
```

### 4-4. 실제 Production 증거

최근 7일:

```text
event: 6
sessions: 2
children: 2
mission_v3: 100%
confirmed_bug: 6/6
latency: 12.8s ~ 26.8s
```

대표 정상 답변:

```text
"그냥 돌봐 주는 것"
"엄마 아빠가 돌봐준거"
"잘하기!"
"즐거운 기분!"
```

모두 STT final text가 정상 서버 전달된 이후 발생했다.

따라서 이번 버그는 STT/VAD 수정으로 해결하려고 하지 않는다.

---

## 5. 금지사항

1. 이번 버그를 STT/VAD 문제로 처리하지 않는다.
2. 정상 완료된 아이 답변을 다시 요구하지 않는다.
3. 미션용 fallback에 `더 말해줘/계속 말해줘`를 사용하지 않는다.
4. 자연어 생성 실패 때문에 Goal/별 게이지를 롤백하지 않는다.
5. 자연어 생성 실패 때문에 같은 질문을 다시 던지지 않는다.
6. retry delay만 줄이고 fallback 의미 오류를 그대로 두지 않는다.
7. fallback만 바꾸고 20초 이상 latency를 그대로 두지 않는다.
8. 실패 원인 확인 없이 013 친구되기 패치를 원인으로 단정하지 않는다.
9. 증거 없이 prompt leak detector를 제거하지 않는다.
10. 고위험 Safety를 deterministic fallback으로 덮어쓰지 않는다.
11. 자유대화 전체 fallback 정책까지 불필요하게 변경하지 않는다.
12. 별 게이지/황금열쇠 정책을 변경하지 않는다.
13. Production 데이터를 QA 목적으로 수정하지 않는다.

---

## 6. 모호성 처리

### 6-1. 다음 질문 텍스트가 이미 존재하는 경우

LLM 실패 시 해당 텍스트를 최우선으로 사용한다.

### 6-2. 다음 질문 방향만 있고 완성 문장이 없는 경우

기존 Seed/Fallback question bank 또는 deterministic template을 사용한다.

이를 위해 추가 LLM 호출을 하지 않는다.

### 6-3. Mission progress는 성공했지만 자연어 응답 저장이 실패한 경우

progress를 되돌리지 않는다.

클라이언트가 재시도할 때 중복 별 게이지 증가가 발생하지 않도록 idempotency를 확인한다.

### 6-4. 첫 시도 실패가 Prompt Leak Detector 때문인 경우

실제 false positive인지 확인한다.

정상 leak 차단 기능은 유지하고 과도한 탐지만 최소 튜닝한다.

### 6-5. LLM 서비스가 장시간 장애인 경우

Mission deterministic fallback으로 세션이 계속 진행 가능해야 한다.

단 Safety 관련 turn은 기존 안전 경로를 우선한다.

---

## 7. QA

### 7-1. 정상 답변

- [ ] `"그냥 돌봐 주는 것"` → 다음 질문 정상
- [ ] `"엄마 아빠가 돌봐준거"` → 다음 질문 정상
- [ ] `"잘하기!"` → 다음 질문 정상
- [ ] `"즐거운 기분!"` → 다음 질문 정상
- [ ] 같은 답변 재요구 없음
- [ ] 별 게이지 정상
- [ ] mission progress 정상

### 7-2. LLM 1차 실패

- [ ] 1차 실패 강제
- [ ] 제한된 retry 정상
- [ ] retry 성공 시 정상 자연어 응답
- [ ] latency SLO 충족
- [ ] 중복 turn 저장 없음

### 7-3. LLM 전체 실패

- [ ] 모든 attempt 강제 실패
- [ ] 공용 `FALLBACK_TEXT` 미사용
- [ ] Mission deterministic fallback 사용
- [ ] 다음 질문 명확히 존재
- [ ] 별 게이지 유지
- [ ] 같은 답변 재요구 없음

### 7-4. 금지 문구

다음 문구 또는 동등 의미가 미션 완료 답변 뒤 나오지 않는지 검사:

- [ ] `응, 듣고 있어. 더 얘기해줄래?`
- [ ] `계속 말해줘`
- [ ] `계속 얘기해줘`
- [ ] `더 말해줘`

### 7-5. Latency

- [ ] 정상 turn latency 측정
- [ ] 1회 retry turn latency 측정
- [ ] 전체 failure fallback latency 측정
- [ ] 10초 이상 장기 대기 재발 없음
- [ ] 20초 이상 대기 0건

### 7-6. Failure Logging

각 failure case에서:

- [ ] attempt number
- [ ] elapsed_ms
- [ ] failure_type
- [ ] model
- [ ] mode=MISSION
- [ ] correlation id

확인 가능.

아동 대화 원문은 신규 오류 로그에 저장하지 않음.

### 7-7. Mission 회귀

- [ ] 정상 V3 미션 완료
- [ ] Goal assessment 정상
- [ ] 별 게이지 정상
- [ ] 황금열쇠 정상
- [ ] Parent Question 우선순위 회귀 없음
- [ ] 친구되기 파생 질문 정책 회귀 없음

### 7-8. Safety 회귀

- [ ] 자해 신호 정상
- [ ] 폭력/학대 신호 정상
- [ ] 성적 위험 정상
- [ ] 관계 안전 가드 정상
- [ ] Safety 응답이 mission fallback보다 우선

### 7-9. Production 재발 확인 기준

배포 후 운영 데이터에서 해당 fallback exact/semantic match를 추적할 수 있게 한다.

PASS 기준:

```text
정상 답변 완료 후
"더 얘기해줘/계속 말해줘"류 fallback = 0건
```

운영 검증용 자동 조회 스크립트는 READ-ONLY로 작성 가능하다.

---

## 8. 완료 조건

다음 조건을 모두 만족해야 완료다.

1. 미션과 자유대화 fallback이 분리된다.
2. 정상 완료된 미션 답변 뒤 `더 얘기해줄래?`가 나오지 않는다.
3. 모든 LLM 생성 실패 시에도 deterministic한 다음 미션 질문으로 진행된다.
4. Goal/별 게이지가 자연어 생성 성공 여부와 분리된다.
5. 동일 답변 재요구가 발생하지 않는다.
6. 10~25초 장기 retry latency가 제거된다.
7. 실시간 대화에 맞는 retry budget이 적용된다.
8. attempt별 실패 원인이 로깅된다.
9. 013 프롬프트가 실제 원인인지 확인 가능한 관측성이 확보된다.
10. Mission V3 실제 Production 실행경로에 적용된다.
11. 기존 Safety가 유지된다.
12. 기존 미션 완료/별 게이지/황금열쇠에 회귀가 없다.
13. 대표 제보 4개 문장 E2E가 모두 PASS 한다.
14. BLOCKED/HIGH/MEDIUM 이슈가 0건이다.

---

## 9. 개발 완료 보고 형식

Claude Code는 완료 후 다음 순서로 보고한다.

```text
1. Root Cause 최종 확인
2. 변경 요약
3. 실제 변경 파일 목록
4. Mission fallback 분리 방식
5. Deterministic fallback 구현 방식
6. Goal/별 게이지와 자연어 생성 실패 분리 방식
7. Retry 횟수/지연/총 budget
8. 정상/실패 latency 측정 결과
9. Attempt별 failure logging
10. Prompt leak detector 확인 결과
11. 013 prompt 영향 확인 결과
12. 대표 제보 4개 E2E 결과
13. Mission V3 전체 회귀 테스트
14. Safety 회귀 테스트
15. Production 적용 경로 확인
16. 남은 위험/확인 필요 사항
```

BLOCKED/HIGH/MEDIUM 이슈가 남아 있으면 완료로 보고하지 않는다.
