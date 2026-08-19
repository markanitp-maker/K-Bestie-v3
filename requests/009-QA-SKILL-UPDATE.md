현재 있는 QA 스킬을 업데이트 한다.
# K PLAY QA SKILL — 끝말잇기 / 초성게임 / 넌센스퀴즈 전문 QA 기준

## 1. QA Skill의 역할

`K PLAY QA SKILL`은 단순히 “게임이 실행되는지” 확인하는 QA가 아니다.

이 Skill은 다음 역할을 동시에 수행한다.

```text
K PLAY QA SKILL
│
├─ COMMON PLAY QA
│   ├─ Skill Routing
│   ├─ Active Session
│   ├─ Stop / Topic Shift
│   ├─ STT / Voice
│   ├─ DB Persistence
│   ├─ Cross-Skill
│   └─ K Friend Experience
│
├─ WORD_CHAIN_QA
│   └─ 끝말잇기 전문 심판
│
├─ CHOSUNG_QA
│   └─ 초성게임 전문 심판
│
└─ NONSENSE_QA
    └─ 넌센스퀴즈 전문 심판
```

QA는 각 놀이의 규칙을 정확히 알고 있어야 하며 다음 세 가지를 별도로 판단한다.

```text
1. Rule Correctness
   게임 규칙 자체가 맞는가?

2. State Correctness
   이전 턴·문제·단어·Session을 정확히 기억하는가?

3. Friend Experience
   정확하게 게임하면서도 아이와 친구답게 놀고 있는가?
```

---

# 2. 모든 K놀이에 공통으로 적용할 절대 규칙

## 2-1. 아이 발화 우선순위

모든 Skill에서 다음 순서를 절대 기준으로 사용한다.

```text
Safety / 위험 발화
↓
Stop / 그만
↓
불만 / Frustration
↓
Topic Shift
↓
Skill Control
↓
Gameplay Input
```

따라서:

아이:
`그만`

을 게임 정답이나 끝말잇기 단어로 판정하면 즉시 FAIL.

아이:
`너 왜 똑같은 것만 내?`

를 오답으로 처리하고 다음 문제를 내면 즉시 FAIL.

아이:
`오늘 친구랑 싸웠어`

를 게임 입력으로 처리하면 즉시 FAIL.

---

## 2-2. Active Skill 규칙

한 아이는 동시에 하나의 K Play Skill만 Active 상태일 수 있다.

```text
CHOSUNG ACTIVE
+
WORD_CHAIN ACTIVE
```

금지.

```text
WORD_CHAIN ACTIVE
+
NONSENSE ACTIVE
```

금지.

PASS:

```text
ONE CHILD
→ MAX ONE ACTIVE PLAY SKILL
```

---

## 2-3. Gameplay Hard Guard

절대 규칙:

```text
NO ACTIVE SKILL SESSION
→ NO GAMEPLAY
```

DB/Session Manager에서 실제 게임 Session 생성이 확인되지 않았는데 Gemini가:

`좋아! 첫 문제!`

라고 게임을 시작하면 P0 FAIL.

---

## 2-4. Rule Engine과 Gemini 역할 분리

QA는 매 턴 다음을 확인한다.

### Rule Engine
결정해야 하는 것:

- 정답
- 오답
- 현재 차례
- 현재 문제
- 다음 문제
- 다음 단어
- 중복 여부
- Hint 단계
- 난이도
- Game State

### Gemini
담당:

- 친구다운 표현
- 짧은 리액션
- 장난
- 공감
- 자연스러운 말투

Gemini가 Conversation History를 보고 게임 Rule을 새로 추론하면 FAIL.

---

# 3. 공통 Session QA

## 3-1. Session 시작

검증:

```text
Skill 선택
→ Skill.start()
→ game_session 생성
→ Active 확인
→ 첫 Gameplay
```

순서여야 한다.

다음은 FAIL:

```text
첫 Gameplay
→ 뒤늦게 session 생성
```

---

## 3-2. Session 유지

게임 도중 다음이 유지되어야 한다.

- child_id
- chat_session_id
- game_session_id
- skill_id
- current round
- current turn
- difficulty
- used content

HTTP 요청이 매 턴 새로 들어와도 같은 Game Session이어야 한다.

---

## 3-3. 서버 재시작 / Cold Start

