008-request-nonsense-quiz-skill.md
# 넌센스 퀴즈 Skill + 학년별 Question Bank + 아이별 재출제 방지 구현

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 아이가 자유대화에서 “넌센스 퀴즈 하자”, “수수께끼 하자”처럼 직접 요청하면 `NONSENSE_QUIZ_SKILL`이 시작된다.
- 문제는 Gemini가 즉석 생성하지 않고 검수된 `nonsense_questions` Question Bank에서만 선택한다.
- 아이 학년, 문제 난이도, 최근 출제 이력, 최근 문제 유형을 고려해 문제를 선택한다.
- 동일 아이에게 최근 180일 이내 출제한 문제는 다시 내지 않는다.
- 아직 한 번도 출제하지 않은 문제를 최우선으로 사용하고, 신규 문제가 소진된 경우에만 180일이 지난 문제 중 가장 오래된 문제부터 재사용한다.
- 문제를 실제로 아이에게 제시한 순간부터 출제 이력을 남겨 Topic Shift나 중도 종료가 있어도 다음 접속에서 같은 문제가 바로 반복되지 않는다.
- 문제/정답/힌트/설명은 DB가 Source of Truth이며 Gemini는 친구다운 말투와 리액션만 담당한다.
- 실제 active nonsense game session이 없는 상태에서는 Gemini가 넌센스 퀴즈를 임의로 시작하거나 문제를 만들어내지 않는다.
- 게임 중 아이가 다른 이야기를 시작하거나 감정/안전 이슈를 말하면 게임보다 현재 아이 발화를 우선하고 동일 Free Chat으로 자연스럽게 복귀한다.

### 대표님 테스트 정상 프로세스
1. Dev의 초1~초6 테스트 아이 각각으로 자유대화에 진입한다.
2. “넌센스 퀴즈 하자”라고 말한다.
3. 해당 아이 학년에 허용된 Question Bank 문제 중 하나가 출제되는지 확인한다.
4. 정답/오답/모르겠어/힌트 요청/그만/Topic Shift를 각각 테스트한다.
5. 같은 아이로 게임을 종료한 뒤 다시 시작한다.
6. 방금 출제된 문제와 최근 180일 이력 문제들이 다시 나오지 않는지 확인한다.
7. 다른 아이 계정에서는 동일 문제가 정상적으로 출제 후보가 되는지 확인한다.
8. DB에서 해당 child_id/question_id의 PRESENTED/ANSWERED/SKIPPED 및 timestamp 기록을 확인한다.
9. active skill session이 없는 일반 Free Chat에서 Gemini가 임의로 넌센스 문제를 생성하지 않는지 확인한다.

PASS 기준:
- 학년 범위 밖 문제 0건
- 최근 180일 동일 아이 재출제 0건
- Question Bank에 없는 Gemini 임의 문제 생성 0건
- 정답 Source of Truth 불일치 0건
- cross-child 출제 이력 오염 0건
- Topic Shift 후 게임 강제 지속 0건

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 구현
- 우선순위: HIGH
- 대상: K Play Skill Platform / Free Chat / NONSENSE_QUIZ_SKILL
- 선행 기준: 006 K Play Skill Platform + WORD_CHAIN 완료 구조, 007 Pending Proposal / Active Skill Session Guard 원칙을 유지한다.
- Production 데이터 직접 수정은 구현 작업 범위가 아니며 Dev 검증 후 기존 배포 게이트를 따른다.

## 2. 목표
1. `NONSENSE_QUIZ_SKILL`을 독립 Skill로 구현한다.
2. 넌센스 문제를 별도 DB Question Bank로 관리한다.
3. 아이별 출제 이력을 별도 저장하여 최근 180일 문제 반복을 차단한다.
4. 문제 선택/정답 판정/힌트/설명/세션 상태는 deterministic하게 운영한다.
5. Gemini는 Rule/정답 Source of Truth가 아니라 K Persona에 맞는 자연스러운 표현과 놀이 리액션을 담당한다.
6. 초1~6 학년별 난이도와 Play Health를 고려해 “맞히기 시험”이 아니라 “친구와 웃고 노는 경험”을 만든다.

