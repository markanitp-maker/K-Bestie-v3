# PLAY_PROPOSAL 수락 상태 및 Active Skill Session Hard Guard

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- K가 “초성게임이나 끝말잇기 할래?”처럼 복수 놀이를 제안한 뒤 아이가 “게임부터 하자”, “좋아”, “하자”처럼 포괄적으로 수락해도 K가 임의로 특정 게임을 선택하지 않는다.
- 복수 Skill 제안 후 아이의 수락이 모호하면 K가 “초성게임이랑 끝말잇기 중 뭐 할래?”처럼 다시 선택을 받는다.
- K가 단일 Skill만 제안한 상태에서 아이가 “좋아”, “하자”, “응”처럼 포괄적으로 수락하면 해당 Skill을 정상적으로 시작할 수 있다.
- 아이가 “초성게임 하자”, “끝말잇기 하자”처럼 특정 Skill을 직접 요청하면 Pending Proposal과 무관하게 해당 Skill로 즉시 진입한다.
- 실제 Skill Session 생성에 성공하기 전에는 Gemini가 절대로 게임을 시작한 것처럼 문제·단어·턴을 임의 생성하지 않는다.
- `NO ACTIVE SKILL SESSION → NO GAMEPLAY GENERATION` 규칙이 CHOSUNG과 WORD_CHAIN 모두에 적용된다.
- CHOSUNG의 문제/정답/힌트는 CHOSUNG Skill이 Source of Truth다.
- WORD_CHAIN의 현재 단어/차례/usedWords/K 다음 단어는 WORD_CHAIN Skill이 Source of Truth다.
- Gemini는 Skill이 확정한 상태와 결과를 자연스럽게 말하는 역할만 한다.
- Skill Session 생성 실패, inactive, stale 상태에서는 K가 게임을 하는 척하지 않고 안전하게 재선택 또는 일반 Free Chat으로 복귀한다.
- 놀이 제안/선택 과정에서도 같은 `chat_session_id`, Conversation History, Relationship Context, 4-tier Memory가 유지된다.
- Safety / Negative Emotion / Conflict / Serious Topic / Topic Shift가 게임 진입보다 우선한다.
- 기존 006 K Play Skill Platform 구조를 유지하고, 이번 수정 때문에 CHOSUNG/WORD_CHAIN 내부 룰을 재설계하지 않는다.
- Owner QA 전까지 Production 코드·DB·env에는 아무 변경도 하지 않는다.

### 대표님 테스트 정상 프로세스

#### A. 복수 놀이 제안 후 포괄 수락
1. Development 자유대화에 QA 계정으로 접속한다.
2. “심심해”, “뭐 하고 놀까?”라고 말한다.
3. K가 “초성게임이나 끝말잇기 할래?”처럼 복수 Skill을 제안하도록 유도한다.
4. 아이가 “게임부터 하자”, “좋아”, “하자”처럼 특정 게임을 지정하지 않고 수락한다.
5. K가 임의로 초성게임 또는 끝말잇기를 선택하지 않는지 확인한다.
6. K가 다시 “초성게임이랑 끝말잇기 중 뭐 할래?”처럼 선택을 요청하는지 확인한다.
7. 아이가 “초성게임”이라고 선택한다.
8. 실제 CHOSUNG Skill Session이 생성된 뒤에만 첫 문제가 나오는지 확인한다.

#### B. 단일 놀이 제안 후 포괄 수락
9. K가 한 개의 Skill만 제안하는 상황을 만든다.
10. 예: “끝말잇기 한 판 할래?”
11. 아이가 “응”, “좋아”, “하자”라고 답한다.
12. 해당 Pending Proposal의 Skill이 확정되어 WORD_CHAIN Session이 실제 생성되는지 확인한다.
13. Session 생성 성공 후에만 K가 첫 단어를 말하는지 확인한다.

#### C. 특정 Skill 직접 요청
14. 새 자유대화에서 “초성게임 하자”라고 말한다.
15. Pending Proposal 없이 CHOSUNG Skill로 직접 진입하는지 확인한다.
16. “끝말잇기 하자”라고 말한다.
17. WORD_CHAIN Skill로 직접 진입하는지 확인한다.

