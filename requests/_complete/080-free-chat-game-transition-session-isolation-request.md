# 080 — Free Chat Game Transition & Session Isolation Improvement Request
## 박서아 Production 사고 기반 끝말잇기/초성게임 전환·세션 격리·게임 집중도 개선

> 목적: 자유대화 놀이 중 한 게임이 ACTIVE인 상태에서 다른 게임으로 잘못 전환되거나, 이전 게임 세션이 다음 게임 입력을 가로채거나, 일반 Memory/Relationship 화제가 게임 흐름을 깨는 문제를 제거한다.

---

# 0. Production Incident — 기준선

## 사용자
- Child: 박서아
- Child ID: `2f98d390-e690-452d-8cd2-8e1f9cac09f9`
- 학년: 초4

## 사건 Session
- Session ID: `7acc0330-efcb-40b5-a49a-3332544466d3`
- `session_type = free_chat`
- 2026-08-16 23:00:34 KST 시작

## 실제 사건 요약

### 1. 초성게임 시작
아이:
> “끝말잇기나 아니면은 초성 퀴즈 이런 거 할 수 있어”

Router:
- `hasChosungGameStart = true`
- 실제 `chosung_game_sessions` 생성

K:
> “초성 퀴즈 완전 좋지!...”

### 2. 초성게임 도중 일반 잡담으로 이탈
K:
> “오늘 킨텍스 다녀왔다고 했잖아. 어땠어?”

문제:
- 초성게임 session은 DB상 여전히 ACTIVE
- 그러나 대화 표면상 일반 자유대화로 이탈

### 3. 아이가 명시적으로 다른 게임 요청
아이:
> “끝말잇기하자”

기대:
```text
CHOSUNG end
→ WORD_CHAIN start
→ active_game = WORD_CHAIN
```

실제:
- 기존 CHOSUNG active session이 먼저 잡힘
- WORD_CHAIN `start()` 호출되지 않음
- `word_chain_game_sessions` 생성 0
- 일반 LLM이 자연어로 끝말잇기하는 척함

K:
> “좋아, 끝말잇기 재밌겠다! 그럼 나부터 시작할게, ‘킨텍스’!”

### 4. 끝말잇기 단어가 이전 초성게임으로 잘못 처리
아이:
> “스위스”

실제 Backend:
- `detectChosungAnswerAttempt("스위스") === true`
- 이전 CHOSUNG active session으로 라우팅
- 초성게임 오답 횟수 증가
- 다음 문제 `"ㄱㅊ"` 생성

최종 K:
> “‘스’로 시작하는 단어구나! ‘스위스’ 다음엔 ‘스케이트’ 어때? 다음 초성은 ‘ㄱㅊ’야!”

사용자에게는:
> **끝말잇기를 하다가 갑자기 초성게임으로 넘어간 것처럼 보임**

실체:
> WORD_CHAIN backend session은 한 번도 시작되지 않았고, 이전 CHOSUNG session이 끝말잇기 입력을 가로챘다.

---

# 1. Root Cause — 확정

## RC1 — Game Transition 우선순위 부재 — CONFIRMED

현재 Router는:

```text
기존 active session 탐색
→ active skill 우선 처리
→ 새 게임 직접 요청
```

에 가까운 구조로 동작한다.

따라서:

```text
CHOSUNG ACTIVE
+
아이: "끝말잇기하자"
```

에서도 기존 CHOSUNG이 먼저 잡혀 WORD_CHAIN start가 막힌다.

### 수정 원칙

**직접적인 게임 변경 요청은 기존 active game보다 우선해야 한다.**

---

## RC2 — ACTIVE Game 중 일반 대화 화제 전환 가능 — CONFIRMED

초성게임이 ACTIVE인데 K가:

> “오늘 킨텍스 다녀왔다고 했잖아. 어땠어?”

라고 일반 Memory 화제로 빠졌다.

문제는 “초성 세션이 살아있다” 자체가 아니라:

> **ACTIVE game을 유지한 채 일반 free-chat topic으로 이탈할 수 있다는 것**

이다.

### 수정 원칙

ACTIVE game 중에는:
- Memory
- Relationship Context
- Scenario Card
- 일반 친해지기 화제

가 **새로운 대화 주제로 게임을 깨면 안 된다.**

Memory는 게임을 풍부하게 만드는 용도로만 사용할 수 있다.

---

## RC3 — Generic Answer Detector의 Cross-Game False Positive — CONFIRMED / 방어 필요

`"스위스"`는 끝말잇기 단어였으나 초성게임 answer attempt로 탐지되었다.