QA가 반드시 재현해야 한다.

```text
게임 시작
→ 5턴 진행
→ 서버 Context 재생성
→ 다음 Turn
```

PASS:

- 현재 게임 유지
- 현재 문제 유지
- 사용 문제 유지
- 현재 차례 유지

FAIL:

- 게임 처음부터 시작
- 방금 했던 문제 재출제
- K가 자기가 낸 단어를 모름

---

## 3-4. Session 종료

다음 모두 테스트한다.

- `그만`
- `안 할래`
- `다른 거 하자`
- UI 놀이 종료
- 정상 게임 종료
- 다른 Skill 선택
- Free Chat 화면 이탈
- stale session

종료 후:

```text
Active Skill = NONE
```

이어야 한다.

---

# 4. 음성 / STT 공통 QA

K놀이는 음성 기반이므로 텍스트 Unit Test만으로 PASS시키면 안 된다.

## 4-1. Final STT 기준

게임 정답 판정은 가능한 한 확정된 final utterance를 기준으로 한다.

partial transcript가:

```text
마네...
```

라고 들어왔다고 즉시 오답 처리하면 안 된다.

최종:

```text
마네킹
```

까지 기다려야 한다.

---

## 4-2. 자연어 속 정답

아이들은 정답만 또박또박 말하지 않는다.

QA 필수:

```text
마네킹
마네킹이야
마네킹 같은데
정답 마네킹
내가 마네킹이라고 했잖아
그러니까 마네킹이라고
```

게임별 Answer Candidate가 실제 핵심 답을 추출해야 한다.

---

## 4-3. 반복 STT

STT가:

```text
마네킹 마네킹
```

처럼 반복해도 동일 정답 하나로 처리해야 한다.

---

## 4-4. 잘못 들었을 때

확신할 수 없는 STT를 억지로 정답/오답 확정하지 않는다.

K:

`내가 잘 못 들었어. 한 번만 다시 말해줘!`

처럼 재확인할 수 있다.

단 동일 문구 무한 반복 금지.

---

## 4-5. Barge-in

K가 문제를 말하고 있는 중 아이가:

`그만!`

이라고 끼어들면 가능한 한 즉시 Gameplay 진행을 중단해야 한다.

`그만` 이후 다음 문제를 끝까지 말하고 또 문제를 내면 FAIL.

---

# 5. WORD_CHAIN_QA — 끝말잇기 전문 QA

## 5-1. 끝말잇기란 무엇인가

기본 구조는:

```text
K 단어
→ 그 단어의 마지막 음절
→ 아이가 그 음절로 시작하는 새 단어
→ 그 단어의 마지막 음절
→ K가 새 단어
→ 반복
```

이다.

끝말잇기는 일반적으로 앞 단어의 마지막 글자와 다음 단어의 첫 글자를 연결하는 말놀이지만 세부 허용 단어·두음법칙 등은 놀이마다 변형이 있으므로, K에서는 자체 Rule Contract를 하나로 고정해야 한다. citeturn245343search0turn245343search5

---

## 5-2. K 끝말잇기 고정 Rule Contract

### 기본 Rule

```text
previousWord.lastSyllable
=
nextWord.firstSyllable
```

또는 K에서 허용한 deterministic 두음법칙 변환과 일치해야 한다.

### 허용 단어

K Dictionary에 등록된 단어를 Source of Truth로 한다.

QA 확인:

- 일반 명사
- 음식
- 동물
- 학교생활
- 물건
- 장소
- 놀이
- 자연
- 초등 수준 어휘

### 고유명사

Dictionary에서 명시적으로 허용한 것만 인정.

### 1음절

Dictionary에 허용된 경우 인정.

### 활용형

임의 동사/형용사 활용형은 인정하지 않는다.

### 오타

fuzzy match로 자동 정답 인정하지 않는다.

---

# 6. 끝말잇기 두음법칙 QA

국립국어원의 한글 맞춤법에서는 단어 첫머리의 일부 `ㄴ/ㄹ` 계열 한자음에 두음법칙이 적용되는 규칙을 제10~12항에서 다룬다. citeturn303086search3turn303086search0

K에서는 LLM에게 이를 판단시키지 않는다.

```text
dueumRules()
```

또는 동등한 deterministic utility가 Source of Truth여야 한다.

