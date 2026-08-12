# Request: K-Bestie LLM Wiki + RAG Memory Architecture 구축

작성일: 2026-07-27

## 1. 작업 목적

현재 K-Bestie-v3는 다음 Pipeline까지 구현되어 있다.

아이-케이 대화
→ chat_messages 저장
→ 18:00 / 23:59:59 데이터 수집
→ raw_daily_conversations
→ Gemini Context Correction
→ corrected_daily_conversations
→ daily_reports
→ child_memory

현재 문제:

- child_memory 기반 텍스트 기억 저장은 존재한다.
- 최근 기억 조회 후 Prompt 주입은 일부 구현되어 있다.
- 하지만 Vector 기반 Semantic Retrieval이 없다.
- Memory 간 관계(Entity, Relation, Event)가 없다.
- 케이가 아이의 과거 경험을 상황에 맞게 검색하여 활용하는 LLM Wiki 구조가 아니다.

목표:

현재 Pipeline은 유지하고,
LLM Wiki + RAG Memory Layer를 추가하여
아이별 2nd Brain 구조를 구축한다.

---

# 2. 절대 변경 금지 원칙

이번 작업은 기존 기능을 제거하지 않는다.

유지 대상:

- chat_messages
- chat_sessions
- raw_daily_conversations
- corrected_daily_conversations
- daily_reports
- child_memory
- parent_questions
- 기존 미션
- 자유대화
- Gemini Live
- STT/TTS Pipeline

기존 데이터 흐름을 깨지 않고 확장 방식으로 구현한다.

---

# 3. 목표 아키텍처

최종 구조:

아이 대화

↓

chat_messages

↓

Daily Collection

↓

raw_daily_conversations

↓

Gemini Context Correction

↓

corrected_daily_conversations

↓

Memory Extraction Agent

↓

LLM Wiki Memory Layer

↓

┌───────────────────────┐
│ memory_facts           │
│ memory_entities        │
│ memory_relations       │
│ memory_evidence        │
│ memory_embeddings      │
│ memory_history         │
└───────────────────────┘

↓

Vector Retrieval

↓

Child Agent

↓

개인화 응답


동시에:

Parent Agent

↓

LLM Wiki Retrieval

↓

부모 질문 답변


---

# 4. 구현 단계

## Phase 1. LLM Wiki DB Schema 설계

현재 child_memory는 유지한다.

추가 테이블 설계:

## memory_facts

목적:
아이에 대한 의미 있는 사실 저장

예:

- 아이가 좋아하는 활동
- 친구 관계
- 학교 사건
- 감정 변화
- 반복 패턴


필드 예:

id
child_id
fact_type
subject
content
confidence
importance
status
created_at
updated_at


---

## memory_entities

목적:

사람/장소/사물 Entity 관리


예:

민지
축구
학교


필드:

id
child_id
entity_type
entity_name
metadata


---

## memory_relations

목적:

Entity 관계 저장


예:

서아
→ 친구
→ 민지


필드:

id
child_id
source_entity_id
relation_type
target_entity_id


---

## memory_evidence

목적:

기억 근거 추적


필드:

id
memory_fact_id
conversation_id
message_id
source_text
created_at


중요:

모든 Memory는 반드시 근거 데이터를 가져야 한다.

---

## memory_embeddings

목적:

Vector Search


필드:

id
memory_fact_id
child_id
embedding
model
created_at


---

## memory_history

목적:

기억 변경 이력


필드:

id
memory_id
action
before_value
after_value
created_at


---

# 5. pgvector 추가

Supabase PostgreSQL에 pgvector 활성화.

Migration 작성:

예:

CREATE EXTENSION IF NOT EXISTS vector;


Embedding dimension은 사용하는 모델 기준으로 결정.

임의 결정하지 말고 현재 사용 가능한 Google Embedding 모델 확인 후 선택.

---

# 6. Memory Extraction Agent 구현

현재:

corrected_daily_conversations

↓

child_memory


변경:

corrected_daily_conversations

↓

Memory Extraction Agent

↓

Fact 추출

↓

Entity 추출

↓

Relation 생성

↓

Evidence 연결

↓

Embedding 생성

↓

LLM Wiki 저장


---