근본적으로 RC1이 정상이라면 WORD_CHAIN session이 active였기 때문에 이 사고는 막혔어야 한다.

그러나 방어선으로:

> **현재 active game 이외의 다른 게임 answer detector가 사용자 입력을 가로채지 못하도록 제한한다.**

---

# 2. 추가 품질 문제

## 2.1 초성 힌트 정합성 오류

정답:
> `배드민턴`

그런데 K 힌트:
> “아이템 뺏고 뺏기는 카트 타는 게임”

처럼 카트라이더에 가까운 엉뚱한 힌트가 생성됨.

### 문제

게임 state가 정상이어도:
- 정답
- 초성
- 힌트

사이에 의미적 계약이 깨질 수 있다.

### 요구

힌트는 반드시 현재 정답과 의미적으로 일치해야 한다.

---

## 2.2 게임 턴 소유권 혼선

끝말잇기처럼 보이던 상황에서:

아이:
> “스위스”

K:
> “스케이트 어때?”

까지 이어버리면서 K가 다음 단어를 대신 진행하고, 동시에 초성 퀴즈까지 제시했다.

### 요구

각 게임은:
- 누구 차례인지
- 현재 round가 무엇인지
- 다음 입력이 무엇이어야 하는지

를 명시적으로 state로 관리해야 한다.

---

# 3. 제품 불변식 — 반드시 강제

## Invariant 1 — Single Active Game

한 child / 한 free_chat session 기준:

```text
active_game_count <= 1
```

동시에 2개 이상의 game session ACTIVE 금지.

---

## Invariant 2 — Explicit Transition Wins

아이의 발화가 다른 게임으로의 **명시적 전환 요청**이면:

```text
old_game.end()
→ new_game.start()
→ active_game = new_game
```

순서로 처리한다.

예:

```text
CHOSUNG active
아이: "끝말잇기하자"
```

결과:

```text
CHOSUNG ended_at != null
WORD_CHAIN session created
active_game = WORD_CHAIN
```

---

## Invariant 3 — Active Game Stickiness

사용자가:
- 게임 종료
- 다른 게임 시작
- 명시적 일반대화 전환

을 요청하지 않는 한 현재 game을 유지한다.

---

## Invariant 4 — Cross-Skill Input Capture 금지

`active_game = WORD_CHAIN`이면:
- CHOSUNG answer detector
- 다른 놀이 skill detector

가 일반 단어 입력을 가로채지 못해야 한다.

반대도 동일.

---

## Invariant 5 — Game Focus

ACTIVE game 중:
- relationship memory
- episodic memory
- scenario card

가 **새 주제를 시작하는 instruction을 생성하지 못해야 한다.**

허용 예:

> “지난번에 로블록스 좋아한다고 했지? 이번 끝말잇기 단어는 ‘로봇’ 어때?”

단, 실제 게임 규칙을 깨지 않아야 한다.

금지 예:

> 초성게임 도중 “오늘 킨텍스 다녀왔다고 했잖아. 어땠어?”

---

# 4. Router 우선순위 재정의

권장 우선순위:

```text
1. 명시적 게임 종료 요청
2. 명시적 다른 게임 전환 요청
3. 현재 ACTIVE game turn
4. 새 게임 시작 요청
5. 일반 자유대화
```

중요:

```text
getActiveSession()
```

이 무조건 첫 단계가 되어서는 안 된다.

---

# 5. Transition 처리 설계

의사코드:

```ts
const directIntent = detectDirectGameControlIntent(utterance);

if (directIntent.type === "END_GAME") {
  await endActiveGame(...);
  return buildGameExitResult(...);
}

if (directIntent.type === "SWITCH_GAME") {
  const active = await getActiveGame(...);

  if (active && active.gameType !== directIntent.targetGame) {
    await endGame(active);
  }

  return startGame(directIntent.targetGame, ...);
}

const active = await getActiveGame(...);

if (active) {
  return active.skill.handleTurn(...);
}

if (directIntent.type === "START_GAME") {
  return startGame(directIntent.targetGame, ...);
}

return freeChat(...);
```

---

# 6. Atomic Transition

다음 상태는 금지:

```text
CHOSUNG ended
WORD_CHAIN start 실패
→ active game 없음
```

또는:

```text
CHOSUNG active
WORD_CHAIN active
→ 2개 동시 ACTIVE
```

권장:

- transaction 또는 equivalent safe transition
- 실패 시 deterministic recovery
- transition result를 server-side에서 검증

