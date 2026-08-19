
파일명: `009-K놀이-선택모달-액티브스킬-라이프사이클.md`

# K놀이 선택 모달 및 Active Skill Lifecycle 구현 요청

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 자유대화 화면에서 케이 캐릭터 왼쪽에 `K놀이` 버튼이 표시된다.
- `K놀이` 버튼을 누르면 현재 사용 가능한 놀이 Skill 선택 모달이 열린다.
- 모달에는 최소 `초성게임 / 끝말잇기 / 넌센스 퀴즈`가 표시된다.
- 놀이 하나를 선택하면 현재 Free Chat `chat_session_id`를 그대로 유지한 채 해당 Skill Session이 생성되고 즉시 놀이가 시작된다.
- 동시에 한 아이에게 Active Play Skill은 최대 1개만 존재한다.
- 다른 놀이를 선택하면 기존 Active Skill이 먼저 종료된 뒤 새 Skill이 시작된다.
- 놀이 중 `그만`, 놀이 종료 UI, 정상 게임 종료, 자유대화 종료 시 Active Skill이 정상 종료된다.
- 앱 강제 종료·네트워크 단절 등 client 종료 요청이 전달되지 않는 경우에도 stale session이 영구적으로 남지 않는다.
- 놀이 종료 후 별도 대화방을 만들지 않고 기존 자유대화로 자연스럽게 복귀한다.
- Active Skill Session이 없는 상태에서는 Gemini가 임의로 게임 문제를 생성하거나 놀이를 시작하지 않는다.

### 대표님 테스트 정상 프로세스
1. Dev 아이 계정으로 자유대화 화면에 진입한다.
2. 케이 왼쪽의 `K놀이` 버튼을 누른다.
3. `초성게임 / 끝말잇기 / 넌센스 퀴즈`가 모달에 정상 표시되는지 확인한다.
4. `끝말잇기`를 선택한다.
5. 같은 자유대화 화면에서 즉시 끝말잇기가 시작되는지 확인한다.
6. 놀이 중 다시 `K놀이` 버튼을 누르고 `초성게임`을 선택한다.
7. 기존 끝말잇기가 종료되고 초성게임 하나만 Active인지 확인한다.
8. 아이가 `그만`이라고 말했을 때 놀이가 종료되고 자유대화로 복귀하는지 확인한다.
9. 다시 넌센스 퀴즈를 시작한 뒤 놀이 종료 UI를 눌러 종료한다.
10. 자유대화 화면을 정상적으로 나간 뒤 재진입해 새 놀이를 시작한다.
11. 이전 Active Skill 때문에 새 게임이 차단되지 않는지 확인한다.
12. stale session 시나리오에서도 기준시간 경과 후 새 놀이가 정상 시작되는지 확인한다.

PASS 기준:
- K놀이 버튼 및 선택 모달 정상 동작
- 선택하지 않은 Skill 임의 시작 0건
- 동시에 Active Skill 2개 이상 존재 0건
- Skill 전환 시 기존 Skill 미종료 0건
- 종료 후 Free Chat 복귀 실패 0건
- stale session 때문에 신규 놀이 차단 0건
- Active Session 생성 전 gameplay 생성 0건
- 기존 초성게임 / 끝말잇기 / 넌센스 퀴즈 direct voice 요청 회귀 오류 0건

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 기능 구현 + 기존 Active Skill Lifecycle 보강
- 우선순위: HIGH
- 대상 프로젝트: `K-Bestie-v3`
- 개발 주체: Claude Code
- 적용 대상:
  - 아이 자유대화 `/chat`
  - K Play Skill Platform
  - CHOSUNG
  - WORD_CHAIN
  - NONSENSE_QUIZ
  - Skill Registry / Router / Session Lifecycle
