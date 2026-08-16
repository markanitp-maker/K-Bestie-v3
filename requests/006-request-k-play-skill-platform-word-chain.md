# K Play Skill Platform 및 끝말잇기(WORD_CHAIN) Skill 구축

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- K가 자유대화 중 아이에게 자연스럽게 놀이를 제안할 수 있다.
- “심심해”, “놀아줘”, “뭐 하고 놀까?”처럼 특정 놀이를 지정하지 않은 경우 `PLAY_PROPOSAL`이 현재 available Skill 중 적절한 놀이를 제안한다.
- “초성게임 하자”, “끝말잇기 하자”처럼 특정 놀이를 직접 요청하면 제안 단계를 거치지 않고 해당 Skill로 바로 진입한다.
- 초성게임과 끝말잇기는 각각 독립 Skill Module로 동작한다.
- 향후 스무고개, 밸런스게임, 수수께끼 등 새 놀이를 추가할 때 K Conversation Engine 핵심을 거의 건드리지 않고 Skill Registry에 새 모듈을 등록하는 방식으로 확장 가능하다.
- K Core Persona, Grade Persona, Relationship Context, 4-tier Memory, Safety, Conversation Health는 모든 Skill에서 동일하게 유지된다.
- 게임 규칙, 상태, 난이도, Session Manager, K Play Brain, Recovery는 각 Skill이 독립적으로 소유한다.
- 끝말잇기는 한 판 시작 시 `WORD_CHAIN_SKILL.start()` 1회 → 같은 active game session에서 `handleTurn()` 여러 회 → 종료 시 `end()` 1회 구조로 동작한다.
- HTTP 요청이 턴마다 새로 들어와도 게임 상태는 동일 game session에 유지되어 매번 새 게임을 시작하지 않는다.
- 끝말잇기 단어 유효성, 두음법칙, 중복 단어, 연결 규칙, K의 다음 단어 선택은 deterministic code가 담당한다.
- Gemini는 이미 확정된 game result와 K word를 받아 학년/관계 맥락에 맞는 자연스러운 리액션만 생성한다.
- WORD_CHAIN은 약 3,000개 규모의 아동용 Static Dictionary를 Runtime Source of Truth로 사용한다.
- 아이가 사전에 등록된 어려운 단어를 말하면 학년과 무관하게 인정하고, K가 선택하는 단어에만 학년별 난이도 baseline을 적용한다.
- 게임 중 아이가 다른 이야기, 속상한 이야기, 화난 이야기, Safety 관련 이야기로 전환하면 게임보다 현재 아이 발화를 우선하고 동일 free_chat session의 일반 대화로 복귀한다.
- 앱 종료/네트워크 단절로 한 판이 중단되어도 Skill 자체는 계속 사용 가능하며, 중단되는 것은 현재 game session instance뿐이다.
- CHOSUNG과 WORD_CHAIN이 동시에 active 되지 않는다.
- stale active session 때문에 새 게임 시작이 영구 차단되지 않는다.
- 기존 CHOSUNG 내부 규칙과 구현을 불필요하게 generic Game Engine으로 리팩터링하지 않는다.
- Owner QA 전까지 Production 코드·DB·env에는 아무 변경도 하지 않는다.

