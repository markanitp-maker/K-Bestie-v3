085-parent-k-simple-chat-and-ask-child-e2e.md
부모–케이 단순 대화 재설계 + 아이에게 질문하기 E2E 정상화 요청

상태: READY
우선순위: P0
대상: Parent K Chat / Intent / Unified Retrieval / ASK_CHILD / Parent Questions / Q&A
환경: Development → Production
담당: Claude Code

# 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

## 완료 시 기대 결과

부모–케이 대화는 아래 4개 흐름만 명확히 구분한다.

```text
1. GENERAL_CHAT
   부모와 자연스럽게 대화
   최근 부모+K 대화 맥락 사용
   아이 RAG 조회 불필요

2. CHILD_INFO
   아이에 대해 묻는 질문
   Dashboard + Daily + Weekly + Detailed Report + Memory Facts 검색
   근거가 있으면 답변
   없으면 "그건 제가 가진 아이 기록에는 아직 없어요."

3. ASK_CHILD
   부모가 아이에게 직접 물어봐 달라고 요청
   직전 궁금한 주제 유지
   Red/Crisis 검사
   부모 승인
   미션에서 실제 질문
   아이 답변
   K 재확인
   아이 최종 확인
   Q&A 완료

4. UNSUPPORTED_EXTERNAL
   인터넷 검색/외부 정보 확인 요청
   외부 검색하지 않음
   지원하지 않는다고 짧고 자연스럽게 안내
```

핵심 정책:

```text
- 일반 대화는 자연스럽게 한다.
- 아이에 관한 사실은 아이 기록에 근거해서만 답한다.
- 기록이 없으면 추측하지 않고 모른다고 말한다.
- 외부 인터넷 검색은 하지 않는다.
- Green List 화이트리스트 차단은 당분간 OFF 유지.
- Red/Crisis 안전 차단은 유지.
```

아이 정보 질문은 아래 전체 지식원을 사용할 수 있어야 한다.

```text
- 부모 대시보드
- 일일 리포트
- 주간 리포트
- 상세 리포트
- Memory Facts
- 현재 부모–K 대화 맥락
```

## 대표님 테스트 정상 프로세스

### A. 일반 대화

```text
부모:
오늘 좀 힘드네.

K:
많이 바쁜 하루였나 봐요. 무슨 일 있으셨어요?

부모:
일이 좀 많았어.

K:
일이 몰리면 정말 지치죠. 지금은 좀 쉬고 계세요?
```

PASS:
- 최근 부모+K 대화 맥락 사용
- 같은 말을 반복하지 않음
- 아이 RAG 호출 없음
- NO_DATA/fallback 없음

### B. 일반 날짜/요일

```text
부모:
어제 날짜가 몇 일이야?

K:
어제는 KST 기준 어제 날짜를 정확히 답변
```

PASS:
- GENERAL_CHAT
- KST deterministic 날짜
- 아이 리포트 조회 안 함

### C. 아이 정보 질문

```text
부모:
서현이가 요즘 뭐 좋아해?
```

PASS:
- CHILD_INFO
- Dashboard/Daily/Weekly/Detailed/Memory Facts 통합 Retrieval
- 관련 근거가 있으면 바로 설명
- 추측 금지

### D. 아이 정보 없음

```text
부모:
서현이가 무슨 색 신발 사고 싶어해?
```

근거가 없다면:

```text
K:
그건 제가 가진 서현이 기록에는 아직 없어요.
```

### E. 아이에게 물어보기

```text
부모:
그럼 서현이한테 물어봐줘.
```

정상:

```text
직전 unknown topic:
사고 싶은 신발 색

→ ASK_CHILD
→ 부모 확인용 초안
→ 부모 승인
→ 질문 등록
```

아이 질문 예:

```text
요즘 갖고 싶은 신발 색 있어?
```

PASS:
- 부모에게 질문을 처음부터 다시 입력시키지 않음
- 직전 topic 자동 승계
- Green List 미매칭으로 차단하지 않음
- Red/Crisis 정상 검사

### F. ASK_CHILD 전체 E2E

```text
부모 질문 승인
→ parent_questions 등록
→ 다음 아이 미션에서 실제 질문
→ 아이 답변
→ K 재확인
→ 아이 최종 확인
→ Q&A 답변 완료
```