#### D. Active Session 없는 상태에서 Gameplay 차단
18. Skill Session이 생성되지 않도록 QA fixture 또는 실패 상태를 만든다.
19. K에게 게임을 시작할 수 있는 문맥을 준다.
20. Gemini가 임의로 “첫 문제 나간다”, “나는 과자!” 같은 gameplay를 생성하지 않는지 확인한다.
21. 재선택 또는 일반 Free Chat 상태로 안전하게 머무는지 확인한다.

#### E. Skill Source of Truth
22. CHOSUNG에서 Skill이 확정한 문제/정답을 기준으로 K가 반응하는지 확인한다.
23. K가 자신이 낸 문제의 답을 잊거나 임의로 바꾸지 않는지 확인한다.
24. WORD_CHAIN에서 Skill이 확정한 K 단어/usedWords/차례를 기준으로 K가 반응하는지 확인한다.
25. Gemini가 사전에 없는 단어나 Session에 없는 상태를 임의로 만들어내지 않는지 확인한다.

#### F. 거절 / Topic Shift / 감정 우선
26. 놀이 제안 후 “싫어”, “안 할래”라고 말한다.
27. 같은 세션에서 K가 반복적으로 놀이를 제안하지 않는지 확인한다.
28. 게임 선택/진입 과정에서 “오늘 학교에서 속상했어”라고 말한다.
29. 게임 진입을 중단하고 현재 아이 이야기로 Free Chat이 이어지는지 확인한다.

PASS 기준:
- 복수 제안 + 포괄 수락 시 임의 Skill 선택 없음.
- 단일 제안 + 포괄 수락 시 해당 Skill을 확정적으로 시작 가능.
- 특정 Skill 직접 요청은 즉시 해당 Skill 진입.
- Active Skill Session이 없으면 Gameplay 생성 0건.
- Skill Session 생성 성공 후에만 CHOSUNG 문제 또는 WORD_CHAIN 단어가 생성됨.
- CHOSUNG/WORD_CHAIN 게임 상태의 Source of Truth가 Skill Session에 있음.
- Gemini 단독 게임 생성/환각 없음.
- Topic Shift/Safety/Negative Emotion이 게임보다 우선.
- same chat_session 유지.
- 기존 Free Chat 및 006 Play Skill Platform 회귀 없음.
- Production 변경 없이 Development 검증 상태로 종료.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 후속 수정 요청
- 우선순위: CRITICAL
- 대상 프로젝트: `/mnt/e/VibeCoding/K-Bestie-v3`
- 개발 주체: K-Bestie-v3 메인 앱 Claude Code
- 선행 완료: `006-request-k-play-skill-platform-word-chain.md`
- 적용 대상: PLAY_PROPOSAL, PLAY_SKILL_ROUTER, PLAY_SKILL_REGISTRY, CHOSUNG Skill 진입, WORD_CHAIN Skill 진입, Free Chat Response Generator guard
- 제외: CHOSUNG 규칙 재설계, WORD_CHAIN 규칙 재설계, Mission Goal Layer, STT, Gemini 모델 변경
- 배포 원칙: Development 구현 및 QA 우선
- 최종 상태: `WAITING_FOR_OWNER_QA`

## 2. 목표

006 완료 이후 Production 실제 사용에서 다음 결함이 확인됐다.

```text
K:
“초성게임이나 끝말잇기 할래?”

아이:
“게임부터 먼저 해 보자”

↓
특정 Skill 선택 신호 없음
↓
Skill Router handled=false
↓
실제 game session 생성 안 됨
↓
하지만 Gemini는 play catalog를 보고
“그럼 초성게임부터 해볼까? 첫 문제! ㅈㅅ”
라고 임의 gameplay 생성
↓
DB/Skill에는 문제 Source of Truth 없음
↓
다음 턴부터 K가 정답/문제/현재 상태를 기억하지 못함
↓
대화 모순/환각/신뢰 붕괴
```