- 제외 대상:
  - `/child/play` 황금열쇠 기반 외부 놀이 구조 재설계
  - CHOSUNG 문제 Pool 재설계
  - WORD_CHAIN Dictionary 재설계
  - NONSENSE Question Bank 콘텐츠 재작성
  - Mission Engine 대규모 수정
  - ConversationAction 대규모 구조 변경

## 2. 목표
현재 K Play Skill Platform에는 다음 서버 구조가 이미 존재한다.

```text
PLAY_SKILL_REGISTRY
├─ CHOSUNG_SKILL
├─ WORD_CHAIN_SKILL
└─ NONSENSE_QUIZ_SKILL

K Conversation Engine
→ routePlaySkillTurn()
→ Skill start / handleTurn / end
```

하지만 자유대화 화면에는 사용자가 직접 놀이를 선택할 UI가 없다.

이번 작업의 목표는 다음 정상 흐름을 완성하는 것이다.

```text
Free Chat
↓
K놀이 버튼
↓
Skill 선택 모달
↓
사용자가 특정 Skill 명시 선택
↓
서버 인증 / chat ownership 확인
↓
기존 Active Skill 확인
↓
필요 시 기존 Skill 종료
↓
선택 Skill.start()
↓
Active Session 생성 확인
↓
같은 chat_session_id에서 Gameplay
↓
종료
↓
같은 Free Chat 복귀
```

추가 목표:

```text
ONE CHILD
→ MAX ONE ACTIVE PLAY SKILL
```

을 서버 기준으로 실제 보장한다.

절대 invariant:

```text
NO ACTIVE SKILL SESSION
→ NO GAMEPLAY GENERATION
```

## 3. 요구사항

### 3-1. 자유대화 K놀이 버튼 구현
- `app/chat/page.tsx`의 실제 현재 구조를 기준으로 구현한다.
- 케이 캐릭터 왼쪽 영역에 `K놀이` 버튼을 배치한다.
- 기존 마이크, 키보드, 말풍선, 캐릭터 UI와 겹치거나 밀리지 않아야 한다.
- 모바일/PWA/PC viewport 모두 정상 표시되어야 한다.
- 버튼 클릭만으로 특정 게임을 바로 시작하지 않는다.
- 클릭 시 Skill 선택 모달을 연다.

### 3-2. K놀이 Skill 선택 모달 구현
초기 표시 대상:
- 초성게임
- 끝말잇기
- 넌센스 퀴즈

각 항목은 최소:
- Skill 이름
- 아이가 이해할 수 있는 짧은 설명
- 사용 가능 여부

를 표시한다.

향후 새로운 Skill이 Registry에 등록될 때 UI에 거대한 게임별 `if/else`를 계속 추가하는 구조를 만들지 않는다.

현재 `PLAY_SKILL_REGISTRY`의 metadata를 재사용할 수 있는지 먼저 확인한다.

`buildPlayCatalogFragment()`가 LLM Prompt용 문자열이라면 UI에서 문자열을 parsing하여 사용하지 않는다.

필요한 경우 UI용 최소 DTO/API를 별도로 만든다.

### 3-3. UI Skill 선택은 명시적 Skill Selection으로 처리
모달에서 사용자가 `WORD_CHAIN`을 선택했다면 자연어:

```text
“끝말잇기 하자”
```

를 가짜 child utterance로 만들어 Router에 넣는 우회 구현을 금지한다.

UI 선택은 명시적인:

```text
skillId = WORD_CHAIN
```

선택으로 서버에 전달한다.

### 3-4. Skill Selection 서버 Adapter/API 구현
현재 API convention을 먼저 확인하고 최소 수정으로 구현한다.

개념 예:

```text
POST /api/play/skill/select
```

최소 client 입력:
- `chatSessionId`
- `skillId`

서버에서:
1. 인증 확인
2. chat_session 소유권 확인
3. child_id server-side derive
4. Registry에 존재하는 Skill인지 확인
5. availability 확인
6. 현재 Active Skill 조회
7. 필요 시 기존 Skill 종료
8. 선택한 Skill start
9. Active Session 생성 성공 확인
10. 시작 결과 반환

