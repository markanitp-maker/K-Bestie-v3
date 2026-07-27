-- 023 LLM Wiki + RAG Memory Layer — Step 2 (설계 문서: docs/k-bestie-llm-wiki-design.md).
-- 기존 child_memory 파이프라인은 그대로 유지, 이 스키마는 그 위에 병렬로 얹는 확장이다.
-- 근거 보존 정책(2026-07-27 대표님 확정): 원문(memory_evidence.source_text 등)은
-- 최대 7일만 임시 보존 후 반드시 NULL 처리, 영구 보존은 memory_facts의 구조화
-- 메타데이터 + memory_evidence.evidence_summary(원문 인용 아닌 LLM 생성 요약)만.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── memory_entities ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person','place','object','activity','other')),
  entity_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_entities_child_name
  ON memory_entities(child_id, entity_type, entity_name);

-- ── memory_facts ─────────────────────────────────────────────────────────
-- fact_type 7종(2026-07-27 확정): 요청서 원안 5종 + trait/pattern.
-- status에 candidate(trait/pattern 승격 대기)/stale/invalidated 추가(active를 무기한
-- 확정하지 않는다는 대표님 지시 반영).
CREATE TABLE IF NOT EXISTS memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('interest','friend','family','dream','event','trait','pattern')),
  subject TEXT,
  content TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  importance NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('candidate','active','stale','superseded','invalidated','rejected')),
  source_type TEXT NOT NULL CHECK (source_type IN ('mission','free_chat')),
  source_date DATE NOT NULL,
  session_type TEXT,
  source_count INT NOT NULL DEFAULT 1,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_facts_child_id ON memory_facts(child_id);
CREATE INDEX IF NOT EXISTS idx_memory_facts_child_status ON memory_facts(child_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_facts_last_confirmed ON memory_facts(last_confirmed_at) WHERE status = 'active';

-- ── memory_relations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  target_entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  derived_from_fact_id UUID REFERENCES memory_facts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_relations_child_id ON memory_relations(child_id);

-- ── memory_evidence ──────────────────────────────────────────────────────
-- evidence_summary: 영구 보존(원문 인용 금지, LLM 생성 최소 요약만).
-- source_text/source_message_id/source_conversation_id: 임시 보존(생성 후 최대 7일,
-- 기존 raw_daily_conversations/chat_messages 파기 리듬과 동일) — 이후 반드시 NULL.
CREATE TABLE IF NOT EXISTS memory_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_fact_id UUID NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  evidence_summary TEXT NOT NULL,
  source_text TEXT,
  source_message_id UUID,
  source_conversation_id UUID,
  source_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_evidence_fact_id ON memory_evidence(memory_fact_id);
CREATE INDEX IF NOT EXISTS idx_memory_evidence_pending_purge ON memory_evidence(created_at)
  WHERE source_deleted_at IS NULL AND source_text IS NOT NULL;

-- ── memory_embeddings ────────────────────────────────────────────────────
-- embedding은 반드시 memory_facts.content(추출 요약)를 임베딩한 것 — 절대 원문
-- (memory_evidence.source_text)을 임베딩하지 않는다(원본 삭제 후 역복원 경로 차단).
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_fact_id UUID NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  embedding VECTOR(768) NOT NULL,
  model TEXT NOT NULL DEFAULT 'gemini-embedding-001',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_child_id ON memory_embeddings(child_id);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_hnsw ON memory_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- ── memory_history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','reinforced','promoted','stale','superseded','invalidated','rejected')),
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_history_memory_id ON memory_history(memory_id);

-- ── RLS + GRANT (child_memory와 동일 패턴 — 서비스 롤만 행 접근) ──────────
ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memory_entities_service_all" ON memory_entities;
CREATE POLICY "memory_entities_service_all" ON memory_entities
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "memory_facts_service_all" ON memory_facts;
CREATE POLICY "memory_facts_service_all" ON memory_facts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "memory_relations_service_all" ON memory_relations;
CREATE POLICY "memory_relations_service_all" ON memory_relations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "memory_evidence_service_all" ON memory_evidence;
CREATE POLICY "memory_evidence_service_all" ON memory_evidence
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "memory_embeddings_service_all" ON memory_embeddings;
CREATE POLICY "memory_embeddings_service_all" ON memory_embeddings
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "memory_history_service_all" ON memory_history;
CREATE POLICY "memory_history_service_all" ON memory_history
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON memory_entities TO anon, authenticated;
GRANT ALL ON memory_facts TO anon, authenticated;
GRANT ALL ON memory_relations TO anon, authenticated;
GRANT ALL ON memory_evidence TO anon, authenticated;
GRANT ALL ON memory_embeddings TO anon, authenticated;
GRANT ALL ON memory_history TO anon, authenticated;
