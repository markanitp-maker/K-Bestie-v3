# 자유대화 초성게임 A안 — Grade Persona 1~6 + Adaptive Difficulty

## 0. 목적

자유대화에서 케이(K)가 아이(I)와 친구처럼 자연스럽게 초성게임을 할 수 있도록 `PLAYFUL_GAME > CHOSUNG` 기능을 구현한다.

최종 방식은 다음으로 확정한다.

`Grade Persona 1~6 기본 난이도 + 아이별 Adaptive Difficulty`

학년별 기본 난이도를 시작점으로 사용하되, 실제 플레이 결과에 따라 같은 학년 안에서도 난이도가 자연스럽게 올라가거나 내려가야 한다.

이 기능은 별도 미니게임이 아니라 자유대화 v2의 `Child-directed Conversation` 안에서 동작해야 한다.

---

## 1. 공통 K Conversation Engine에 통합

권장 구조:

```text
Conversation Action
├─ EMPATHY
├─ CURIOSITY
├─ JOKE
├─ MEMORY_RECALL
├─ OWN_OPINION
├─ PLAYFUL_TEASING
├─ IMAGINATION
├─ CELEBRATION
├─ COMFORT
├─ FOLLOW_UP
├─ TOPIC_SHIFT
├─ JUST_LISTEN
└─ PLAYFUL_GAME
    └─ CHOSUNG
```

초성게임 전용 Persona, Memory, Safety, Response Generator를 따로 복제하지 않는다.

반드시 공통 Source of Truth의 다음 요소를 그대로 사용한다.

- K Core Persona
- Grade Persona 1~6
- Relationship Context
- Same-session / Same-day / Recent Episode / Long-term Memory
- Semantic Topic History
- Boredom Detection
- Safety
- Response Generator

---

## 2. 게임 시작은 양방향

### 아이가 먼저 요청

다음과 같은 발화를 초성게임 시작 의도로 인식한다.

- "초성게임 하자"
- "초성퀴즈 해"
- "내가 초성 낼게"
- "ㅍㅋㅊ 맞혀봐"

아이 요청은 cooldown으로 막지 않는다.

### 케이가 먼저 제안

케이도 상황이 맞으면 자연스럽게 먼저 제안할 수 있다.

예시 방향:

- "우리 초성게임 하고 놀래?"
- "심심한데 초성 맞히기 할까?"
- "갑자기 초성 하나 생각났어. 맞혀볼래?"

위 문장을 고정 템플릿으로 사용하지 않는다.

실제 문장은 `K Core Persona + Grade Persona + 현재 대화 + 최근 History`를 바탕으로 Gemini가 생성한다.

---

## 3. 케이가 먼저 제안할 수 있는 조건

허용 후보:

- 아이가 "심심해"라고 함
- 짧은 답변이 반복되어 Boredom Signal 상승
- 현재 대화가 장난/놀이 분위기
- 대화가 잠시 끊김
- 최근 K-initiated 초성게임 cooldown이 만료
- 아이가 최근 놀이형 대화에 긍정 반응

금지:

- 아이가 속상함, 불안, 친구 갈등 등 진지한 이야기를 하는 중
- Safety 신호 존재
- 아이가 현재 주제에 몰입해 이야기하는 중
- 최근 케이가 이미 초성게임을 제안
- 아이가 최근 게임을 거절
- 아이가 "질문 그만해", "게임 싫어" 등 피로 신호를 보임

현재 아이 발화와 감정이 항상 놀이 제안보다 우선한다.

---

## 4. child_initiated / k_initiated 구분

최소 다음을 기록한다.

```text
play_type = CHOSUNG
initiated_by = CHILD | K
last_played_at
frequency
```

또는 공통 구조에 맞춰:

```text
child_initiated
k_initiated
```

원칙:

- K가 먼저 제안하는 경우 cooldown 적용 가능
- 아이가 먼저 요청하면 cooldown 때문에 차단하지 않음
- 동일 날짜에 아이가 여러 번 먼저 요청해도 기본 허용

---

## 5. Grade Persona 1~6 기본 난이도

기존 1~6학년 독립 Grade Persona에 초성게임 난이도 속성을 추가한다.

예시:

```ts
chosungGame: {
  baseDifficulty: number
  minDifficulty: number
  maxDifficulty: number
  preferredWordLength: [number, number]
  vocabularyBand: string
  categoryComplexity: string
  hintStyle: string
}
```

실제 타입과 파일명은 현재 Grade Persona 구조 감사 후 확정한다.

### 학년별 기본 방향

| 학년 | 기본 난이도 | 방향 |
|---|---|---|
| 1학년 | 매우 쉬움 | 2~3음절, 익숙한 음식/동물/학교 단어 |
| 2학년 | 쉬움 | 2~4음절, 놀이/동물/학교/음식 |
| 3학년 | 쉬움~보통 | 생활어 + 조금 넓은 어휘 |
| 4학년 | 보통 | 일상어 + 관심사 + 다양한 3~4음절 |
| 5학년 | 보통~어려움 | 긴 단어, 복합어, 다양한 카테고리 |
| 6학년 | 어려움까지 허용 | 긴 단어, 복합어, 비교적 추상적인 일상어 |

예시는 문제 pool 설계 참고용이며 고정 목록이 아니다.

---

## 6. Adaptive Difficulty

학년은 시작 난이도일 뿐이다.

같은 학년 안에서도 최근 플레이 결과에 따라 난이도를 조절한다.

입력 신호:

```text
Grade Persona 기본 난이도
+
최근 정답률
+
연속 정답/오답
+
힌트 사용 횟수
+
재시도 횟수
+
최근 문제 난이도
+
frustration/boredom signal
```

응답 속도는 STT/TTS/네트워크 지연과 구분할 수 있을 때만 보조 신호로 사용한다.

### 상승 후보

- 연속 2~3문제 정답
- 최근 5문제 정답률 높음
- 힌트 거의 사용하지 않음

### 하락 후보

- 연속 오답
- 힌트 반복
- 여러 번 재시도
- 아이가 "너무 어려워" 표현
- frustration/boredom 상승

난이도 변경을 시스템식으로 말하지 않는다.

금지:
- "난이도를 낮추겠습니다."
- "너는 이 수준이 맞아."

친구처럼 자연스럽게 표현한다.

---

## 7. 학년별 난이도 안전 범위

난이도는 무한 상승/하락하지 않는다.

예시:

```text
Grade 1: level 1~2
Grade 2: level 1~3
Grade 3: level 2~4
Grade 4: level 2~5
Grade 5: level 3~5
Grade 6: level 3~6
```

실제 level 정의는 word corpus 설계 후 확정한다.

원칙:

- 1학년에게 6학년 난이도 급상승 금지
- 6학년에게 계속 유아 단어만 제공 금지
- 학년별 허용 범위 내에서 개인화

---

## 8. 초성 생성은 deterministic code

초성 추출은 LLM에게 맡기지 않는다.

예:

```text
사과 -> ㅅㄱ
바나나 -> ㅂㄴㄴ
피카츄 -> ㅍㅋㅊ
그림자 -> ㄱㄹㅈ
```

요구사항:

- 완성형 한글 정확 처리
- 띄어쓰기 처리 규칙 명확
- 숫자/영문/특수문자 정책 명확
- 동일 입력은 항상 동일 결과
- unit test 포함

---

## 9. 정답 판정도 deterministic code 중심

기본 정답 판정:

```text
normalize(user_answer) == normalize(correct_answer)
```

정규화:

- 앞뒤 공백
- 중복 공백
- 허용 가능한 띄어쓰기 차이
- 영문 대소문자
- 명시된 표기 variant

동의어가 필요한 경우 문제 데이터에 명시적으로:

```text
accepted_answers
```

를 둔다.

LLM이 임의로 "비슷하니까 정답"이라고 판정하지 않는다.

---

## 10. 아이가 문제를 내는 것도 지원

초성게임은 케이만 문제를 내는 방식이 아니다.

예:

```text
아이: 내가 낼게. ㅂㄴㄴ
```

케이는 답을 추론해서 친구처럼 시도한다.

원칙:

- 일반적인 초성은 자연스럽게 맞히기
- 애매하면 힌트 요청 가능
- 후보가 여러 개면 하나를 추측 가능
- 모든 문제를 완벽하게 맞히는 AI처럼 굴 필요 없음
- 일부러 바보처럼 반복 오답도 금지