client가 보낸 `child_id`, `game_session_id`를 권위값으로 신뢰하지 않는다.

### 3-5. Single Active Skill Coordinator 보강
현재 각 게임 테이블의:

```text
child_id
WHERE ended_at IS NULL
UNIQUE
```

는 동일 Skill 내부 중복 Active만 방지한다.

다음 cross-table 상태는 허용하면 안 된다.

```text
CHOSUNG ACTIVE
+
WORD_CHAIN ACTIVE
```

또는:

```text
WORD_CHAIN ACTIVE
+
NONSENSE ACTIVE
```

따라서 공통 Active Skill coordination 계층에서:

```text
ONE CHILD
→ MAX ONE ACTIVE PLAY SKILL
```

을 보장한다.

동작:

```text
Active 없음
→ 선택 Skill start

같은 Skill Active
→ 중복 Session 생성 금지
→ 기존 Session resume 또는 현재 Skill 정책 적용

다른 Skill Active
→ 기존 Skill end
→ 종료 성공 확인
→ 새 Skill start
```

동시 요청/race condition에서도 2개 Active Skill이 생성되지 않도록 현재 DB 구조에 맞는 최소 coordination 방식을 구현한다.

### 3-6. 기존 다중 Active fallback 보강
현재 `skillRouter.ts`에서 여러 Active Skill이 발견될 경우 첫 번째 Skill을 사용하고 error log를 남기는 구조는 정상 상태로 인정하지 않는다.

2개 이상 Active가 발견되면:
- invariant violation으로 기록
- 안전하게 기존 상태를 정리
- 최종적으로 Active Skill 1개 이하가 되도록 처리

단, 자동 복구 과정에서 사용자의 정상 Session 데이터를 무작정 삭제하지 않는다.

### 3-7. Gameplay Hard Guard 유지
다음 순서를 보장한다.

```text
UI Skill 선택
↓
서버 검증
↓
기존 Active 종료
↓
Skill.start()
↓
Game Session 생성
↓
Active Session 확인
↓
Gameplay state 확정
↓
Gemini 표현
```

Skill.start() 실패 또는 Active Session 생성 실패 상태에서 Gemini가 게임을 하는 척하면 안 된다.

### 3-8. 동일 Free Chat Session 유지
놀이 시작 때문에 새로운 `chat_session`을 만들지 않는다.

유지 대상:
- chat_session_id
- Conversation History
- K Persona
- Grade Persona
- Relationship Context
- Memory Context
- Safety
- Conversation Health

구조:

```text
Free Chat
→ Play Skill
→ Free Chat
```

Game Session만 별도 Lifecycle을 가진다.

### 3-9. Active 놀이 종료 UI
Active Skill 진행 중 아이가 명확히 놀이를 종료할 수 있는 UI를 제공한다.

모달의 단순 `X 닫기`와 Active Skill 종료는 반드시 구분한다.

```text
선택 모달 X
→ 모달만 닫음

놀이 종료
→ Skill.end()
```

Active 놀이 종료 후 기존 Free Chat으로 복귀한다.

### 3-10. 음성 종료 유지
기존 Router의 stop intent를 유지한다.

예:
- 그만
- 그만할래
- 이제 안 할래
- 게임 그만하자

명확한 종료 발화는 현재 Active Skill을 종료한다.

종료 이후 해당 발화를 gameplay 오답으로 처리하지 않는다.

### 3-11. 다른 Skill로 전환
Active 놀이 중에도 `K놀이` 버튼을 다시 사용할 수 있어야 한다.

예:

```text
WORD_CHAIN ACTIVE
↓
K놀이
↓
CHOSUNG 선택
↓
WORD_CHAIN end
↓
CHOSUNG start
```

새 Skill을 먼저 시작한 뒤 기존 Skill을 종료하지 않는다.

### 3-12. Pending Play Proposal 정리
K가:

```text
“초성게임이나 끝말잇기 할래?”
```

라고 제안한 상태에서 사용자가 UI로 넌센스 퀴즈를 명시 선택했다면:

```text
pending proposal clear
→ NONSENSE start
```

로 처리한다.

UI 선택을 다시 자연어 ambiguity 판정에 넣지 않는다.

### 3-13. 정상 자유대화 종료 시 Active Skill 정리
다음 정상 이탈 경로를 확인한다.
- 자유대화 종료
- 앱 내부 다른 화면 이동
- 정상 뒤로가기
- 기존 chat session 종료 처리

기존 chat session close lifecycle이 있다면 해당 서버 경계에서 Active Skill cleanup을 연계한다.

각 Skill마다 client에서 개별 종료 API를 반복 호출하는 구조는 피한다.

### 3-14. Client 종료 이벤트는 보조 수단으로만 사용
다음은 종료 Source of Truth로 사용하지 않는다.
- React unmount
- `beforeunload`
- `visibilitychange`
- browser close client request

앱 강제 종료/PWA kill/네트워크 단절에서는 request 전달이 보장되지 않기 때문이다.

필요하면 best-effort 보조 처리만 한다.

### 3-15. Server-side Stale Session 처리
현재 조사 결과:
- game session `expires_at` 없음
- game cleanup cron 없음
- 강제 종료 시 `ended_at IS NULL`이 남을 수 있음

따라서 stale Active Session을 서버에서 방어적으로 정리한다.

최소 요구:

```text
Active Session 조회/start 시점
↓
stale 여부 확인
↓
stale이면 Active로 인정하지 않음
↓
안전하게 종료 처리
↓
신규 Skill 시작 허용
```

stale 시간은 각 Skill 파일에 개별 magic number로 넣지 않는다.

공통 Play Lifecycle config 또는 동등한 단일 Source of Truth를 사용한다.

### 3-16. Stale Cleanup 방식
현재 repository 구조를 확인한 후 최소 구현을 선택한다.

가능 구조:

```text
Active Skill Coordinator
→ active session 조회
→ stale 검사
→ cleanup
```

또는:

```text
getActiveSession()
→ stale 검사
→ cleanup
```

필요하다면 Cron을 보조적으로 추가할 수 있으나 Cron만을 유일한 stale 방어 수단으로 사용하지 않는다.

### 3-17. Skill Availability
모달에는 Registry에 존재한다는 이유만으로 모든 Skill을 클릭 가능하게 표시하지 않는다.

현재:
- availability
- enabled
- feature flag
- environment

구조가 있으면 이를 따른다.

미완성 Skill은 Production에서 활성 버튼으로 노출하지 않는다.

### 3-18. 오류 처리
Skill start 실패 시:
- loading 상태 해제
- Active Skill 표시 금지
- gameplay 시작 금지
- 기존 Free Chat 유지
- 사용자에게 짧고 자연스러운 실패 안내

서버 운영 로그에는 필요한 최소 정보만 남긴다.

Secret/API key/token/민감정보 평문 로그 금지.

### 3-19. UI/UX
- 모바일 우선
- 초등학생이 누르기 쉬운 터치 크기
- 놀이명을 쉽게 이해할 수 있어야 함
- 불필요하게 긴 설명 금지
- 현재 Active Skill이 있으면 식별 가능해야 함
- 선택 후 모달 자동 닫기
- 중복 클릭 방지
- 기존 음성 대화 흐름 방해 금지
- 불필요한 고정 높이/빈 공간 생성 금지

## 4. 기존 구조 확인
작업 전 반드시 아래 실제 구현을 다시 확인한다.

### 자유대화 UI
- `app/chat/page.tsx`
- 현재 K놀이 버튼 없음
- 현재 자유대화용 Play Skill 선택 모달 없음

### Skill Registry
- `lib/k-conversation/play/skillRegistry.ts`
- 현재 등록:
  - CHOSUNG
  - WORD_CHAIN
  - NONSENSE_QUIZ

