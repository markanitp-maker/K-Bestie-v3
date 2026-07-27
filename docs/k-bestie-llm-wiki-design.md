# K-Bestie LLM Wiki + RAG Memory Architecture 설계 문서

작성일: 2026-07-27
근거 요청서: `requests/023-add-llm-wiki-rag.md`

> 이 문서는 요청서 §12(구현 전 필수 작성 문서) + §16(단계별 진행) 요구사항에 따라
> **설계 단계까지만** 다룬다. 이 문서 작성 시점에는 마이그레이션·코드를 아직 작성하지
> 않았다(§14 Step 1만 완료). Step 2(DB Migration) 이후는 이 문서 승인 후 별도로 진행한다.

---

## 0. 현재 구조 확인 (Step 1-a)

구현 전에 실제 코드를 직접 읽어 확인한 현재 상태다(추측 없음).

### 0-1. 현재 파이프라인 (그대로 유지 대상)

```
아이-케이 대화 (chat_messages, chat_sessions)
  ↓ 18:00 / 23:59:59 KST 배치 (Edge Function)
raw_daily_conversations
  ↓ Gemini Context Correction (018 파이프라인)
corrected_daily_conversations
  ↓ generateDailyReports (supabase/functions/_shared/batch.ts)
daily_reports (부모 대시보드 8개 항목)

병렬:
chat_messages (그날 세션 전체, ended_at IS NOT NULL)
  ↓ generateMemorySummaries (같은 배치 파일)
child_memory (short_term/long_term, 텍스트만)
```

### 0-2. `child_memory`의 실제 생성 로직 (`generateMemorySummaries`, `_shared/batch.ts:656-776`)

- 그날 종료된 세션들의 `chat_messages` 원문 전체를 하나의 LLM(Vertex, 그룹A 모델) 호출에
  통째로 넣고, `{ daily_summary, long_term_facts: [{category, content}] }` JSON을 받는다.
- **매일 그 아이의 그날치 행을 전부 DELETE한 뒤 새로 INSERT한다**(729행) — 중복/병합 로직
  없음. 같은 사실이 매일 반복 언급되면 매번 새 행이 쌓인다(예: "축구를 좋아한다"가 30일
  연속 언급되면 30개의 거의 동일한 `long_term_facts` 행이 생김).
- `category`는 5종 고정(`interest/friend/family/dream/event`), 근거(evidence)는
  `source_session_ids UUID[]`뿐 — 어떤 문장/메시지에서 나온 건지는 추적 불가.
- Entity(사람/장소/사물)나 Relation(누가 누구와 어떤 관계) 개념이 전혀 없다 — 전부
  자유형 텍스트 `content` 한 줄.

### 0-3. 현재 검색/주입 로직 (Vector 없음, 전부 recency 기반 전체 텍스트 주입)

| 호출부 | 조회 방식 | 용도 |
|---|---|---|
| `lib/mission/memoryGreeting.ts` | long_term 최근 10 + short_term(미만료) 최근 5, 전체 텍스트를 LLM에 그대로 넣고 "쓸지 말지" 판단시킴 | 미션 시작 인사말 개인화 |
| `lib/freechat/memoryRecallResponder.ts` | long_term 최근 30 + short_term(미만료) 최근 10 | "케이 기억나?" 명시적 질문 응답(freechat 유일한 LLM 예외) |
| `_shared/batch.ts` (`generateDailyReports` 내부) | long_term 최근 15 + short_term(그날 제외) 전체 | 일일 리포트 생성 컨텍스트 |

세 곳 모두 **"의미적으로 관련 있는 기억"이 아니라 "최근 것"**을 가져와 LLM에 전부 던지고
LLM이 알아서 관련성을 판단하게 한다. 대화 내용과 무관하게 매번 같은 최근 N개가 뽑힌다.

### 0-4. 인프라 확인 결과

- **pgvector**: Dev(`mkrsaaedxqrcrktapaus`) 기준 `vector` 확장 버전 0.8.2 **사용 가능,
  아직 미설치**(`installed_version: null`, 직접 조회 확인). Prod는 미조회(Step 2에서
  마이그레이션 시 함께 확인).