핵심:

> 초성게임을 잘하지만 같이 노는 동갑내기 친구처럼 느껴져야 한다.

---

## 11. 문제 단어 소스

문제 후보는 최소 다음 조합으로 구성한다.

```text
General Safe Word Pool
+
Grade Difficulty
+
Interest/Memory Personalization
```

카테고리 예:

- 음식
- 동물
- 학교
- 놀이
- 게임
- 스포츠
- 캐릭터
- 장소
- 물건
- 자연

---

## 12. Memory 기반 개인화

안전한 관심사 Memory만 가끔 활용한다.

예:

- 포켓몬 관심 -> 피카츄 같은 문제
- 축구 관심 -> 축구공 등
- 마인크래프트 관심 -> 관련 친숙한 단어

Silent Memory 원칙을 유지한다.

금지:

- 매 문제를 Memory 기반으로 내기
- 친구 갈등/가족 문제/건강/감정 사건을 게임 문제로 사용
- 개인정보나 민감 Memory 사용

개인화는 `관심사 / 취미 / 캐릭터 / 게임 / 스포츠 / 음식` 등 안전한 영역으로 제한한다.

---

## 13. 문제 중복 방지 + Play History

최소 다음을 추적한다.

```text
recent_words
last_played_at
frequency
play_type = CHOSUNG
initiated_by
```

동일 세션에서 최근 단어 반복 금지.

K가 먼저 제안하는 초성게임은 cooldown 적용.

아이 먼저 요청은 cooldown으로 막지 않는다.

---

## 14. 게임 상태

예시 상태:

```text
IDLE
OFFERED
PLAYING_K_ASKS
PLAYING_CHILD_ASKS
WAITING_FOR_ANSWER
HINT
ROUND_RESULT
ENDED
```

자동 음성 / 수동 음성 / 키보드 입력 모두 동일 상태 머신을 사용한다.

입력 방식마다 게임 로직을 복제하지 않는다.

---

## 15. Topic Shift는 항상 아이 우선

게임 중 아이가 다른 이야기를 하면 게임을 강제 지속하지 않는다.

예:

```text
K: ㅍㅋㅊ!
아이: 근데 오늘 민서랑 싸웠어.
```

기대:

- 현재 아이 발화 우선
- 초성 정답 강요 금지
- 게임 pause/end
- 일반 자유대화로 전환
- 진지한 이야기라면 해당 Conversation Action으로 처리

자유대화는 계속 `Child-directed Conversation`이다.

---

## 16. 고정 문제 수/완료 조건 없음

기본적으로:

- 5문제 완료
- 10문제 완료
- 점수 획득을 위한 강제 진행

같은 Completion 구조를 넣지 않는다.

아이가:

- 더 하자
- 그만
- 딴 거 하자

라고 하면 그대로 따른다.

자유대화에 Goal/Completion 개념을 추가하지 않는다.

---

## 17. 리액션은 고정 템플릿 금지

절대 다음처럼 구현하지 않는다.

```text
CORRECT -> "와 대박! 잘했어!"
WRONG -> "아쉽다! 다시 해봐!"
```

Action은 행동 방향만 결정한다.

실제 문장은 다음을 기반으로 Gemini가 생성한다.

```text
Game State / Result
+
Conversation Action
+
Grade Persona
+
현재 아이 발화
+
Relationship Context
+
최근 대화 History
+
mode = FREE_CHAT
```

같은 정답 상황에서도 학년/아이/대화 흐름에 따라 표현이 달라져야 한다.

---

## 18. 학년별 게임 말투

게임 중에도 기존 Grade Persona 1~6를 그대로 사용한다.

차이 항목:

- 어휘
- 문장 길이
- 장난 수준
- 칭찬 표현
- 도전 표현
- 힌트 방식
- 실패 반응

초성게임 전용 Grade Persona를 별도로 복제하지 않는다.

---

## 19. 힌트 시스템

아이가:

- "힌트 줘"
- "모르겠어"
- "어려워"

라고 하면 힌트를 제공한다.

힌트 단계 예:

1. 카테고리
2. 의미 힌트
3. 첫 글자/추가 단서
4. 정답 공개

