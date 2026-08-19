# 079 — Mission V3 별 게이지 / Goal Assessor 개선 Request

> 목적: 아이가 K의 질문 의도를 충분히 충족했는데도 `SATISFIED`가 되지 않아 별 게이지가 오르지 않는 문제를 개선한다.  
> 핵심 원칙은 **답변 길이가 아니라 질문 의도 충족 여부로 판정**하는 것이다.

---

# 0. Production 감사 결론

최근 3일 Production Mission V3 데이터 23개 세션, 290턴을 READ-ONLY 재검증한 결과:

- 전체 290턴
- SATISFIED 획득 턴: 90
- DECLINED: 34
- PARTIAL: 58
- SKIPPED: 23
- EMPTY / confidence 미달: 85
- 명백히 질문 의도를 충족했지만 SATISFIED가 되지 않은 `CLEARLY_ANSWERED_BUT_NOT_SATISFIED`: **18건**
- 전체 290턴 대비: **6.2%**
- 비거절 답변 256턴 대비: **7.0%**
- 비-SATISFIED / 비-DECLINED 166턴 대비: **10.8%**

파이프라인 점검 결과:

```text
아이 답변
→ goalAssessor
→ conversation_goals DB
→ /api/mission/v3/turn goalProgress
→ Client 별 게이지
```

판정:

- **goalAssessor의 과도한 구체성 요구**: CONFIRMED
- **짧은 정상 아동 답변을 PARTIAL로 처리**: CONFIRMED
- `MIN_GOAL_CONFIDENCE = 0.5`: POSSIBLE secondary issue
- STT 일부 오타: POSSIBLE secondary issue
- DB persistence: RULED_OUT
- API goalProgress stale: RULED_OUT
- Client gauge rendering: RULED_OUT

즉, 별 UI를 고칠 문제가 아니다.

> **Assessor가 SATISFIED를 주지 않기 때문에 별이 오르지 않는 것이 실체다.**

---

# 1. 현재 문제

현재 Assessor 정의가 사실상 다음처럼 작동한다.

```text
SATISFIED:
의미 있고 구체적인 정보를 충분히 제공

PARTIAL:
관련은 있으나 애매하거나 더 확인 필요
```

이 기준이 초등학생의 자연스러운 단답을 지나치게 엄격하게 본다.

실제 Production 오판 예시:

| K 질문 | 아이 답변 | 현재 | 기대 |
|---|---|---|---|
| 야구 학원에서 어떤 순간이 제일 재밌어? | `던지는 거.` | PARTIAL | SATISFIED |
| 무슨 숙제길래 그래? | `일기랑 독서록` | PARTIAL | SATISFIED |
| 누구랑 같이 다녀왔어? | `가족들이랑 사촌동생` | PARTIAL | SATISFIED |
| 어떤 책 읽을 때가 제일 재밌어? | `만화책` | PARTIAL | SATISFIED |
| 기분이 어땠어? | `많이 속상했어` | PARTIAL | SATISFIED |
| 학교에서 기억에 남는 일? | `학교 안 가고 방학이야` | PARTIAL | SATISFIED 또는 해당 Goal 해결 처리 |

---

# 2. 변경 원칙

## 2.1 판정 기준 변경

기존:

> “얼마나 구체적으로 설명했는가?”

변경:

> **“K가 방금 요구한 핵심 정보 단위를 아이가 제공했는가?”**

답변 길이, 문장 완성도, 조사/어미, 설명의 풍부함은 SATISFIED의 필수 조건이 아니다.

초등학생이 한 단어 또는 짧은 구로 질문의 핵심을 직접 답했다면 SATISFIED가 가능해야 한다.

---

# 3. 핵심 판정 규칙

## 3.1 직접 정보 제공 → SATISFIED

### GAME
K:
> “무슨 게임 했어?”

Child:
> “로블록스.”

Expected:
`SATISFIED`

### ACADEMY
K:
> “오늘 학원에서 뭐 배웠어?”

Child:
> “분수.”

Expected:
`SATISFIED`

### FRIEND
K:
> “누구랑 놀았어?”

Child:
> “민준이랑.”

Expected:
`SATISFIED`

### FOOD
K:
> “뭐 먹었어?”

Child:
> “떡볶이.”

Expected:
`SATISFIED`

### OUTING
K:
> “어디 다녀왔어?”

Child:
> “동묘.”

Expected:
`SATISFIED`

### SCHOOL
K:
> “오늘 어떤 수업이 제일 기억나?”