QA Skill은:

1. 프로젝트에서 허용한 전체 dueum mapping fixture 조회
2. 모든 mapping 자동 테스트
3. direct 연결 가능 시 direct 연결 우선 여부 확인
4. 허용되지 않은 임의 변환 거절

을 수행한다.

중요:

QA Prompt 안에 임의로 두음법칙 전체 규칙을 새로 만들어 적용하지 않는다.

실제 K의 `dueumRules`와 국립국어원 규범에 근거해 검증한다.

---

# 7. 끝말잇기 필수 Rule Test

## 7-1. 정상 연결

예:

```text
바나나
→ 나비
```

PASS.

---

## 7-2. 잘못된 첫 음절

```text
바나나
→ 기차
```

FAIL 처리되어야 한다.

단 K는 아이를 혼내지 않는다.

---

## 7-3. 중복 단어

한 Game Session에서 이미 사용한 단어 재사용:

```text
바나나
...
바나나
```

중복으로 판정.

K 자신도 usedWords를 다시 사용하면 안 된다.

---

## 7-4. K도 같은 규칙 적용

아이에게만 규칙을 적용하면 안 된다.

QA는 매 K Turn마다:

```text
K selected word
→ dictionary valid?
→ chain valid?
→ not used?
→ dueum valid?
```

를 독립 검산한다.

하나라도 틀리면 FAIL.

---

# 8. 끝말잇기 Dictionary QA

현재 실제 아이 불만에서 가장 중요한 부분이다.

전 Dictionary를 자동 스캔한다.

검증:

- normalizedWord 중복
- alias 충돌
- 첫 음절
- 마지막 음절
- difficulty
- child-safe
- forbidden category
- 빈 문자열
- 비한글
- 이상한 공백
- 동일 단어 중복 등록

또한 실제 Transcript에서:

```text
“사전에 없는 단어야”
```

라고 K가 거절한 모든 child word를 추출한다.

그 후:

```text
실제로 정상적인 초등 어휘인가?
Dictionary에 왜 없는가?
```

를 별도 보고한다.

특히 실제 발생:

```text
유리
도둑
밥도둑
```

은 회귀 QA Fixture로 영구 등록한다.

---

# 9. 끝말잇기 K Candidate QA

K는 단순히 이어지는 단어 아무거나 고르면 안 된다.

Candidate:

```text
required syllable 일치
+
Dictionary valid
+
usedWords 제외
+
grade 적합
+
child-safe
+
가능하면 child가 이어갈 후속 단어 존재
```

QA는 K가 일부러 막다른 단어를 계속 선택하는지 확인한다.

K의 목적은 아이를 이기는 것이 아니다.

---

# 10. 끝말잇기 시작 단어 QA

현재 실제 문제처럼 항상:

```text
김치찌개
김치찌개
김치찌개
```

가 나오면 FAIL.

QA:

동일 child / 동일 grade로 신규 Game Session 20회 시작.

보고:

```text
시작 단어별 횟수
unique word count
가장 많이 나온 단어 비율
```

한 단어가 비정상적으로 집중되면 FAIL 또는 HIGH.

그리고 시작 단어는 아이가 이어갈 수 있는 후속 후보가 충분해야 한다.

---

# 11. 끝말잇기 Control Intent QA

Active WORD_CHAIN 중 다음을 반드시 테스트한다.

```text
끝말잇기 하자
다시 하자
처음부터 하자
초성게임 하자
넌센스 하자
그만
다른 거 하자
```

`끝말잇기 하자`에서 마지막 단어 `하자`를 Gameplay word로 처리하면 P0 FAIL.

---

# 12. 끝말잇기 장기 Soak Test

최소:

```text
G1
G3
G4
G6
```

대표 학년에서 50턴씩 진행한다.

검증:

- K rule violation
- child false reject
- duplicate
- current syllable loss
- turn loss
- session reset
- LLM hallucinated word
- stop handling

50턴 중 Rule Error 1건이라도 발생하면 FAIL.

---

# 13. CHOSUNG_QA — 초성게임 전문 QA

## 13-1. 초성게임이란 무엇인가

한글 단어의 각 음절에서 초성만 보여주고 원래 단어를 맞히는 말놀이다.

예:

```text
보드게임
↓
ㅂ ㄷ ㄱ ㅇ
```