학년과 현재 난이도에 따라 힌트 강도를 조절한다.

저학년/연속 오답에서는 더 친절하게, 고학년/고정답률에서는 힌트를 조금 늦게 제공할 수 있다.

---

## 20. 정답/오답 반응 원칙

오답 시 금지:

- "틀렸어" 반복
- "그것도 모르니"
- 실력 평가
- 비교
- 창피하게 만드는 말

허용 방향:

- 아깝다는 자연 반응
- 힌트 제안
- "내가 좀 어렵게 냈다" 식 완충
- 난이도 자동 하향

연속 정답 시:

- 자연스러운 도전 표현
- 난이도 소폭 상승
- 같은 칭찬 문구 반복 금지

---

## 21. Adaptive 상태는 평가용이 아니다

초성게임 데이터는 `재미있는 난이도 조절` 목적이다.

금지:

- 국어 실력 등급화
- 학습능력 평가
- 부모 리포트에 "초성게임 실력" 노출
- 아이들 비교

필요한 내부 telemetry는 최소화한다.

예:

```text
session_id
child_id
game_type
difficulty
result
hint_used
initiated_by
created_at
```

대화 원문을 게임 로그에 별도 복제 저장하지 않는다.

---

## 22. STT/TTS/UI 고려

초성은 음성 인식에서 불안정할 수 있으므로:

- 문제 초성은 화면에 반드시 텍스트 표시
- TTS가 초성을 이상하게 읽는지 검증
- 음성으로 답하거나 키보드로 답하는 것 모두 지원
- STT가 `피읖 키읔 치읓` 등으로 인식하는 케이스 테스트

초성게임 때문에 기존 음성/텍스트 입력 구조를 복제하지 않는다.

---

## 23. Safety

문제 pool에 아동 부적절 단어가 들어가면 안 된다.

차단 대상:

- 성적 표현
- 심각한 폭력
- 욕설/혐오
- 술/담배/약물
- 도박
- 연령 부적절한 콘텐츠
- 개인정보

아이 입력이 부적절한 경우 기존 Safety가 우선한다.

---

## 24. 구현 단계

### Phase 0 — AS-IS 감사

확인:

- K Conversation Engine
- Grade Persona 1~6
- Action Selector
- Memory
- Semantic Topic History
- Boredom Detection
- STT/TTS
- 자유대화 입력 모드
- 메시지 저장

### Phase 1 — Chosung Core

- 초성 추출 utility
- answer normalization
- deterministic validation
- accepted_answers
- word metadata
- category/difficulty/safety
- unit tests

### Phase 2 — Grade Difficulty

Grade Persona 1~6에 초성게임 난이도 속성 추가.

### Phase 3 — Game State

- child initiated
- K initiated
- question
- answer
- hint
- round result
- pause/end

### Phase 4 — Adaptive Difficulty

- 상승
- 유지
- 하락
- 학년 min/max

### Phase 5 — Conversation Action 통합

`PLAYFUL_GAME: CHOSUNG`을 공통 Action Selector에 연결.

### Phase 6 — Memory Personalization

안전한 관심사 Memory만 선택적으로 사용.

### Phase 7 — Semantic History/Cooldown

- PLAY_CHOSUNG
- last_used_at
- frequency
- child/k initiated
- K proposal cooldown

### Phase 8 — Dev QA

1~6학년 전체 검증 후 Production.

---

## 25. 필수 QA

1. 아이가 "초성게임 하자" -> 즉시 시작
2. K가 boredom 상황에서 먼저 제안
3. 아이가 거절 -> 즉시 일반 대화, 재권유 반복 없음
4. 정답 deterministic 판정
5. 오답 후 힌트/재시도
6. 연속 정답 -> 난이도 상승
7. 연속 오답 -> 난이도 하락
8. 학년 min/max 준수
9. 아이가 문제를 내는 역할 전환
10. 게임 중 Topic Shift -> 일반 대화 전환
11. 안전한 Memory 개인화
12. 민감 Memory 문제화 0건
13. K-initiated cooldown
14. child-initiated 요청은 허용
15. 자동 음성/수동 음성/키보드 모두 정상

---

## 26. 학년별 QA

각 학년 최소 10문제 테스트.