### 대표님 테스트 정상 프로세스
1. Development 자유대화에 QA 계정으로 접속한다.
2. “심심해”, “놀아줘”, “뭐 하고 놀까?”라고 말한다.
3. K가 현재 사용 가능한 놀이를 자연스럽게 제안하는지 확인한다.
4. “싫어”, “안 할래”라고 거절한 뒤 같은 세션에서 K가 반복 제안하지 않는지 확인한다.
5. 이후 아이가 직접 “끝말잇기 하자”라고 하면 즉시 WORD_CHAIN으로 진입하는지 확인한다.
6. “초성게임 하자”라고 하면 기존 CHOSUNG으로 직접 진입하는지 확인한다.
7. 끝말잇기를 시작해 최소 10턴 이상 이어간다.
8. 정상 연결, 중복 단어, 두음법칙, 1음절 단어, 등록된 외래어/고유명사, 사전에 없는 단어를 각각 테스트한다.
9. 동일한 단어를 실제 대화 맥락에서 다시 사용했을 때 usedWords 규칙이 정확한지 확인한다.
10. G1~G2와 G5~G6 QA 계정에서 K가 선택하는 단어 난이도가 달라지는지 확인한다.
11. 저학년 아이가 어려운 유효 단어를 말해도 정답으로 인정되는지 확인한다.
12. 게임 중 “오늘 학교에서 친구랑 싸웠어” 같은 일반/감정 발화를 입력한다.
13. 이를 게임 오답으로 처리하지 않고 같은 chat_session의 일반 자유대화로 복귀하는지 확인한다.
14. 끝말잇기 도중 앱 이탈/연결 중단을 재현한다.
15. 재접속 시 Skill 자체는 계속 사용 가능하고, resume 가능 상태면 이어지며 stale 상태면 새 게임을 정상 시작할 수 있는지 확인한다.
16. CHOSUNG active 상태에서 WORD_CHAIN 진입을 시도하고, 반대 방향도 시도한다.
17. 한 아이에게 active game session이 동시에 2개 생기지 않는지 확인한다.

PASS 기준:
- 특정 놀이를 지정하지 않은 경우에만 PLAY_PROPOSAL이 동작한다.
- 특정 놀이를 직접 요청하면 해당 Skill로 바로 진입한다.
- Safety / 부정감정 / 갈등 / 진지한 Topic이 놀이 제안보다 우선한다.
- CHOSUNG과 WORD_CHAIN은 독립 Skill로 동작한다.
- WORD_CHAIN은 START 1회 → HANDLE TURN 여러 회 → END 1회 구조다.
- 게임 상태가 같은 game session에 누적 유지된다.
- 단어 판정과 K 다음 단어 선택은 deterministic이다.
- Gemini가 사전에 없는 단어를 게임 규칙상 새로 만들어내지 않는다.
- Topic Shift 시 게임보다 현재 아이 발화가 우선한다.
- active Skill이 동시에 2개 존재하지 않는다.
- 중단된 game session 때문에 Skill 자체가 사용 불가능해지지 않는다.
- 기존 CHOSUNG/Free Chat에 회귀가 없다.
- Production 변경 없이 Development 검증 상태로 종료한다.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 기능 요청
- 우선순위: HIGH
- 대상 프로젝트: `/mnt/e/VibeCoding/K-Bestie-v3`
- 개발 주체: K-Bestie-v3 메인 앱 Claude Code
- 적용 대상: K Conversation Engine 놀이 제안/라우팅 계층, 기존 CHOSUNG 연동, 신규 WORD_CHAIN Skill
- 신규 핵심 개념: `PLAY_PROPOSAL`, `PLAY_SKILL_ROUTER`, `PLAY_SKILL_REGISTRY`, `WORD_CHAIN_SKILL`
- 기존 유지 대상: CHOSUNG 내부 Rules / Session Manager / Adaptive Difficulty
- 공통 유지 대상: K Core Persona, Grade Persona, Relationship Context, 4-tier Memory, Safety, Conversation Health, Response Generator
- 제외: Mission Goal Layer, Gemini 모델 교체, STT provider 정책 변경, 기존 CHOSUNG 대규모 리팩터링
- 배포 원칙: Development 구현 및 QA 우선
- 최종 상태: `WAITING_FOR_OWNER_QA`

## 2. 목표
K를 “게임 몇 개가 하드코딩된 챗봇”이 아니라 아이들이 좋아하는 놀이를 계속 추가할 수 있는 확장형 K Play Skill Platform으로 만든다.

```text
K Conversation Engine
├─ K Core Persona
├─ Grade Persona
├─ Relationship Context
├─ 4-tier Memory
├─ Safety
├─ Conversation Health
├─ PLAY_PROPOSAL
└─ PLAY_SKILL_ROUTER
    ↓
PLAY_SKILL_REGISTRY
    ├─ CHOSUNG_SKILL
    ├─ WORD_CHAIN_SKILL
    ├─ TWENTY_QUESTIONS_SKILL   (향후)
    ├─ BALANCE_GAME_SKILL       (향후)
    └─ 기타 놀이 Skill          (향후)
```

게임별 내부는 독립한다.

