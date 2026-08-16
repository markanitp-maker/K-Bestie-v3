083-fix-parent-k-temporal-context-ask-child.md
부모–케이 대화 날짜·맥락·질문하기 정상화 및 실제 E2E 수정 요청

상태: READY
우선순위: P0
대상: Parent K Chat / Unified Retrieval / Temporal Routing / Follow-up Context / Ask Child
환경: Development → Production
담당: Codex

# 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

## 완료 시 기대 결과

부모가 케이에게 아이에 대해 질문했을 때 케이는 아래 원칙으로 동작해야 한다.

```text
알고 있으면 → 확인된 내용을 바로 답한다.
일부만 알고 있으면 → 아는 부분만 말하고, 모르는 부분은 모른다고 말한다.
모르면 → 모른다고 명확히 말한다.
시스템 오류면 → 데이터 부족처럼 위장하지 않고 오류로 구분한다.
```

날짜가 포함된 질문은 반드시 KST 기준 날짜/기간을 먼저 확정한 뒤 해당 날짜의 리포트를 우선 조회한다.

Green List 화이트리스트 차단 기능은 현재 임시 비활성 상태를 유지한다. 이번 작업에서 Green List를 다시 켜지 않는다.

유지:
- Crisis 차단
- Red 민감 질문 차단
- 부모 문장 그대로 아이에게 전달 금지
- 부모 최종 승인
- 질문 횟수 제한
- 아이 거부권
- 답변 재확인
- 가족/아이 데이터 격리

## 대표님 테스트 정상 프로세스

### A. “어제” 질문

1. 부모 > 케이와 대화 진입
2. 대상 아이 선택
3. `어제 ○○이는 뭐했어?` 입력
4. KST 기준 오늘-1일을 target date로 확정
5. 해당 `daily_reports.business_date` 우선 조회
6. 해당 날짜에 확인된 내용만 답변
7. 다른 날짜 Memory Fact를 “어제”라고 답하지 않음

PASS:
```text
부모:
어제 서현이는 뭐했어?

케이:
어제(8월 13일) 리포트에서는 ○○와 △△ 이야기가 확인돼요.
```

FAIL:
```text
누적 기억에 따르면, 어제(8월 1일) ...
```

### B. 세부 내용이 없는 후속 질문

```text
부모:
그날 뮤지컬을 봤어?

케이:
리포트에는 뮤지컬을 봤다는 내용이 있어요.

부모:
어떤 장면이 기억에 남았대?
```

해당 장면 정보가 실제 근거에 없다면:

```text
케이:
뮤지컬을 봤다는 기록은 있지만,
어떤 장면이 기억에 남았는지는 기록에 없어요.
서현이에게 직접 물어볼까요?
```

아래 문구로 회피하면 FAIL:

```text
관련된 기록은 일부 확인되지만 지금 질문에 답할 만큼 근거가 충분하지 않아요.
확인된 범위를 더 구체적으로 말씀해 주세요.
```

### C. 아이에게 물어보기

위 대화 직후 부모:

```text
물어봐줘
```

또는:

```text
아이에게 물어봐줘
```

정상:

```text
직전 topic:
뮤지컬에서 기억에 남은 장면

→ Parent Query Request
→ Crisis/Red 검사
→ 안전 문제가 없으면 직전 topic 유지
→ 질문 초안:
“그날 본 뮤지컬에서 제일 기억에 남는 장면이 뭐였어?”
```

부모에게 질문 내용을 처음부터 다시 입력하라고 하면 FAIL.

### D. 잘못된 날짜 답변 정정

```text
부모:
어제 뭐했어?

케이:
잘못된 날짜 답변

부모:
아니, 어제라고 했잖아. 날짜가 왜 달라?
```

정상:

```text
→ FEEDBACK_OR_CORRECTION 감지
→ 직전 사용자 질문 복원
→ Temporal Resolver 재실행
→ Retrieval 재실행
→ 올바른 날짜 기준 수정 답변
```

단순 사과 후 `다시 말씀해 주세요`로 끝나면 FAIL.

# 1. 목표

Antigravity READ-ONLY 진단으로 아래 Root Cause가 확정됐다.

```text
1. 상대 날짜 Resolver 없음
2. "어제/오늘/지난주"를 KST 날짜/기간으로 변환하지 않음
3. 날짜 질문에도 daily_reports.business_date 필터 미적용
4. Daily / Weekly / Dashboard / Memory가 temporal 제약 없이 경쟁
5. 오래된 Memory Fact가 vector score로 최신 날짜 리포트를 이길 수 있음
6. FEEDBACK_OR_CORRECTION에서 Retrieval을 재실행하지 않음
7. parsed.answerable=false 시 고정 fallback 문구 반복
8. 후속 "물어봐줘"에서 직전 질문 topic이 유지되지 않는 경우 존재
```

