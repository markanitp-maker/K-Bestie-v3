084-fix-parent-k-general-conversation-intent-routing.md
부모–케이 일반대화 Intent 분리 및 기본 대화 정상화 요청

상태: READY
우선순위: P0
대상: Parent K Chat / Intent Classifier / General Conversation / Child Information Retrieval / Follow-up Context
환경: Development → Production
담당: Claude Code

# 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

## 완료 시 기대 결과

부모–케이 대화는 아래 4개 경로를 명확히 구분해야 한다.

```text
1. 일반 대화
   → 날짜/요일/시간/케이 이름/인사/감사/간단한 리액션
   → 아이 RAG 조회 금지
   → 자연스럽게 바로 답변

2. 아이 정보 조회
   → 특정 아이에 대한 사실/최근 상태/과거 기록 질문
   → Unified Retrieval 사용
   → 근거 있으면 답변, 없으면 모른다고 답변

3. 아이에게 직접 물어보기
   → Parent Query Request
   → 직전 topic 유지
   → Red/Crisis 검사
   → 부모 확인 후 질문 등록

4. Red / Crisis
   → 기존 안전 정책 유지
```

핵심 원칙:

```text
아이에 관한 사실은 기록에 근거해서만 답한다.
아이와 무관한 일반 대화는 자유롭게 답한다.
```

현재처럼 일반 질문까지 `CHILD_INFORMATION_QUERY`로 보내 아이 기록을 조회하면 안 된다.

## 대표님 테스트 정상 프로세스

### A. 일반 날짜 질문

```text
부모:
어제 날짜가 몇 일이야?
```

정상:

```text
케이:
어제는 8월 15일이에요.
```

PASS 조건:

```text
intent = GENERAL_CONVERSATION
child RAG 호출 = false
Temporal Child Retrieval 호출 = false
```

FAIL:

```text
그 날짜에 확인되는 기록이 없어요.
```

### B. 오늘 요일 질문

```text
부모:
오늘 무슨 요일이야?
```

정상:

```text
케이:
오늘은 일요일이에요.
```

현재 KST 기준 deterministic 값으로 답해야 한다.

### C. 케이 이름 질문

```text
부모:
너 이름이 뭐야?
```

정상:

```text
케이:
저는 케이예요.
```

아이 DB 검색 금지.

### D. 일반 리액션

```text
부모:
그렇구나
```

정상:
현재 대화 맥락에 맞는 짧고 자연스러운 반응.

아래 응답은 FAIL:

```text
그 내용은 아직 확인되는 기록에 없어요.
```

### E. 아이 정보 질문

```text
부모:
서현이가 어제 뭐했어?
```

정상:

```text
intent = CHILD_INFORMATION_QUERY
→ Temporal Resolver
→ KST 어제 날짜 계산
→ 해당 날짜 Daily Report 우선 조회
→ 근거 기반 답변
```

일반 대화로 보내면 안 된다.

### F. 아이에게 직접 질문 요청

```text
부모:
그럼 서현이에게 물어봐줘
```

정상:

```text
intent = PARENT_QUERY_REQUEST
→ 직전 topic 유지
→ Parent Query Router
```

### G. 짧은 후속 질문

```text
부모:
서현이가 요즘 수학 때문에 힘들어해?

케이:
최근 리포트에서는 수학 숙제 부담이 있었어요.

부모:
왜?
```

이 `왜?`는 무조건 GENERAL_CONVERSATION으로 고정하면 안 된다.

정상:

```text
직전 topic = 수학 부담
→ 아이 정보 후속 질문으로 처리
→ 기존 근거/맥락을 이어서 답변
```

반대로 일반 대화 뒤의 `그렇구나`, `그래?`, `왜?`는 일반 대화 맥락으로 처리할 수 있어야 한다.

---

# 1. Antigravity READ-ONLY 진단 결과

확정 Root Cause:

```text
1. intentClassifier.ts의 GENERAL_PATTERNS 범위가 너무 좁음
2. 인사/감사 등 소수 패턴 외 대부분이 기본값 CHILD_INFORMATION_QUERY로 떨어짐
3. "어제 날짜가 몇 일이야?"도 CHILD_INFORMATION_QUERY로 오분류됨
4. 이후 temporalQuery.ts가 "어제"를 EXACT_DATE로 파싱
5. child RAG 조회 실행
6. 해당 아이 기록이 없으면 "그 날짜에 확인되는 기록이 없어요." 반환
7. GENERAL_CONVERSATION handler에는 현재 KST 날짜/요일 정보가 없음
```

실제 Runtime 테스트:

```text
"어제 날짜가 몇 일이야?"
→ CHILD_INFORMATION_QUERY
→ RAG YES
→ EXACT_DATE
→ FAIL

"오늘 날짜가 뭐야?"
→ CHILD_INFORMATION_QUERY
→ RAG YES
→ FAIL

"오늘 무슨 요일이야?"
→ CHILD_INFORMATION_QUERY
→ RAG YES
→ FAIL

"너 이름이 뭐야?"
→ CHILD_INFORMATION_QUERY
→ RAG YES
→ FAIL

"안녕"
→ GENERAL_CONVERSATION
→ PASS

"고마워"
→ GENERAL_CONVERSATION
→ PASS

"왜?"
→ CHILD_INFORMATION_QUERY
→ 현재 구조상 FAIL 가능

"그렇구나"
→ CHILD_INFORMATION_QUERY
→ FAIL
```

Dev/Production 동일 코드 및 동일 증상.

---

# 2. 이번 작업 범위

수정 대상:

```text
lib/parentKChat/intentClassifier.ts
app/api/parent/k-chat/route.ts
필요 시 일반대화 system prompt/context builder
관련 unit/integration/E2E tests
```

실제 HEAD 기준으로 먼저 확인한다.

이번 작업에서 재설계하지 않을 대상:

```text
Unified Retrieval 구조
Daily/Weekly/Detailed/Memory retrieval
Temporal Child Retrieval 핵심 로직
Parent Query Router 정책
Red/Crisis 정책
Q&A
STT
DB schema
report generation pipeline
```

단, 회귀 테스트는 수행한다.

---

# 3. Top-Level Intent 구조

부모 입력은 먼저 top-level intent로 구분한다.

```text
GENERAL_CONVERSATION
CHILD_INFORMATION_QUERY
PARENT_QUERY_REQUEST
PARENT_QUERY_REQUEST_CANCEL
FEEDBACK_OR_CORRECTION
```

핵심:

```text
Temporal expression 존재
≠
Child Information Query
```

예:

```text
어제 날짜가 뭐야?
→ GENERAL_CONVERSATION

서현이가 어제 뭐했어?
→ CHILD_INFORMATION_QUERY
```

---

# 4. GENERAL_CONVERSATION 범위 확장

최소 아래 범주를 일반 대화로 처리한다.

## 날짜/요일/시간

```text
오늘 날짜가 뭐야?
어제 날짜가 몇 일이야?
내일은 몇 일이야?
오늘 무슨 요일이야?
지금 몇 시야?
이번 달이 몇 월이야?
```

## 케이 정체성

```text
너 이름이 뭐야?
너 누구야?
케이가 누구야?
```

## 인사/감사

```text
안녕
하이
반가워
고마워
감사해
```

## 일반 리액션

```text
그렇구나
알겠어
그래
응
네
정말?
아하
```

단, `왜?`, `그래?`, `그건?`, `정말?`처럼 짧은 후속 발화는 직전 맥락이 있으면 context-aware 처리한다.

---

# 5. 명확한 아이 정보 질문 보호

아래 질문은 GENERAL로 오분류하면 안 된다.

```text
서현이가 어제 뭐했어?
서현이는 요즘 뭐 좋아해?
서아가 오늘 학교 갔어?
우리 아이가 요즘 힘들어해?
서현이가 야외에서 노는 걸 좋아해?
```

`selected child_id != null`이라는 이유만으로 모든 질문을 CHILD_INFORMATION_QUERY로 보내면 안 된다.

---

# 6. 기본 Fallback 정책 변경

현재 구조:

```text
GENERAL_PATTERNS 미매칭
→ 기본값 CHILD_INFORMATION_QUERY
```

이 구조를 그대로 유지하지 않는다.

권장 순서:

```text
1. PARENT_QUERY_REQUEST 명확 패턴
2. FEEDBACK/CANCEL
3. 명확한 GENERAL
4. 명확한 CHILD_INFORMATION_QUERY
5. 짧은/모호한 발화는 conversation context 참고
```

모호한 표현을 child RAG로 보내는 것을 기본값으로 삼지 않는다.

---

# 7. 짧은 Follow-up Context 처리

아래 표현:

```text
왜?
그래?
그건?
정말?
어떻게?
그래서?
```

은 단독 정규식으로 GENERAL 또는 CHILD에 고정하지 않는다.

직전 대화 상태를 확인한다.

예:

```text
lastIntent = CHILD_INFORMATION_QUERY
lastTopic = 수학 숙제 부담
current = "왜?"

→ child information follow-up
```