```text
CHOSUNG_SKILL
├─ config
├─ wordPool
├─ validator
├─ sessionManager
├─ adaptiveDifficulty
├─ playState/recovery
└─ reaction instruction

WORD_CHAIN_SKILL
├─ config
├─ static dictionary
├─ validator
├─ dueumRules
├─ candidateSelector
├─ sessionManager
├─ adaptiveDifficulty
├─ playState/recovery
└─ reaction instruction
```

핵심 원칙:

```text
아이의 현재 발화 > 게임 진행
감정/안전 > 게임 규칙
관계 > 승리
아이의 선택 > K의 제안
```

## 3. 요구사항

### 3-1. PLAY_PROPOSAL
- 실제 게임을 실행하지 않는다.
- 지금 놀이를 제안해도 되는지와 무엇을 제안할지만 결정한다.
- “심심해”, “놀아줘”, “뭐 하고 놀까?” 등에서 사용한다.
- 특정 Skill 직접 요청은 PLAY_PROPOSAL을 거치지 않는다.
- 같은 세션에서 명확히 거절하면 K가 먼저 반복 제안하지 않는다.
- child-initiated Skill 요청은 언제든 허용한다.

### 3-2. PLAY_PROPOSAL 우선순위
제안 가능:
- 명시적 놀이 요청(게임 미지정)
- playful/silly 분위기
- boredom rising/high
- 안전한 놀이 선호 Memory

제안 차단:
- Safety
- 부정감정
- 화남/짜증
- 갈등
- 신체 불편
- 진지한 현재 Topic
- 강한 현재 대화 흐름

기존 Action Selector priority cascade를 깨뜨리지 않는다.

### 3-3. PLAY_SKILL_ROUTER
Router는 게임 규칙을 알지 않는다.

책임:
- active Skill 확인
- 명확한 Skill 요청 확인
- Registry에서 Skill 선택
- `start / handleTurn / end` dispatch
- 종료 후 같은 Free Chat으로 복귀

K Conversation Engine에 게임별 거대한 if/else chain을 계속 추가하지 않는다.

### 3-4. PLAY_SKILL_REGISTRY
향후 새 놀이 추가 시 목표:

```text
새 Skill module 생성
→ Registry 등록
→ proposal metadata 등록
→ Skill-specific state/rules 구현
→ K Conversation Engine 핵심 수정 최소
```

Skill contract는 최소한 다음 책임을 표현할 수 있어야 한다.
- id / metadata
- availability
- direct intent
- suggestibility
- start
- handleTurn
- end
- play health / recovery

### 3-5. Skill별 독립 모듈
공통:
- Persona
- Grade
- Relationship
- Memory
- Safety
- Conversation Health
- routing
- active Skill coordination

Skill 전용:
- Rules
- Session Manager
- State Machine
- Difficulty
- Dictionary/WordPool
- Validator
- K Play Brain
- Recovery

CHOSUNG과 WORD_CHAIN Rules/State를 하나의 generic Game Engine으로 강제 통합하지 않는다.

### 3-6. Flat ConversationAction 유지
현재 flat union 구조를 유지한다.

예:
```text
PLAY_PROPOSAL
PLAYFUL_GAME_CHOSUNG
PLAYFUL_GAME_WORD_CHAIN
```

### 3-7. WORD_CHAIN Skill Lifecycle
한 판의 논리 lifecycle:

```text
WORD_CHAIN_SKILL.start()      1회
→ ACTIVE GAME SESSION
→ handleTurn()               여러 회
→ handleTurn()
→ ...
→ WORD_CHAIN_SKILL.end()      1회
```

HTTP 요청이 여러 번이어도 매 턴마다 새 game session을 만들지 않는다.

### 3-8. Free Chat continuity
- 기존 `chat_session_id` 유지
- 새 Conversation Session 생성 금지
- Conversation History 유지
- Relationship Context 유지
- 4-tier Memory 유지
- 종료 후 같은 Free Chat으로 복귀

### 3-9. WORD_CHAIN 독립 Session Manager / DB
CHOSUNG과 WORD_CHAIN은 서로 다른 상태 머신을 사용한다.