Child:
> “과학.”

Expected:
`SATISFIED`

### MOOD
K:
> “기분이 어땠어?”

Child:
> “속상했어.”

Expected:
`SATISFIED`

### PHYSICAL
K:
> “오늘 몸은 어땠어?”

Child:
> “피곤해.”

Expected:
`SATISFIED`

---

# 4. PARTIAL을 유지해야 하는 경우

질문 의도 일부만 충족되거나 실제 후속 정보가 필요한 경우다.

### 존재 여부만 답함

K:
> “새로 좋아하게 된 게 있어?”

Child:
> “응.”

Expected:
`PARTIAL`

이유:
“있다”는 것만 알았고 무엇인지 모름.

### 내용 없음

K:
> “친구랑 뭐 하고 놀았어?”

Child:
> “그냥.”

Expected:
`PARTIAL`

### 회피

K:
> “오늘 학원에서 뭐 배웠어?”

Child:
> “몰라.”

Expected:
`PARTIAL` 또는 정책상 `DECLINED`

### 질문 불일치

K:
> “줄넘기하면서 뿌듯했던 순간이 언제야?”

Child:
> “부루마불.”

Expected:
`PARTIAL` 또는 `SKIPPED`

### 정보 범주 불일치

K:
> “이번 달을 떠올리면 기분이 어때?”

Child:
> “서대문.”

Expected:
`PARTIAL`

---

# 5. 현실 정정 답변 처리

아이의 답변이 질문의 전제를 깨뜨리지만 현실을 정확히 정정하는 경우를 별도로 인정한다.

예:

K:
> “이번 주 학교에서 제일 기억에 남는 일은 뭐야?”

Child:
> “학교 안 가. 방학이야.”

현재:
`PARTIAL`

변경:
- 해당 SCHOOL 질문은 더 이상 반복하지 않도록 **Goal을 해결된 상태로 처리**
- 권장: `SATISFIED` 또는 별도 `RESOLVED_BY_CORRECTION` 내부 결과를 SATISFIED count에 반영
- 동일 질문을 다시 물어 아이를 답답하게 만들지 않는다.

다른 예:

K:
> “오늘 친구랑 학교에서 뭐 하고 놀았어?”

Child:
> “지금 방학이라 학교 안 갔어.”

→ 질문의 premise를 충분히 정정했으므로 반복 추궁 금지.

---

# 6. 학년별 판정 전략

## 초1~2

가장 관대하게 **핵심 명사/감정/행동 단어 자체를 정답으로 인정**한다.

예:

- `로블록스`
- `엄마`
- `떡볶이`
- `태권도`
- `속상해`
- `피곤해`
- `축구`
- `민준이`

위와 같은 한 단어 답변도 질문 intent를 직접 충족하면 SATISFIED.

문장형 답변을 요구하지 않는다.

---

## 초3~4

1~3어절 단답을 정상적인 답변으로 적극 인정한다.

예:

- `던지는 거`
- `일기랑 독서록`
- `친구랑 놀았어`
- `가족들이랑 사촌동생`
- `만화책`
- `방학이야`

질문이 요구한 정보가 있으면 SATISFIED.

---

## 초5~6

고학년이라고 장문을 강요하지 않는다.

예:

K:
> “요즘 제일 많이 하는 게임이 뭐야?”

Child:
> “발로란트.”

→ SATISFIED

다만 의견/이유 자체를 묻는 질문에서는 이유를 요구할 수 있다.

예:

K:
> “왜 그 게임이 좋아?”

Child:
> “로블록스.”

→ 이유에 답하지 않았으므로 PARTIAL.

---

# 7. Intent Unit 기반 판정

Assessor는 각 질문에서 “무엇을 얻으려는 질문인지”를 먼저 판별한다.

권장 intent unit:

```text
ENTITY
PERSON
PLACE
ACTIVITY
GAME_TITLE
FOOD
SUBJECT
EMOTION
PREFERENCE
YES_NO
REASON
EVENT
EXPERIENCE
CHOICE
CORRECTION
```

예:

```text
Q: "누구랑 갔어?"
required_intent = PERSON

A: "엄마랑"
→ PERSON 제공
→ SATISFIED
```

```text
Q: "왜 속상했어?"
required_intent = REASON

A: "속상했어"
→ EMOTION만 제공
→ REASON 미충족
→ PARTIAL
```

이렇게 **질문의 요구 정보 타입과 아이 답변의 정보 타입을 맞춰 판정**한다.

