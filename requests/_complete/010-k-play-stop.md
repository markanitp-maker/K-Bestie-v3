# Production K놀이 Skill 일시 중지 및 Dev QA 전용 운영 전환 요청

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- Production에서는 K Play Skill 전체가 일시 중지되어 초성게임·끝말잇기·넌센스 퀴즈가 시작되지 않는다.
- Production 자유대화 화면의 `케이 놀이` 버튼은 클릭 가능한 놀이 진입 버튼이 아니라 `준비중` 상태로 표시된다.
- Production 자유대화에서 케이가 아이에게 먼저 놀이를 제안하지 않는다.
- Production 자유대화에서 아이가 `초성게임 하자`, `끝말잇기 하자`, `넌센스 퀴즈 하자`, `놀자` 등 놀이를 요청해도 Skill Session을 시작하지 않는다.
- 놀이 요청 시 케이는 `놀이는 지금 준비 중이며 편하게 대화는 가능하다`는 의미로 짧고 자연스럽게 안내한 뒤 Free Chat을 계속한다.
- Production에서 Gemini가 우회적으로 게임 문제를 생성하거나 게임을 하는 척하지 않는다.
- Dev에서는 기존 K Play Skill을 계속 사용할 수 있어 대표님이 전체 QA를 수행할 수 있다.
- Dev에서 대표님 QA가 모두 PASS되기 전에는 K Play Skill을 Production에서 다시 활성화하지 않는다.
- 기존 놀이 데이터·Session History·Question Bank·Dictionary는 삭제하지 않는다.

### 대표님 테스트 정상 프로세스
1. Production 아이 계정으로 자유대화에 진입한다.
2. `케이 놀이` 영역이 `준비중`으로 표시되는지 확인한다.
3. 자유대화를 몇 턴 진행하며 케이가 먼저 놀이를 제안하지 않는지 확인한다.
4. 아이가 `초성게임 하자`라고 말한다.
5. Skill이 시작되지 않고 케이가 놀이 준비 중 안내 후 Free Chat을 계속하는지 확인한다.
6. 동일하게 `끝말잇기 하자`, `넌센스 퀴즈 하자`, `우리 놀자`를 테스트한다.
7. 어떤 경우에도 game session이 신규 생성되지 않는지 확인한다.
8. Dev 아이 계정에서는 기존 K놀이 버튼 및 Skill이 정상 동작하는지 확인한다.
9. Dev에서 초성게임·끝말잇기·넌센스 퀴즈 및 Skill 전환/종료/Free Chat 복귀를 전체 QA한다.
10. 대표님 QA 승인 전 Production에서 K Play Skill이 계속 비활성 상태인지 확인한다.

PASS 기준:
- Production 신규 Play Skill Session 생성 0건
- Production K 선제 놀이 제안 0건
- Production 아이 놀이 요청 후 Skill 시작 0건
- Production Gemini 임의 Gameplay 생성 0건
- Production `케이 놀이` UI가 `준비중` 상태로 표시
- 일반 Free Chat 정상 동작
- Dev에서는 K Play Skill QA 가능
- 대표님 승인 전 Production 재활성화 0건

## 1. 상태 / 우선순위 / 대상
- 상태: 긴급 운영 정책 변경
- 우선순위: CRITICAL
- 대상 프로젝트: `K-Bestie-v3`
- 개발 주체: Claude Code
- 적용 대상:
  - Production 자유대화
  - K Play Skill Platform
  - PLAY_PROPOSAL
  - PLAY_SKILL_ROUTER
  - CHOSUNG
  - WORD_CHAIN
  - NONSENSE_QUIZ
  - 자유대화 `케이 놀이` UI
- 제외 대상:
  - Dev의 K Play Skill 기능 제거
  - 기존 게임 DB 데이터 삭제
  - Question Bank 삭제
  - WORD_CHAIN Dictionary 삭제
  - CHOSUNG Pool 삭제
  - NONSENSE Question Bank 삭제
  - 기존 Skill 구조 전면 재설계
  - `/child/play` 등 별도 외부 놀이 기능은 실제 연관 여부 확인 후 본 요청과 무관하면 변경하지 않음