예:
```text
chosung_game_sessions
chosung_game_rounds

word_chain_game_sessions
word_chain_game_rounds
```

CHOSUNG Session Manager를 억지로 일반화하지 않는다.

### 3-10. WORD_CHAIN 최소 상태
필요 개념:
- child_id
- chat_session_id
- initiated_by
- state
- current_word
- current_difficulty
- recent_words / usedWords
- started_at
- updated_at
- ended_at

가능하면 derivable:
- requiredStartSyllable
- roundCount

### 3-11. WORD_CHAIN Static Dictionary
- V1 목표 약 3,000개
- TypeScript static dictionary
- CHOSUNG 80개 wordPool과 분리
- Runtime validity Source of Truth

기본 entry:
- `word` REQUIRED
- `difficulty` REQUIRED
- `properNoun` OPTIONAL
- `category` OPTIONAL
- `acceptedAliases` OPTIONAL

derived:
- normalizedWord
- firstSyllable
- lastSyllable

### 3-12. Dictionary Lookup
- exact validation: `Set`
- alias: `Map`
- first syllable candidate: `Map<firstSyllable, WordEntry[]>`
- usedWords: `Set`
- difficulty filtering

Runtime 단어 판정을 위해 Gemini 호출 금지.

### 3-13. Dictionary 큐레이션
ALLOW:
- 학교생활, 음식, 동물, 식물, 자연/날씨, 일반 신체부위, 물건, 장소, 교통, 운동/스포츠, 놀이/취미, 색깔/모양, 초등 기초 과학/사회, 계절/시간 명사

CURATED_ONLY:
- 감정 명사
- 정착 외래어
- 아동 친화 고유명사
- 제한적 신조어

EXCLUDE:
- 성인용
- 욕설/비속어
- 성적/과도한 폭력 단어
- 전문 학술어
- 고어/북한어/방언/희귀어
- 사람 실명
- 임의 브랜드명
- 조사/어미
- 동사/형용사 활용형
- 의미 없는 음절 조합

### 3-14. 고유명사 / 외래어 / 1음절 / 오타
- 고유명사는 dictionary에 명시 등록된 아동 친화 entry만 허용
- 외래어는 dictionary 포함 여부로 판단
- 1음절 단어도 dictionary에 있으면 허용
- V1 fuzzy 자동 정답 인정 금지
- exact normalized word 또는 accepted alias만 인정
- STT 오인식을 rule result로 Gemini가 추측해 정답 처리하지 않는다.

### 3-15. 기본 끝말잇기 규칙
deterministic:
- first syllable
- last syllable
- chain match
- empty input
- normalization
- non-Hangul
- duplicate word
- dictionary validity
- usedWords
- dueum

### 3-16. 두음법칙
- 별도 deterministic utility
- dictionary에 allowedInitials 중복 저장 금지
- 직접 연결 우선
- 표준 두음법칙 variant 허용
- 임의 확장 금지

### 3-17. K 다음 단어 deterministic 선택
정상 흐름:

```text
아이 단어
→ dictionary validation
→ chain validation
→ duplicate validation
→ dueum validation
→ VALID
→ requiredStartSyllable
→ candidate filter
   - 시작 음절
   - usedWords 제외
   - 미허용 제외
   - Grade difficulty
   - dead-end 위험 고려
→ K next word 확정
→ session state update
→ Gemini reaction
```

Gemini가 K 단어를 자유 생성하지 않는다.

### 3-18. Dead-end 회피
K는 이기기 위해 아이를 막다른 음절로 몰지 않는다.
- 다음 후보가 있는 단어 선호
- 해당 학년에서 이어갈 쉬운 후보가 있는 단어 선호
- usedWords 때문에 실시간 dead-end가 된 후보 회피

### 3-19. Grade baseline
WORD_CHAIN 전용 config를 둔다. `chosungGame` config를 직접 참조하지 않는다.

초기 참고 범위:
- G1: 1~2
- G2: 1~3
- G3: 2~4
- G4: 2~5
- G5: 3~5
- G6: 3~6

아이 입력 단어에는 difficulty 제한을 적용하지 않는다.

### 3-20. K Play Skill Brain
CHOSUNG:
- 문제 내고 힌트 주며 같이 맞히는 친구