---

# 8. Follow-up과 Goal 판정을 분리

중요:

> **SATISFIED가 됐다고 대화를 즉시 끊을 필요는 없다.**

예:

K:
> “무슨 게임 했어?”

Child:
> “로블록스.”

Goal:
`SATISFIED`

Conversation:
> “오, 로블록스! 오늘은 무슨 맵 했어?”

즉:

```text
Goal satisfaction
≠
대화 종료
```

별은 정상적으로 올리고, Conversation Engine은 자연스럽게 1~2턴 follow-up을 이어갈 수 있다.

이 구조가 별 게이지와 대화 자연스러움을 동시에 해결한다.

---

# 9. Confidence 정책

현재:

```text
MIN_GOAL_CONFIDENCE = 0.5
```

이번 1차 수정에서는 **즉시 낮추지 않는다.**

이유:
- Root Cause 1은 판정 기준 자체
- threshold를 먼저 낮추면 질문과 무관한 답까지 통과할 위험

순서:

1. Assessor prompt / classification 기준 수정
2. DEV fixture 재검증
3. 명백한 정답이 여전히 `SATISFIED + confidence < 0.5`로 나오는지 측정
4. 그런 사례가 실제 남는 경우에만 confidence 정책 별도 검토

---

# 10. Multi-Goal 평가 정책

현재 openGoals 전체를 한 번에 평가하면서 유사 semantic group 사이에 판정이 분산될 가능성이 있다.

1차 원칙:

- `previous_prompted_goal_id`가 존재하면 **직전 K가 실제로 물은 Goal을 primary assessment target으로 명시**
- 다른 openGoals는 아이가 명백히 동시에 답한 경우 secondary로 평가
- primary goal의 direct answer를 유사 Goal들 때문에 낮은 confidence로 분산시키지 않는다.

예:

K가 `DIGITAL_CONTENT` Goal로
> “무슨 게임 했어?”

Child:
> “로블록스.”

→ `DIGITAL_CONTENT` primary SATISFIED가 우선.

`HOBBY`, `INTEREST` 등에 confidence를 쪼개면서 primary가 탈락하면 안 된다.

---

# 11. Assessor Prompt 필수 문구

새 system instruction에는 최소 다음 의미가 들어가야 한다.

```text
- 초등학생의 답변은 짧고 단순할 수 있다.
- 답변 길이 또는 문장 완성도를 SATISFIED의 조건으로 사용하지 마라.
- 아이가 질문이 요구한 핵심 정보 단위를 직접 제공했다면 한 단어 또는 짧은 구라도 SATISFIED로 판정할 수 있다.
- 더 자세한 이야기를 나눌 수 있다는 이유만으로 PARTIAL을 주지 마라.
- PARTIAL은 실제로 질문의 핵심 정보가 아직 빠졌을 때만 사용한다.
- 아이가 질문의 잘못된 전제를 현실 정보로 정정하면 해당 질문을 반복하지 않도록 해결된 답변으로 취급하라.
- 직전 prompted Goal을 primary target으로 우선 평가하라.
- 학년이 낮을수록 짧은 답변을 정상적인 의사표현으로 적극 인정하라.
```

---

# 12. DEV Unit Fixture — 필수

## 12.1 초1~2

| 질문 | 답변 | Expected |
|---|---|---|
| 무슨 게임 해? | 로블록스 | SATISFIED |
| 누구랑 놀았어? | 엄마랑 | SATISFIED |
| 뭐 먹었어? | 김밥 | SATISFIED |
| 기분 어때? | 좋아 | SATISFIED |
| 오늘 몸 어때? | 피곤해 | SATISFIED |
| 새로 좋아하는 거 있어? | 응 | PARTIAL |
| 뭐 하고 놀았어? | 몰라 | PARTIAL/DECLINED |

## 12.2 초3~4

| 질문 | 답변 | Expected |
|---|---|---|
| 야구 학원에서 뭐가 제일 재밌어? | 던지는 거 | SATISFIED |
| 무슨 숙제야? | 일기랑 독서록 | SATISFIED |
| 누구랑 갔어? | 가족들이랑 사촌동생 | SATISFIED |
| 어떤 책 좋아해? | 만화책 | SATISFIED |
| 학교에서 기억나는 일? | 학교 안 가고 방학이야 | RESOLVED/SATISFIED |
| 새로 좋아하는 거 있어? | 응 | PARTIAL |