## 3. 요구사항

### 3-1. Skill Registry / Routing
- Skill ID는 기존 코드 naming과 Action 구조를 확인해 최소 변경으로 추가한다.
- 개념상 `NONSENSE_QUIZ_SKILL`을 독립 등록한다.
- 직접 요청(예: “넌센스 퀴즈 하자”, “수수께끼 내줘”)은 PLAY_PROPOSAL을 거치지 않고 해당 Skill로 route한다.
- 복수 Skill 제안 후 포괄 수락은 007의 Pending Proposal 규칙을 그대로 따른다.
- Router에 게임별 거대 if/else 체인을 추가하지 말고 현재 Skill Registry 확장 경계를 사용한다.

### 3-2. Gameplay Hard Guard
절대 invariant:
`NO ACTIVE NONSENSE SKILL SESSION -> NO NONSENSE GAMEPLAY GENERATION`

순서:
1. intent 확정
2. Skill.start()
3. server-side child/chat ownership 확인
4. game session 생성 성공
5. active session 확인
6. Question Selector가 DB 문제 확정
7. round/PRESENTED 상태 저장
8. 그 뒤에만 Gemini가 문제를 자연스럽게 발화

- play catalog나 prompt 예시만 보고 Gemini가 임의 문제를 생성하면 안 된다.
- DB Question Bank에 없는 문제/정답/힌트를 gameplay Source of Truth로 사용하지 않는다.

### 3-3. Question Bank
별도 seed 파일:
`008-nonsense-quiz-question-pool.seed.json`

권장 테이블 개념:
`nonsense_questions`

필수 또는 동등 필드:
- id
- concept_key
- question
- canonical_answer
- accepted_answers
- hint_1
- hint_2
- explanation
- category
- pun_type
- difficulty
- min_grade
- max_grade
- status
- child_safe
- source_type
- quality_score
- created_at / updated_at

상태:
- ACTIVE: selector 사용 가능
- REVIEW: 검수 전 후보, Production selector 사용 금지
- REJECTED: 사용 금지
- DEPRECATED: 과거 사용했으나 신규 출제 금지

- JSON의 구조를 현재 DB convention에 맞춰 migration/seed로 변환한다.
- 질문 텍스트를 코드에 하드코딩하지 않는다.
- Gemini가 runtime에 신규 공식 문제를 생성해 DB에 자동 등록하지 않는다.

### 3-4. 학년 / 난이도
- `min_grade <= child.grade <= max_grade`인 문제만 후보로 사용한다.
- difficulty는 1~6 정수로 관리한다.
- 초기 baseline:
  - G1: D1~2 중심
  - G2: D1~3 중심
  - G3: D2~4 중심
  - G4: D2~5 중심
  - G5: D3~6 중심
  - G6: D3~6 중심
- 어려운 문제를 아이가 스스로 맞혔다고 해서 답을 부정하지 않는다.
- 난이도는 K가 선택할 문제를 조절하기 위한 값이지 아이 정답 인정 제한이 아니다.

### 3-5. 아이별 출제 이력
별도 테이블 또는 동등 구조:
`nonsense_question_history`

최소 필드:
- id
- child_id
- question_id
- first_presented_at
- last_presented_at
- play_count
- last_outcome
- last_hint_count
- last_game_session_id
- created_at
- updated_at

중요:
- `nonsense_questions.used=true` 같은 global flag 금지.
- 동일 문제를 서아가 사용해도 다른 아이의 후보에서는 제외되면 안 된다.
- child_id + question_id 기준으로 이력을 관리한다.
- 질문을 아이에게 실제로 발화하기 직전/확정된 round에서 PRESENTED 이력을 기록하여 중도 Topic Shift도 반복 방지 대상이 되게 한다.