이번 요청의 목표는 놀이 제안과 실제 Skill Session 사이의 계약을 명확히 하여, 실제 Skill Session이 없는 상태에서 Gemini가 게임을 연기하는 것을 시스템적으로 불가능하게 만드는 것이다.

최종 invariant:

```text
NO ACTIVE SKILL SESSION
→ NO GAMEPLAY GENERATION
```

정상 구조:

```text
PLAY_PROPOSAL
→ Pending Proposal 저장
→ 아이 응답
   ├─ 특정 Skill 선택 → 해당 Skill start
   ├─ 단일 Skill 제안 + 포괄 수락 → 해당 Skill start
   ├─ 복수 Skill 제안 + 포괄 수락 → 재선택 요청
   └─ 거절 / Topic Shift → 일반 Free Chat

Skill start 성공
→ Active Skill Session 생성
→ Skill이 gameplay state 확정
→ Gemini는 확정된 결과를 자연스럽게 표현
```

## 3. 요구사항

### 3-1. Pending Play Proposal 상태 도입
PLAY_PROPOSAL이 놀이를 제안한 뒤 아이의 다음 응답을 해석할 수 있도록 최소 상태를 유지한다.

필요 개념:
- 제안이 있었는지
- 제안한 Skill 목록
- 제안 시각/세션
- child initiated / K initiated 여부
- 거절 여부

구현 형태는 현재 006 구조를 확인한 뒤 최소 범위로 선택한다.

중요:
- 장기 Memory에 저장하지 않는다.
- 같은 Free Chat session 내 short-lived 상태로 관리한다.
- Topic Shift / 거절 / Skill 시작 / 세션 종료 시 정리한다.

### 3-2. 단일 Skill 제안 + 포괄 수락
예:

```text
K: “끝말잇기 할래?”
아이: “응”
```

Pending Proposal의 offeredSkills가 1개라면 해당 Skill을 확정할 수 있다.

조건:
- 최근 제안과 같은 chat_session
- 아직 proposal이 유효
- Safety/Topic Shift/거절 신호 없음
- 실제 Skill start 성공 필요

Skill start 성공 전 gameplay 생성 금지.

### 3-3. 복수 Skill 제안 + 포괄 수락
예:

```text
K: “초성게임이나 끝말잇기 할래?”
아이: “게임부터 하자”
```

offeredSkills가 2개 이상이고 아이가 특정 Skill을 선택하지 않았다면:
- K가 임의 Skill 선택 금지
- Gemini가 임의 Skill 시작 금지
- 선택 질문으로 되돌아감

예:
```text
“초성게임이랑 끝말잇기 중 뭐 할래?”
```

### 3-4. 특정 Skill 직접 요청 우선
다음은 Pending Proposal 없이 직접 Skill 진입 가능:

```text
“초성게임 하자”
“초성 내줘”
“끝말잇기 하자”
“단어 이어가자”
```

직접 Skill intent가 감지되면:
- PLAY_PROPOSAL보다 우선
- 해당 Skill start 시도
- start 성공 후 gameplay
- 실패 시 gameplay 금지

### 3-5. Active Skill Session Hard Guard
가장 중요한 공통 규칙:

```text
NO ACTIVE SKILL SESSION
→ NO GAMEPLAY GENERATION
```

CHOSUNG:
- active CHOSUNG session 없음 → 초성 문제/힌트/정답 gameplay 생성 금지

WORD_CHAIN:
- active WORD_CHAIN session 없음 → K 단어/차례/usedWords 관련 gameplay 생성 금지

playCatalogFragment 또는 available skill metadata는 “K가 할 수 있는 놀이” 정보일 뿐 실제 게임 상태가 아니다.

### 3-6. Skill start 성공이 Gameplay의 유일한 진입 조건
정상 흐름:

```text
Skill intent 확정
→ Skill.start()
→ DB/session 생성 성공
→ active session 검증
→ Skill initial state 확정
→ gameplay instruction 생성
→ Gemini response
```

start 실패 / DB 실패 / stale conflict / inactive 상태에서는 gameplay instruction을 Response Generator에 전달하지 않는다.

