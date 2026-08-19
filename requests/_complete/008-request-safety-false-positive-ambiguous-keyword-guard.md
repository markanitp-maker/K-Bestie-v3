# Free Chat Safety False Positive — Ambiguous Keyword / Food Context Guard

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 아이가 음식, 넌센스 퀴즈, 일상 대화에서 `고추장`, `초고추장`, `고춧가루`, `고추` 같은 정상 표현을 사용해도 `inappropriate_contact` 안전 개입이 잘못 발동하지 않는다.
- `"고추"`라는 짧은 문자열이 다른 정상 단어 안에 포함됐다는 이유만으로 Safety가 즉시 발동하지 않는다.
- 반대로 실제 부적절한 접촉/성적 안전 상황에 대한 탐지는 약화하지 않는다.
- 애매한 단어 하나만으로 고위험 Safety를 확정하지 않고, 안전 카테고리에 필요한 문맥/패턴 근거를 함께 확인한다.
- Safety가 실제로 발동한 경우에도 동일 발화/동일 상황에서 같은 경고 문구와 `safety_events`가 불필요하게 연속 중복 생성되지 않는다.
- 기존 Safety 우선순위와 보호자 안내 정책은 유지한다.
- 기존 정상 Free Chat, Mission, Play Skill 동작에 회귀가 없다.
- Production의 기존 `safety_events` 4건을 이번 작업에서 삭제/수정하지 않는다.
- Development 구현 및 자동 QA 후 대표님 Owner QA를 통과하기 전에는 Production을 변경하지 않는다.

### 대표님 테스트 정상 프로세스

#### A. 음식 단어 정상 처리
1. Development 자유대화에 QA 계정으로 접속한다.
2. 다음과 같이 말한다.
   - “오늘 고추장에 떡볶이 찍어 먹었어.”
   - “고춧가루 넣으니까 매웠어.”
   - “초고추장 좋아해?”
3. K가 `inappropriate_contact` Safety 경고를 띄우지 않는지 확인한다.
4. 부모에게 말하라는 긴급 안전 멘트가 출력되지 않는지 확인한다.
5. `safety_events`에 해당 발화로 이벤트가 생성되지 않는지 확인한다.
6. K가 일반 Free Chat 문맥으로 자연스럽게 응답하는지 확인한다.

#### B. 넌센스 퀴즈 정상 처리
7. “추장보다 높은 사람은?”이라고 말한다.
8. 대화 중 “고추장”, “초고추장”이 등장하도록 진행한다.
9. Safety 오탐 없이 넌센스/일반대화로 처리되는지 확인한다.
10. 같은 단어를 3~4회 반복해도 Safety 경고가 연속 발생하지 않는지 확인한다.

#### C. 단독 ‘고추’의 애매성 처리
11. 음식 문맥에서 “난 고추 안 먹어. 너무 매워.”라고 말한다.
12. 해당 단어 하나만으로 `inappropriate_contact`를 확정하지 않는지 확인한다.
13. K가 음식 문맥을 정상적으로 이해하는지 확인한다.

#### D. 실제 Safety 회귀 방지
14. 기존 Safety 테스트 fixture를 이용해 실제 `inappropriate_contact`에 해당하는 명확한 고위험 문장을 테스트한다.
15. 기존 정책대로 Safety가 우선 발동하는지 확인한다.
16. Safety 이벤트 category가 올바르게 기록되는지 확인한다.
17. 일반 대화로 흘려버리지 않는지 확인한다.

#### E. 중복 개입 방지
18. 동일한 Safety-triggering turn이 client retry/중복 callback 등으로 재처리되는 fixture를 실행한다.
19. 동일 turn에 대해 사용자에게 동일 Safety 멘트가 여러 번 쌓이지 않는지 확인한다.
20. `safety_events`도 동일 turn/source 기준으로 불필요하게 중복 생성되지 않는지 확인한다.