### Skill Interface
- `lib/k-conversation/play/skillTypes.ts`
- 기존 `PlaySkillModule` 계약 재사용 우선

### Skill Router
- `lib/k-conversation/play/skillRouter.ts`
- direct request
- cross-skill 전환
- active session stickiness
- Pending Proposal
- stop
처리 확인

### K Conversation Engine
- `lib/k-conversation/index.ts`
- Free Chat에서 `routePlaySkillTurn()` 호출
- MISSION 진입 시 Skill 종료 처리 존재

### Pending Proposal
- `lib/k-conversation/play/pendingProposalStore.ts`
- `chat_sessions.pending_play_proposal`

### Skill별 Session
확인 대상:
- `chosung_game_sessions`
- `word_chain_game_sessions`
- `nonsense_game_sessions`

현재 각 Skill 내부 active unique constraint 존재 여부를 재확인한다.

### 기존 Source of Truth
- Skill 목록: `PLAY_SKILL_REGISTRY`
- Gameplay state: 각 Skill Session Manager
- CHOSUNG 문제/정답: CHOSUNG deterministic source
- WORD_CHAIN 단어/판정: WORD_CHAIN deterministic source
- NONSENSE 문제/정답: NONSENSE Question Bank
- Active Gameplay 여부: 실제 DB Game Session

### 현재 문제 발생 경로
현재 자유대화에서는:
- K가 놀이 제안
또는
- 아이가 음성/텍스트로 직접 게임 이름을 발화

해야 Skill이 시작된다.

사용자가 UI에서 명시적으로 놀이를 선택하는 경로가 없다.

또한 앱 강제 종료/네트워크 단절 시 stale Active Game Session 정리 경로가 현재 없다.

### 환경 차이
Dev / Production에서:
- Skill availability
- feature flag
- DB migration
- Session table/index
상태 차이가 있는지 구현 전 확인한다.

## 5. 금지사항
- 기존 K Play Skill Engine 전면 재작성 금지
- CHOSUNG/WORD_CHAIN/NONSENSE Rules를 Generic Game Engine 하나로 강제 통합 금지
- UI Skill 선택을 가짜 자연어 child utterance로 변환해 실행 금지
- client child_id를 권위값으로 신뢰 금지
- client game_session_id를 권위값으로 신뢰 금지
- Active Session 생성 전 gameplay 생성 금지
- 한 아이에게 동시에 Active Skill 2개 이상 허용 금지
- 다중 Active 발견 시 단순 첫 번째 Skill 사용만 하고 정상 상태로 간주 금지
- 놀이 시작 시 새 Free Chat Session 생성 금지
- `beforeunload`/unmount만으로 종료 보장 금지
- stale session을 영구 Active로 인정 금지
- Skill 목록을 UI에 별도 하드코딩하여 Registry와 이중 Source of Truth 생성 금지
- `/child/play` 황금열쇠 놀이와 K Play Skill을 무리하게 통합 금지
- 기존 006/007/008 계약 훼손 금지
- Production 실계정 데이터 수동 수정/삭제 금지
- 대표 승인 전 Production 배포 금지

## 6. 모호성 처리
- 문서의 API/파일/table 명칭 예시는 개념적 명칭이며 실제 repository convention을 우선한다.
- 기존 공통 lifecycle/endpoint가 있으면 신규 중복 구현보다 재사용한다.
- Registry metadata가 UI에 부족하면 최소 필드만 확장한다.
- UI와 LLM prompt용 catalog 문자열을 억지로 공유하지 않는다.
- stale timeout 값은 개발자가 임의로 정하지 말고 현재 Free Chat/Skill Session 정책을 확인하여 일관된 값으로 설정한다.
- Cross-skill coordination 구현 때문에 대규모 DB schema 통합이 필요해지는 경우 임의 진행하지 않고 최소 변경 방식을 우선한다.
- 예상과 다른 기존 구현이 발견돼도 006/007/008을 다시 설계하지 않는다.
- 다른 프로젝트(`/child/play` 외부 놀이) 문제라면 본 Request 범위에 섞지 않고 분리한다.
- 모든 변경은 최소 수정 원칙을 따른다.