### 3-7. CHOSUNG Source of Truth
CHOSUNG의 문제/chosung/정답/accepted answers/hint/round result/difficulty/current state는 반드시 CHOSUNG Skill/Session Manager에서 확정한다.

Gemini가 문제나 정답을 자유 생성하지 않는다.

### 3-8. WORD_CHAIN Source of Truth
WORD_CHAIN의 current word/child validation/required start syllable/usedWords/dueum result/K next word/current turn/difficulty/game state는 WORD_CHAIN Skill/Session Manager에서 확정한다.

Gemini가 K의 다음 단어나 rule result를 자유 생성하지 않는다.

### 3-9. Gemini 역할 제한
Gemini 역할:
- Skill이 확정한 결과를 자연스럽게 말함
- Grade Persona 반영
- Relationship Context 반영
- 친구다운 리액션
- 선택 질문 표현
- 종료/복귀 표현

Gemini 역할 아님:
- Skill 선택 임의 결정
- session 없는 gameplay 시작
- 게임 문제 생성
- 정답 Source of Truth
- usedWords/turn/state 추측
- rule 판정

### 3-10. PLAY_PROPOSAL과 Gameplay Prompt 분리
PLAY_PROPOSAL 상태에서는 Gemini에 available Skill 목록/제안 가능 정보만 전달할 수 있다.

실제 gameplay detail은 active Skill Session이 있을 때만 전달한다.

### 3-11. Selection Required 상태
복수 제안 후 아이 응답이 모호하면 Skill start를 하지 않고 selection-required 상태를 유지한다.

```text
offeredSkills = [CHOSUNG, WORD_CHAIN]
child = “좋아”
→ selection required
→ game session 생성 0
→ gameplay 생성 0
```

### 3-12. 거절 처리
아이가 “싫어”, “안 할래”, “됐어”, “다른 거 하자” 등으로 거절하면 Pending Proposal을 정리한다.

같은 세션에서 K가 반복적으로 먼저 놀이를 강요하지 않는다.

단, 이후 child initiated 직접 요청은 허용한다.

### 3-13. Topic Shift / Negative Emotion / Safety 우선
Pending Proposal 이후라도 Safety / Negative Emotion / Conflict / Frustration / Serious Topic / 명확한 Topic Shift가 오면 proposal/game 진입보다 현재 발화를 우선한다.

### 3-14. Session 생성 실패 처리
Skill start 중 DB error / unique conflict / stale active session / ownership mismatch / inactive 상태가 발생하면:
- gameplay 생성 금지
- active session 없음 유지
- 일반 Free Chat 또는 재선택 가능한 안전 상태로 복귀
- 기술 오류 코드를 아이에게 노출하지 않음

### 3-15. stale/inactive session Hard Guard
stale 또는 ended session을 active gameplay Source로 사용하지 않는다.

### 3-16. Cross-game 충돌 방지
CHOSUNG active 상태에서 WORD_CHAIN을 동시에 시작하지 않는다.
WORD_CHAIN active 상태에서 CHOSUNG도 동일하다.

### 3-17. Same Free Chat Session 유지
Proposal → 선택 → Skill start → Skill end → Free Chat 복귀 전 과정에서 같은 chat_session_id / Conversation History / Relationship Context / 4-tier Memory를 유지한다.

### 3-18. Play Catalog 역할 제한
playCatalogFragment 또는 Skill Registry metadata는 K가 어떤 놀이를 할 수 있고 무엇을 제안할 수 있는지 알려주는 용도다.

Catalog만 보고 gameplay 시작/문제 생성/정답 생성/현재 게임 상태 주장을 하면 안 된다.

### 3-19. Gameplay Instruction 생성 조건
Response Generator에 game-specific instruction을 전달하기 전에 반드시:
- selected Skill 확정
- start/active session 확인
- Skill handled=true 또는 동등한 성공 상태
를 확인한다.

### 3-20. 006 구조 보존
이번 요청은 006 완료 구조의 후속 보강이다.