WORD_CHAIN:
- 단어를 주고받으며 살짝 경쟁하지만 오래 같이 노는 친구

WORD_CHAIN에서:
- 교사/채점자 말투 지양
- deterministic K word를 자연스럽게 표현
- 아이를 조롱하지 않음
- 승리보다 관계/지속 재미 우선

### 3-21. Play Health / Frustration Recovery
Skill 내부에서 게임 신호 + 현재 발화로:
- ENGAGED
- EXCITED
- CHALLENGED
- STRUGGLING
- FRUSTRATED
- BORED
- WANTS_TO_STOP

등의 상태를 최소한으로 표현 가능해야 한다.

FRUSTRATED면 게임을 기계적으로 계속하지 않고 관계 회복/종료 선택권을 우선한다.

### 3-22. Topic Shift / Safety
게임 중 아이가 다른 일반/감정/Safety 이야기를 시작하면 게임 오답으로 처리하지 않는다.

```text
game input
→ Safety / Negative / Strong Topic Shift preflight
→ 명확한 이탈이면 game validation 생략
→ game session 종료/이탈
→ same chat_session Free Chat handoff
→ 현재 child utterance를 일반 대화로 처리
```

### 3-23. Cross-game Active Skill Guard
한 child에게:
```text
CHOSUNG active + WORD_CHAIN active
```
가 동시에 존재하면 안 된다.

현재 CHOSUNG partial unique index는 같은 테이블 안에서만 active 1개를 보장하므로 cross-game coordination이 필요하다.

### 3-24. Skill Session Lifecycle
Skill 자체와 현재 한 판을 분리한다.

```text
WORD_CHAIN_SKILL = 영구 능력
word_chain_game_session = 현재 한 판
```

최소 lifecycle:
- ACTIVE
- SUSPENDED 또는 동등한 중단 상태
- ENDED

상황:
- 명시적 stop → ENDED
- Topic Shift → ENDED + Free Chat
- Skill switch → 기존 종료 후 새 Skill
- 순간 연결 중단 → resume 가능 상태 고려
- 오래 방치 → stale 처리 후 새 게임 가능

stale `ended_at IS NULL` 때문에 새 Skill 시작이 영구 차단되면 안 된다.

### 3-25. Game Session과 Long-term Memory 분리
장기 Memory 가능:
- “이 아이는 끝말잇기를 좋아한다”

장기 Memory 금지:
- 특정 판의 usedWords
- 현재 difficulty
- 현재 차례
- 특정 score/hint 상태

### 3-26. WORD_CHAIN Adapter
전용 Adapter 경계를 둔다.

예:
`/api/word-chain/turn`

책임:
- 인증
- chat_session 소유권 검증
- child_id server derive
- active Skill/session 확인
- Session Manager 호출
- K Conversation Engine 연결
- client routing response

client가 전달한 child_id/game_session_id를 권위값으로 신뢰하지 않는다.

## 4. 기존 구조 확인

작업 전 반드시 확인한다.

### K Conversation Engine
- Safety preflight
- 4-tier Memory/Persona
- Boredom
- utteranceSignals
- Action Selector priority
- current game orchestrator 위치
- Response Generator
- Semantic Topic History

### CHOSUNG
- `PLAYFUL_GAME_CHOSUNG`
- `hasChosungGameStart`
- `runChosungTurn`
- `gameOrchestrator.ts`
- `gameSessionManager.ts`
- `chosung_game_sessions`
- `chosung_game_rounds`
- `recent_words`
- adaptive difficulty
- current state machine
- `/api/chosung/turn` 최신 구현 상태
- client routing 최신 구현 상태

조사 당시:
- CHOSUNG core/session manager/DB/action은 구현 또는 부분 구현
- `/api/chosung/turn`은 미구현
- activeGameSession 공통 타입은 없음
- 공통 cross-game lookup은 없음

현재 코드가 더 진행됐으면 최신 상태를 Source of Truth로 보고 후 최소 변경한다.

### Active Skill
- child-level CHOSUNG active unique index
- `getActiveChosungGameSession`
- `ended_at IS NULL`
- stale cleanup 여부
- cross-game active lookup 부재