- **임베딩 모델**: 임의 결정하지 않고 웹 검색으로 2026-07 기준 최신 상태 확인(요청서 §5
  지시대로) — **`gemini-embedding-001`**(GA, Gemini API/Vertex AI 양쪽 제공)을 채택한다.
  - 100개 이상 언어 지원(한국어 포함), MTEB Multilingual 리더보드 상위.
  - 기본 출력 3072차원, Matryoshka Representation Learning(MRL)으로 1536/768차원으로
    안전하게 축소 가능(품질 손실 미미, 문헌상 확인).
  - 가격: $0.15/1M 입력 토큰(Vertex AI 기준, 배치는 $0.12). 입력 2,048 토큰 제한.
  - 후속 모델 `gemini-embedding-2-preview`(멀티모달)는 **preview 상태**라 제외 —
    이 프로젝트의 기존 정책(그룹A 리포트 호출도 `provider !== "vertex"`면 예외를 던지는
    fail-closed 방침, `_shared/batch.ts:156-162`)과 동일한 이유로 GA 모델만 쓴다.
  - **차원 결정: 768차원**(MRL 축소) 채택 — pgvector HNSW 인덱스가 2026년 기준 권장
    방식이고, 이 아이 수·기억 규모(초기 수백~수천 아이 × 아이당 수십~수백 fact)에서
    3072차원은 저장/속도상 과함. 768차원으로도 검색 정확도 손실이 크지 않다는 문헌
    근거를 확인했다.

### 0-5. 이 설계가 지켜야 하는 절대 제약(요청서 §2, 그대로 인용)

기존 유지 대상 — 삭제/변경 금지: `chat_messages`, `chat_sessions`,
`raw_daily_conversations`, `corrected_daily_conversations`, `daily_reports`,
`child_memory`, `parent_questions`, 기존 미션, 자유대화, Gemini Live, STT/TTS Pipeline.

이 설계는 **`child_memory` 위에 병렬로 얹는 확장**이며, 기존 3개 호출부(0-3 표)의 recency
기반 조회는 코드에서 제거하지 않고 **fallback으로 그대로 둔다**(요청서 §8 명시).

---

## 1. 전체 Architecture Diagram

```
                          아이 ↔ 케이 대화
                                │
                          chat_messages (기존, 불변)
                                │
                      ┌─────────┴─────────┐
                      │                   │
              (기존, 불변)          (기존, 불변)
              Daily Collection      generateMemorySummaries
                      │             (기존 child_memory 파이프라인,
              raw_daily_conversations  그대로 유지)
                      │                   │
              Gemini Context Correction  child_memory
                      │              (short_term/long_term)
              corrected_daily_conversations
                      │
              ┌───────┴────────┐
              │                │
      generateDailyReports   ★Memory Extraction Agent(신규)
      (기존, 불변)                 │
              │           ┌───────┼────────┬─────────┐
        daily_reports   Fact 추출  Entity 추출  Relation 생성
                          │        │           │
                          └────────┴─────┬─────┘
                                   Evidence 연결(필수)
                                          │
                                   Embedding 생성
                                   (gemini-embedding-001, 768d)
                                          │
                              ┌───────────┴────────────┐
                              │      LLM Wiki 저장       │
                              │ memory_facts            │
                              │ memory_entities          │
                              │ memory_relations         │
                              │ memory_evidence          │
                              │ memory_embeddings        │
                              │ memory_history           │
                              └───────────┬─────────────┘
                                          │
                        ┌─────────────────┼─────────────────┐
                        │                                   │
                Child Agent 경로                      Parent Agent 경로
        (미션 인사말·자유대화 recall·일일리포트)      (GET /api/parent/memory/query)
                        │                                   │
              사용자 발화/트리거 임베딩                부모 질문 임베딩
                        │                                   │
              pgvector similarity search              pgvector similarity search
              (WHERE child_id = :cid 필수)             (WHERE child_id = :cid 필수)
                        │                                   │
                  Top-K memory_facts                  Top-K memory_facts
                        │                                   │
        ┌───────────────┴───────────────┐                  │
        │                               │                   │
  Vector 결과 있음                 Vector 결과 없음/실패      │
        │                          (기존 recency 조회로       │
  Prompt Injection                  fallback, 요청서 §8)     │
        │                               │                   │
        └───────────────┬───────────────┘                   │
                  System Prompt                        Gemini Answer
              (아이 프로필+관련 Memory                    + 근거 Memory
               +최근 Conversation Context)                + 신뢰도
                        │                                   │
                  개인화 응답                            부모 Insight
```