모든 단계 실제 확인 필수.

# 1. 상태 / 우선순위 / 대상

- 상태: READY
- 우선순위: P0
- 대상 프로젝트: K-Bestie v3
- 개발 주체: Claude Code
- 적용 대상:
  - 부모 > 케이와 대화
  - Parent K Chat API
  - Intent Router
  - Unified Retrieval
  - ASK_CHILD / Parent Query Router
  - Q&A
  - 아이 미션 질문 전달/재확인 흐름
- 적용 환경:
  - Development
  - Production
- 제외 대상:
  - 아이 자유대화 자체의 대화 정책
  - 리포트 생성 배치 구조 재설계
  - DB 데이터 임의 보정
  - Green List 재활성화
  - Red/Crisis 정책 해제
  - 외부 인터넷 검색 기능 신규 추가

# 2. 목표

## 2-1. 부모–K 대화를 단순화

부모–K 대화 앞단은 아래 4개 흐름을 중심으로 처리한다.

```text
GENERAL_CHAT
CHILD_INFO
ASK_CHILD
UNSUPPORTED_EXTERNAL
```

## 2-2. 부모와 기본 대화 가능

아래 일반 말에 자연스럽게 답한다.

```text
오늘 좀 힘드네
그렇구나
왜?
고마워
너 이름이 뭐야?
오늘 무슨 요일이야?
어제 날짜가 몇 일이야?
```

## 2-3. 아이 관련 질문만 아이 지식 Retrieval 사용

```text
서현이가 어제 뭐했어?
서현이가 요즘 뭐 좋아해?
서아가 최근 친구 얘기 했어?
```

같은 질문만 Unified Retrieval을 사용한다.

## 2-4. 모르면 명확히 모른다고 답함

범용 fallback 반복 금지.

## 2-5. ASK_CHILD 끝까지 E2E 검증

질문 등록 화면까지만 정상이라고 완료 처리하지 않는다.

```text
부모 승인
→ 질문 저장
→ 아이 미션에서 실제 질문
→ 아이 답변 저장
→ K 재확인
→ 아이 최종 확인
→ Q&A 답변 완료
```

# 3. 요구사항

## 3-1. GENERAL_CHAT 정상화

현재 원인 분석에서 확인된 문제:

```text
- 일반 대화에 최근 conversationContext를 충분히 전달하지 않음
- 일부 경로에서 현재 질문 한 줄만 LLM에 전달
- 부모 발화만 넘기고 K 직전 응답을 빼는 경로 존재
- GENERAL_PATTERNS 미매칭 시 CHILD_INFORMATION_QUERY로 떨어지는 구조
- flash-lite + thinking MINIMAL + 과도한 짧은 답변 제약
```

수정 방향:

```text
- 최근 부모+K 대화 턴 모두 전달
- 최소 최근 6턴 이상 현재 구조 기준 재사용
- 일반 대화는 아이 RAG와 분리
- 일반 질문이 Child Info로 강제 분류되지 않도록 함
- 짧은 후속 발화는 직전 intent/topic 참고
```

## 3-2. 부모–K 대화 모델/추론 설정 개선

현재 코드 확인 후 아래를 검토·적용한다.

진단 기준:

```text
parent chat model:
gemini-3.5-flash-lite

thinking:
MINIMAL
```

권장:

```text
model:
gemini-3.5-flash 또는 현재 프로젝트에서 상위 안정 모델

thinking:
LOW 이상
```

실제 modelRouter와 환경변수를 먼저 확인한다.
존재하지 않는 모델명을 추측해 하드코딩하지 않는다.

## 3-3. 일반 대화 프롬프트 단순화

핵심:

```text
너는 부모와 자연스럽게 대화하는 케이야.
직전 대화 맥락을 이해하고 이어서 답해.
대단한 정답이나 긴 설명을 하려고 하지 마.
부모 말에 자연스럽게 반응하고 필요한 경우 짧게 되물어봐.
아이에 관한 사실은 제공된 아이 기록이 있을 때만 말해.
기록에 없으면 추측하지 말고 모른다고 말해.
외부 인터넷 검색은 하지 않아.
```