## 12.3 초5~6

| 질문 | 답변 | Expected |
|---|---|---|
| 요즘 제일 많이 하는 게임? | 발로란트 | SATISFIED |
| 친구들이랑 뭐 했어? | 농구 | SATISFIED |
| 오늘 기분 어땠어? | 좀 짜증났어 | SATISFIED |
| 왜 짜증났어? | 짜증났어 | PARTIAL |
| 어떤 점이 재밌어? | 그냥 | PARTIAL |

---

# 13. Production False-Negative Regression Set

감사에서 발견된 실제 사례를 익명 fixture로 고정한다.

최소 다음은 regression test에 포함:

1. `던지는 거` → SATISFIED
2. `일기랑 독서록` → SATISFIED
3. `학교 안가고 방학이야` → 해결 처리
4. `가족들이랑 사촌동생` → SATISFIED
5. `친구랑 놀았어` → SATISFIED
6. `게임 유튜브 찍었어` → SATISFIED
7. `방학이라고?` → 문맥상 teacher statement 회상이라면 SATISFIED
8. `만화책` → SATISFIED
9. `응 많이 속상했어` → 감정 질문이면 SATISFIED
10. 질문과 무관한 `부루마불` → SATISFIED 금지

---

# 14. E2E 별 게이지 QA

## Scenario A — 5개 짧은 정답

Goal 질문에 아이가 다음처럼 답함:

```text
로블록스
엄마랑
떡볶이
태권도
속상했어
```

각 답이 각 질문의 intent를 충족하는 fixture라면:

```text
1번째 → 1/5
2번째 → 2/5
3번째 → 3/5
4번째 → 4/5
5번째 → 5/5 + COMPLETED
```

PASS:
- 별이 매 SATISFIED 후 즉시 증가
- DB conversation_goals와 API goalProgress 일치
- 5개에서 COMPLETED
- reward/event 기존 once-only 정책 유지

---

## Scenario B — PARTIAL 혼합

```text
Q1: 무슨 게임? → 로블록스      => SATISFIED
Q2: 새로 좋아하는 거? → 응     => PARTIAL
Q2 follow-up: 그게 뭐야? → 농구 => SATISFIED
```

PASS:
- `응`에서는 별 상승 없음
- `농구`에서 별 상승
- 동일 Goal 중복 보상 없음

---

## Scenario C — 현실 정정

```text
K: 오늘 학교에서 뭐 했어?
Child: 지금 방학이라 학교 안 가.
```

PASS:
- 같은 학교 질문 반복 금지
- Goal을 해결 처리
- 다음 생활 주제로 자연스럽게 이동

---

# 15. 완료 기준

다음이 모두 PASS면 완료:

- 질문 intent를 직접 충족한 1~3어절 아동 답변이 SATISFIED
- 길이가 짧다는 이유만으로 PARTIAL 금지
- 실제 정보가 빠진 `응/그냥/몰라`는 PARTIAL 유지
- 질문과 무관한 답은 SATISFIED 금지
- 현실 정정 답변 반복 추궁 금지
- 초1~6 fixture PASS
- Production false-negative regression 10건 PASS
- DB/API/UI 기존 정상 경로 유지
- `MIN_GOAL_CONFIDENCE = 0.5`는 1차 수정에서 유지
- Goal 10개 / SATISFIED 5개 완료 정책 유지
- 5/5 도달 시 reward/event once-only 정책 유지

---

# 16. 금지 사항

- 별을 쉽게 올리려고 모든 PARTIAL을 SATISFIED로 바꾸지 말 것
- confidence threshold부터 무작정 낮추지 말 것
- 한 글자라도 답하면 무조건 SATISFIED 처리하지 말 것
- 질문 intent와 무관한 답을 승인하지 말 것
- UI 게이지 코드를 원인처럼 수정하지 말 것
- DB reward/completion 정책 변경 금지
- 기존 10 Goal / 5 SATISFIED 완료 정책 변경 금지

---

# 17. 최종 UX 기준

아이에게는 다음처럼 느껴져야 한다.

> “케이가 물어본 거에 제대로 답했으면 별이 바로 오른다.”

그리고 동시에:

> “아무 말이나 해도 별이 오르는 건 아니다.”

즉 목표는 **쉬운 별**이 아니라 **공정한 별**이다.

초등학생의 자연스러운 짧은 말투를 정상 답변으로 인정하면서, 질문 의도는 정확히 지키는 판정기로 개선한다.