핵심 설계 원칙:
1. 기존 파이프라인(왼쪽 열)은 **한 줄도 수정하지 않는다** — 새 파이프라인(오른쪽)은 항상
   `corrected_daily_conversations`를 소스로 병렬로 얹힌다.
2. Vector 검색은 **항상 fallback을 가진다** — pgvector 실패/미설정/결과 0건이면 기존
   recency 기반 `child_memory` 조회로 자동 강등(이미 있는 코드 경로, 손대지 않음).
3. 모든 신규 테이블은 `child_id` 스코프 RLS(서비스 롤 전용, `child_memory`와 동일 정책)로
   잠근다 — 클라이언트가 직접 조회하는 화면은 이번 범위에 없다.

---

## 2. DB Schema (Step 2에서 실제 마이그레이션 파일로 작성 예정, 여기서는 설계만)

요청서 §4가 제시한 6개 테이블에 근거 추적·이력·격리에 필요한 최소 컬럼을 보강한다.
(요청서가 제시한 필드는 그대로 유지, 추가분은 `+`로 표시)

### 2-1. `memory_entities`

```sql
CREATE TABLE memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person','place','object','activity','other')),
  entity_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- + 같은 아이 안에서 같은 이름의 엔티티가 중복 생성되지 않도록.
CREATE UNIQUE INDEX uq_memory_entities_child_name ON memory_entities(child_id, entity_type, entity_name);
```

Relation을 먼저 정의하면 FK 순서상 entities가 선행해야 하므로 여기서 먼저 다룬다.

### 2-2. `memory_facts`

> 2026-07-27 대표님 확정 정책 반영 — 원문이 삭제된 뒤에도 fact는 살아남아야 하므로,
> 아래 구조화 메타데이터(§8-2 참고)는 전부 이 테이블에 **영구 보존**한다. 원문 텍스트는
> 여기 없다(`memory_evidence.source_text`에만, 임시).

```sql
CREATE TABLE memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('interest','friend','family','dream','event','trait','pattern')), -- = "category"
  subject TEXT,                    -- 이 사실이 누구/무엇에 대한 것인지(자유 텍스트, entity와는 별개)
  content TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  -- 대표님 지시: active를 무기한 확정하지 않는다 — 장기간 미확인/상충 시 전환 가능해야 함.
  -- candidate: trait/pattern 전용 — 근거 기준(§4 참고) 미달 시 active로 바로 승격하지
  -- 않고 여기 머문다(검색 대상 아님, §5 쿼리는 status='active'만 봄).
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('candidate','active','stale','superseded','invalidated','rejected')),
  -- 이 사실이 최초 관찰된 맥락(원문 삭제 후에도 영구 보존).
  source_type TEXT NOT NULL CHECK (source_type IN ('mission','free_chat')),
  source_date DATE NOT NULL,       -- 최초 관찰된 business_date
  session_type TEXT,               -- 'mission' | 'free' (chat_sessions.session_type와 동일 값)
  -- 재확인(reinforcement) 추적 — 같은 사실이 반복 관찰되면 새 행을 만들지 않고 여기를 갱신.
  source_count INT NOT NULL DEFAULT 1,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 추출에 사용된 모델/프롬프트 버전(원문 없이도 "무엇이 이 결론을 냈는지" 재현/디버깅 가능하게).
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_facts_child_id ON memory_facts(child_id);
CREATE INDEX idx_memory_facts_child_status ON memory_facts(child_id, status);
-- stale 전환 배치가 스캔할 대상(오래 미확인된 active fact)을 빠르게 찾기 위한 인덱스.
CREATE INDEX idx_memory_facts_last_confirmed ON memory_facts(last_confirmed_at) WHERE status = 'active';
```

### 2-3. `memory_relations`

```sql
CREATE TABLE memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,     -- 예: '친구', '가족', '좋아함'
  target_entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  -- + 어느 fact에서 이 관계가 도출됐는지(선택, 관계 자체도 evidence 추적 가능하게).
  derived_from_fact_id UUID REFERENCES memory_facts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_relations_child_id ON memory_relations(child_id);
```