최종 조건:

```text
exactly 0 or 1 active game
```

---

# 7. 명시적 게임 제어 Intent

최소 다음 표현을 direct control로 인식한다.

## SWITCH / START WORD_CHAIN
- 끝말잇기 하자
- 끝말잇기로 바꾸자
- 끝말잇기 하고 싶어
- 우리 끝말잇기해
- 이제 끝말잇기

## SWITCH / START CHOSUNG
- 초성게임 하자
- 초성퀴즈 하자
- 초성게임으로 바꾸자
- 초성 문제 내줘

## END
- 그만하자
- 게임 그만
- 이제 안 할래
- 다른 얘기하자
- 그냥 얘기하자

Context를 고려하되, **직접 요청을 active game보다 낮은 우선순위로 두지 않는다.**

---

# 8. Answer Detector Scope

현재 문제:

```text
detectChosungAnswerAttempt("스위스") === true
```

### 변경 원칙

Answer detector는 global router에서 독립적으로 모든 입력을 잡는 detector가 아니다.

권장:

```text
if (active_game === CHOSUNG) {
  detectChosungAnswerAttempt()
}

if (active_game === WORD_CHAIN) {
  detectWordChainAnswer()
}
```

즉:
> **active game scope 안에서만 answer detection**

---

# 9. Memory / Relationship / Scenario Composition

ACTIVE game인 경우 prompt composition에 game mode를 최상위 constraint로 넣는다.

예:

```text
[ACTIVE PLAY MODE]
game=WORD_CHAIN
Do not change topic or start another game unless the child explicitly requests it.
Relationship/memory context may only support the current game and must not introduce unrelated topics.
```

### Memory 사용 허용

- 게임 단어 추천에 아이 취향 반영
- 게임 난이도 조절
- 친숙한 이름/관심사를 힌트에 활용

### Memory 사용 금지

- 현재 게임을 끊고 과거 에피소드 질문
- 별도 친해지기 질문으로 전환
- 다른 놀이 제안

---

# 10. Word Chain 전용 규칙

끝말잇기가 시작되면 DB state가 반드시 생성되어야 한다.

최소 저장:

```text
game_type = WORD_CHAIN
status = ACTIVE
current_turn_owner
last_word
required_start_syllable
round_count
started_at
ended_at
```

K의 자연어 대화만으로 “끝말잇기처럼 보이는 상태”를 만들면 안 된다.

### 핵심

```text
K가 "끝말잇기 시작하자"라고 응답했다면
backend WORD_CHAIN session이 ACTIVE여야 한다.
```

응답과 backend state 불일치 금지.

---

# 11. Chosung Game 전용 규칙

최소:
- current_word
- current_chosung
- hint_level
- wrong_count
- turn owner / mode
- round number

을 session SSOT로 사용.

### 힌트

LLM에게 정답만 주고 자유롭게 힌트를 만들게 하지 않는 방향을 우선 검토.

최소한:

```text
answer = 배드민턴
allowed_hint_facts = [
  "라켓을 사용한다",
  "셔틀콕을 친다",
  "두 명 또는 네 명이 경기할 수 있다"
]
```

같은 structured fact 기반이 안전하다.

---

# 12. Hint Consistency Guard

DEV에서 최소 다음 검증:

```text
answer: 배드민턴
hint: 카트 / 아이템 뺏기 / 레이싱
```

→ FAIL

```text
answer: 배드민턴
hint: 라켓 / 셔틀콕 / 체육관
```

→ PASS

정답과 의미적으로 모순되거나 다른 게임/사물을 설명하는 힌트는 생성 금지.

---

# 13. 박서아 Production Incident Regression Test

## Scenario 1 — 핵심 재현

```text
1. Child: "초성게임 하자"
2. CHOSUNG session ACTIVE 확인
3. 초성게임 1~2 round 진행
4. Child: "끝말잇기하자"
5. 기존 CHOSUNG ended 확인
6. WORD_CHAIN ACTIVE 생성 확인
7. K: "킨텍스"
8. Child: "스위스"
```

PASS:

```text
active CHOSUNG = 0
active WORD_CHAIN = 1
"스위스" = WORD_CHAIN input
response instruction contains WORD_CHAIN
response instruction does not contain CHOSUNG
"ㄱㅊ" 초성게임 문제 등장 0
```

---

# 14. 추가 Regression Tests

## Scenario 2 — 같은 게임 유지

```text
CHOSUNG active
Child: "힌트 줘"
```

PASS:
- CHOSUNG 유지
- 다른 skill start 0