유지:
- PLAY_PROPOSAL
- PLAY_SKILL_ROUTER
- PLAY_SKILL_REGISTRY
- CHOSUNG Skill 독립성
- WORD_CHAIN Skill 독립성
- Skill lifecycle
- Topic Shift/Safety 우선 원칙

대규모 재설계 금지.

## 4. 기존 구조 확인

작업 전 반드시 확인한다.

### Production 재현 근거
박말동 최근 Production Free Chat에서 확인된 흐름:
- K가 CHOSUNG + WORD_CHAIN 복수 제안
- 아이가 포괄적 수락
- 특정 Skill signal 없음
- Skill Router handled=false
- active CHOSUNG/WORD_CHAIN session 없음
- Gemini가 play catalog를 보고 임의 CHOSUNG gameplay 시작
- 이후 문제/정답 Source of Truth 부재
- 모순/환각 연쇄 발생

### 확인할 코드
- PLAY_PROPOSAL 구현
- Pending Proposal 상태 존재 여부
- Skill Registry metadata
- Skill Router
- `routePlaySkillTurn`
- `runChosungTurn`
- WORD_CHAIN routing
- `playCatalogFragment`
- game-specific instruction 생성 조건
- Response Generator
- active session 조회
- Skill start return contract
- handled flag
- stale/inactive recovery
- same-session proposal rejection 처리

## 5. 금지사항
- Production deploy 금지
- Production DB migration 금지
- Production env 변경 금지
- Production 데이터 수정 금지
- 006 전체 재설계 금지
- CHOSUNG/WORD_CHAIN Rules 재설계 금지
- Gemini가 Skill을 임의 선택하도록 두는 것 금지
- active session 없이 gameplay 허용 금지
- playCatalog만으로 gameplay 생성 허용 금지
- Gemini가 CHOSUNG 문제/정답 생성 금지
- Gemini가 WORD_CHAIN next word/rule state 생성 금지
- 복수 제안 후 포괄 수락을 임의 첫 번째 Skill로 매핑 금지
- Topic Shift/Negative/Safety를 게임 수락으로 처리 금지
- client child_id/game_session_id 권위값 신뢰 금지
- 실제 가족 계정 자동화 테스트 금지
- QA 테스트 계정만 자동화 테스트에 사용
- Owner QA 전 Production 변경 금지

## 6. 모호성 처리
- Pending Proposal 저장 구조가 이미 있다면 새 상태를 중복 생성하지 말고 기존 Source를 확장한다.
- 단일 Skill 제안인지 복수 Skill 제안인지 기존 metadata로 복원 가능하면 별도 중복 state를 만들지 않는다.
- 포괄 수락 발화의 범위가 모호하면 deterministic signal + Pending Proposal context를 우선하고 Gemini에게 Skill 선택 권한을 넘기지 않는다.
- Skill start API/manager가 실패 사유를 충분히 반환하지 않으면 gameplay 허용 여부를 판단할 수 있는 최소 성공/실패 contract를 확보한다.
- CHOSUNG과 WORD_CHAIN의 active session Source가 다르면 각각의 canonical Source를 유지한다.
- baseline test 기존 실패와 신규 회귀를 분리 보고한다.

## 7. QA

### 7-1. 복수 제안 + 포괄 수락
- K: “초성게임이나 끝말잇기 할래?”
- 아이: “좋아”
- Skill start 0
- active game session 0
- gameplay 생성 0
- K가 재선택 요청

### 7-2. 복수 제안 + 특정 선택
- 아이: “끝말잇기”
- WORD_CHAIN start 성공
- active WORD_CHAIN 1
- CHOSUNG 0
- start 이후 gameplay

### 7-3. 단일 제안 + 포괄 수락
- K: “끝말잇기 할래?”
- 아이: “응”
- WORD_CHAIN start
- session 성공 후 gameplay

### 7-4. 직접 CHOSUNG 요청
- “초성게임 하자”
- CHOSUNG direct start
- 실제 session 생성
- Skill이 확정한 첫 문제만 출력

### 7-5. 직접 WORD_CHAIN 요청
- “끝말잇기 하자”
- WORD_CHAIN direct start
- 실제 session 생성
- Skill이 확정한 첫 단어만 출력

### 7-6. Active Session 없음
- game start 실패 fixture
- `active session = null`
- Gemini gameplay 0
- 임의 첫 문제/초성/K 단어 생성 없음

### 7-7. CHOSUNG Source of Truth
- Skill problem과 Gemini 출력 일치
- 정답 검증 Skill 기준
- 다음 턴에서도 문제/정답 유지

### 7-8. WORD_CHAIN Source of Truth
- current_word/usedWords/K next word가 Skill state와 일치
- Gemini 다른 단어 임의 생성 없음

### 7-9. Topic Shift / Negative / Safety
- proposal clear
- Skill start 없음
- 현재 발화를 Free Chat 처리
- 기존 Conversation Health/Safety 우선

### 7-10. 거절
- Pending Proposal clear
- same-session proactive 재제안 없음
- 이후 direct child request 정상 허용

### 7-11. stale/inactive / Cross-game
- stale/ended session gameplay Source 사용 없음
- CHOSUNG/WORD_CHAIN 동시에 active 2개 없음

### 7-12. Free Chat continuity
- same chat_session_id
- History/Relationship/Memory 유지
- Skill 종료 후 Free Chat 정상

### 7-13. 회귀 테스트
- PLAY_PROPOSAL
- Skill Router
- Skill Registry
- CHOSUNG
- WORD_CHAIN
- K Conversation Engine
- Action Selector
- Safety
- Conversation Health
- Topic Shift
- 4-tier Memory
- Response Generator
- typecheck
- lint
- build

## 8. 완료조건
- Pending Play Proposal이 실제 child 후속 응답 해석에 사용된다.
- 단일 제안 + 포괄 수락은 해당 Skill을 정확히 시작한다.
- 복수 제안 + 포괄 수락은 임의 Skill 선택 없이 재선택을 요구한다.
- 특정 Skill 직접 요청은 해당 Skill로 바로 진입한다.
- Skill start 성공 전 gameplay 생성 0건.
- `NO ACTIVE SKILL SESSION → NO GAMEPLAY GENERATION`이 CHOSUNG/WORD_CHAIN 모두에서 보장된다.
- CHOSUNG 문제/정답/힌트 Source of Truth는 CHOSUNG Skill이다.
- WORD_CHAIN current word/usedWords/K word Source of Truth는 WORD_CHAIN Skill이다.
- playCatalog는 제안/능력 metadata 용도로만 사용된다.
- Gemini는 Skill 결과의 자연어 표현만 담당한다.
- start 실패/inactive/stale 시 gameplay 차단.
- Topic Shift/Negative/Safety가 게임보다 우선.
- 거절 후 same-session 반복 proposal 없음.
- same chat_session continuity 유지.
- 기존 006 구조/CHOSUNG/WORD_CHAIN/Free Chat 회귀 없음.
- 자동 테스트 통과.
- typecheck/lint/build 결과 보고.
- Development 검증 완료.
- Owner QA 전 Production 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 9. 완료보고
완료 후 다음을 보고한다.

- 최종 Root Cause
- 변경 파일 목록
- Pending Play Proposal 저장 위치/수명
- offeredSkills 표현 방식
- 단일 제안 + 포괄 수락 처리
- 복수 제안 + 포괄 수락 처리
- 특정 Skill 직접 요청 처리
- Skill start 성공 contract
- Active Skill Session Hard Guard 위치
- `NO ACTIVE SKILL SESSION → NO GAMEPLAY GENERATION` 보장 방식
- playCatalog 역할 제한 방식
- CHOSUNG Source of Truth 보호 방식
- WORD_CHAIN Source of Truth 보호 방식
- session start 실패/inactive/stale 처리
- Topic Shift/rejection/cross-game 처리
- Free Chat continuity 결과
- QA 결과
- Regression 결과
- unit/integration test 결과
- typecheck 결과
- lint 결과
- build 결과
- Dev 배포 URL
- Production 변경 여부: NO
- 최종 상태: `WAITING_FOR_OWNER_QA`
- 작업 커밋