### 2-4. `memory_evidence` (요청서 §7 "모든 Memory는 반드시 근거를 가져야 한다" — NOT NULL FK로 강제)

> 2026-07-27 대표님 확정 정책 — **혼합 정책**(원문 임시 보존 + 원문과 무관한 요약 영구
> 보존)으로 설계한다. 상세 근거·삭제 절차는 §8-2 "Memory Evidence Lifecycle" 참고.

```sql
CREATE TABLE memory_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_fact_id UUID NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  -- ── 영구 보존(원문 인용이 아닌, LLM이 생성한 최소화된 구조화 근거 요약) ──
  evidence_summary TEXT NOT NULL, -- 예: "미션 대화 중 축구를 좋아한다고 언급" — 원문 발췌 금지
  -- ── 임시 보존(생성 후 최대 7일, raw_daily_conversations/corrected_daily_conversations/
  --    chat_messages와 동일한 파기 리듬 — report_generated_at 기준 + 7일) ──
  source_text TEXT,                -- NULL 허용 — 7일 후 반드시 NULL(20자 요약 등으로 축약해
                                    -- 영구 보존하는 것도 금지, 대표님 명시 지시)
  source_message_id UUID,          -- chat_messages.id — 원본 삭제 시 명시적으로 NULL 처리
  source_conversation_id UUID,     -- raw_daily_conversations.id — 원본 삭제 시 명시적으로 NULL 처리
  source_deleted_at TIMESTAMPTZ,   -- 원문(source_text/message_id/conversation_id)이 실제로
                                    -- NULL 처리된 시각(파기 배치가 기록) — NULL이면 아직 보존 중
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_evidence_fact_id ON memory_evidence(memory_fact_id);
-- 파기 배치가 "아직 원문이 남아있는데 7일 지난 행"을 빠르게 찾기 위한 인덱스.
CREATE INDEX idx_memory_evidence_pending_purge ON memory_evidence(created_at)
  WHERE source_deleted_at IS NULL AND source_text IS NOT NULL;
```

**의도적으로 하지 않는 것(대표님 명시 금지)**: `source_text`를 축약(20자 등)해서
영구 보존하는 것, `source_message_id`/`source_conversation_id`가 가리키던 원본이
삭제된 뒤에도 그 내용을 재구성할 수 있는 해시나 임베딩을 별도로 남기는 것 — 둘 다
하지 않는다. `memory_embeddings`(§2-5)의 벡터는 **`memory_facts.content`(사실 요약,
원문 아님)를 임베딩한 것**이며, `memory_evidence.source_text`를 임베딩하지 않는다
— 원문 자체가 벡터로 남아 우회 복원되는 경로를 원천적으로 막는다.

### 2-5. `memory_embeddings`

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_fact_id UUID NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  embedding VECTOR(768) NOT NULL,  -- gemini-embedding-001, MRL 768차원
  model TEXT NOT NULL DEFAULT 'gemini-embedding-001',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_embeddings_child_id ON memory_embeddings(child_id);
-- HNSW — 2026년 기준 pgvector 권장 인덱스(수백만 벡터까지 p99 <10ms).
CREATE INDEX idx_memory_embeddings_hnsw ON memory_embeddings
  USING hnsw (embedding vector_cosine_ops);
```

### 2-6. `memory_history`

```sql
CREATE TABLE memory_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,         -- memory_facts.id (다형 참조라 FK 미설정, 코드에서 검증)
  action TEXT NOT NULL CHECK (action IN ('created','reinforced','promoted','stale','superseded','invalidated','rejected')),
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_history_memory_id ON memory_history(memory_id);
```

### 2-7. RLS/GRANT (6개 테이블 공통, `child_memory` 기존 정책과 동일 패턴)

```sql
ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_history ENABLE ROW LEVEL SECURITY;

-- 6개 테이블 각각에 동일 패턴 반복(서비스 롤만 행 접근, 하드룰 §5 체크리스트 GRANT는 별도):
CREATE POLICY "memory_facts_service_all" ON memory_facts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
-- ... (나머지 5개 동일 패턴, Step 2 실제 마이그레이션에서 전부 작성)

GRANT ALL ON memory_entities, memory_facts, memory_relations, memory_evidence,
  memory_embeddings, memory_history TO anon, authenticated;