## 2. 목표
현재 Production의 K Play Skill 품질 문제로 실제 아이 사용 경험이 악화되고 있으므로 Production에서 놀이 기능을 임시 중지한다.

중지 기간에는:

```text
Production

Free Chat
├─ 일반 대화: 정상 사용
├─ K 선제 놀이 제안: 차단
├─ 아이 놀이 요청: 준비중 안내
├─ K놀이 버튼: 준비중
└─ Play Skill Session 생성: 차단
```

Dev에서는:

```text
Dev

Free Chat
└─ K Play Skill 전체 기능 유지
   ↓
대표님 QA
   ↓
모든 주요 시나리오 PASS
   ↓
대표님 승인
   ↓
Production 재활성화
```

최종 목적은 놀이 기능을 삭제하는 것이 아니라 Production 노출만 안전하게 차단한 상태에서 Dev에서 충분한 QA를 완료한 뒤 다시 활성화하는 것이다.

## 3. 요구사항

### 3-1. Production K Play Skill 전체 비활성화
Production에서는 다음 Skill 신규 시작을 모두 차단한다.

- CHOSUNG
- WORD_CHAIN
- NONSENSE_QUIZ
- 향후 Registry에 추가된 모든 K Play Skill

게임별 조건문으로 각각 막지 말고 K Play Platform의 공통 진입 지점에서 환경별 활성화 여부를 관리한다.

가능하면 기존 Feature Flag / config 구조를 우선 사용한다.

기존 구조가 없다면 K Play 전용 중앙 설정을 추가한다.

개념:

```text
K_PLAY_ENABLED

Dev = true
Production = false
```

실제 naming은 현재 프로젝트 convention을 따른다.

### 3-2. Server-side Kill Switch
UI만 숨기는 방식으로 구현하면 안 된다.

Production에서는 서버에서도 Skill start가 반드시 차단되어야 한다.

다음 모든 진입 경로에서 동일하게 차단한다.

- UI K놀이 선택
- 음성 직접 요청
- 텍스트 직접 요청
- PLAY_PROPOSAL
- Pending Proposal 수락
- 다른 Skill에서 전환
- 내부 Router 호출

절대 규칙:

```text
PRODUCTION K_PLAY_ENABLED = false
→ NO PLAY SKILL START
```

### 3-3. 케이 놀이 버튼 `준비중` 표시
Production 자유대화 화면의 현재 `케이 놀이` UI를 `준비중` 상태로 변경한다.

요구:
- 아이가 봤을 때 현재 놀이를 사용할 수 없다는 것이 명확해야 한다.
- 기존 놀이 선택 모달이 열리지 않아야 한다.
- 클릭 가능한 상태로 놀이가 시작되는 것처럼 보여서는 안 된다.
- 기존 자유대화 UI 배치를 불필요하게 재구성하지 않는다.

Dev에서는 기존 K놀이 UI를 유지하여 QA가 가능해야 한다.

### 3-4. K의 선제 놀이 제안 완전 차단
Production에서 `PLAY_PROPOSAL`을 비활성화한다.

다음과 같은 상황에서도 케이가 놀이를 먼저 권하지 않는다.

```text
아이: 심심해
아이: 뭐 하지?
아이: 재미있는 거 없어?
아이: 놀고 싶다
```

Production에서는:

```text
PLAY_PROPOSAL
→ 실행하지 않음
```

일반 Free Chat Persona가 자연스럽게 대화를 이어간다.

### 3-5. 아이가 놀이를 요청한 경우
Production에서 아이가 직접 놀이를 요청해도 Skill을 시작하지 않는다.

대상 예:
- 초성게임 하자
- 끝말잇기 하자
- 넌센스 퀴즈 하자
- 게임하자
- 놀자
- 우리 뭐 하고 놀까
- 케이야 문제 내줘