초성퀴즈는 실제 초등 저학년 말놀이 수업에서도 끝말잇기와 함께 활용되고 있다. citeturn245343search44turn245343search49

Unicode에서도 현대 한글 음절은 leading consonant(L), vowel(V), 선택적 trailing consonant(T)로 구성되므로 초성 추출은 LLM 추측이 아니라 deterministic하게 처리할 수 있다. citeturn877057search5turn877057search10

---

# 14. 초성 생성 QA

초성은 반드시 코드가 생성한다.

Gemini에게:

`보드게임 초성 만들어줘`

라고 시키지 않는다.

QA Fixture 예:

```text
보드게임 → ㅂㄷㄱㅇ
도서관 → ㄷㅅㄱ
코끼리 → ㅋㅋㄹ
```

Question Bank 전체에 대해:

```text
stored chosung
==
deterministically generated chosung
```

인지 자동 검사한다.

---

# 15. 초성 문제 Source of Truth

각 문제에는 최소:

```text
question_id
answer
accepted_aliases
chosung
difficulty
grade range
category
hint_1
hint_2
```

가 있어야 한다.

현재 문제를 Gemini Conversation History에서 기억하면 안 된다.

---

# 16. 초성 문제 중복 QA

절대 조건:

```text
한 Game Session
→ 동일 question_id 재출제 0
```

문제는 아이가 정답을 맞힌 뒤가 아니라 아이에게 실제 제시되는 시점부터 `PRESENTED` 처리한다.

따라서:

```text
문제 출제
→ Topic Shift
```

가 발생했어도 같은 세션에서 바로 다시 나오면 안 된다.

---

# 17. 초성 Cross-Session 반복 QA

QA는 현재 Skill에 설정된 child별 cooldown 정책을 읽어 검증한다.

정책이 없다면:

```text
동일 Session 반복 차단은 필수
Cross-Session 반복 정책 없음
```

을 품질 Risk로 보고한다.

임의로 QA Skill이 30일/60일 같은 값을 만들어내지 않는다.

---

# 18. 초성 정답 QA

다음 전부 테스트한다.

```text
보드게임
보드 게임
보드게임이야
정답은 보드게임
내가 보드게임이라고 했잖아
```

accepted answer라면 모두 정답.

---

# 19. 초성 Hint QA

정상:

```text
문제
↓
아이 생각
↓
틀림 또는 Hint 요청
↓
Hint 1
↓
Hint 2
↓
Answer
```

첫 문제 발화와 동시에:

```text
ㅂㄷㄱㅇ이야!
주사위를 굴리고 판에서 하는 게임이야!
```

처럼 강한 힌트를 자동 누출하면 품질 FAIL.

힌트는 단계적으로 제공한다.

---

# 20. 초성 난이도 QA

학년별:

```text
Grade
→ Difficulty baseline
→ Adaptive Difficulty
```

를 확인한다.

QA는 각 학년에서:

- 너무 쉬운 문제만 반복
- 지나치게 어려운 문제만 반복
- 동일 category 연속
- 긴 단어만 연속

등을 분석한다.

---

# 21. 초성 성공/실패 Rhythm QA

K는 아이가 계속 못 맞히는데 난이도를 계속 높이면 안 된다.

예:

```text
3연속 어려움
→ STRUGGLING
→ 조금 쉬운 문제
```

반대로 계속 쉽게 맞히면 적당히 난이도를 높일 수 있다.

QA는 단순 정답률뿐 아니라 난이도 변화 흐름을 기록한다.

---

# 22. 초성 20문제 Soak QA

각 대표 학년에서 최소 20문제.

PASS:

- 중복 0
- 정답 오판 0
- 초성 생성 오류 0
- Question State 망각 0
- Hint 순서 오류 0
- Stop 무시 0

---

# 23. NONSENSE_QA — 넌센스퀴즈 전문 QA

## 23-1. 넌센스퀴즈란 무엇인가

넌센스/수수께끼는 단순 사실 문제와 다르다.

단어의 소리, 여러 의미, 표현의 비틀기, 상황 반전을 이용해 답을 찾는 언어놀이다.

아동 놀이 연구에서도 아이들은 놀이 속에서 언어를 변형·재구성하고 이를 서로 공유하며 소통한다. 수수께끼 역시 말장난과 언어 조작을 수용하는 놀이적 맥락을 만든다. citeturn303086search2turn303086search5