반면:

```text
lastIntent = GENERAL_CONVERSATION
current = "그렇구나"

→ general follow-up
```

기존 최근 턴 구조를 재사용한다. 새 DB 테이블 생성 금지.

---

# 8. GENERAL_CONVERSATION에서 Child RAG 호출 금지

GENERAL_CONVERSATION 확정 후:

```text
retrieveParentKContext()
```

를 호출하지 않는다.

특히:

```text
어제 날짜가 뭐야?
오늘 무슨 요일이야?
너 이름이 뭐야?
```

에서:

```text
daily_reports
weekly_reports
memory_facts
dashboard
```

조회가 발생하면 FAIL.

---

# 9. 일반 날짜/시간은 KST deterministic context 사용

GENERAL_CONVERSATION handler에 현재 KST 값을 제공한다.

필수:

```text
timezone = Asia/Seoul
currentDate
currentDayOfWeek
currentTime
yesterdayDate
tomorrowDate
```

날짜/요일 질문에 모델 학습 시점이나 추측을 사용하지 않는다.

가능하면 단순 날짜·요일 질문은 deterministic 응답으로 처리한다.

---

# 10. 일반 대화 System Prompt 정책 분리

잘못된 전역 정책:

```text
케이는 기록 안에서만 답한다.
기록에 없으면 답하지 않는다.
```

정상 정책:

```text
아이에 관한 사실:
→ 아이 기록에 근거해서만 답한다.
→ 추측 금지.

아이와 무관한 일반 대화:
→ 자연스럽게 답한다.
```

아이 프라이버시/환각 방지 정책이 일반 날짜·인사·메타 대화까지 막으면 안 된다.

---

# 11. Response Contract

GENERAL_CONVERSATION 응답에는 child retrieval 상태를 섞지 않는다.

예:

```json
{
  "intent": "GENERAL_CONVERSATION",
  "answer": "어제는 8월 15일이에요."
}
```

Frontend가 `retrievalStatus=NO_DATA` 같은 값 때문에 정상 general answer를 덮어쓰지 않는지 확인한다.

---

# 12. Parent Query Request 회귀 보호

아래는 기존대로 유지한다.

```text
서현이에게 물어봐줘
이번 주말에 뭐 하고 싶은지 물어봐줘
아이에게 질문해줘
```

기대:

```text
PARENT_QUERY_REQUEST
RAG 호출 없음
Parent Query flow
```

Green List 임시 OFF 정책 유지.
Red/Crisis 유지.

---

# 13. 단위 테스트 추가

## General PASS

```text
어제 날짜가 몇 일이야?
오늘 날짜가 뭐야?
오늘 무슨 요일이야?
지금 몇 시야?
너 이름이 뭐야?
그렇구나
알겠어
아하
고마워
안녕
```

## Child Info PASS

```text
서현이가 어제 뭐했어?
서현이는 요즘 뭐 좋아해?
서현이가 야외에서 노는 걸 좋아해?
우리 아이가 오늘 뭐 했어?
```

## Parent Query PASS

```text
서현이에게 물어봐줘
이번 주말에 뭐 하고 싶은지 물어봐줘
```

## Context-aware follow-up

```text
previous intent = CHILD_INFORMATION_QUERY
current = 왜?
→ child follow-up

previous intent = GENERAL_CONVERSATION
current = 그렇구나
→ general follow-up
```

---

# 14. 실제 E2E 테스트

## Scenario A

```text
부모:
어제 날짜가 몇 일이야?
```

PASS:

```text
intent=GENERAL_CONVERSATION
RAG=false
정확한 KST 어제 날짜
```

## Scenario B

```text
부모:
오늘 무슨 요일이야?
```

PASS:

```text
GENERAL
정확한 KST 요일
```

## Scenario C

```text
부모:
너 이름이 뭐야?
```

PASS:

```text
GENERAL
케이 정체성 답변
```

## Scenario D

```text
부모:
그렇구나
```

PASS:

```text
GENERAL 또는 직전 일반대화 follow-up
NO_DATA 금지
```

## Scenario E

```text
부모:
서현이가 어제 뭐했어?
```

PASS:

```text
CHILD_INFORMATION_QUERY
Temporal Resolver 실행
Unified Retrieval 실행
```

## Scenario F

```text
부모:
서현이가 요즘 뭐 좋아해?
```

PASS:

```text
CHILD_INFORMATION_QUERY
Unified Retrieval
```

## Scenario G

```text
부모:
서현이에게 물어봐줘
```

PASS:

```text
PARENT_QUERY_REQUEST
```