응답 의미:

```text
놀이는 지금 준비 중이야.
우리 지금은 편하게 얘기하자.
```

실제 문장은 K Persona에 맞게 짧고 자연스럽게 표현한다.

예시:

```text
“놀이는 지금 준비 중이야! 우리 그냥 편하게 얘기하자 😊”
```

단:
- 매번 동일 문장을 기계적으로 반복할 필요는 없다.
- 의미는 변하지 않아야 한다.
- 다른 게임을 임의 제안하면 안 된다.
- 놀이 대신 Free Chat을 자연스럽게 계속한다.

### 3-6. Gameplay 생성 완전 차단
Production K Play 비활성 상태에서는 Gemini가 다음을 하면 안 된다.

- 초성 문제 즉석 생성
- 끝말잇기 시작
- 넌센스 문제 생성
- 점수/턴/정답 판정
- 게임 진행자인 척 대화

절대 invariant:

```text
K_PLAY_DISABLED
→ NO ACTIVE PLAY SESSION
→ NO GAMEPLAY GENERATION
```

### 3-7. 기존 Active Session 처리
Production 배포 시점에 `ended_at IS NULL`인 기존 Active Play Session이 존재할 가능성을 확인한다.

비활성화 이후 해당 Session을 신규 gameplay에 사용하지 않는다.

새 Free Chat 요청이 들어올 경우:
- 기존 Active Play Session을 정상 종료 또는 disabled 상태로 무효화
- gameplay를 재개하지 않음
- Free Chat으로 처리

Production 데이터를 대량 수동 삭제하지 않는다.

필요한 cleanup은 기존 Session Manager/end lifecycle을 사용한다.

### 3-8. Pending Play Proposal 처리
Production 비활성화 시 기존 `pending_play_proposal`이 남아 있어도 Skill을 시작하면 안 된다.

K Play disabled 상태에서는:
- Pending Proposal start 금지
- 기존 Pending Proposal을 안전하게 clear
- 일반 Free Chat 유지

### 3-9. Dev에서는 K Play 유지
Dev 환경에서는 K Play 기능을 계속 활성 상태로 유지한다.

대표님이 다음 전체 기능을 QA할 수 있어야 한다.

- K놀이 버튼
- Skill 선택 Modal
- CHOSUNG
- WORD_CHAIN
- NONSENSE
- 직접 음성 요청
- PLAY_PROPOSAL
- Pending Proposal
- Skill 전환
- 게임 종료
- Topic Shift
- Free Chat 복귀
- Active Skill Guard
- stale session
- Gameplay Source of Truth

### 3-10. Production 재활성화 Gate
Production K Play 재활성화는 자동으로 수행하지 않는다.

조건:

```text
Dev 구현 완료
↓
자동 QA PASS
↓
대표 시나리오 QA PASS
↓
대표님 직접 QA PASS
↓
대표님 명시적 승인
↓
Production 활성화
```

대표님 승인 이전:
- Production flag 활성화 금지
- Production 놀이 UI 활성화 금지
- Production Skill start 허용 금지

## 4. 기존 구조 확인
작업 전 반드시 실제 구현을 확인한다.

확인 대상:

- `app/chat/page.tsx`
  - 현재 K놀이 버튼 구현 상태
  - Production/Dev UI 분기 가능 위치

- `lib/k-conversation/play/skillRegistry.ts`
  - PLAY_SKILL_REGISTRY
  - 현재 등록 Skill

- `lib/k-conversation/play/skillRouter.ts`
  - direct Skill request
  - Active Skill
  - cross-skill
  - Pending Proposal
  - stop 처리

- `lib/k-conversation/play/playProposal.ts`
  - K 선제 놀이 제안 발생 경로

- `lib/k-conversation/play/pendingProposalStore.ts`
  - pending proposal 저장/clear 방식

- `lib/k-conversation/index.ts`
  - Free Chat → Play Router 호출 위치
  - Gameplay 응답 생성 이전 차단 가능 경계