## Scenario 3 — 명시적 일반대화

```text
WORD_CHAIN active
Child: "게임 그만하고 오늘 학교 얘기하자"
```

PASS:
- WORD_CHAIN end
- Free Chat 정상 전환

## Scenario 4 — 일반 단어 입력

```text
WORD_CHAIN active
Child: "스위스"
```

PASS:
- CHOSUNG detector 실행/반영 0

## Scenario 5 — 초성 답

```text
CHOSUNG active
Child: "배드민턴"
```

PASS:
- CHOSUNG answer 처리

## Scenario 6 — Zombie DB residue

기존 historical CHOSUNG ACTIVE residue가 존재하지만 사용자가:

```text
"끝말잇기하자"
```

PASS:
- 기존 CHOSUNG 종료
- WORD_CHAIN start
- stale game이 새 게임을 가로채지 못함

## Scenario 7 — Memory isolation

```text
WORD_CHAIN active
Memory: 오늘 킨텍스 방문
```

PASS:
- K가 독립적으로 “킨텍스 어땠어?” 화제로 이탈하지 않음

## Scenario 8 — Hint consistency

```text
answer = 배드민턴
```

PASS:
- 카트라이더/레이싱 계열 힌트 없음

---

# 15. DB / State Invariant Tests

동일 child/session에 대해:

```sql
active game sessions count <= 1
```

게임 전환 직후:

```text
old.ended_at != null
new.ended_at == null
```

그리고:

```text
K response game mode == backend active game
```

를 항상 검증.

---

# 16. Error / Recovery

## new game start 실패

기존 game을 종료한 뒤 새 game 생성 실패 시:
- generic LLM이 새 게임을 하는 척하면 안 됨
- 명시적인 안전한 오류 처리
- retry 가능
- active state와 화면 응답 불일치 금지

## reconnect

Client reconnect 후:
- DB active game을 복원
- 동일 session이면 game continuity 유지
- 이전에 종료된 게임을 active로 부활시키지 않음

---

# 17. Logging / Observability

각 play turn에 최소 로그:

```text
child_id
chat_session_id
utterance
direct_game_intent
active_game_before
router_selected_skill
transition_action
active_game_after
game_session_id
play_instruction_type
```

목적:
“왜 이 턴이 초성으로 갔는지”를 즉시 재현 가능하게 한다.

---

# 18. Production Migration 원칙

- 박서아 historical 대화 메시지 수정 금지
- 기존 historical game log 삭제 금지
- 정상 active session을 일괄 종료하는 migration 금지
- 새로운 Router 동작은 DEV 검증 후 Production
- schema change가 필요하면 backward compatible
- 기존 Free Chat/Reward 로직에 영향 금지

---

# 19. 성공 기준

다음 모두 PASS:

- 명시적 새 게임 요청이 기존 active game보다 우선
- old game → new game 전환 성공
- 동시 active game 2개 발생 0
- WORD_CHAIN 시작 발화와 backend session 불일치 0
- CHOSUNG이 WORD_CHAIN 단어 가로채는 현상 0
- ACTIVE game 중 Memory가 무관한 새 화제로 이탈시키는 현상 0
- 정답과 무관한 초성 힌트 생성 0
- reconnect 후 active game continuity 정상
- 박서아 regression scenario PASS

---

# 20. 금지 사항

- 프롬프트에 “다른 게임으로 넘어가지 마” 한 줄만 추가하고 종료 금지
- LLM에게 현재 game state를 추측하게 하지 말 것
- global generic answer detector가 active game scope를 무시하게 두지 말 것
- 두 game session을 동시에 ACTIVE로 허용하지 말 것
- K가 게임 시작했다고 말했는데 backend game session이 없는 상태 허용 금지
- Memory/Relationship이 ACTIVE game보다 높은 대화 우선순위를 갖지 못하게 할 것
- historical 박서아 데이터 수동 수정으로 문제를 덮지 말 것

---

# 21. 완료 정의

```text
Explicit game control intent
→ deterministic router transition
→ exactly one active game
→ scoped answer detector
→ game-focused prompt composition
→ backend state와 K 발화 일치
→ 박서아 사고 재현 불가
```

최종 UX:

> 아이가 초성게임을 하다가 “끝말잇기하자”고 하면 K는 확실하게 끝말잇기로 바뀐다.  
> 그 뒤 “스위스”라고 말하면 오직 끝말잇기 단어로 처리한다.  
> 이전 초성게임이나 기억 화제가 중간에 끼어들지 않는다.