이번 작업에서 위 문제를 하나의 흐름으로 수정한다.

# 2. 현재 확정된 실제 장애 사례

Antigravity 실측:

```text
질문 시 기준 KST:
2026-08-10

부모 질문:
어제 서현이는 뭐했어?

정상 target_date:
2026-08-09

실제 target_date:
NULL

2026-08-09 daily_reports:
존재

실제 선택된 과거 데이터:
2026-08-01

원인:
8/9 리포트 keyword score=0
8/1 memory vector score가 더 높아 8/1이 선택됨
```

데이터 생성 실패가 아니다.

# 3. 기존 구조 확인 후 수정

작업 시작 전 현재 HEAD 기준으로 실제 코드를 확인한다.

필수 확인:
```text
app/api/parent/k-chat/route.ts
lib/parentKChat/intentClassifier.ts
lib/parentKChat/parentKnowledgeRetrieval.ts
buildEffectiveParentQuery
retrieveParentKContext
daily report 조회부
weekly report 조회부
dashboard 조회부
memory retrieval
FEEDBACK_OR_CORRECTION 처리부
INSUFFICIENT_EVIDENCE 처리부
Parent Query Request / pending topic 처리부
```

Antigravity 보고서의 파일/라인을 그대로 믿고 덮어쓰지 않는다.

# 4. Temporal Query Resolver 구현

Retrieval 전에 deterministic Temporal Resolver를 실행한다.

지원 최소 범위:
```text
오늘
어제
그제
내일
이번 주
지난주
다음 주
이번 달
지난달
요즘
최근
평소
원래
예전부터
자주
8월 9일
2026년 8월 9일
2026-08-09
```

KST 기준:
```text
timezone = Asia/Seoul
```

예:
```text
현재 KST:
2026-08-10

어제
→ EXACT_DATE
→ 2026-08-09
```

LLM에 날짜 해석을 맡기지 않는다.

# 5. Temporal Source Router

## EXACT_DATE
```text
1. 해당 날짜 Daily Report
2. 해당 날짜 부모 공개 상세/대시보드 파생 정보
3. 해당 날짜에 연결된 기타 부모 공개 근거
```

다른 날짜 Memory Fact를 primary evidence로 사용 금지.

## DATE_RANGE
```text
1. Weekly Report
2. 해당 기간 Daily Reports
3. Dashboard aggregate
4. Memory는 장기 비교 보조
```

## RECENT
```text
1. 최근 Daily
2. Dashboard
3. 최신 Weekly
4. Memory Facts
```

## LONG_TERM
```text
1. Memory Facts
2. 과거 Reports
3. 최근 Report 보조
```

# 6. Date-Scoped Retrieval 필수

EXACT_DATE면:

```text
daily_reports.business_date = resolved targetDate
```

를 먼저 적용한다.

다른 날짜 row는 primary evidence가 될 수 없다.

# 7. Temporal Constraint > Semantic Score

잘못된 구조:
```text
8/9 report semantic score 낮음
8/1 memory score 높음
→ 8/1 선택
```

정상:
```text
targetDate = 8/9
↓
8/9가 아닌 evidence는 primary 후보 제외
↓
8/9 evidence 안에서 relevance 평가
```

# 8. Evidence 구조에 날짜·출처 포함

예:
```json
{
  "source": "daily_report",
  "businessDate": "2026-08-09",
  "content": "...",
  "temporalMatch": "EXACT",
  "relevance": 0.9
}
```

다른 날짜 Memory:
```json
{
  "source": "memory_fact",
  "sourceDate": "2026-08-01",
  "content": "...",
  "temporalMatch": "MISMATCH",
  "relevance": 0.8
}
```

EXACT_DATE에서는 `MISMATCH`를 primary answer context에서 제외한다.

# 9. LLM 호출 전 날짜 검증

EXACT_DATE 질문이면 LLM 호출 전에:

```text
primary evidence date == targetDate
```

를 검증한다.

불일치 evidence는 제거하거나 Retrieval을 재평가한다.

# 10. 후속 질문 맥락 유지

예:
```text
부모:
어제 서현이는 뭐했어?

케이:
8월 13일에는 ○○했어요.

부모:
어떤 게 제일 재밌었대?
```

두 번째 질문은:
```text
targetDate = 기존 targetDate 유지
topic = 그날 활동
```

이어야 한다.

# 11. Assistant 오류 Context Feedback Loop 제거

Retrieval용 effective query는 우선적으로:

```text
current user turn
+
필요한 이전 user turns
+
structured topic/date state
```

로 만든다.

assistant의 이전 factual answer는 검색 조건의 사실로 신뢰하지 않는다.

# 12. FEEDBACK_OR_CORRECTION에서 실제 복구

예:
```text
부모:
아니, 어제라고 했잖아. 왜 8월 1일을 말해?
```

처리:
```text
1. FEEDBACK_OR_CORRECTION
2. 직전 user information query 찾기
3. 정정 발화에서 target date/topic 추출
4. Temporal Resolver 다시 실행
5. Retrieval 다시 실행
6. 수정된 답변 생성
```

정상:
```text
맞아요. 제가 날짜를 잘못 확인했어요.
어제는 8월 13일이에요.
8월 13일 리포트를 다시 확인해보면 ...
```

# 13. Answer Policy — 알면 말하고, 모르면 모른다고 말하기

## EVIDENCE_FOUND
```text
확인되는 내용을 바로 답한다.
```

## PARTIAL_EVIDENCE
```text
뮤지컬을 봤다는 기록은 있어요.
하지만 어떤 장면이 가장 기억에 남았는지는 기록에 없어요.
```

## NO_DATA
```text
그 내용은 아직 확인되는 기록에 없어요.
```

## SYSTEM_ERROR
```text
지금은 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
```

범용 fallback으로 아래 문구 사용 금지:
```text
관련된 기록은 일부 확인되지만 지금 질문에 답할 만큼 근거가 충분하지는 않아요.
확인된 범위를 더 구체적으로 말씀해 주시면 다시 살펴볼게요.
```

# 14. “물어봐줘”가 직전 모르는 항목을 승계해야 함

정상 대화:
```text
부모:
어떤 장면이 제일 기억에 남았대?

케이:
뮤지컬을 봤다는 기록은 있지만,
어떤 장면이 기억에 남았는지는 기록에 없어요.
서현이에게 직접 물어볼까요?

부모:
물어봐줘.
```

이때:
```text
구체적인 질문을 입력해 주세요.
```

라고 하면 FAIL.

Parent Query Request는 최소:
```text
child_id
lastTopic
lastUnknownDetail
targetDate / temporal context
직전 parent question
```

을 승계한다.

질문 초안:
```text
그날 본 뮤지컬에서 제일 기억에 남는 장면이 뭐였어?
```

# 15. Green List 임시 OFF 상태 유지

이번 작업에서 Green whitelist gate 다시 ON 금지.

질문 생성:
```text
Crisis
→ Red
→ 그 외 일반 질문 중립 재작성
→ 부모 확인
```

# 16. 부모 화면 내부 용어 금지

사용자 노출 금지:
```text
fallback
Green List
DEFAULT_RED
RED
GREEN
rule_id
policy_version
confidence
INSUFFICIENT_EVIDENCE
```

# 17. 기존 통합 Retrieval 유지

유지:
```text
Dashboard
Daily Report
Weekly Report
Detailed Report
Memory Facts
Conversation Context
```

이번 작업은 Unified Retrieval을 제거하거나 memory-only 구조로 롤백하지 않는다.

# 18. 필수 단위 테스트

## Temporal Resolver
```text
오늘
어제
그제
이번 주
지난주
요즘
평소
8월 9일
2026년 8월 9일
```

## Source Router
```text
EXACT_DATE → Daily
DATE_RANGE → Weekly
RECENT → recent sources
LONG_TERM → Memory
```

## Date Guard
```text
targetDate=8/9
evidenceDate=8/1
→ primary=false
```

## Correction
```text
잘못된 날짜 답변
→ user correction
→ retrieval rerun=true
```

## Ask Child Context
```text
직전 unknown detail 존재
+ "물어봐줘"
→ draft topic == previous unknown detail
```

# 19. 실제 E2E 테스트 — 화면 기준

## Scenario A
```text
부모:
어제 서현이는 뭐했어?
```

PASS:
```text
KST yesterday 계산
해당 날짜 Daily Report
다른 날짜 Memory primary=false
```

## Scenario B
```text
부모:
8월 9일 서현이는 뭐했어?
```

PASS:
```text
business_date=2026-08-09
```

## Scenario C
```text
부모:
그날 어떤 게 제일 기억에 남았대?
```

상세 근거가 없으면:
```text
그날 ○○했다는 기록은 있지만,
무엇이 가장 기억에 남았는지는 기록에 없어요.
```

## Scenario D
```text
부모:
물어봐줘
```

PASS:
```text
직전 unknown detail를 질문 초안으로 이어감
부모 재입력 요구 없음
```

## Scenario E — 정정
```text
부모:
아니 어제라고 했잖아. 왜 다른 날짜를 말해?
```

PASS:
```text
사과 + retrieval 재실행 + 수정 답변
```

## Scenario F — 장기 질문
```text
평소 서현이는 뭘 좋아해?
```

PASS:
```text
Memory Facts 우선
```

## Scenario G — 데이터 없음
```text
특정 날짜 report 없음
```

PASS:
```text
그 날짜에 확인되는 기록이 없어요.
```

다른 날짜 기록으로 답변 금지.

# 20. Development → Production

1. 현재 HEAD 및 Dev/Prod 배포 Commit 확인
2. 현재 구현과 Antigravity 진단 재대조
3. 코드 수정
4. 단위 테스트
5. 타입 검사
6. 린트
7. 빌드
8. Development 배포
9. Development 모바일/PWA 실제 E2E
10. Scenario A~G 전부 PASS
11. 기존 일반 대화·PQR·Q&A·STT 회귀 확인
12. 동일 Commit Production 배포
13. Production 모바일/PWA 실제 E2E
14. 대표 사례 재검증
15. 결과 보고

Dev만 고치고 완료 처리하지 않는다.

# 21. 금지사항

- DB 데이터를 만들어서 테스트 통과시키기
- 8월 1일 Memory Fact 삭제
- 리포트를 수동 수정해 증상을 숨기기
- keyword score만 임의 조정해 8/9를 위로 올리기
- LLM prompt에 임시 문구만 추가
- 상대 날짜 계산을 LLM에 맡기기
- Green List를 다시 활성화
- Red/Crisis를 끄기
- user correction을 단순 사과로만 처리
- 동일 fallback 문구 유지
- Dev만 수정하고 Prod 미적용

# 22. 완료 조건

- [ ] KST Temporal Resolver 구현
- [ ] targetDate/dateRange 구조화
- [ ] 날짜 질문에 DB date scope 적용
- [ ] temporal constraint가 semantic score보다 우선
- [ ] 다른 날짜 Memory 오버랭킹 차단
- [ ] 날짜별 Source Routing
- [ ] 후속 질문 temporal/topic 유지
- [ ] assistant 오류 feedback loop 차단
- [ ] correction 시 Retrieval 재실행
- [ ] 부분 근거는 아는 부분만 답함
- [ ] 모르면 명확히 모른다고 답함
- [ ] 시스템 오류와 NO_DATA 구분
- [ ] "물어봐줘"가 직전 unknown detail 승계
- [ ] 부모에게 재입력 요구하지 않음
- [ ] Green List 임시 OFF 유지
- [ ] Red/Crisis 유지
- [ ] 내부 용어 노출 0건
- [ ] Dev Scenario A~G PASS
- [ ] Production Scenario A~G PASS
- [ ] 모바일/PWA 실제 검증 PASS

# 23. 완료 보고 형식

```text
1. 실제 수정 전 Root Cause 재확인
2. 수정 파일·함수
3. Temporal Resolver 구현 방식
4. KST 처리 방식
5. Source Router 구현
6. Date-scoped Retrieval 구현
7. Memory overranking 방지
8. Correction Recovery 구현
9. Assistant Context Filtering 구현
10. Answer Policy 변경
11. Ask Child Context 승계 구현
12. Green List OFF 유지 확인
13. Red/Crisis 회귀 결과
14. 단위 테스트 결과
15. Scenario A 결과
16. Scenario B 결과
17. Scenario C 결과
18. Scenario D 결과
19. Scenario E 결과
20. Scenario F 결과
21. Scenario G 결과
22. Development Commit/URL
23. Production Commit/URL
24. 모바일/PWA 실제 결과
25. 남은 제한사항
```

실제 trace를 반드시 포함:
```text
질문:
어제 서현이는 뭐했어?

resolved temporal:
EXACT_DATE

targetDate:
YYYY-MM-DD

primary source:
daily_report

primary business_date:
YYYY-MM-DD

different-date memory primary:
false

answer status:
EVIDENCE_FOUND / PARTIAL_EVIDENCE / NO_DATA / SYSTEM_ERROR
```

# 24. 보안

Production service role key, API key, token, password 등 비밀정보:
- 평문 하드코딩 금지
- 로그 출력 금지
- 임시 파일 저장 금지
- 테스트 소스 삽입 금지

기존 Secret Manager / Vercel Secrets / Supabase Secrets / 안전한 환경변수에서 런타임에만 사용하며 값은 마스킹한다.