PASS 기준:
- `고추장`, `초고추장`, `고춧가루` 정상 문맥 Safety false positive 0건.
- 음식 문맥의 `고추` 단독 표현이 키워드 하나만으로 `inappropriate_contact` 확정되지 않음.
- 넌센스 퀴즈에서 동일 단어 반복 시 false positive 0건.
- 실제 명확한 inappropriate-contact fixture는 기존처럼 차단됨.
- Safety priority/order 회귀 없음.
- 동일 turn 기준 중복 Safety warning/event 방지.
- 기존 Production 데이터 수정 없음.
- Production deploy 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 긴급 수정 요청
- 우선순위: P0 / CRITICAL
- 대상: Free Chat Safety / deterministic reaction layer
- 주요 확인 파일:
  - `lib/freeChatReactions.ts`
  - Safety keyword/category matcher
  - Safety event persistence 경로
  - Free Chat response short-circuit 경로
- Production 재현 계정: 안서아 계정
- Production 재현 세션: `6cf6b86b...`
- 확인된 카테고리: `inappropriate_contact`
- 배포 원칙: Development only → Owner QA → 별도 승인 후 Production
- 최종 상태: `WAITING_FOR_OWNER_QA`

## 2. 목표

Production 자유대화 전수 점검에서 정상 음식/넌센스 표현이 아동 성적 학대/부적절 접촉 Safety로 오탐되는 치명적 결함이 확인됐다.

재현 흐름:

```text
아이:
“추장보다 높은 사람은?”

K:
“고추장?”

아이:
“고추장 맞아”

현재 Safety matcher:
INAPPROPRIATE_CONTACT_KEYWORDS 안의 “고추”
+ substring includes 매칭

↓
“고추장” 안에 “고추” 포함

↓
inappropriate_contact 확정

↓
“그건 케이 혼자 도와주기 어려운 일이야.
지금 바로 엄마아빠한테 꼭 말해줘...”

↓
같은 정상 문맥에서 반복 Safety 개입
↓
safety_events 허위 기록
```

문제의 본질은 단순히 `"고추장"` 예외 한 개가 빠진 것이 아니다.

현재 구조가 **애매한 짧은 문자열의 부분일치 하나만으로 고위험 Safety category를 확정할 수 있다**는 것이 근본 문제다.

이번 목표는:

```text
ambiguous token/sub-string alone
≠
high-risk safety confirmation
```

을 보장하면서도 실제 Safety 탐지는 유지하는 것이다.

## 3. 요구사항

### 3-1. 기존 Safety matcher 실제 구조 확인
수정 전 현재 코드를 먼저 확인한다.

반드시 확인:
- `INAPPROPRIATE_CONTACT_KEYWORDS`
- `includesAny`
- normalization 방식
- exact/substring/regex/token matching 여부
- category별 trigger 방식
- category 우선순위
- Safety short-circuit 위치
- `safety_events` insert 위치
- 동일 turn idempotency 여부

보고서의 line number가 현재 HEAD와 다르면 현재 코드를 Source of Truth로 사용한다.

### 3-2. `"고추"` 단순 substring trigger 제거
다음 구조는 허용하지 않는다.

```ts
text.includes("고추")
→ inappropriate_contact
```

또는 의미상 동일한 broad substring rule.

다만 단순히 keyword list에서 `"고추"`만 삭제하고 끝내지 않는다.

왜냐하면:
- `고추`는 음식 의미도 있음
- 일부 문맥에서는 신체 관련 속어로 쓰일 수 있음
- 하나의 표면 문자열이 여러 의미를 갖기 때문

따라서 ambiguous term을 별도로 다뤄야 한다.

### 3-3. 정상 compound word 보호
최소 다음 정상 표현은 high-risk safety keyword 부분일치로 차단되면 안 된다.

- 고추장
- 초고추장
- 고춧가루
- 고추가루
- 고추기름
- 풋고추
- 청양고추
- 꽈리고추

목록을 무한 allowlist로 키우는 방식만 사용하지 않는다.

핵심은 정상 compound/token을 부분문자열로 잘못 분해하지 않는 matching semantics를 만드는 것이다.

### 3-4. ambiguous lexical signal 분리
`고추`처럼 일상 의미와 민감 의미가 함께 존재할 수 있는 단어는 **단독 high-risk trigger로 사용하지 않는다.**

개념적으로:

```text
HIGH_CONFIDENCE_SAFETY_PATTERN
→ 단독 trigger 가능

AMBIGUOUS_SAFETY_TERM
→ 단어 하나만으로 trigger 금지
→ 추가 문맥 signal 필요
```

실제 타입/파일 구조는 기존 Safety 설계를 최대한 유지하여 최소 변경한다.

### 3-5. inappropriate_contact에 필요한 추가 근거
ambiguous term에서 `inappropriate_contact`를 확정하려면 현재 Safety 정책에 맞는 추가 signal이 있어야 한다.

예시 범주:
- 누군가의 접촉/행동
- 아이의 원치 않는 접촉
- 신체 부위와 접촉 행위의 조합
- 보여달라/만졌다/만지게 했다 등 명확한 위험 행위
- 강요/비밀 요구 등 기존 Safety에서 이미 사용하는 고위험 맥락

주의:
- 위 문장을 새로운 안전 정책으로 임의 확장하지 말 것.
- 현재 프로젝트에 이미 존재하는 Safety taxonomy/pattern을 확인하여 재사용할 것.
- Gemini 자유판단 하나만으로 deterministic Safety를 대체하지 말 것.

### 3-6. Token/phrase matching 정밀화
현재 `includesAny`가 category 전체에서 광범위하게 사용된다면 전체를 무작정 교체하지 않는다.

먼저 위험도와 회귀 범위를 확인한다.

가능한 최소 방향:
- exact phrase
- token/word boundary
- compound-aware matching
- category-specific matcher
- ambiguous-term matcher

중 현재 구조와 가장 맞는 것을 선택한다.

한국어는 띄어쓰기가 불안정하므로 영문 `\b`만 사용하는 식의 단순한 해결은 금지한다.

### 3-7. Safety 우선순위 유지
실제 Safety 신호가 명확하면 기존대로 일반 Conversation Engine/Play Skill보다 먼저 처리한다.

이번 수정은 Safety를 약화하는 작업이 아니다.

목표:
- false positive 감소
- true positive 유지

### 3-8. 반복 Safety warning 방지
Production 재현에서는 동일 정상 문맥에서 Safety 경고가 4회 연속 발생했다.

이번 작업에서 최소한 동일 turn/source의 중복 처리가 가능한지 확인하고, 가능한 현재 구조 안에서 idempotency를 보장한다.

권장 기준:
- `turn_id` 또는 canonical source identifier 기반
- 동일 turn + 동일 category에 대한 duplicate insert 방지
- 동일 turn에 대한 duplicate response 생성 방지

단:
- 서로 다른 실제 child turn에서 Safety가 계속 필요한 경우까지 무조건 suppress하지 않는다.
- “같은 위험을 여러 턴 말하면 Safety는 한 번만” 같은 광범위한 제품 정책은 이번 요청에서 임의 도입하지 않는다.

### 3-9. 기존 허위 safety_events 처리
Production에 이미 기록된 해당 false-positive 이벤트는 이번 작업에서:
- delete 금지
- update 금지
- backfill 금지

필요하면 완료보고에 affected event 수/식별 가능한 범위만 기록한다.

과거 데이터 정리는 별도 Owner 결정 사항이다.

### 3-10. Safety event에 근거 추적성 유지
기존 schema가 지원한다면 trigger source/category/reason이 QA 가능한 형태로 유지되어야 한다.

새 PII/원문 로그를 추가하지 않는다.

불필요하게 child raw text를 신규 telemetry에 복제하지 않는다.

### 3-11. Free Chat 이외 영향 확인
동일 matcher가 Mission/다른 모드에서 공유되는지 확인한다.

공유된다면:
- 공용 matcher 회귀 QA
- Mission Safety regression
를 포함한다.

공유되지 않는다면 Free Chat 범위만 수정한다.

### 3-12. Play/Nonsense 문맥 회귀
다음 정상 놀이 표현이 Safety 때문에 차단되면 안 된다.

예:
- “고추장보다 높은 건 초고추장”
- “고추장 퀴즈”
- “고추 먹으면 매워”
- 향후 NONSENSE Skill에서 음식 단어 사용

단, 놀이 문맥이라는 이유만으로 실제 Safety signal을 무조건 무시하지 않는다.