- 각 Skill:
  - CHOSUNG
  - WORD_CHAIN
  - NONSENSE_QUIZ

기존 Source of Truth:
- Skill 목록: `PLAY_SKILL_REGISTRY`
- Skill 실행: Skill Router / 각 Session Manager
- 게임 상태: 각 Game Session DB
- Free Chat: K Conversation Engine

현재 Feature Flag/config/env 구조가 있다면 신규 중복 flag를 만들지 말고 기존 방식을 우선한다.

Dev/Production 환경값이 명확히 분리되어 있는지 확인한다.

## 5. 금지사항
- K Play 관련 DB/Question Bank/Dictionary 삭제 금지
- 놀이 코드를 통째로 제거 금지
- Dev에서도 Skill을 비활성화하는 구현 금지
- UI만 `준비중`으로 바꾸고 서버 Skill start는 살아 있는 상태 금지
- 특정 Skill만 차단하고 다른 Skill은 Production에서 실행 가능한 상태 금지
- Gemini에게 Prompt만으로 “게임하지 마”라고 지시하고 서버 Guard를 생략하는 구현 금지
- direct voice/text request 우회 실행 허용 금지
- Pending Proposal 우회 실행 허용 금지
- 기존 Active Session 자동 resume 금지
- Production 실계정 gameplay 데이터 수동 삭제 금지
- 기존 Free Chat 기능 변경 금지
- 대표님 승인 없이 Production K Play 재활성화 금지
- 대표님 승인 없이 Production에 QA 중인 놀이 기능 배포/활성화 금지

## 6. 모호성 처리
- 기존 Feature Flag 구조가 있으면 이를 재사용한다.
- 없으면 최소 범위의 공통 K Play kill switch를 만든다.
- `NODE_ENV`만으로 환경을 추정해야 하는 구조보다 현재 프로젝트의 명확한 deployment/environment convention을 우선한다.
- `/child/play`가 K Conversation Skill Platform과 별개라면 본 Request에서 수정하지 않는다.
- 기존 Active Session cleanup 방식이 예상과 다르면 기존 Session Manager 계약을 우선한다.
- Production 차단을 위해 각 Skill 코드를 개별 수정하는 것보다 공통 상위 경계 차단을 우선한다.
- Free Chat 응답 정책까지 대규모 변경하지 않는다.
- 최소 수정으로 Production 노출/실행만 확실하게 차단한다.

## 7. QA

### 7-1. Production UI QA
1. Production 자유대화 진입
2. K놀이 영역 확인

PASS:
- `준비중` 표시
- Skill 선택 Modal 미오픈
- Skill 시작 불가

### 7-2. Production 선제 제안 QA
아이 발화:
- 심심해
- 재미있는 거 없어?
- 뭐 하지?
- 놀고 싶어

PASS:
- K 선제 Play Skill 제안 0건
- 일반 Free Chat으로 자연스럽게 대화

### 7-3. Production 직접 놀이 요청 QA
각각 테스트:
- 초성게임 하자
- 끝말잇기 하자
- 넌센스 퀴즈 하자
- 게임하자
- 놀자

PASS:
- game session 신규 생성 0건
- 준비중 안내
- Free Chat 지속

### 7-4. Production Gameplay Guard QA
다음 상태에서 테스트:
- 과거 game history 존재
- pending proposal 존재
- stale active session 존재
- direct intent 존재

PASS:

```text
K_PLAY_DISABLED
→ gameplay 0건
```

### 7-5. 기존 Active Session QA
Production에 Active Session이 있는 테스트 상태를 구성하거나 Dev에서 동일 조건을 재현한다.

PASS:
- 기존 Session 자동 resume 안 함
- Skill gameplay 재개 안 함
- Free Chat 정상

### 7-6. Dev K Play QA
Dev에서:
- K놀이 Modal
- CHOSUNG
- WORD_CHAIN
- NONSENSE
- direct request
- PLAY_PROPOSAL
- Skill switch
- Skill end