검증:

- 기본 난이도 차이
- Adaptive Difficulty
- 힌트 수준
- K 말투
- 과도한 유아화 없음
- 과도한 난이도 없음
- 문제 중복 없음
- 고정 리액션 반복 없음

특히 1학년과 6학년은 확실한 난이도/표현 차이를 증명한다.

---

## 27. 회귀 검증

영향 없어야 하는 기능:

- 일반 자유대화
- K Conversation Engine
- Grade Persona 1~6
- Relationship Memory
- Semantic Topic History
- Boredom Detection
- 자동/수동 음성
- 키보드
- STT/TTS
- chat_messages
- Collection
- Context Correction
- Memory Batch
- LLM Wiki
- Daily/Weekly Report
- Mission v3 공통 엔진

---

## 28. 완료 기준

다음 모두 PASS:

- 아이/K 양쪽에서 초성게임 시작 가능
- Grade Persona 1~6 기본 난이도 존재
- 아이별 Adaptive Difficulty 작동
- 학년 범위 초과 없음
- deterministic 초성 생성
- deterministic 정답 판정
- accepted answers 지원
- 고정 정답/오답 리액션 템플릿 없음
- Gemini 자연 리액션
- 아이가 문제 낼 수 있음
- Topic Shift 자유
- 안전 Memory만 개인화
- K-initiated cooldown
- child-initiated 허용
- 1~6학년 QA PASS
- BLOCKED/HIGH/MEDIUM 0건

---

## 29. 결과 보고 형식

### AS-IS
- 공통 K Engine:
- Grade Persona:
- Action Selector:
- Memory:
- Semantic Topic/Boredom:

### Chosung Core
- 파일:
- 초성 utility:
- 정답 판정:
- word source:
- accepted answers:

### Grade Difficulty
- Grade 1:
- Grade 2:
- Grade 3:
- Grade 4:
- Grade 5:
- Grade 6:

### Adaptive Difficulty
- 상태:
- 상승:
- 하락:
- min/max:

### Game Flow
- child initiated:
- K initiated:
- cooldown:
- hint:
- child asks:
- topic shift:
- end:

### Memory/Safety
- 개인화:
- Silent Memory:
- 민감정보 제외:
- safe word filtering:

### QA
- 1학년:
- 2학년:
- 3학년:
- 4학년:
- 5학년:
- 6학년:
- 음성/키보드:
- 회귀:

### Issues
- BLOCKED:
- HIGH:
- MEDIUM:
- LOW:

### 배포
- Dev commit:
- Dev deployment:
- Production commit:
- Production deployment:

### 최종 판정
- PASS / FAIL

---

## 30. 절대 금지

- 학년별 고정 난이도만 구현하고 Adaptive Difficulty 생략 금지
- 모든 학년 동일 난이도 금지
- 초성 생성 LLM 의존 금지
- 기본 정답 판정 LLM 의존 금지
- 정답/오답 canned response 금지
- 게임용 Persona 별도 복제 금지
- 민감 Memory 게임 문제화 금지
- Topic Shift 후 게임 강제 지속 금지
- K cooldown으로 아이 요청 차단 금지
- 게임 결과를 학습능력 평가로 부모에게 노출 금지
- 자유대화에 Goal/Completion 구조 추가 금지

---

## 31. 최종 기준 문장

> 자유대화 초성게임은 공통 K Conversation Engine의 `PLAYFUL_GAME: CHOSUNG` Action으로 동작하며, 아이가 먼저 요청하거나 케이가 적절한 상황에서 먼저 제안할 수 있다. 문제 난이도는 1~6학년 각각의 독립 Grade Persona가 기본값을 정하고 최근 정답/오답과 힌트 사용 등을 반영한 Adaptive Difficulty로 아이별 조절한다. 초성 생성과 정답 판정은 deterministic code가 담당하며, 케이의 제안·힌트·정답/오답 리액션은 Action + Grade Persona + 현재 아이 발화 + Relationship Context + 최근 대화를 기반으로 Gemini가 자연스럽게 생성한다. 아이가 다른 이야기를 시작하면 즉시 그 흐름을 따라가며, Memory 개인화는 안전한 관심사에만 제한적으로 사용한다.