## 7. QA

### 7-1. K놀이 버튼 / UI QA
환경:
- 모바일
- PWA
- PC

확인:
1. 자유대화 진입
2. K놀이 버튼 표시
3. 기존 마이크/키보드/캐릭터 UI overlap 확인
4. 화면 회전/viewport 변경 확인

PASS:
- 버튼 잘림/겹침/오작동 0건

### 7-2. Skill 선택 모달 QA
1. K놀이 클릭
2. CHOSUNG 표시 확인
3. WORD_CHAIN 표시 확인
4. NONSENSE 표시 확인
5. 모달 X 클릭

PASS:
- X는 모달만 닫고 Active Skill을 종료하지 않음
- unavailable Skill 잘못 노출 0건

### 7-3. CHOSUNG 시작 QA
1. K놀이
2. 초성게임 선택
3. Session DB 확인
4. 첫 gameplay 확인

PASS:
- Active CHOSUNG Session 생성 후에만 gameplay 발생

### 7-4. WORD_CHAIN 시작 QA
동일 절차로 끝말잇기 확인.

PASS:
- Active WORD_CHAIN Session 생성 후에만 gameplay 발생

### 7-5. NONSENSE 시작 QA
동일 절차로 넌센스 퀴즈 확인.

PASS:
- Active NONSENSE Session 생성 후 Question Bank 문제만 출제

### 7-6. Cross-skill 전환 QA
최소 전 조합 테스트:
- CHOSUNG → WORD_CHAIN
- WORD_CHAIN → NONSENSE
- NONSENSE → CHOSUNG

PASS:
- 기존 Skill `ended_at` 기록
- 새 Skill만 Active
- 동시에 2 Active 0건

### 7-7. 동일 Skill 재선택 QA
예:

```text
WORD_CHAIN ACTIVE
→ K놀이
→ WORD_CHAIN 선택
```

PASS:
- 중복 Active Session 생성 0건
- 기존 Session resume 또는 정의된 정상 처리

### 7-8. 음성 종료 QA
각 Skill에서:
- 그만
- 이제 안 할래
- 게임 그만하자

PASS:
- 현재 Skill 종료
- Free Chat 정상 복귀
- 종료 발화를 오답으로 처리하지 않음

### 7-9. UI 종료 QA
Active Skill에서 놀이 종료 UI 선택.

PASS:
- Skill.end 성공
- Active Session 종료
- Free Chat 유지
- 즉시 다른 놀이 시작 가능

### 7-10. 정상 자유대화 이탈 QA
놀이 중:
- 뒤로가기
- 앱 내부 다른 화면 이동
- 정상 대화 종료

PASS:
- 정상 lifecycle에서 Active Skill cleanup
- 재진입 후 신규 놀이 정상

### 7-11. 비정상 종료 / stale QA
테스트:
- browser/PWA 강제 종료
- network 단절
- client end request 미전달 상태

PASS:
- stale 기준 이후 Session이 신규 놀이를 영구 차단하지 않음
- 조회/start 경로에서 방어적 stale 처리 정상

### 7-12. Pending Proposal + UI QA
1. K가 `초성게임이나 끝말잇기 할래?` 제안
2. 아이가 응답하지 않고 K놀이 모달 오픈
3. 넌센스 퀴즈 선택

PASS:
- Pending Proposal clear
- NONSENSE만 시작
- CHOSUNG/WORD_CHAIN 임의 시작 0건

### 7-13. NO ACTIVE SESSION Guard QA
Active Session 없는 상태에서:
- 기존 gameplay history 존재
- play catalog 존재
- 일반 Free Chat 진행