따라서 QA 기준도 일반 지식 퀴즈와 달라야 한다.

---

# 24. 넌센스 Question Bank 전수 QA

모든 ACTIVE 문제를 전수 검사한다.

필수:

```text
id
question
canonical_answer
accepted_answers
hint_1
hint_2
explanation
difficulty
min_grade
max_grade
category
pun_type
status
child_safe
```

검증:

- 빈 question 없음
- 빈 answer 없음
- duplicate question 없음
- normalized duplicate 없음
- grade 1~6
- difficulty 정상
- ACTIVE인데 child_safe=false 금지
- hint 없음 금지
- explanation 없음 금지
- REVIEW 문제 Production 사용 금지

---

# 25. 넌센스 정답 QA

예:

```text
문제:
매일 새 옷만 입고 서 있는 것은?

정답:
마네킹
```

필수 Fixture:

```text
마네킹
마네킹이야
마네킹이라고
옷 마네킹
그러니까 마네킹
마네킹이라고 마네킹
```

위와 같은 발화에서 핵심 정답이 명확하면 정답 처리해야 한다.

현재 실제 장애인 `마네킹` 사례는 영구 회귀 Fixture로 둔다.

---

# 26. 넌센스의 창의적 오답 처리

이 부분은 초성게임과 달라야 한다.

아이의 답이 공식 정답은 아니지만 꽤 재미있거나 말이 되는 경우:

K:

```text
“ㅋㅋ 그것도 웃긴데?
내가 생각한 답은 ○○였어!”
```

처럼 처리할 수 있다.

금지:

```text
“틀렸어.”
“아니야.”
```

라고 무조건 잘라 버린 뒤 정답을 우기는 방식.

Rule Engine상 결과는 INCORRECT일 수 있지만 Friend Experience에서는 아이의 언어유희를 인정할 수 있어야 한다.

---

# 27. 넌센스 정답 절대 번복 금지

다음은 P0.

```text
아이 정답
→ K 오답 처리
→ 아이 항의
→ K “사실 네가 맞았어”
```

QA는 Answer Validator 결과와 K 최종 발화가 일치하는지 검사한다.

```text
validator = CORRECT
K response contains “틀렸어”
```

즉시 P0.

---

# 28. 넌센스 180일 반복 방지 QA

현재 K 정책:

```text
동일 child
+
최근 출제 history
→ cooldown 동안 제외
```

NEW 문제를 최우선으로 사용한다.

QA:

```text
오늘 출제
다음 세션
다음날
최근 기간
```

에서 동일 question_id가 다시 나오지 않는지 검증한다.

cooldown 경계값은 Skill config를 Source of Truth로 사용한다.

현재 기본 정책이 180일이면 그 값을 그대로 테스트한다.

---

# 29. PRESENTED 기준 QA

아이에게 문제를 실제로 들려준 시점부터 사용 문제로 취급한다.

```text
K 문제 출제
→ 아이 “잠깐만, 다른 얘기할래”
```

이 문제를 다음 세션에서 바로 또 내면 안 된다.

---

# 30. 넌센스 Hint QA

힌트는 답을 바로 노출하지 않는다.

자동 검사:

```text
hint_1 contains canonical_answer
→ FAIL
```

그리고 사람이 이해하는 의미에서도 사실상 정답을 그대로 말하는 힌트인지 QA한다.

---

# 31. 넌센스 Explanation QA

정답 공개 후 설명은:

- 왜 그 답인지 이해 가능
- 너무 장황하지 않음
- 문제의 말장난 원리와 일치
- 새로운 거짓 설명 생성 금지

Gemini가 explanation 의미를 바꾸면 안 된다.

---

# 32. 아이가 K에게 넌센스 문제를 낼 때

K놀이는 일방향 문제풀이가 아니다.

아이:

```text
“이번에는 내가 문제 낼래.”
```

가능해야 한다.

QA:

```text
CHILD_AS_QUIZ_MASTER
```

전환 확인.

K는:

- 한 번 추측
- 모르겠으면 힌트 요청 가능
- 틀리면 친구답게 반응
- 아이가 알려준 답을 받아들임

단 아이가 낸 문제/정답을 자동으로 공식 Question Bank에 저장하면 안 된다.