# 7. Memory Extraction 규칙

모든 대화를 Memory로 저장하지 않는다.


저장 대상:

YES:

- 반복되는 관심사
- 중요한 사건
- 친구 관계 변화
- 감정 패턴
- 장기 선호
- 아이 성향


NO:

- 단순 인사
- 하루 일회성 표현
- 의미 없는 잡담


각 Memory에는:

confidence

importance

status

필수.

---

# 8. Vector Retrieval 구현

현재:

child_memory
ORDER BY date DESC LIMIT 15


방식 제거하지 말고 fallback으로 유지.


추가:

사용자 발화

↓

Embedding 생성

↓

pgvector similarity search

↓

Top K Memory 검색

↓

Prompt Injection


검색 조건:

반드시:

child_id

조건 포함.


절대:

다른 아이 Memory 조회 금지.


---

# 9. Child Agent Memory Injection


현재:

이름
학년

정적 주입.


변경:

System Prompt:

아이 프로필

+

관련 Memory

+

최근 Conversation Context


형태.


예:

사용자:

"오늘 학교 가기 싫어"


검색 Memory:

- 지난 월요일에도 비슷한 표현
- 친구 관계 문제 경험
- 운동 후 기분 개선


Prompt:

"이 아이는 과거 월요일 아침 학교 관련 스트레스를 표현한 적이 있습니다."


---

# 10. Parent Agent 준비


이번 단계에서는 완전한 UI 개발보다 Backend 구조 준비.


필요 API:

GET /api/parent/memory/query


입력:

child_id

question


처리:

Parent Question

↓

Memory Retrieval

↓

Gemini Answer


응답:

- 답변
- 근거 Memory
- 신뢰도


---

# 11. 기존 parent_questions 연계


현재:

부모 질문

↓

아이 질문


유지.


추가:

아이 답변

↓

Memory Extraction

↓

LLM Wiki 업데이트


Loop 완성.


최종:

부모

↓

케이

↓

아이

↓

케이 기억 업데이트

↓

부모 Insight


---

# 12. 구현 전 반드시 작성할 문서

코드 작성 전에 아래 문서 작성.


docs/

k-bestie-llm-wiki-design.md


내용:

- 전체 Architecture Diagram
- DB Schema
- Data Flow
- Memory Lifecycle
- Retrieval Flow
- Prompt Injection 방식
- 비용 고려사항
- 개인정보 보호 고려사항


---

# 13. 테스트 요구사항


반드시 테스트.


Scenario 1:

아이:

"나는 축구가 좋아"


확인:

memory_fact 생성

entity 생성

embedding 생성


---

Scenario 2:

3개월 후:

아이:

"요즘 뭐 할까?"


확인:

축구 기억 검색

응답 반영


---

Scenario 3:

부모:

"우리 아이 요즘 관심사가 뭐야?"


확인:

Parent Retrieval 동작


---

Scenario 4:

아이 A Memory와 아이 B Memory 격리


확인:

cross child leakage 없음.


---

# 14. 개발 순서

반드시 아래 순서.


Step 1.
LLM Wiki 설계 문서 작성


Step 2.
DB Migration 작성


Step 3.
Memory Extraction Pipeline 구현


Step 4.
Embedding Pipeline 구현


Step 5.
Vector Retrieval API 구현


Step 6.
Child Agent Memory Injection 연결


Step 7.
Parent Agent Backend 준비


Step 8.
통합 테스트


---

# 15. 완료 기준


아래 조건 만족해야 완료.


PASS:

- 아이별 Memory 저장 가능
- Memory 근거 추적 가능
- Embedding 생성 가능
- Vector Search 가능
- 관련 기억 Prompt 주입 가능
- 부모 질문에 Memory 기반 답변 가능
- 다른 아이 데이터 접근 불가
- 기존 리포트 Pipeline 정상


---

# 16. 작업 방식

중요:

한 번에 모든 코드를 수정하지 않는다.

각 단계마다:

1. 현재 구조 확인
2. 변경 계획 작성
3. 영향도 분석
4. Migration 작성
5. 코드 구현
6. 테스트
7. 결과 보고

순서로 진행한다.


기존 기능을 깨뜨리는 Shortcut 구현 금지.