```

---

## 3. Data Flow

```
1. corrected_daily_conversations에 그날 보정 대화가 쌓임(기존, 불변)
2. Memory Extraction Agent가 그날치 report_eligible=true 대화만 읽음
   (daily_reports가 쓰는 것과 동일한 조건 — 민감/무의미 대화는 애초에 제외됨),
   session_type(mission/free)·business_date를 함께 확보
3. LLM 1회 호출(모델/프롬프트 버전 기록)로 Fact/Entity/Relation 후보를 함께 추출(JSON)
4. 각 Fact 후보에 대해:
   a. memory_facts.content(추출된 사실 텍스트, 원문 아님)를 임베딩(gemini-embedding-001)
   b. 같은 child_id 안에서 벡터 유사도 top-1 기존 active fact 검색
   c. 유사도가 임계치(예: 0.92, §9 튜닝 대상) 이상이면 "동일 사실 재확인"으로 판단
      → 기존 fact.source_count += 1, last_confirmed_at=now(), confidence 소폭 상향,
        memory_history에 action='reinforced' 기록(새 행 생성하지 않음 — §4 참고)
   d. 임계치 미달이면 새 fact 생성(source_type/source_date/session_type/
      first_observed_at/last_confirmed_at/source_count=1/model_version/prompt_version
      전부 채움) + entity/relation/evidence/embedding 행 생성,
      memory_history에 action='created' 기록
   e. **trait/pattern 전용 게이트(2026-07-27 대표님 확정)**: `fact_type IN
      ('trait','pattern')`인 신규 fact는 (d)에서 곧바로 `active`로 만들지 않는다.
      아래 조건 중 하나를 만족해야 `active`, 아니면 `status='candidate'`로 저장한다.
      - 서로 다른 날짜·서로 다른 대화(대화 세션)에서 나온 **독립적인 evidence가
        누적 2건 이상**(같은 대화 안에서 반복 언급은 1건으로 침), 또는
      - 단 1건이라도 아이의 **명시적 자기진술**이고 추출 모델이 높은 confidence(예:
        ≥0.85, §9 튜닝 대상)로 판단한 경우.
      단일 발화·일회성 사건만으로는 절대 trait/pattern을 만들지 않는다(요청서 §1
      "반복 패턴"이라는 정의 자체와 일치). `interest/friend/family/dream/event`
      5종은 이 게이트를 적용하지 않는다(기존 요청서 원안 그대로, 1건 관찰로도
      `active` 가능).
      candidate 상태에서 두 번째 독립 evidence가 확보되면(다음날 배치 실행 시 §4c와
      같은 벡터 매칭으로 같은 fact를 다시 찾음) `active`로 승격하고
      memory_history에 action='promoted' 기록.
5. 모든 fact는 최소 1개의 memory_evidence를 가져야 저장을 완료로 본다(evidence_summary는
   NOT NULL이라 반드시 채움, source_text는 이 시점엔 원문 발췌를 그대로 채움 — 임시 보존
   시작). evidence 없이 fact만 insert되는 경로는 코드에서 금지(트랜잭션 단위 처리).
6. (신규, 매일 배치) **원문 파기 배치** — 기존 raw_daily_conversations/
   corrected_daily_conversations 파기(§0-2 표, `report_generated_at`+7일 기준)와 같은
   실행에서, 그 시각 기준 7일이 지난 memory_evidence 행을 찾아
   source_text=NULL, source_message_id=NULL, source_conversation_id=NULL,
   source_deleted_at=now()로 갱신한다. evidence_summary/memory_facts는 손대지 않는다.
7. (신규, 주 1회 배치) **stale 전환 배치** — `last_confirmed_at`이 오래(예: 90일, §9
   튜닝 대상) 지난 `active` fact를 `stale`로 전환. 상충하는 새 fact가 감지되면(§4)
   즉시 `invalidated`/`superseded`로 전환(재확인 대기 없이).