### 3-6. 180일 Cooldown / Recycle
V1 기본 정책:
- 동일 child에게 최근 180일 이내 PRESENTED된 문제는 후보에서 제외.
- 한 번도 출제되지 않은 NEW 문제를 최우선.
- NEW 문제 후보가 존재하는 동안 recycle 문제를 사용하지 않는다.
- NEW가 완전히 소진되면 180일 초과 문제 중 `last_presented_at ASC`(가장 오래된 문제 우선)로 recycle한다.
- 180일 이내 문제밖에 남지 않았으면 같은 문제를 억지로 재출제하지 말고 Skill Brain이 자연스럽게 다른 놀이/Free Chat 선택지를 제공한다.
- cooldown 값은 코드 곳곳에 magic number로 퍼뜨리지 말고 Skill config 한 곳에서 관리한다.

### 3-7. Question Selector
우선순위:
1. ACTIVE + child_safe
2. 학년 범위 일치
3. 최근 180일 child history 제외
4. NEW 문제 우선
5. 현재 Play Difficulty 적합
6. 직전 round와 동일 pun_type/category 연속 반복 최소화
7. 동일 조건에서는 deterministic/random-safe selection 사용
8. NEW 소진 시 180일 초과 oldest-first recycle

- 동시 요청으로 같은 child에게 동일 question이 중복 확정되지 않도록 transaction/locking/idempotency를 현재 DB 구조에 맞게 보장한다.

### 3-8. Round / Outcome
별도 `nonsense_game_rounds` 또는 현재 Session Manager convention에 맞는 동등 구조를 사용한다.

최소 상태:
- PRESENTED
- ANSWERED_CORRECT
- ANSWERED_INCORRECT
- SKIPPED
- TOPIC_SHIFT
- ENDED

최소 telemetry:
- game_session_id
- child_id
- question_id
- presented_at
- answered_at
- outcome
- hint_count
- child_answer_normalized

- 원문 대화 보존 정책과 충돌하지 않도록 gameplay 운영에 필요한 최소 데이터만 저장한다.

### 3-9. Answer Validator
- canonical_answer + accepted_answers를 Source of Truth로 사용한다.
- 공백/문장부호/가벼운 종결 표현 등 명백한 normalization만 deterministic하게 처리한다.
- fuzzy match로 다른 답을 정답 처리하지 않는다.
- Gemini 단독 판단으로 정답/오답을 뒤집지 않는다.
- 애매한 STT 결과는 현재 STT 보정 정책/원문을 고려하되 확정이 어려우면 자연스럽게 재확인한다.

### 3-10. Hint / Explanation
- hint_1 -> hint_2 -> answer reveal 순서를 기본으로 한다.
- 아이가 바로 정답 공개를 요청하면 강제로 힌트를 거치지 않는다.
- explanation은 DB 값이 의미 Source of Truth다.
- Gemini는 explanation 의미를 바꾸지 않고 또래 친구 말투로 짧게 표현한다.
- 교사식 “정답입니다/오답입니다” 진행을 기본값으로 사용하지 않는다.

### 3-11. Nonsense Skill Brain
K는 퀴즈 진행자가 아니라 같이 웃고 노는 같은 나이 친구다.

행동:
- 정답: 짧고 즐거운 리액션
- 오답: 놀리거나 평가하지 않고 재미있게 이어감
- “모르겠어”: 힌트 제안 또는 답 공개 선택권
- 여러 번 막힘: 더 쉬운 문제로 회복
- 아이가 지루해함: 다른 유형/다른 놀이/Free Chat 제안
- “그만”: 즉시 종료
- 아이가 자기 문제를 내고 싶어함: 가능한 범위에서 CHILD_AS_QUIZ_MASTER 전환을 지원하되 아이가 낸 문제를 공식 Question Bank에 자동 등록하지 않는다.

### 3-12. Play Health
최소:
- ENGAGED
- EXCITED
- CHALLENGED
- STRUGGLING
- FRUSTRATED
- BORED
- WANTS_TO_STOP

입력 신호:
- 최근 정답/오답
- hint 횟수
- skip
- 짧은 반복 답변
- 명시적 “몰라/재미없어/그만”
- 현재 child utterance

- LLM 감정 추측 하나만으로 상태를 확정하지 않는다.
- FRUSTRATED/BORED면 난이도 상승이나 연속 문제 출제를 강제하지 않는다.