목표는 정보형 AI가 아니라:

```text
말이 통하는 부모 대화 상대
```

다.

## 3-4. GENERAL_CHAT KST 날짜/요일/시간 지원

```text
오늘 날짜가 뭐야?
어제 날짜가 몇 일이야?
오늘 무슨 요일이야?
지금 몇 시야?
```

는 아이 정보가 아니다.

KST(`Asia/Seoul`) 기준 deterministic context를 제공한다.
아이 RAG 호출 금지.

## 3-5. CHILD_INFO Unified Retrieval 유지

```text
Dashboard
Daily Report
Weekly Report
Detailed Report
Memory Facts
Current Conversation Context
```

역할:

```text
최근/오늘/어제
→ Daily / Dashboard 우선

이번 주
→ Weekly 우선

평소/원래/장기
→ Memory Facts + 과거 리포트 우선
```

## 3-6. CHILD_INFO 답변 정책

근거 있음:
```text
확인되는 내용을 바로 답한다.
```

일부만 있음:
```text
뮤지컬을 봤다는 기록은 있어요.
하지만 어떤 장면이 기억에 남았는지는 기록에 없어요.
```

없음:
```text
그건 제가 가진 아이 기록에는 아직 없어요.
```

시스템 오류:
```text
지금은 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
```

## 3-7. UNSUPPORTED_EXTERNAL 처리

예:

```text
인터넷에서 찾아봐
오늘 뉴스 알려줘
네이버 검색해서 알려줘
```

현재 부모–K 제품 범위에서는 외부 검색을 수행하지 않는다.
아이 기록 질문처럼 RAG를 돌리지 않는다.

## 3-8. ASK_CHILD 직전 topic 승계

예:

```text
부모:
서현이가 무슨 색 신발 사고 싶어해?

K:
그건 제가 가진 서현이 기록에는 아직 없어요.

부모:
그럼 물어봐줘.
```

정상:

```text
lastUnknownTopic = 사고 싶은 신발 색
child_id = 서현
→ ASK_CHILD
```

부모에게 다시 질문 입력 요구 금지.

## 3-9. Green List 임시 OFF 유지

```text
Green whitelist:
TEMPORARILY_DISABLED
```

질문 등록 흐름:

```text
ASK_CHILD
→ Crisis 검사
→ Red 검사
→ 그 외 질문은 중립적으로 재작성
→ 부모 확인
→ 질문 등록
```

Red/Crisis 유지.

## 3-10. ASK_CHILD 부모 승인

부모 확인 없이 자동 등록 금지.

```text
질문 초안 표시
→ 부모 승인
→ DB 저장
→ quota 차감
```

취소/실패/Red/Crisis는 quota 차감 금지.

## 3-11. ASK_CHILD 실제 미션 전달

```text
parent_questions
→ queue candidate
→ mission loader
→ P0 priority
→ K 실제 질문 발화
→ chat_messages 기록
```

질문이 계속 `질문 대기 중`이면 완료 처리 금지.

## 3-12. 아이 답변 및 재확인

```text
K:
요즘 갖고 싶은 신발 색 있어?

아이:
파란색

K:
파란색 신발을 갖고 싶다는 거지?

아이:
응
```

그 후에만 ANSWERED.

## 3-13. 아이 거부

```text
몰라
말하기 싫어
넘어갈래
```

→ 추가 추궁 없음
→ 적절한 DECLINED
→ 부모에게 이유 추측 안 함

시스템 오류/STT 오류를 아이 거부로 위장 금지.

## 3-14. Q&A 답변 내용 보존

실제 아이가:

```text
친구랑 수영장 가고 싶어
```

라고 답했다면 부모에게:

```text
친구와 수영장에 가고 싶다고 했어요.
```

처럼 핵심 의미를 전달한다.

# 4. 기존 구조 확인

현재 HEAD 기준으로 아래를 확인한다.

```text
app/api/parent/k-chat/route.ts
lib/parentKChat/intentClassifier.ts
lib/parentKChat/parentKnowledgeRetrieval.ts
lib/parentKChat/temporalQuery.ts
lib/parentKChat/answerPolicy.ts
lib/llm/modelRouter.ts
Parent Query Router 공통 코드
parent_questions 조회/저장 코드
mission parent question loader
mission question priority/select 코드
chat_messages 저장
reconfirmation 처리
Q&A API/UI
```