### WORD_CHAIN
- 기존 구현이 생겼는지 재확인
- 중복 구현 금지

## 5. 금지사항
- Production deploy/DB migration/env/data 변경 금지
- CHOSUNG/WORD_CHAIN Rules/State를 하나의 generic Game Engine으로 강제 통합 금지
- 기존 CHOSUNG 대규모 refactor 금지
- K Conversation Engine에 게임별 거대한 if/else chain 추가 금지
- Gemini로 단어 validity/dueum/duplicate/K next word 판정 금지
- Runtime 외부 국어사전 API 의존 금지
- fuzzy typo 자동 인정 금지
- client child_id/game_session_id 권위값 신뢰 금지
- 게임마다 새 Conversation Session 생성 금지
- Safety/Negative Emotion보다 게임 우선 금지
- Topic Shift를 게임 오답 처리 금지
- 거절 후 같은 세션 반복 놀이 제안 금지
- game session state를 Long-term Memory로 저장 금지
- 실제 가족 계정 자동화 테스트 금지
- QA 계정만 자동화 테스트에 사용
- Owner QA 전 Production 변경 금지

## 6. 모호성 처리
- CHOSUNG 구현이 더 진행됐으면 기존 구현을 되돌리지 말고 최신 구조를 우선 보고한다.
- Skill Registry 도입이 CHOSUNG 대규모 리팩터링을 요구하면 영향 범위를 먼저 보고하고 단계적으로 최소 적용한다.
- cross-game guard를 DB constraint만으로 해결할 수 없으면 기존 unique index는 유지한 채 최소 공통 coordination을 사용한다.
- stale/resume timeout 숫자는 임의 확정하지 말고 config 가능하게 두거나 Owner QA 전에 보고한다.
- 3,000개 dictionary는 무검수 자동 생성으로 완료 처리하지 않는다.
- 희귀어를 dead-end coverage 때문에 억지로 추가하지 않는다.
- 고유명사/외래어가 모호하면 미등록을 기본으로 한다.
- PLAY_PROPOSAL proactive 빈도는 기존 cooldown/semantic topic과 충돌하지 않게 조정 가능해야 한다.
- baseline test 기존 실패와 신규 회귀를 분리 보고한다.

## 7. QA

### 7-1. PLAY_PROPOSAL
- 심심해/놀아줘/뭐 하고 놀까 → 놀이 제안
- 게임 미지정 → available Skill 선택지
- 거절 후 반복 제안 없음
- 이후 child initiated game request 허용

### 7-2. Proposal 차단
- 속상함
- 화남/짜증
- 갈등
- 신체 불편
- Safety
- 진지한 Topic
에서 놀이 제안이 나오지 않는지 확인

### 7-3. CHOSUNG direct routing
- “초성게임 하자”
- 기존 Skill 진입
- 기존 규칙/난이도 회귀 없음

### 7-4. WORD_CHAIN direct routing
- “끝말잇기 하자”
- WORD_CHAIN 시작
- same chat_session_id 유지

### 7-5. WORD_CHAIN lifecycle
- start 1회
- handleTurn 최소 10회
- end 1회
- 매 턴 새 game session 생성 없음

### 7-6. Word/Chain validation
- 정상 단어
- 사전 밖 단어
- alias
- 1음절
- 고유명사
- 외래어
- non-Hangul
- 빈 입력
- 정상 연결
- 잘못된 연결
- 두음법칙
- usedWords 중복

### 7-7. K candidate
- required syllable 일치
- usedWords 제외
- dictionary valid
- Grade 난이도
- dead-end 회피
- Gemini 임의 단어 생성 없음

### 7-8. Grade
- G1~G2 쉬운 K 단어
- G3~G4 중간
- G5~G6 확장
- 저학년의 어려운 유효 입력 단어 인정

### 7-9. K Play Brain
- CHOSUNG과 WORD_CHAIN 반응 스타일이 각각 놀이 특성에 맞음
- 교사/채점자 말투 반복 없음
- 아이를 이기기 위한 dead-end 고의 선택 없음

### 7-10. Topic Shift / Frustration / Safety
- 일반/감정 이야기 → game validator 오답 처리 없음
- same Free Chat handoff
- Frustrated 상태에서 기계적 게임 지속 없음
- Safety 최우선