---

# 33. 넌센스 안전성 QA

ACTIVE Question 전체에서 제외:

- 성적 소재
- 술/담배
- 욕설
- 외모 비하
- 장애 비하
- 인종/국가/지역 조롱
- 특정 아이 이름 조롱
- 지나친 폭력
- 성인 문화에 의존하는 농담

전수 데이터 QA 대상이다.

---

# 34. 넌센스 학년 QA

초1과 초6에게 동일 문제 조합만 제공하면 안 된다.

QA:

각 학년에서 20문제 selection simulation.

보고:

```text
difficulty distribution
category distribution
pun_type distribution
duplicate
grade violation
```

학년 범위를 벗어난 문제 1건이라도 나오면 FAIL.

---

# 35. Cross-Skill QA

세 Skill을 따로 잘 만드는 것만으로 부족하다.

반드시:

```text
초성 → 끝말잇기
끝말잇기 → 넌센스
넌센스 → 초성
```

전환을 테스트한다.

PASS:

```text
기존 Skill END
→ 새 Skill START
```

FAIL:

```text
두 Skill ACTIVE
```

---

# 36. 게임 → Free Chat QA

각 Skill 진행 중:

```text
“오늘 학교에서...”
“친구랑 싸웠어.”
“엄마한테 혼났어.”
“나 기분 안 좋아.”
```

테스트.

게임보다 현재 아이 이야기 우선.

다음 문제 자동 출제 금지.

---

# 37. Free Chat → 게임 QA

아이 직접 요청:

```text
초성게임 하자
끝말잇기 하자
넌센스 퀴즈 하자
```

정확한 Skill로 진입해야 한다.

잘못된 Skill 시작은 P0.

---

# 38. K놀이 모달 QA

각 버튼:

```text
초성게임
끝말잇기
넌센스 퀴즈
```

선택 결과와 실제 Active Skill이 1:1 일치하는지 확인한다.

예:

```text
UI = NONSENSE
DB Active = CHOSUNG
```

P0 FAIL.

---

# 39. Friend Experience QA

기계적 Rule QA와 별도로 검사한다.

### 금지

```text
정답입니다.
오답입니다.
다시 시도하세요.
```

를 계속 반복하는 교사식 진행.

### 권장

```text
“오 맞았어ㅋㅋ”
“아깝다! 힌트 줄까?”
“ㅋㅋ 그것도 웃긴데?”
```

단 자연스러움보다 Rule 정확성이 먼저다.

---

# 40. 반복 말투 QA

최근 K 발화 N개를 비교한다.

동일 또는 거의 동일한:

```text
“그럼 우리 이어서 초성게임 마저 해볼까?”
```

가 연속적으로 반복되면 품질 FAIL.

보고:

```text
duplicate response count
near-duplicate response count
```

---

# 41. 실제 장애 Replay QA

오늘 발견된 실제 문제들은 반드시 Regression Fixture가 된다.

최소:

### Nonsense
```text
마네킹
그러니까 마네킹이라고
```

### Word Chain
```text
유리
밥도둑
끝말잇기 하자
```

### Chosung
```text
보드게임 정답 후 동일 ㅂㄷㄱㅇ 재출제
도서관 정답 후 동일 ㄷㅅㄱ 재출제
```

### Stop
```text
게임 방법부터 제대로 학습해
```

이후 자동 Gameplay 재시작 여부.

이 실제 장애가 한 번이라도 다시 발생하면 Production 후보 FAIL.

---

# 42. QA 실행 레벨

## LEVEL 1 — Static QA

매 변경마다.

- Question Bank
- Dictionary
- duplicates
- aliases
- grade
- difficulty
- metadata
- dueum fixtures
- chosung generation

---

## LEVEL 2 — Rule Engine QA

LLM 없이 deterministic 테스트.

### WORD_CHAIN
최소 100개 chain validation.

### CHOSUNG
전체 Question Pool 초성 생성 검산.

### NONSENSE
전체 ACTIVE answer/alias validator 검사.

---

## LEVEL 3 — Conversation Simulation

실제 자연어 child utterance 사용.

각 Skill 최소:

```text
정답
오답
긴 문장 속 정답
STT 반복
모르겠어
힌트
불만
그만
Topic Shift
재시작
```

