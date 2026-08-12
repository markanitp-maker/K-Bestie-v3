# K-Bestie Memory Context 및 Proactive AI Friend 구현

## 작업 정보

- 우선순위: High
- 유형: 기능 구현
- 선행 조건:
  - 기존 음성 대화 안정화 완료 후 진행
  - Memory 저장 파이프라인 정상 동작 확인 완료
- 목표:
  - 케이가 아이와 이전에 나눈 대화와 경험을 기억하는 AI 친구 경험 구현
  - 단순히 아이가 기억을 물어볼 때만 답하는 방식이 아니라, 자연스럽게 이전 기억을 활용하는 대화 구조 구축

---

# 현재 상태

현재 시스템은 다음까지 구현되어 있다.

## 완료

### 대화 저장

`chat_messages`

저장 데이터:

- child_id
- session_id
- role(child/k)
- content
- mode(mission/free)
- voice_mode
- created_at

미션 대화와 자유 대화 모두 동일 구조로 저장됨.

---

## 완료

### Memory 생성

`child_memory`

생성 위치:

- `supabase/functions/_shared/batch.ts`
- `generateMemorySummaries()`

생성 데이터:

### short_term

- 최근 대화 요약
- 일정 기간 유지

### long_term

카테고리:

- interest
- friend
- family
- dream
- event

---

## 완료

### Daily Report

`daily_reports`

부모 리포트용 요약 데이터 생성 완료.

---

# 현재 문제

현재 저장된 기억을 케이 대화 컨텍스트로 활용하지 못한다.

현재 구조:

```
아이 대화
 ↓
chat_messages 저장
 ↓
Memory Batch
 ↓
child_memory 생성

(중단)

다음 대화 시작
 ↓
기억 조회 없음
 ↓
케이는 현재 세션만 인식
```

---

# 목표 아키텍처

변경 목표:

```
아이 로그인
 ↓
Child Profile 조회
 ↓
child_memory 조회
 ↓
Memory Context 생성
 ↓
Session Context 포함
 ↓
K Prompt 전달
 ↓
개인화 대화
```

---

# 요구사항

## 1. Memory Context Loader 구현

세션 시작 시 아이별 기억 데이터를 조회하는 공통 모듈을 만든다.

조건:

- 기존 child_memory 재사용
- 신규 DB 생성 금지
- 기존 프로필 조회 구조 재사용

조회 대상:

### 단기 기억

최근:

- daily_summary
- 최근 사건
- 최근 감정 변화


### 장기 기억

필요 카테고리:

- 관심사
- 친구
- 좋아하는 것
- 반복적으로 언급한 주제

---

# 2. LLM Context 전달 구조 추가

현재:

```
System Prompt
+
현재 세션 대화
```

변경:

```
System Prompt
+
Child Profile Context
+
Memory Context
+
현재 세션 대화
```

Memory Context는:

- 아이에게 자연스럽게 활용 가능한 정보만 전달
- 민감정보 제외
- 부모 정보 제외
- 인증 정보 제외

---

# 3. 첫 인사 개인화

세션 시작 시 케이가 기억 기반 인사를 할 수 있어야 한다.

예:

현재:

```
안녕 서아야.
오늘 하루 어땠어?
```

변경:

```
안녕 서아야.
어제 친구랑 놀이터 갔다고 했는데 재미있었어?
```

조건:

- 항상 기억을 꺼내지 않는다.
- 연결성이 높은 기억만 사용한다.
- 부담스러운 표현 금지.

---

# 4. 아이 질문 기반 기억 답변 유지

현재 구현된:

```
"케이 기억나?"
"어제 뭐 했는지 알아?"
```

형태의 Memory Recall 기능은 유지한다.

변경 금지:

- 기존 memoryRecallResponder 제거 금지
- 기존 자유대화 기억 조회 로직 유지

---

# 5. Proactive Memory Follow-up 구현

케이가 먼저 과거 기억을 활용하는 기능 추가.

예:

과거 기억:

```
친구 민지와 놀이터 방문
```

다음날:

```
서아야,
어제 민지랑 재미있게 놀았다고 했는데
오늘도 만났어?
```

조건:

- 무조건 기억을 꺼내지 않는다.
- 대화 흐름과 관련 있을 때만 사용한다.
- 하루 사용 횟수 제한 필요 검토.

---

# 6. 미션 대화 Memory Context 검토

미션 질문 생성 과정에서도 기억 활용 가능 여부 검토.

예:

기존:

```
오늘 친구와 있었던 일을 이야기해줘
```

개선:

```
서아야,
전에 민지 이야기 했었잖아.
오늘 민지랑 재미있는 일 있었어?
```

주의:

- 미션 목표 개수 계산 변경 금지
- 유효 답변 판정 변경 금지
- 질문 풀 구조 변경 금지

---

# 7. 자유 대화 Memory Context 검토

자유대화에서도 동일한 Memory Context 사용.

확인:

- reactionEngine
- voice/respond
- 자유대화 prompt 생성 위치

---

# 수정 범위

수정 가능:

- memory 관련 lib
- prompt 생성 코드
- session context 관련 코드
- mission/freechat context 전달 코드

수정 금지:

- 미션 완료 로직
- 황금열쇠
- MBTI
- 리텐션
- 인증 구조
- Production 환경

---

# DB 변경 정책

원칙:

- 신규 테이블 생성 금지
- child_memory 재사용
- daily_reports 재사용

---

# 검증 시나리오

## Scenario A

오늘:

아이:

```
친구랑 놀이터에서 놀았어
```

검증:

- chat_messages 저장
- child_memory 생성
- 다음날 조회 가능


다음날:

아이:

```
어제 뭐 했는지 알아?
```

기대:

```
응, 어제 친구랑 놀이터에서 놀았다고 했잖아.
```

---

## Scenario B

전날:

```
학교에서 친구 때문에 속상했어
```

다음날:

기대:

```
어제 학교에서 속상한 일이 있었다고 했는데
오늘은 괜찮아?
```

---

## Scenario C

기억 없는 정보 질문

아이:

```
내가 좋아하는 음식 뭐야?
```

기대:

- 저장된 기억 있으면 답변
- 없으면 모른다고 표현
- 추측 금지

---

# QA 검증

개발 완료 후 반드시:

`.claude/skills/k-bestie-voice-mission-qa`

스킬 기준으로 검증한다.

검증 항목:

- 기억 저장 정상 여부
- Memory Context 조회 여부
- Prompt 전달 여부
- 아이별 데이터 분리 여부
- 다른 아이 기억 노출 여부
- 기존 음성 대화 회귀 여부
- 미션 진행률 회귀 여부
- 자유대화 회귀 여부

---

# 로그 기록

QA 완료 후 반드시 기록:

- requests/_log.md

포함 내용:

- 구현 파일 목록
- Memory Context 흐름
- 테스트 시나리오 결과
- QA PASS/FAIL
- 발견 이슈
- 커밋 SHA
- Dev 배포 URL

---

# 최종 보고 형식

반드시 아래 항목으로 보고한다.

1. Memory Context Loader 위치
2. child_memory 조회 방식
3. Prompt 전달 위치
4. 미션 적용 여부
5. 자유대화 적용 여부
6. Proactive 질문 생성 방식
7. 변경 파일 목록
8. QA 결과
9. 테스트 시나리오 결과
10. 커밋 SHA
11. Dev 배포 결과