### 3-13. Session Lifecycle
Skill과 한 판 Session을 분리한다.

- ACTIVE
- SUSPENDED 또는 현재 공통 lifecycle의 동등 상태
- ENDED

- 게임 시작 시 새 Free Chat conversation session을 만들지 않는다.
- 기존 chat_session_id 안에서 gameplay를 진행한다.
- Topic Shift -> game session 종료 또는 안전한 suspend 후 동일 Free Chat으로 복귀.
- 다른 Skill 시작 -> 기존 active Skill coordination 규칙으로 충돌 방지.
- stale session 때문에 새 게임이 영구 차단되지 않게 현재 플랫폼의 stale 정책을 적용한다.

### 3-14. Memory
Long-term Memory 저장 금지:
- 어느 문제를 몇 번 풀었는지
- 현재 문제
- 힌트 횟수
- 정답률
- 현재 난이도
- 게임 session state

위 값은 Gameplay History/Telemetry에서 관리한다.

장기 Memory 후보는 기존 Memory 정책을 따르며 예:
- “넌센스 퀴즈를 좋아한다”처럼 반복적으로 확인된 선호만 별도 Memory pipeline이 판단한다.

### 3-15. Safety / Topic Shift
게임 중:
- “오늘 친구랑 싸웠어”
- “나 속상해”
- “짜증나”
등 현재 아이의 의미 있는 이야기가 나오면 오답 처리하지 않는다.

우선순위:
`현재 child utterance > gameplay`

- 감정/안전/관계 대화를 우선하고 동일 Free Chat으로 handoff한다.
- 성인/성적/혐오/비하/과도한 폭력/특정 집단 희화화 문제는 Question Bank ACTIVE 금지.

### 3-16. Question Pool Import
- `008-nonsense-quiz-question-pool.seed.json`을 읽어 현재 DB convention에 맞는 seed/import를 구현한다.
- idempotent해야 한다.
- `concept_key`를 stable key로 사용하거나 현재 schema에 맞는 동등한 unique key를 둔다.
- 재실행 시 중복 row를 생성하지 않는다.
- REVIEW는 DB에 적재할 수 있으나 Production selector 대상에서 반드시 제외한다.
- invalid grade/difficulty/빈 답/중복 concept_key/중복 normalized question/child_safe=false ACTIVE 등을 자동 검증한다.
- 문제은행 변경만을 위해 핵심 Skill 코드 배포가 필요하지 않는 구조를 우선한다.

## 4. 기존 구조 확인
구현 전 반드시 실제 repository 기준으로 확인:
- 006에서 구현된 Skill Registry interface / WORD_CHAIN 경계
- 007 Pending Proposal / Active Session Guard
- CHOSUNG Session Manager / telemetry
- Free Chat Action 결정 -> Skill Router -> Response Generator 실제 호출 순서
- child grade server-side source
- chat_session ownership 확인 방식
- 현재 Supabase migration/seed convention
- current active skill coordination
- stale session 처리
- STT normalization 경계

기존 구조와 본 문서의 예시 명칭이 다르면 기존 convention을 우선하되 요구되는 invariant는 유지한다.

## 5. 금지사항
- Gemini runtime 즉석 문제를 공식 gameplay 문제로 사용 금지
- Question Bank 없이 prompt 예시만으로 게임 진행 금지
- active Skill Session 생성 전 gameplay 생성 금지
- global `used` flag로 전체 사용자 문제 차단 금지
- 최근 180일 동일 child 문제 재출제 금지
- client child_id/game_session_id 권위값 신뢰 금지
- CHOSUNG word pool/WORD_CHAIN dictionary 재사용 금지
- 게임별 Rules/State를 Generic Game Engine으로 대규모 통합 금지
- ConversationAction 대규모 nested refactor 금지
- 게임 telemetry를 장기 Memory로 저장 금지
- REVIEW 문제를 Production gameplay에 노출 금지
- 비밀키/토큰 평문 로그·하드코딩 금지