Source of Truth를 결과 보고에 명시한다.

# 5. 금지사항

- 부모–K 일반 대화에서 매번 child RAG 호출
- 모든 미매칭 문장을 CHILD_INFORMATION_QUERY로 fallback
- 모델만 올리고 conversation context는 그대로 두기
- conversation context 없이 현재 질문 한 줄만 전달
- K 직전 응답을 맥락에서 제거
- 아이 관련 근거가 없는데 추측
- 인터넷 검색 기능 새로 추가
- NO_DATA와 SYSTEM_ERROR 혼동
- Green List 재활성화
- Red/Crisis 비활성화
- 부모 승인 없이 질문 자동 등록
- 질문 DB 등록만 확인하고 ASK_CHILD 완료 처리
- 아이 실제 응답 없이 Q&A를 ANSWERED 처리
- STT/mission 오류를 아이 거부로 표시
- 기존 데이터 임의 수정으로 테스트 통과
- Development만 수정하고 Production 미적용

# 6. 모호성 처리

우선순위:

```text
1. 부모와 기본적인 자연 대화가 가능해야 함
2. 아이에 관한 사실은 기록 기반만 허용
3. 기록 없으면 모른다고 명확히 답함
4. 외부 인터넷 검색은 하지 않음
5. 부모가 직접 요청할 때만 ASK_CHILD 진입
6. ASK_CHILD Red/Crisis 유지
7. 부모 승인 후 질문 등록
8. 실제 아이 답변+재확인 후에만 Q&A 완료
```

# 7. QA

## 7-1. GENERAL_CHAT

```text
오늘 좀 힘드네
일이 많았어
그렇구나
고마워
너 이름이 뭐야?
오늘 날짜가 뭐야?
어제 날짜가 몇 일이야?
오늘 무슨 요일이야?
```

PASS:
- 자연 대화
- 최근 부모+K 맥락 유지
- child RAG 0건
- NO_DATA 문구 0건

## 7-2. CHILD_INFO

```text
서현이가 어제 뭐했어?
서현이가 요즘 뭐 좋아해?
서현이는 평소 어떤 걸 좋아해?
```

PASS:
- Unified Retrieval
- temporal/source priority 정상
- 근거 기반 답변

## 7-3. CHILD_INFO NO_DATA

```text
서현이가 무슨 색 신발 사고 싶어해?
```

근거 없을 때:

```text
그건 제가 가진 서현이 기록에는 아직 없어요.
```

## 7-4. UNSUPPORTED_EXTERNAL

```text
인터넷에서 서현이가 좋아할 만한 신발 찾아봐.
```

PASS:
- 인터넷 검색 안 함
- 지원 범위 밖이라고 자연스럽게 안내

## 7-5. ASK_CHILD Context 승계

```text
부모:
서현이가 무슨 색 신발 사고 싶어해?

K:
그건 제가 가진 서현이 기록에는 아직 없어요.

부모:
그럼 물어봐줘.
```

PASS:
- 직전 unknown topic 승계
- 질문 초안
- 재입력 요구 없음

## 7-6. ASK_CHILD 등록

PASS:
- 부모 승인 전 신규 질문 0건
- 승인 후 1건
- quota 정확히 1회 차감

## 7-7. ASK_CHILD Mission Delivery

PASS:
- 다음 eligible mission에서 loader가 질문 읽음
- P0 우선순위
- K 실제 질문
- chat_messages 기록

## 7-8. ASK_CHILD Answer

PASS:
- 아이 답변 저장
- K 재확인
- 아이 최종 확인
- final answer 저장
- Q&A ANSWERED

## 7-9. ASK_CHILD Decline

PASS:
- 추가 추궁 0회
- 적절한 DECLINED
- 부모에게 이유 추측 안 함

## 7-10. Q&A 정보 보존

실제 아이 답변 핵심 정보가 부모 화면에서 사라지지 않는지 확인.

## 7-11. 아이별 격리

안서아 ↔ 안서현 전환 시:

```text
conversation context
lastUnknownTopic
pending question
Q&A
```