```

---

## 4. Memory Lifecycle

```
created(신규, source_count=1)
   → [fact_type IN ('trait','pattern') AND 근거 기준 미달] → candidate(검색 대상 아님,
        §3-4e 참고) → [독립 evidence 2건째 확보] → active로 승격(action='promoted')
   → [그 외(5종 기존 타입) 또는 근거 기준 충족] → active(사용 중, 검색 대상)
        ↺ 재확인될 때마다 source_count+=1, last_confirmed_at=now() (같은 행, 새 행 아님)
   → stale(오래(예 90일) 재확인 안 됨 — 대표님 지시: active를 무기한 확정하지 않는다.
     검색에서는 제외되지만 완전히 버리지는 않음 — 다시 관찰되면 active로 복귀 가능)
   → superseded(더 최신 사실이 이전 사실을 대체 — 예: "이사 가서 전 학교 친구와 연락
     끊김"이 "민지와 친함"을 대체하면 이전 행 status=superseded, 새 행 생성 후
     relation으로 연결 가능)
   → invalidated(상충하는 새 사실이 감지됨 — superseded와 달리 "새 사실로 대체"가
     아니라 "이전 사실 자체가 틀렸다"로 판단된 경우. 예: "형이 있다"→"외동이라고 확인"처럼
     교체가 아닌 정정)
   → rejected(추출 시점에 이미 오류/저품질로 판단 — 검색 대상에서 제외, 삭제하지 않고
     보존해 history 추적 가능하게 유지)
```

`status != 'active'`인 fact는 벡터 검색 쿼리에서 `WHERE status = 'active'`로 항상
제외한다(Retrieval 쿼리에 고정 조건으로 포함, §5 참고).

**dedup 정책이 필요한 이유**: 현재 `generateMemorySummaries`처럼 매일 델리트+인서트하면
"축구를 좋아한다"가 30일 쌓여 30개 fact가 된다. 새 파이프라인은 위 §3 3-4단계로 반복
사실을 하나의 fact로 합치고 `source_count`/`confidence`/`last_confirmed_at`만 올린다
— 이게 이 설계의 핵심 차별점이다.

---

## 5. Retrieval Flow

```sql
-- 예시(개념 쿼리, 실제 구현 시 Supabase RPC로 감쌈):
SELECT f.id, f.content, f.fact_type, f.confidence, f.importance,
       1 - (e.embedding <=> :query_embedding) AS similarity
FROM memory_embeddings e
JOIN memory_facts f ON f.id = e.memory_fact_id
WHERE e.child_id = :child_id       -- 절대 조건 — 다른 아이 조회 금지(요청서 §8)
  AND f.status = 'active'