### 3-13. Safety와 Play의 책임 분리
Play Skill/LLM에 Safety 예외 판정을 떠넘기지 않는다.

Safety matcher 자체가 정상 lexical ambiguity를 처리해야 한다.

### 3-14. 실패 시 Fail-safe
matcher를 정밀화하다가 판단 불가능한 경우:
- 기존 명확한 high-confidence Safety rule은 그대로 유지
- ambiguous term 하나만으로 catastrophic category를 확정하지 않음

새 외부 API/LLM call을 추가하지 않는다.

## 4. 기존 구조 확인

작업 전에 다음을 실제 코드에서 확인하고 완료보고에 남긴다.

### Production 재현
Production 자유대화에서 확인된 흐름:

```text
정상 넌센스/음식 문맥
→ “고추장”
→ keyword “고추” substring match
→ inappropriate_contact
→ 보호자 안내 Safety template
→ 동일 흐름 반복
→ safety_events 4건
```

### 확인 대상
- `lib/freeChatReactions.ts`
- `INAPPROPRIATE_CONTACT_KEYWORDS`
- `includesAny`
- category별 keyword list
- Safety classification/short-circuit
- `safety_events` insert
- turn/source ID 전달 여부
- Mission과 matcher 공유 여부
- 기존 Safety unit/integration tests
- Free Chat reaction tests

### 기존 Source of Truth
현재 Production audit 결과:
- 정상 음식/퀴즈 발화가 실제 Safety event로 기록됨
- category=`inappropriate_contact`
- 동일 문맥에서 4회 반복
- 원인 후보가 `"고추"` substring match로 코드 레벨 확인됨

구현 전 현재 HEAD에서 동일 원인이 존재하는지 다시 확인하고, 다르면 최신 구조 기준으로 최소 수정한다.

## 5. 금지사항
- Production deploy 금지
- Production env 변경 금지
- Production DB row delete/update 금지
- 기존 false-positive `safety_events` 임의 삭제 금지
- `"고추"` 키워드를 아무 대안 없이 단순 삭제하고 종료 금지
- `"고추장"` 하나만 hard-coded exception으로 추가하고 근본 matcher 문제를 남기는 것 금지
- Safety 전체를 Gemini classifier로 대체 금지
- 외부 moderation API 신규 도입 금지
- 실제 Safety sensitivity를 낮추는 broad allowlist 금지
- “놀이 중이면 Safety 무시” 규칙 금지
- 한국어 matcher에 영문 `\b`만 사용하여 해결했다고 간주 금지
- raw child conversation 신규 로그/telemetry 복제 금지
- 실제 가족 계정 자동화 QA 금지
- Owner 승인 전 Production 변경 금지

## 6. 모호성 처리
- 현재 Safety taxonomy가 본 요청의 예시와 다르면 기존 taxonomy를 우선한다.
- `inappropriate_contact` matcher가 여러 파일에 분산되어 있으면 canonical matcher를 먼저 확인하고 중복 rule을 만들지 않는다.
- ambiguous term 분류 구조가 이미 있으면 재사용한다.
- idempotency Source가 `turn_id`가 아니라 기존 canonical event id라면 기존 Source를 사용한다.
- 동일 turn 중복과 서로 다른 연속 child turns는 구분한다.
- Production 과거 데이터 정리는 별도 요청이 없으면 하지 않는다.
- 현재 코드에 이미 부분 수정이 들어갔다면 중복 패치하지 말고 부족한 QA/guard만 보강한다.

## 7. QA

### 7-1. 음식 compound false positive
입력:
- “고추장 먹었어”
- “초고추장 찍어 먹었어”
- “고춧가루 좀 매워”
- “청양고추 너무 매워”
- “고추기름 넣었어”

기대:
- `inappropriate_contact` 0
- Safety template 0
- 일반 Free Chat 정상

### 7-2. 넌센스 퀴즈
대화:
```text
아이: 추장보다 높은 사람은?
K: ...
아이: 고추장
아이: 고추장보다 높은 건 초고추장이잖아
```

기대:
- false Safety 0
- `safety_events` 0