PASS:
- 기존 기능 QA 가능

### 7-7. Dev 전체 대표 시나리오 QA
각 Skill에 대해:
- 정상 시작
- 정상 답변
- 오답
- 힌트
- 중도 종료
- Topic Shift
- 다른 Skill 전환
- Free Chat 복귀
- Session 재접속
- stale 처리

PASS:
- BLOCKED/HIGH/MEDIUM 0건

### 7-8. Free Chat 회귀 QA
Production/Dev 모두:
- 일반 대화
- 감정 대화
- Memory 활용
- Topic Shift
- 음성 입력
- STT
- K 응답

PASS:
- K Play 비활성화로 Free Chat 신규 오류 0건

### 7-9. Production 재활성화 Gate QA
대표님 승인 전 확인:

PASS:
- Production K Play disabled 유지
- `준비중` 유지
- Skill Session 신규 생성 0건

## 8. 완료조건
- [ ] Production K Play 중앙 비활성화 구현
- [ ] Production 서버 Skill start 차단
- [ ] Production `케이 놀이` 버튼 `준비중` 처리
- [ ] Production PLAY_PROPOSAL 차단
- [ ] Production direct 놀이 요청 차단
- [ ] 놀이 요청 시 준비중 + Free Chat 안내
- [ ] Production Gameplay Generation 차단
- [ ] Pending Proposal 우회 차단
- [ ] 기존 Active Session 자동 resume 차단
- [ ] Dev K Play 기능 유지
- [ ] Production Free Chat 정상
- [ ] Production 신규 game session 0건
- [ ] Dev 전체 K Play QA 가능
- [ ] 자동 테스트 PASS
- [ ] 회귀 테스트 PASS
- [ ] 대표님 QA 전 Production 재활성화 없음
- [ ] 대표님 전체 Dev QA PASS 이후에만 Production 재활성화 가능
- [ ] BLOCKED/HIGH/MEDIUM 0건

## 9. 완료보고
완료 후 반드시 아래 내용을 보고한다.

### 최종 원인
- Production K Play Skill을 임시 중지하게 된 운영 원인
- 기존 Production에서 놀이가 실행되던 진입 경로
- 이번 차단 지점

### 변경 파일
- 수정 파일 전체 목록
- 신규 파일 전체 목록
- Feature Flag/config 변경 파일
- migration 발생 여부

### 구현 방식
- Production/Dev 환경 분리 방식
- K Play Kill Switch Source of Truth
- UI `준비중` 처리 방식
- PLAY_PROPOSAL 차단 방식
- direct request 차단 방식
- Pending Proposal 처리 방식
- 기존 Active Session 처리 방식
- Gameplay Guard 위치

### 테스트 결과
PASS/FAIL:
- Production K놀이 준비중
- Production 선제 놀이 제안 차단
- Production CHOSUNG 요청 차단
- Production WORD_CHAIN 요청 차단
- Production NONSENSE 요청 차단
- Production 일반 놀자 요청 차단
- Production game session 신규 생성 차단
- Pending Proposal 차단
- 기존 Active Session resume 차단
- Production Free Chat
- Dev K Play

### 회귀 결과
- Free Chat
- STT
- Memory
- Conversation Health
- Mission
- CHOSUNG Dev
- WORD_CHAIN Dev
- NONSENSE Dev

### Dev / Production 배포 정보
- Dev 배포 여부
- Production 배포 여부
- Production K Play 활성 상태
- Production 데이터 변경 여부

### 배포 커밋
- 구현 commit SHA
- Dev 배포 commit SHA
- Production 차단 배포 commit SHA

최종 보고:

```text
BLOCKED:
HIGH:
MEDIUM:
LOW:

Dev K Play:
Production K Play:
Production 케이 놀이 UI:
대표님 Dev QA:
Production 재활성화 승인:
Dev 배포:
Production 배포:
Production 데이터 변경:
배포 커밋:
```