혼입 0건.

## 7-12. 회귀 테스트

```text
Temporal Retrieval
Dashboard Retrieval
Daily Report
Weekly Report
Detailed Report
Memory Facts
Parent Query Request
Red
Crisis
Q&A
STT
모바일 PWA
PC Browser
```

# 8. Development → Production 배포

1. 현재 HEAD/Dev/Prod Commit 확인
2. 현재 Parent-K Chat 및 ASK_CHILD 실행 구조 확인
3. 일반 대화 context 전달 수정
4. Intent 단순화
5. 모델/thinking/prompt 조정
6. GENERAL_CHAT RAG bypass
7. CHILD_INFO Unified Retrieval 유지
8. ASK_CHILD context 승계
9. ASK_CHILD mission delivery/answer/reconfirm/Q&A 점검 및 수정
10. 단위 테스트
11. 타입 검사
12. 린트
13. 빌드
14. Development 배포
15. QA 7-1~7-12 전부 실행
16. 실제 모바일/PWA 검증
17. PASS 후 동일 Commit Production 배포
18. Production 동일 시나리오 재검증
19. 결과 보고

Development만 수정하고 완료 처리하지 않는다.

# 9. 완료 조건

- [ ] 부모와 일반 대화 자연스럽게 이어짐
- [ ] 부모+K 최근 맥락이 실제 LLM 호출에 포함됨
- [ ] 일반 대화에서 아이 RAG 호출 0건
- [ ] 일반 날짜/요일/시간 정상
- [ ] 아이 관련 질문만 Unified Retrieval 사용
- [ ] 아이 정보 근거 있으면 답변
- [ ] 아이 정보 없으면 명확히 모른다고 답변
- [ ] 외부 검색 요청 자연스럽게 미지원 안내
- [ ] Green List 임시 OFF 유지
- [ ] Red/Crisis 유지
- [ ] `물어봐줘`가 직전 unknown topic 승계
- [ ] 부모 승인 전 질문 미등록
- [ ] 부모 승인 후 질문 등록
- [ ] 실제 아이 미션에서 질문
- [ ] 아이 답변 저장
- [ ] K 재확인
- [ ] 아이 최종 확인
- [ ] Q&A 답변 완료
- [ ] 실제 답변 핵심 내용 보존
- [ ] 시스템 오류와 아이 거부 구분
- [ ] 아이별 데이터 혼입 0건
- [ ] Development E2E PASS
- [ ] Production E2E PASS
- [ ] 모바일/PWA PASS

# 10. 완료 보고 형식

```text
1. 수정 전 Parent-K 구조
2. 수정 파일/함수
3. GENERAL_CHAT 구조
4. conversationContext 전달 방식
5. 모델 변경 전/후
6. thinking 설정 변경
7. prompt 변경
8. CHILD_INFO Retrieval 유지 구조
9. NO_DATA / SYSTEM_ERROR 처리
10. UNSUPPORTED_EXTERNAL 처리
11. ASK_CHILD context 승계
12. 질문 등록 결과
13. mission loader 결과
14. K 실제 질문 발화 결과
15. 아이 답변 저장 결과
16. 재확인 결과
17. Q&A 최종 상태
18. Decline 테스트
19. 아이별 격리 테스트
20. 일반대화 QA 결과
21. Child Info QA 결과
22. Development Commit/URL
23. Production Commit/URL
24. 모바일/PWA 결과
25. 남은 제한사항
```

ASK_CHILD 완료 보고에는 반드시 실제 trace 포함:

```text
parent approval:
true

question persisted:
true

mission loaded:
true

K asked child:
true

child response captured:
true

K reconfirmed:
true

child final confirmed:
true

Q&A final status:
ANSWERED
```

위 trace 중 하나라도 false이면 ASK_CHILD 전체 기능을 PASS로 보고하지 않는다.

# 11. 보안

Production service role key, API key, token, password 등 중요 비밀정보:
- 평문 하드코딩 금지
- 로그 출력 금지
- 임시 파일 저장 금지
- 테스트 소스 직접 삽입 금지

기존 Secret Manager / Vercel Secrets / Supabase Secrets / 안전한 런타임 환경변수에서만 로드하고 값은 마스킹한다.