### 7-11. Cross-game / stale / resume
- CHOSUNG ↔ WORD_CHAIN 동시 active 방지
- stale active session으로 새 게임 영구 차단 없음
- resume 가능한 중단은 상태 유지
- Skill 자체는 항상 Registry에서 available

### 7-12. Free Chat continuity
- same chat_session_id
- History/Relationship/Memory 유지
- 게임 종료 후 일반 자유대화 정상

### 7-13. Dictionary quality
- 총 단어 수
- duplicate entry
- invalid Hangul
- difficulty 범위
- first syllable coverage
- next candidate coverage
- dead-end syllable 목록
- 저학년 coverage
- 제외 기준 위반

### 7-14. 회귀 테스트
- k-conversation
- CHOSUNG
- WORD_CHAIN
- Action Selector
- PLAY_PROPOSAL
- Skill Router/Registry
- 4-tier Memory
- Grade Persona
- Boredom
- Safety
- Topic Shift
- responseGenerator
- typecheck
- lint
- build

## 8. 완료조건
- PLAY_PROPOSAL / PLAY_SKILL_ROUTER / PLAY_SKILL_REGISTRY 경계 구현
- CHOSUNG 독립 Skill 유지
- WORD_CHAIN 독립 Skill 구현
- 향후 새 놀이 등록 시 K Conversation Engine 핵심 수정 최소
- 놀이 제안과 특정 Skill 직접 진입 구분
- 거절 후 반복 제안 없음
- child initiated 요청은 허용
- Safety/Negative/Conflict/Serious Topic 우선
- WORD_CHAIN START 1회 → HANDLE TURN 여러 회 → END 1회
- same free_chat chat_session_id 유지
- 약 3,000개 static dictionary 준비
- validity/dueum/usedWords/K candidate deterministic
- Gemini는 자연스러운 reaction만 담당
- Grade difficulty는 K 단어에만 적용
- Topic Shift 시 현재 아이 이야기 우선
- CHOSUNG/WORD_CHAIN 동시 active 없음
- stale session으로 Skill 사용 영구 차단 없음
- game session state와 Long-term Memory 분리
- 기존 CHOSUNG/Free Chat 회귀 없음
- 자동 테스트 통과
- typecheck/lint/build 결과 보고
- Development 검증 완료
- Owner QA 전 Production 변경 없음
- 최종 상태 `WAITING_FOR_OWNER_QA`

## 9. 완료보고
완료 후 다음을 보고한다.

### K Play Platform
- 최종 구조
- 변경 파일 목록
- PLAY_PROPOSAL 위치/동작
- PLAY_SKILL_ROUTER 구조
- PLAY_SKILL_REGISTRY 구조
- 신규 Skill 등록 방식
- active Skill coordination 방식

### CHOSUNG
- 기존 구조 보존 여부
- 변경 영향
- 회귀 테스트 결과

### WORD_CHAIN
- Skill module 파일 목록
- Session Manager
- state machine
- start / handleTurn / end lifecycle
- DB session/round 구조
- dictionary 위치/총 단어 수/검수 결과
- dueum rules
- usedWords
- candidate selection
- dead-end avoidance
- Grade config
- K Play Brain
- Frustration Recovery
- Topic Shift

### Session Lifecycle
- active 판정
- cross-game guard
- suspended/re-entry
- stale cleanup
- end reason
- Free Chat handoff

### QA / Regression / Build
- PLAY_PROPOSAL
- proposal rejection
- CHOSUNG direct routing
- WORD_CHAIN direct routing
- WORD_CHAIN 10턴 이상
- 동일 단어/두음법칙/1음절/고유명사/외래어/invalid word
- Grade별 난이도
- Topic Shift
- Frustration
- cross-game conflict
- stale session
- Free Chat continuity
- K Conversation Engine
- 4-tier Memory
- Grade Persona
- Boredom
- Safety
- Action Selector
- CHOSUNG
- responseGenerator
- unit/integration test
- typecheck
- lint
- build

### 배포
- Dev 배포 URL
- Production 변경 여부: NO
- 최종 상태: `WAITING_FOR_OWNER_QA`
- 작업 커밋