## 6. 모호성 처리
- 실제 파일명/interface/table convention은 현재 repository를 우선한다.
- 요구사항을 충족하는 기존 공통 utility가 있으면 재사용한다.
- 구조적으로 중요한 충돌이 발견되면 임의 대규모 refactor하지 말고 최소 변경안을 선택하고 완료보고에 명시한다.
- Question Pool 콘텐츠의 의미/정답을 개발 과정에서 임의 변경하지 않는다. 명백한 오탈자는 별도 변경 목록으로 보고한다.

## 7. QA

### 7-1. Question Bank 자동 검증
- JSON parse PASS
- concept_key unique
- normalized question duplicate 검사
- canonical_answer non-empty
- accepted_answers에 canonical normalization 포함
- 1 <= min_grade <= max_grade <= 6
- 1 <= difficulty <= 6
- ACTIVE -> child_safe=true
- ACTIVE -> hint_1/hint_2/explanation non-empty
- status enum 검증

### 7-2. 학년 Selector
초1~6 각각:
- 허용 학년 밖 문제 0건
- baseline difficulty 후보 정상
- 인접 난이도 fallback 정상

### 7-3. 180일 History
동일 child:
- 오늘 출제 -> 즉시 재게임 -> 동일 문제 제외
- 30일 전 -> 제외
- 179일 전 -> 제외
- 180일 경계 처리 명시 및 테스트
- 181일 전 + NEW 존재 -> NEW 우선
- 181일 전 + NEW 없음 -> recycle 가능
- 다른 child -> 동일 문제 후보 가능

### 7-4. Presented / 중도 이탈
- 문제 제시 직후 Topic Shift
- 앱 이탈
- “그만”
각 경우에도 방금 들은 문제가 최근 출제 문제로 남아 즉시 반복되지 않는지 검증.

### 7-5. Answer Validation
- canonical exact
- accepted alias
- 공백/문장부호 normalization
- 오답
- STT 애매
- “몰라”
- 힌트 1/2
- 정답 공개

### 7-6. Gameplay Guard
- active session 없음 + 일반 대화 -> Gemini 임의 문제 0
- 복수 Skill proposal + “하자” -> 임의 Skill start 0
- Nonsense direct intent -> session 생성 후에만 문제 출제
- stale/cross-game active 충돌 테스트

### 7-7. Topic Shift / Safety
- 친구 갈등
- 속상함
- 짜증
- 그만
- 다른 놀이 요청
각 시나리오에서 오답 처리 없이 Free Chat/Skill 전환 정상.

### 7-8. 대표 시나리오
최소 Dev E2E:
- G1 정상 정답
- G2 오답 -> hint -> 정답
- G3 “모르겠어” -> answer reveal
- G4 연속 성공 -> 난이도 조절
- G5 연속 실패 -> recovery
- G6 CHILD_AS_QUIZ_MASTER
- 최근 180일 문제 제외
- 다른 child에는 동일 문제 허용
- Topic Shift
- NO ACTIVE SESSION guard

## 8. 완료조건
- NONSENSE_QUIZ_SKILL 독립 등록/실행
- Question Bank DB + seed/import 완료
- child별 question history 완료
- 180일 cooldown 완료
- NEW-first + oldest recycle 완료
- deterministic answer validator 완료
- difficulty/category/pun_type selector 완료
- hint/explanation Source of Truth 완료
- Play Health/Recovery 완료
- Topic Shift/Free Chat continuity 완료
- active session gameplay guard 완료
- 자동 테스트 및 대표 E2E PASS
- 기존 CHOSUNG/WORD_CHAIN/Free Chat regression PASS

## 9. 완료보고
완료 시 아래 형식으로 보고:
1. 변경 파일 목록
2. migration / table / index 목록
3. Question Bank 적재 건수: ACTIVE / REVIEW / 제외 건수
4. 학년별 실제 후보 건수
5. 180일 cooldown 구현 위치와 경계 조건
6. Selector 우선순위 구현 요약
7. Gameplay Guard 증빙
8. 자동 테스트 결과
9. Dev E2E 결과
10. 미해결 BLOCKER/HIGH/MEDIUM
11. Production 배포 여부(대표 승인 전 임의 Production 변경 금지)