ORDER BY e.embedding <=> :query_embedding
LIMIT :top_k;
```

- `child_id` 필터는 **쿼리 자체에 하드코딩**하며, 호출부 인자로만 결정된다(다른 아이
  child_id를 넘겨받을 수 있는 경로 자체를 API 레벨에서 검증 — `requireChildAccess`
  기존 가드 재사용).
- top_k는 5(child agent, 짧은 인사말/응답용) / 10(parent agent, 더 풍부한 답변용)으로
  용도별 다르게 설정.
- **Fallback(요청서 §8 "방식 제거하지 말고 fallback으로 유지")**: pgvector 쿼리가
  0건이거나 예외를 던지면(임베딩 API 실패, DB 오류 등) 기존 `child_memory` recency
  조회(0-3 표의 3개 호출부 원본 로직)를 그대로 호출한다 — 코드 삭제 없이 순서만
  "벡터 우선 → 실패 시 recency" 로 감싼다.

---

## 6. Prompt Injection 방식

요청서 §9 예시 그대로:

```
System Prompt = 아이 프로필(이름/학년, 기존 유지)
              + 관련 Memory(위 Retrieval 결과, 최대 top_k개, "[신뢰도 0.8] 축구를
                좋아함(2026-07-10 최초 확인, 3회 재확인)" 형태로 근거 메타데이터 포함)
              + 최근 Conversation Context(기존 유지)
```

기존 3개 호출부(`memoryGreeting.ts`/`memoryRecallResponder.ts`/`_shared/batch.ts`
generateDailyReports)는 "memoryContext 문자열을 어떻게 만드는지"만 교체 대상이고,
그 문자열을 프롬프트에 넣는 자리·후속 로직(할루시네이션 금지 규칙, 40자/60자 제한 등)은
그대로 유지한다.

---

## 7. 비용 고려사항

| 항목 | 빈도 | 단가 | 비고 |
|---|---|---|---|
| Fact 추출 LLM 호출 | 아이당 1일 1회(기존 generateMemorySummaries와 같은 배치 시점에 병행) | 기존 그룹A 모델 단가와 동일(추가 호출 아님, 같은 배치 파이프라인에 통합) | 기존 대비 **추가 LLM 호출 비용 없음** — 같은 응답 스키마를 확장 |
| Fact당 임베딩 생성 | 아이당 1일 평균 신규 fact 0~5개 추정(재확인은 재임베딩 불필요 — 기존 임베딩 재사용) | $0.15/1M 토큰(Vertex, gemini-embedding-001), fact 1건당 수십 토큰 | 아이 1,000명 기준 월 추정 3만~15만 토큰 — 무시할 수준 |
| 발화당 검색 임베딩 | 미션/자유대화 턴마다 1회(child agent), 부모 질문마다 1회(parent agent) | 동일 단가 | 이게 실제 비용의 대부분 — 미션 10턴×아이1,000명×일1회 = 1만 회/일 규모, 발화 평균 20토큰 → 하루 20만 토큰 ≈ $0.03/일. **무시 가능한 수준으로 확인.** |

**결론**: 이 설계의 GCP 비용 증가분은 기존 STT/TTS/Gemini 대화 비용 대비 무시할 만한
수준(§ 위 표 기준 월 수 달러 이내로 추정)이다. 실제 정확한 수치는 Step 3(Extraction
Pipeline 구현) 이후 `usage_events`에 새 kind(`embedding`)를 추가해 실측 기반으로
재확인한다 — 이 문서의 추정치를 확정값으로 쓰지 않는다.

---

## 8. 개인정보 보호 고려사항

1. **격리**: 모든 신규 테이블 RLS는 서비스 롤 전용(§2-7) — `child_memory`와 동일 수준.
   벡터 검색 쿼리는 반드시 `child_id` 조건을 포함하며, 다른 아이 데이터 조회 경로 자체가
   코드상 존재하지 않는다(요청서 §8 절대 조건).
2. **Memory Evidence Lifecycle과 보존·삭제 정책 (2026-07-27 대표님 확정, 혼합 정책)**:
   `chat_messages`/`raw_daily_conversations`/`corrected_daily_conversations`는 기존
   정책상 `report_generated_at` 기준 7일 후 삭제된다(이미 구현됨). `memory_evidence`도
   이 리듬에 정확히 맞춘다 — **원문(`source_text`/`source_message_id`/
   `source_conversation_id`)은 생성 후 최대 7일만 임시 보존하고, 그 뒤 반드시 NULL로
   마스킹한다.** 20자 등으로 축약해 영구 보존하는 것도 금지(원문 재구성 우회 경로가
   되기 때문) — 삭제는 삭제다, 축약본으로 대체하지 않는다.
   - **영구 보존은 원문이 아니라 `evidence_summary`(LLM이 생성한 최소화된 구조화 요약,
     원문 인용 금지)와 `memory_facts`의 구조화 메타데이터
     (`fact_type`/`confidence`/`importance`/`source_type`/`source_date`/`session_type`/
     `first_observed_at`/`last_confirmed_at`/`source_count`/`model_version`/
     `prompt_version`)만이다.** 이 필드들은 원문이 아니므로 삭제 대상이 아니다.
   - **역복원 경로 차단**: 원본이 삭제된 뒤에도 그 내용을 재구성할 수 있는 해시·임베딩을
     별도로 남기지 않는다 — 이 때문에 `memory_embeddings.embedding`은 반드시
     `memory_facts.content`(추출된 사실 요약)를 임베딩한 것이어야 하고, 절대
     `memory_evidence.source_text`(원문)를 임베딩해서는 안 된다(§2-4 재확인).
   - **fact 자체의 생존**: fact는 원문(evidence) 삭제 후에도 그대로 유지된다. 이후 같은
     사실이 다시 관찰되면 `source_count`/`last_confirmed_at`/`confidence`를 갱신한다
     (§3-4c, §4). `active` 상태를 무기한 확정하지 않고, 장기간 미확인·상충 시
     `stale`/`superseded`/`invalidated`로 전환한다(§4 Lifecycle).
   - **파기 배치**: 위 §3 Step 6에서 매일 실행, 기존 파기 배치와 같은 트리거에 병행.
3. **부모 조회 API(`GET /api/parent/memory/query`)**: 기존 절대 규칙("부모 원문 열람
   불가, RLS")과 정합성 확인 필요 — 이 API는 fact의 **요약/답변**만 반환하고 원문
   `source_text`는 API 응답에 포함하지 않는다(내부 근거 추적용으로만 DB에 존재, 부모
   화면에는 노출 안 함).
4. **민감 정보 금지 규칙 유지**: 기존 `generateMemorySummaries` 프롬프트의 "주소/전화번호
   등 민감 정보는 절대 담지 마라" 규칙을 새 Extraction Agent 프롬프트에도 동일하게
   포함한다.

---

## 9. 대표님 확인이 필요한 미결 사항 (임의 결정하지 않음)

1. ~~§8-2 `memory_evidence.source_text` 보존 정책~~ — **2026-07-27 확정(혼합 정책,
   §2-4/§8-2 반영 완료).**
2. 재확인(reinforcement) 유사도 임계치(위 예시 0.92), stale 전환 기준(위 예시 90일),
   trait/pattern 자기진술 confidence 임계치(위 예시 0.85), **검색(retrieval) 최소
   유사도 `search_memory_facts`의 `min_similarity=0.3`(codex 리뷰 지적 — 실측·평가
   근거 없는 임의값)** 은 전부 초안 값 — 실제 데이터로 튜닝 필요(Step 3~5 구현 중
   재검토 대상으로 남김, 지금 확정하지 않음).
3. ~~`memory_facts.fact_type` 범위~~ — **2026-07-27 확정: 7종
   (`interest/friend/family/dream/event/trait/pattern`) 전부 적용.** trait/pattern은
   candidate 게이트(§3-4e, §4)를 통과해야 `active`로 승격된다.
4. **Step 3 codex 리뷰에서 발견, 이번 라운드에서 의도적으로 미해결(잔여 리스크)**:
   - **트랜잭션 원자성 없음**: fact/evidence/embedding/history/entity/relation 저장이
     하나의 DB 트랜잭션이 아니다 — 중간에 실패하면 evidence 없는 fact, embedding 없는
     fact가 남을 수 있다(§3 Step 5 "evidence 없이 fact 저장 금지" 원칙과 완전히
     일치하지 않음). `generateDailyReports`/`generateMemorySummaries`(기존 코드)도
     같은 방식이라 이 파이프라인만의 새 문제는 아니지만, 근본 해결은 아니다.
   - **동시 실행 경쟁 상태**: 벡터 조회→갱신이 read-modify-write라 같은 아이·같은
     시각에 두 실행이 겹치면 증가분이 유실되거나 중복 fact가 생길 수 있다. 지금은
     daily-batch/memory-batch가 pg_cron 1일 1회 호출 구조라 정상 운영 중 동시실행
     경로가 없음 — 리스크는 낮지만 0은 아니다(수동 중복 트리거 시 발생 가능).
   - **세션 단위 출처 분리 미흡**: 하루에 여러 세션(미션+자유대화 등)이 있으면 하나의
     transcript로 합쳐 추출하고, 첫 세션의 session_type만 모든 fact에 적용한다 —
     세션별로 독립 추출하지 않아 출처 메타데이터가 부정확할 수 있다.
   - 위 3건은 다음 라운드(Step 4 이후 안정화 작업)에서 재검토 대상으로 남긴다 —
     2026-07-27 codex 리뷰가 이 3건을 [복잡]으로 분류했고, 대표님께도 이렇게
     보고했다.

---

## 10. 다음 단계

이 문서 승인 후 요청서 §14 순서대로 진행:

- Step 2: DB Migration 작성(§2 스키마 그대로, `supabase/migrations/`에 신규 파일,
  Dev 먼저 적용 후 검증 — Production은 대표님 별도 승인 전까지 미적용).
- Step 3: Memory Extraction Agent 구현(§3 Data Flow, 기존 `generateMemorySummaries`와
  같은 배치 트리거에 병행 호출로 추가).
- Step 4~8: 요청서 §14 그대로.

각 Step은 한 번에 다 만들지 않고(요청서 §16), Step마다 "현재 구조 확인 →
변경 계획 → 영향도 분석 → Migration → 코드 → 테스트 → 결과 보고" 순서를 반복한다.