### 7-3. 음식 의미의 단독 고추
입력:
- “난 고추 싫어”
- “고추 너무 매워”
- “할머니가 고추 키워”

기대:
- ambiguous keyword 단독으로 inappropriate_contact 확정 안 됨

### 7-4. 실제 high-confidence Safety
기존 inappropriate-contact positive fixture 전체 실행.

기대:
- 기존 true positive 유지
- Safety priority 유지
- category 정상

### 7-5. Ambiguous + 실제 위험 문맥
기존 프로젝트 Safety 정책상 실제 위험에 해당하는 fixture에서 ambiguous term이 포함되어도 필요한 추가 signal이 있으면 정상 Safety 처리.

기대:
- 음식 allowlist 때문에 실제 위험이 무시되지 않음

### 7-6. Substring regression
다른 Safety keyword 중 정상 compound 안에 포함될 가능성이 있는 사례가 있는지 기존 테스트 세트 범위에서 확인한다.

이번 요청과 무관한 taxonomy를 대규모 재설계하지 않는다.

### 7-7. Duplicate same-turn
동일 `turn_id` / 동일 category 처리를 두 번 시도.

기대:
- 사용자 visible warning 중복 없음
- duplicate safety event 없음 또는 기존 idempotency 정책에 맞는 단일 canonical event

### 7-8. Separate real safety turns
서로 다른 child turn에서 실제 Safety 발화가 반복되는 fixture.

기대:
- same-turn dedupe 때문에 이후 실제 위험 신호가 사라지지 않음

### 7-9. Mission/shared matcher regression
matcher가 공용이면 Mission에서도:
- 정상 음식 문맥 false positive 없음
- 실제 Safety true positive 유지

### 7-10. Free Chat regression
- 일상대화
- Relationship Memory
- PLAY_PROPOSAL
- CHOSUNG/WORD_CHAIN
- Response Generator
- Safety priority
회귀 없음.

### 7-11. Quality gates
- 관련 unit tests
- integration tests
- typecheck
- lint
- build

기존 baseline failure와 신규 failure를 구분하여 보고한다.

## 8. 완료조건
- `"고추"` 단순 substring 하나만으로 `inappropriate_contact`가 확정되지 않는다.
- `고추장`, `초고추장`, `고춧가루` 등 정상 음식 compound false positive 0건.
- 음식 의미의 단독 `고추`가 keyword 하나만으로 고위험 Safety를 발동하지 않는다.
- 실제 high-confidence inappropriate-contact fixture는 기존대로 Safety 처리된다.
- Safety priority가 일반 Conversation/Play보다 우선한다.
- 정상 놀이/넌센스 문맥을 blanket bypass하지 않는다.
- category-specific/ambiguous matching의 책임이 Safety layer에 존재한다.
- 동일 turn/source의 중복 Safety warning/event가 방지된다.
- 서로 다른 실제 위험 turn의 Safety는 유지된다.
- 기존 Production `safety_events`는 변경하지 않는다.
- Mission/shared Safety 회귀 없음.
- Free Chat 회귀 없음.
- 자동 테스트 결과 보고 완료.
- typecheck/lint/build 결과 보고 완료.
- Development 배포/검증 완료.
- Owner QA 전 Production 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 9. 완료보고
완료 후 다음 형식으로 보고한다.

### Root Cause
- 기존 matcher:
- false positive 발생 원리:
- 영향 category:

### 변경
- 변경 파일:
- ambiguous term 처리 방식:
- compound/token matching 방식:
- 기존 Safety priority 유지 방식:
- duplicate event/warning guard:
- Mission 공유 여부:

### QA 결과
- 고추장:
- 초고추장:
- 고춧가루:
- 음식 의미 고추:
- 넌센스 시나리오:
- actual Safety positive fixture:
- ambiguous + actual risk fixture:
- same-turn duplicate:
- separate safety turns:
- Mission/shared regression:
- Free Chat regression:

### 기존 데이터
- Production false-positive event 수정/삭제: NO
- 별도 backfill 필요 여부:

### Build
- unit:
- integration:
- typecheck:
- lint:
- build:

### 배포
- Development URL:
- Production changed: NO
- 최종 상태: `WAITING_FOR_OWNER_QA`
- commit:
