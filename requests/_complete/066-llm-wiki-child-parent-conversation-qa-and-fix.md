# 066 - LLM WIKI 기반 아이·부모 대화 연동 QA 및 전체 정상화

## 1. 작업 목적

LLM WIKI가 DB에 Fact·Evidence·Embedding을 저장하는 수준을 넘어, 실제 사용자 화면에서 기억을 조회하고 대화를 이어가도록 검증·수정·재검증한다.

대상 화면:

1. 아이 화면 — 미션
2. 아이 화면 — 자유대화
3. 부모 화면 — 케이와의 대화

이번 작업은 단순 코드 리뷰나 DB 건수 확인으로 끝내지 않는다.

Claude Code는 다음을 모두 수행한다.

1. 아래 QA 시나리오를 기준으로 Development에서 실제 E2E 테스트
2. Antigravity 또는 기존 QA 도구를 활용해 실행 증거 수집
3. 최초 실패 단계 추적
4. 코드·DB·RPC·Prompt·Retrieval 로직 수정
5. Development 재배포
6. 동일 시나리오 처음부터 재실행
7. 모든 항목 PASS까지 반복
8. Dev 전체 PASS 후 Production 안전 배포
9. Production 기존 데이터 보존 및 Runtime 연결 검증

---

## 2. 핵심 사용자 시나리오

### 2.1 아이 화면 — 미션

아이 발화:

```text
내가 좋아하는 과일은 수박이야.
```

기대 저장:

```text
Fact: 아이는 수박을 좋아한다.
source: mission
```

### 2.2 아이 화면 — 자유대화

같은 아이 발화:

```text
내가 싫어하는 과일은 참외야.
```

기대 저장:

```text
Fact: 아이는 참외를 싫어한다.
source: free_chat
```

미션 기억과 자유대화 기억은 같은 아이의 단일 LLM WIKI에 통합돼야 한다.

### 2.3 부모 화면 — 케이와의 대화

부모 질문:

```text
아이가 좋아하는 과일은 뭐니?
```

기대 답변:

```text
수박을 좋아해요.
```

부모 질문:

```text
아이가 싫어하는 과일은 뭐니?
```

기대 답변:

```text
참외를 싫어해요.
```

부모 질문:

```text
이번 주말에 스케이트장에 가면 좋아할까?
```

관련 정보가 없으면 추측 금지.

기대 답변:

```text
아직 그건 잘 모르겠어요. 아이에게 자연스럽게 물어볼게요.
```

그리고 `parent_questions`에 pending 질문을 생성한다.

### 2.4 다시 아이 화면 — 기존 기억 회상

아이 질문:

```text
내가 싫어하는 과일이 뭐지?
```

기대 답변:

```text
참외 싫어한다고 했잖아.
```

아이 질문:

```text
내가 먹고 싶은 과일은?
```

기대 답변:

```text
수박 좋아한다고 했지. 지금 수박 먹고 싶어?
```

금지:

```text
너 수박 좋아하니, 수박 먹고 싶지?
```

과거 선호와 현재 욕구를 동일하게 단정하면 안 된다.

### 2.5 부모 질문을 아이에게 자연스럽게 전달

pending 질문이 있으면 아이 미션 또는 자유대화에서 자연스럽게 묻는다.

예시:

```text
케이: 이번 주말에 스케이트장 가보는 건 어때?
아이: 좋아.
케이: 스케이트 타본 적 있어?
아이: 처음이야.
케이: 그럼 부모님이랑 처음 도전해 볼래?
아이: 좋아.
케이: 좋아! 부모님께 한번 말씀드려 볼게.
```

기대 저장:

```text
아이는 이번 주말 스케이트장에 가보고 싶어 한다.
아이는 스케이트를 타본 적이 없다.
아이는 부모님과 처음 도전하는 것에 긍정적이다.
```

`parent_questions.status`:

```text
pending → answered
```

### 2.6 부모 화면 결과 회수

부모가 다시 물으면:

```text
아이에게 물어봤어요. 스케이트는 처음이지만, 이번 주말에 부모님과 도전해 보고 싶다고 했어요.
```

---

## 3. 확정 기능 구조

```text
아이 미션 기억
+
아이 자유대화 기억
→ 아이별 단일 LLM WIKI

부모 화면 케이와의 대화
→ 부모가 선택한 child_id의 LLM WIKI 조회

부모 질문에 답이 없음
→ parent_questions 생성

아이 미션·자유대화
→ pending 질문 자연스럽게 전달

아이 답변
→ LLM WIKI 저장
→ parent_questions answered 처리

부모 화면
→ answered 결과 반환
```

---

## 4. 역할 구분

### Antigravity

허용:

- Development QA 계정 로그인
- 실제 UI 기반 시나리오 실행
- Network·DB·Job·로그 읽기
- 각 단계 PASS/FAIL 판정
- 최초 실패 지점 보고
- 실행 증거 수집

금지:

- 코드 수정
- DB 데이터 직접 생성
- Job 상태 직접 변경
- Production 데이터 수정
- 관련 없는 문서 수정
- DB 건수만 보고 PASS 판정

### Claude Code

수행:

- QA 결과 분석
- 코드 수정
- Migration·RPC 수정
- Prompt 수정
- Retrieval 연결 수정
- Dev 배포
- 재테스트
- Production 배포
- 최종 검증

---

## 5. 테스트 환경

Development 기존 QA 계정을 사용한다.

권장:

```text
TestA: 기억 생성·회상 테스트
TestB: 아이 간 기억 격리 테스트
```

실제 로그인 ID와 child_id는 Dev DB 기준으로 확인한다.

---

## 6. QA 시나리오 A — 미션 기억 생성

TestA 아이 화면에서 실제 미션을 시작한다.

아이 발화:

```text
내가 좋아하는 과일은 수박이야.
```

자연스러운 문맥으로 최소 3턴 이상 진행한다.

확인:

```text
chat_sessions 생성
chat_messages 저장
session_type = mission
child_id 정확
business_date KST 기준 정상
```

파이프라인 완료 후 확인:

- `수박을 좋아한다` Fact
- source = mission
- Evidence 연결
- Embedding 연결
- 모델 = `gemini-embedding-001`
- 다른 아이 혼입 0

PASS:

```text
Fact 생성
Evidence 존재
Embedding 존재
child_id 정확
```

---

## 7. QA 시나리오 B — 자유대화 기억 생성

같은 TestA로 실제 자유대화를 시작한다.

아이 발화:

```text
내가 싫어하는 과일은 참외야.
```

최소 3턴 이상 진행한다.

확인:

- `참외를 싫어한다` Fact
- source = free_chat
- Evidence 연결
- Embedding 연결
- 수박 Fact 유지
- 수박·참외 모두 같은 child_id에서 검색 가능

PASS:

```text
free_chat Fact 생성
수박 Fact 유지
참외 Fact 생성
통합 검색 가능
```

---

## 8. QA 시나리오 C — 부모 화면에서 알려진 정보 조회

TestA 부모 계정으로 로그인하고 해당 아이를 선택한다.

질문 1:

```text
아이가 좋아하는 과일은 뭐니?
```

기대:

```text
수박을 좋아해요.
```

질문 2:

```text
아이가 싫어하는 과일은 뭐니?
```

기대:

```text
참외를 싫어해요.
```

각 질문마다 Runtime 증거:

```text
parent_id
selected child_id
부모-아이 권한 검증
Retrieval 호출
Query Embedding
검색 Fact ID
Similarity/Ranking
Prompt에 전달된 Memory 수
최종 응답
```

PASS:

- 부모 ID가 아닌 선택된 child_id로 검색
- 관련 Fact 검색
- 사실 왜곡 0
- 다른 아이 정보 0
- 모른다고 답하지 않음

---

## 9. QA 시나리오 D — 부모 질문에 답이 없는 경우

부모 질문:

```text
이번 주말에 스케이트장에 가면 좋아할까?
```

기대:

```text
아직 그건 잘 모르겠어요. 아이에게 자연스럽게 물어볼게요.
```

DB 기대:

```text
parent_questions
- parent_id
- child_id
- topic
- normalized_question
- status = pending
- created_at
```

금지:

- 좋아할 것 같다고 추측
- 수박·참외 기억을 근거로 스케이트장 선호 추론
- 질문 큐 생성 없이 답변 종료
- 같은 질문을 pending으로 중복 생성

PASS:

```text
추측 0
pending 1건
parent_id·child_id 정확
중복 0
```

---

## 10. QA 시나리오 E — 아이 화면에서 기존 기억 회상

다시 TestA 아이 계정으로 로그인한다.

질문 1:

```text
내가 싫어하는 과일이 뭐지?
```

기대:

```text
참외 싫어한다고 했잖아.
```

질문 2:

```text
내가 먹고 싶은 과일은?
```

기대:

```text
수박 좋아한다고 했지. 지금 수박 먹고 싶어?
```

PASS:

```text
참외 기억 정확
수박 기억 정확
현재 욕구 추측 0
다른 아이 기억 0
```

---

## 11. QA 시나리오 F — pending 부모 질문 전달

pending 질문:

```text
이번 주말에 스케이트장에 가보고 싶은지
```

아이 미션 또는 자유대화에서 자연스럽게 전달한다.

확인:

- 올바른 child_id
- 설문처럼 한꺼번에 읽지 않음
- 아이 답변에 따라 후속 질문
- 같은 질문 반복 0
- 아이가 거부하면 압박 0
- 답변 완료 후 answered 처리

PASS:

```text
pending 조회
자연스러운 전달
답변 저장
status = answered
중복 질문 0
```

---

## 12. QA 시나리오 G — 스케이트장 기억 저장

아이 답변 이후 다음 의미가 저장돼야 한다.

```text
아이는 이번 주말 스케이트장에 가보고 싶어 한다.
아이는 스케이트를 타본 적이 없다.
아이는 부모님과 처음 도전하는 것에 긍정적이다.
```

확인:

- Fact
- Evidence
- Embedding
- parent_question linkage
- 다른 질문 혼합 0
- 원문에 없는 과장 0

---

## 13. QA 시나리오 H — 부모 결과 회수

부모 질문:

```text
스케이트장에 대해 아이에게 물어봤니?
```

기대:

```text
아이에게 물어봤어요. 스케이트는 처음이지만, 이번 주말에 부모님과 도전해 보고 싶다고 했어요.
```

PASS:

- answered parent_question 조회
- 해당 아이 Fact 조회
- 사실 기반 답변
- 미완료를 완료로 표시하지 않음
- 다른 아이 결과 0

---

## 14. QA 시나리오 I — 아이 간 기억 격리

TestB 질문:

```text
내가 좋아하는 과일 기억나?
내가 싫어하는 과일 기억나?
이번 주말에 스케이트장 가기로 했지?
```

PASS:

```text
TestA Fact ID 노출 = 0
TestA Fact 내용 노출 = 0
TestA parent_question 노출 = 0
```

한 건이라도 노출되면 `CHILD_MEMORY_ISOLATION_FAIL`.

---

## 15. QA 시나리오 J — 화면별 공통 Retrieval

세 화면이 공통 Retrieval 서비스를 사용하도록 확인한다.

```text
아이 미션
아이 자유대화
부모 케이와의 대화
```

권장 인터페이스:

```ts
retrieveChildMemory({
  childId,
  query,
  surface: 'mission' | 'free_chat' | 'parent_chat',
  topK,
})
```

정책:

```text
V3 결과 있음 → V3만 사용
V3 결과 없음 → Legacy child_memory fallback
V3 + Legacy 동시 주입 금지
```

---

## 16. 오동작 분류

```text
FACT_NOT_CREATED
EVIDENCE_NOT_LINKED
EMBEDDING_NOT_CREATED
RETRIEVAL_NOT_CALLED
WRONG_CHILD_ID
VECTOR_SEARCH_EMPTY
WRONG_FACT_RANKING
PROMPT_MEMORY_NOT_INJECTED
MISSION_MEMORY_FAIL
FREE_CHAT_MEMORY_FAIL
PARENT_CHAT_MEMORY_FAIL
PARENT_QUESTION_NOT_CREATED
PARENT_QUESTION_NOT_DELIVERED
PARENT_QUESTION_DUPLICATED
PARENT_QUESTION_NOT_ANSWERED
CURRENT_STATE_OVERINFERENCE
CROSS_CHILD_MEMORY_LEAK
LEGACY_DUPLICATE_INJECTION
REPORT_OR_PIPELINE_DEPENDENCY_FAIL
```

---

## 17. Claude Code 수정 범위

### Memory 생성

- Context Correction 입력
- Memory Batch 입력
- Fact 추출 Prompt
- Evidence 연결
- Embedding
- source 구분
- 멱등성

### Retrieval

- 공통 Retrieval 함수
- child_id 필터
- Query Embedding
- threshold
- Top-K
- RPC
- Cache key
- V3 우선·Legacy fallback

### Prompt

- 미션 Prompt
- 자유대화 Prompt
- 부모 대화 Prompt
- Memory Context 위치
- 토큰 예산
- 기억 없음 fallback
- 과거 선호와 현재 상태 구분

### 부모 질문 큐

- `parent_questions` 생성
- 중복 방지
- pending/asked/answered
- 아이 화면 전달
- 답변 저장
- 부모 결과 회수
- 부모-아이 권한 검증

### 화면 경로

- 자동 마이크
- 수동 마이크
- 세션 재진입
- Live
- 비Live
- 미션
- 자유대화
- 부모 케이 대화

---

## 18. 비용·실행 정책

기존 정책을 유지한다.

```text
17:55 → Phase 1 Collection만, LLM 호출 없음
23:55 → Phase 2 Collection, 하루 Raw 확정
그 이후 → Correction 1회, Memory 1회, Report 1회
```

10분 polling은 pending Job 확인만 수행한다.

금지:

- 아이 대화마다 Correction
- 아이 대화마다 Memory Batch
- 아이 대화마다 Report 재생성
- completed Job 재claim
- 자동 generation_version 증가

---

## 19. Dev 실행 순서

```text
1. 테스트 전 스냅샷
2. TestA 미션에서 수박 입력
3. TestA 자유대화에서 참외 입력
4. 파이프라인 완료
5. 부모 화면 수박·참외 조회
6. 부모 화면 스케이트장 질문
7. pending 질문 확인
8. 아이 화면에서 기억 회상
9. pending 질문 자연스럽게 전달
10. 아이 답변 저장
11. 부모 화면 결과 회수
12. TestB 격리 테스트
13. 실패 지점 수정
14. Dev 재배포
15. 전체 시나리오 재실행
```

부분 PASS로 종료 금지.

---

## 20. Production 적용 조건

다음이 모두 PASS하기 전 Production 배포 금지.

```text
미션 Fact 생성
자유대화 Fact 생성
부모 화면 Retrieval
아이 미션 Retrieval
아이 자유대화 Retrieval
부모 질문 pending 생성
아이에게 질문 전달
answered 처리
부모 결과 회수
아이 간 격리
V3 우선
Legacy 중복 없음
비용 정책 유지
중복 데이터 0
```

---

## 21. Production 안전 적용

1. 기존 Memory·parent_questions 스냅샷
2. Migration 적용
3. 앱·API·Worker 배포
4. 기존 데이터 삭제 0
5. 안전한 QA 계정으로 축소 검증
6. 일반 사용자 데이터 수정 금지
7. Runtime Retrieval 증거 확인
8. 오류 로그 확인

---

## 22. 보안

금지:

- 서비스 역할 키 평문 출력
- QA 비밀번호 하드코딩
- 세션 토큰 로그
- 아이 대화 원문 전체 출력
- 완성 Prompt 전체 로그
- 다른 아이 Memory 조회

로그 허용:

```text
child_id 마스킹
Fact ID
검색 건수
Similarity
surface
memorySource
parent_question status
```

---

## 23. 완료 기준

```text
미션에서 수박 Fact 생성
자유대화에서 참외 Fact 생성
부모 질문에서 수박 정확 응답
부모 질문에서 참외 정확 응답
스케이트장 질문에서 추측 금지
parent_questions pending 생성
아이 화면에서 참외 기억 회상
아이 화면에서 수박 선호와 현재 욕구 구분
스케이트장 질문 자연스럽게 전달
아이의 처음 경험 저장
아이의 긍정 답변 저장
parent_questions answered 처리
부모 화면 결과 회수
TestB 교차 기억 0
세 화면 공통 Retrieval
V3 우선
Legacy 중복 없음
중복 Fact·Question·Report 0
```

---

## 24. 최종 보고 형식

첫 줄:

```text
LLM WIKI 3개 화면 전체 정상
LLM WIKI 아이 화면만 정상
LLM WIKI 부모 화면 실패
LLM WIKI 부모 질문 연동 실패
LLM WIKI 아이 간 격리 실패
LLM WIKI 일부 실패
LLM WIKI 전체 실패
```

### 변경 파일

| 파일 | 변경 내용 | Dev 배포 | Production 배포 |
|---|---|---|---|

### 테스트 계정

```text
TestA child_id:
TestA parent_id:
TestB child_id:
테스트 시작:
테스트 종료:
```

### 기억 생성

| 항목 | Source | Fact | Evidence | Embedding | 결과 |
|---|---|---|---|---|---|
| 수박 좋아함 | mission | | | | |
| 참외 싫어함 | free_chat | | | | |

### 부모 화면

| 질문 | 검색 Fact | Prompt 주입 | 실제 답변 | 결과 |
|---|---|---|---|---|
| 좋아하는 과일 | | | | |
| 싫어하는 과일 | | | | |
| 스케이트장 | | | | |

### 부모 질문 큐

```text
pending 생성:
중복:
아이 전달:
asked:
answered:
부모 결과 회수:
```

### 아이 화면 회상

| 화면 | 질문 | 검색 Fact | 실제 답변 | 결과 |
|---|---|---|---|---|
| 미션 | 싫어하는 과일 | | | |
| 자유대화 | 먹고 싶은 과일 | | | |
| 미션/자유대화 | 스케이트장 | | | |

### 아이 격리

```text
TestB에서 TestA Fact 노출:
TestB에서 TestA 질문 노출:
교차 child_id 결과:
```

### Runtime 연결

```text
Mission Retrieval:
Free Chat Retrieval:
Parent Chat Retrieval:
공통 함수:
V3 우선:
Legacy fallback:
V3+Legacy 중복:
```

### 최종 판정

```text
미션 기억 생성: PASS / FAIL
자유대화 기억 생성: PASS / FAIL
부모 알려진 정보 조회: PASS / FAIL
부모 미지 정보 처리: PASS / FAIL
부모 질문 생성: PASS / FAIL
아이 질문 전달: PASS / FAIL
아이 답변 저장: PASS / FAIL
부모 결과 회수: PASS / FAIL
현재 상태 과잉 추론 방지: PASS / FAIL
아이 간 격리: PASS / FAIL
전체 결과: PASS / FAIL
```

### 남은 문제

없으면:

```text
남은 문제 없음
```

문제가 있으면:

```text
최초 실패 단계:
재현 화면:
재현 질문:
child_id:
session_id:
job_id:
관련 Fact ID:
오류 코드:
확정 원인:
수정 대상:
다음 조치:
```

---

## 25. 절대 금지

- DB Fact 존재만으로 PASS
- 코드에 Retrieval 함수 존재만으로 PASS
- Prompt에 memory 항목 존재만으로 PASS
- 부모 화면에서 parent_id로 Memory 검색
- 미션만 테스트하고 자유대화 생략
- 자유대화만 테스트하고 부모 화면 생략
- 질문 생성만 하고 아이 전달 생략
- 아이 답변 후 부모 결과 회수 생략
- TestA 정보가 TestB에 노출
- 수박 선호를 현재 먹고 싶은 욕구로 단정
- 스케이트장 선호 추측
- 관련 없는 파일 수정
- 원인 보고만 하고 종료