---

## LEVEL 4 — Voice E2E

실제 Dev 음성 흐름.

대표 학년:

```text
G1
G3
G4
G6
```

각 게임 수행.

STT → Router → Rule → DB → K Response → TTS 전체 검증.

---

## LEVEL 5 — Soak QA

각 Skill 최소 50턴.

목적:

- 상태 유실
- 중복
- 반복 문구
- 난이도 이상
- Session 꼬임

탐지.

---

## LEVEL 6 — Restart / Failure QA

- server cold start
- DB temporary failure
- LLM failure
- TTS failure
- STT ambiguity
- network reconnect

이후 State consistency 확인.

---

# 43. Severity 기준

## P0 / BLOCKER

한 건이라도 Production 불가.

- 맞는 답을 틀렸다고 함
- 틀린 답을 맞았다고 함
- K Rule 위반
- 현재 문제 망각
- 현재 차례 망각
- Active Session 없는 Gameplay
- 두 Skill 동시 Active
- 그만 무시
- Topic Shift 무시 후 게임 강행
- 방금 한 문제 즉시 반복
- Session State 유실

## P1 / HIGH

- 정상 기본 단어 거절
- 시작 단어 심각한 편중
- 게임 명령을 answer/word로 오인
- Hint 즉시 누출
- Free Chat fallback으로 Gameplay 붕괴

## P2 / MEDIUM

- 동일 말투 반복
- 지나친 교사 말투
- 난이도 리듬 불량
- category 반복
- 어색한 조사

## LOW

- 사소한 표현
- 작은 UI 문구
- 놀이 결과에 영향 없는 스타일 오류

---

# 44. Production Gate

K놀이를 다시 Production에 열기 위한 조건:

```text
Static QA PASS
+
Rule QA PASS
+
Conversation QA PASS
+
Voice E2E PASS
+
50-turn Soak PASS
+
실제 장애 Replay PASS
+
BLOCKER 0
HIGH 0
MEDIUM 0
+
대표님 Owner QA PASS
```

하나라도 실패하면 Production 재활성화 금지.

---

# 45. QA Skill 최종 보고 형식

QA 실행 후 반드시:

```text
[K PLAY QA RESULT]

환경:
Commit:
검사 시각:

COMMON PLAY:
PASS / FAIL

WORD_CHAIN:
PASS / FAIL

CHOSUNG:
PASS / FAIL

NONSENSE:
PASS / FAIL

VOICE/STT:
PASS / FAIL

SESSION/PERSISTENCE:
PASS / FAIL

CROSS-SKILL:
PASS / FAIL

실제 장애 Replay:
PASS / FAIL

BLOCKER:
HIGH:
MEDIUM:
LOW:

대표 시나리오 총:
PASS:
FAIL:

Production Ready:
YES / NO
```

문제가 있으면 각각:

```text
[ISSUE]

Severity:
Skill:
Session:
Turn:
Child utterance:
K response:

Expected:
Actual:

Rule violated:
Source of Truth:

관련 파일:
관련 함수:
관련 DB state:

재현 방법:
```

형식으로 보고한다.

---

# 46. QA Skill이 절대 하면 안 되는 것

QA Skill은 검사와 판정 역할이다.

QA 과정에서 임의로:

- 코드 수정
- Dictionary 수정
- DB 수정
- 문제 삭제
- Prompt 수정
- migration
- Production 변경
- Production 배포

하지 않는다.

문제를 발견하면 정확한 재현 정보만 개발자에게 전달한다.

---

# 47. 최종 QA 철학

K Play QA의 최종 질문은 하나다.

```text
“게임 알고리즘이 동작했는가?”
```

가 아니라:

```text
“초등학생 친구가 실제 사람 친구와 놀 때 기대하는
규칙의 정확성, 기억, 다양성, 통제권을
K가 끝까지 지켰는가?”
```

이다.

Rule이 틀리면 친구로서 신뢰가 깨지고,
방금 한 문제를 다시 내면 기억 못 하는 친구가 되며,
그만하라고 했는데 계속하면 같이 놀고 싶지 않은 친구가 된다.

따라서 K놀이 QA 우선순위는:

```text
정확성
→ 기억/상태
→ 아이 통제권
→ 반복 방지
→ 재미
→ 말투
```

순서로 평가한다.