## Scenario H — Intent 전환

```text
부모:
서현이가 어제 뭐했어?

케이:
...

부모:
아 그렇구나.

부모:
그런데 오늘 무슨 요일이야?
```

마지막 질문은 반드시:

```text
GENERAL_CONVERSATION
```

이어야 한다.

이전 child topic 때문에 child RAG로 계속 끌려가면 FAIL.

---

# 15. Development → Production 적용

1. 현재 HEAD 확인
2. Antigravity Runtime 결과 재확인
3. Intent Classifier 수정
4. context-aware short follow-up 처리
5. GENERAL handler KST context 추가
6. general query의 RAG bypass 확인
7. 단위 테스트
8. 타입 검사
9. 린트
10. 빌드
11. Development 배포
12. Scenario A~H 실제 E2E
13. 기존 Temporal Child Retrieval 회귀
14. Parent Query Request 회귀
15. Red/Crisis 회귀
16. PASS 후 동일 Commit Production 배포
17. Production 모바일/PWA Scenario A~H 재검증
18. 결과 보고

Dev만 수정하고 완료 처리하지 않는다.

---

# 16. 금지사항

- 모든 날짜 표현을 GENERAL로 처리
- `어제`라는 단어만 보고 GENERAL 결정
- `왜?`를 무조건 GENERAL로 고정
- selected child_id 존재만으로 CHILD_INFORMATION_QUERY 결정
- 모든 미매칭 문장을 다시 CHILD_INFORMATION_QUERY 기본값으로 유지
- GENERAL 질문에서 child RAG 호출
- 날짜/요일 답변을 모델 기억에 맡김
- Unified Retrieval 롤백
- Green List 재활성화
- Red/Crisis 비활성화
- Dev만 수정하고 Production 미적용

---

# 17. 완료 조건

- [ ] 일반 날짜 질문 → GENERAL
- [ ] 일반 요일 질문 → GENERAL
- [ ] 케이 이름/정체성 → GENERAL
- [ ] 일반 인사/감사/리액션 → GENERAL
- [ ] 일반 질문에서 child RAG 호출 0건
- [ ] KST 날짜/요일 정확
- [ ] 아이 정보 질문 → CHILD_INFORMATION_QUERY 유지
- [ ] 아이 정보 날짜 질문 → Temporal Resolver 정상
- [ ] 짧은 후속 발화 → 직전 context 기반 판정
- [ ] 새로운 일반 질문으로 topic 전환 가능
- [ ] PARENT_QUERY_REQUEST 회귀 PASS
- [ ] Unified Retrieval 회귀 PASS
- [ ] Green List 임시 OFF 유지
- [ ] Red/Crisis 유지
- [ ] Development Scenario A~H PASS
- [ ] Production Scenario A~H PASS
- [ ] 모바일/PWA PASS

---

# 18. 완료 보고 형식

```text
1. 수정 전 Runtime Root Cause 재확인
2. 수정 파일·함수
3. GENERAL_CONVERSATION 판정 확장 내용
4. CHILD_INFORMATION_QUERY 판정 방식
5. 기본 fallback 변경 방식
6. context-aware short follow-up 처리
7. GENERAL RAG bypass 확인
8. KST 날짜/요일 제공 방식
9. General system prompt 변경
10. 단위 테스트 결과
11. Scenario A 결과
12. Scenario B 결과
13. Scenario C 결과
14. Scenario D 결과
15. Scenario E 결과
16. Scenario F 결과
17. Scenario G 결과
18. Scenario H 결과
19. Temporal Retrieval 회귀
20. Parent Query 회귀
21. Red/Crisis 회귀
22. Development Commit/URL
23. Production Commit/URL
24. 모바일/PWA 결과
25. 남은 제한사항
```

반드시 실제 trace 포함:

```text
input:
어제 날짜가 몇 일이야?

intent:
GENERAL_CONVERSATION

child retrieval invoked:
false

KST date:
YYYY-MM-DD

answer:
어제는 M월 D일이에요.
```

그리고:

```text
input:
서현이가 어제 뭐했어?

intent:
CHILD_INFORMATION_QUERY

temporal:
EXACT_DATE

child retrieval invoked:
true
```

---

# 19. 보안

Production service role key, API key, token, password 등 비밀정보:
- 평문 하드코딩 금지
- 로그 출력 금지
- 임시 파일 저장 금지
- 테스트 소스 삽입 금지

기존 Secret Manager / Vercel Secrets / Supabase Secrets / 안전한 환경변수에서 런타임에만 사용하며 값은 마스킹한다.