PASS:
- Gemini 임의 게임 문제 생성 0건

### 7-14. 회귀 QA
반드시 확인:
- 일반 Free Chat
- CHOSUNG 직접 음성 요청
- WORD_CHAIN 직접 음성 요청
- NONSENSE 직접 음성 요청
- PLAY_PROPOSAL
- 단일 Pending Proposal 수락
- 복수 Pending Proposal 재선택
- MISSION 진입 시 Active Skill 종료
- 기존 `/child/play` 황금열쇠 놀이

PASS:
- 본 작업으로 기존 기능 신규 오류 0건

## 8. 완료조건
- [ ] 자유대화 K놀이 버튼 구현
- [ ] Skill 선택 모달 구현
- [ ] Skill Registry 기반 목록 연결
- [ ] 명시적 UI Skill Selection 서버 경로 구현
- [ ] 서버 chat ownership 검증
- [ ] child_id server-side derive
- [ ] Single Active Skill coordination 구현
- [ ] Cross-skill 전환 구현
- [ ] 동일 Skill 중복 Session 방지
- [ ] `NO ACTIVE SESSION → NO GAMEPLAY` 보장
- [ ] 동일 Free Chat Session 유지
- [ ] 음성 종료 정상
- [ ] UI 종료 정상
- [ ] 정상 화면 이탈 cleanup
- [ ] stale session 서버 방어 구현
- [ ] Pending Proposal 정리 정상
- [ ] CHOSUNG QA PASS
- [ ] WORD_CHAIN QA PASS
- [ ] NONSENSE QA PASS
- [ ] Cross-skill QA PASS
- [ ] Free Chat 회귀 PASS
- [ ] Mission 회귀 PASS
- [ ] `/child/play` 회귀 PASS
- [ ] BLOCKED/HIGH/MEDIUM 미해결 0건
- [ ] Dev 배포 및 Dev QA 완료
- [ ] 대표 승인 전 Production 임의 배포 없음

## 9. 완료보고
작업 완료 후 반드시 아래를 보고한다.

### 최종 원인
- 기존에 K놀이 UI 진입점이 없었던 원인
- 기존 Cross-skill Active Guard가 불완전했던 구조
- stale Game Session이 남을 수 있었던 원인

### 변경 파일
- 수정 파일 전체 목록
- 신규 파일 전체 목록
- migration이 있다면 migration 파일명

### 구현 방식
- K놀이 버튼 구현 위치
- 모달 데이터 Source
- Skill Selection API/Adapter
- Single Active Skill coordination 방식
- Cross-skill 전환 방식
- stale 판정 기준
- stale cleanup 위치
- 정상 Free Chat 복귀 방식

### 테스트 결과
아래 각각 PASS/FAIL:
- K놀이 버튼
- Skill 모달
- CHOSUNG start
- WORD_CHAIN start
- NONSENSE start
- CHOSUNG → WORD_CHAIN
- WORD_CHAIN → NONSENSE
- NONSENSE → CHOSUNG
- 동일 Skill 재선택
- 음성 종료
- UI 종료
- 정상 화면 이탈
- stale session
- Pending Proposal + UI
- NO ACTIVE SESSION Guard

### 회귀 결과
- Free Chat
- PLAY_PROPOSAL
- 기존 CHOSUNG
- 기존 WORD_CHAIN
- 기존 NONSENSE
- MISSION
- `/child/play`

### Dev / Production 배포 정보
- Dev 배포 여부
- Dev 배포 URL 또는 deployment 정보
- Production 배포 여부
- Production 데이터 변경 여부

### 배포 커밋
- 구현 commit SHA
- Dev 배포 commit SHA
- Production 배포 시 Production commit SHA

최종 상태를 아래 형식으로 종료한다.

```text
BLOCKED:
HIGH:
MEDIUM:
LOW:

Dev 배포:
Production 배포:
Production 데이터 변경:
배포 커밋:
`