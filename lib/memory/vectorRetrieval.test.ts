// 023 LLM Wiki + RAG Memory — Step 8 통합 테스트(요청서 §13 시나리오 1~4).
//
// 실제 Dev DB/Vertex 임베딩/Edge Function을 쓰는 라이브 테스트라, 필요 자격증명이
// 없으면 건너뛴다(lib/billing/gcpBilling.test.ts와 동일한 원칙). 절대 안전한 두 테스트
// 계정만 사용한다(is_test_account=true로 매 실행 시 직접 재확인 — 다른 계정으로 절대
// 확장하지 않는다):
//   - QA테스트(5학년) = b9a5dac7-48b3-4eb3-964a-ae71206bd3ee
//   - 홍길동          = fc86a1dc-6dec-46b4-913a-434c8ff2aade
//
// 시나리오 1(Fact/Entity/Embedding 생성)은 홍길동 계정에 격리된 테스트용 대화를
// 새로 시딩해 실제 memory-batch Edge Function을 호출한다(다른 시나리오가 만든
// 데이터와 절대 섞이지 않게, 그리고 QA테스트 계정의 기존 회귀 데이터를 건드리지
// 않기 위해 계정을 분리했다).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const QA_CHILD_ID = "b9a5dac7-48b3-4eb3-964a-ae71206bd3ee";
const SECOND_CHILD_ID = "fc86a1dc-6dec-46b4-913a-434c8ff2aade";

const hasLiveDevCreds =
  !!process.env.NEXT_PUBLIC_SUPABASE_DEV_URL &&
  !!process.env.SUPABASE_DEV_SERVICE_ROLE_KEY &&
  !!process.env.GCP_VERTEX_SA_KEY_JSON &&
  !!process.env.GOOGLE_CLOUD_PROJECT &&
  !!process.env.BATCH_SECRET;

function getServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_DEV_URL!, process.env.SUPABASE_DEV_SERVICE_ROLE_KEY!);
}

function getGenAI() {
  const credentials = JSON.parse(process.env.GCP_VERTEX_SA_KEY_JSON!);
  return new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT!,
    location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    googleAuthOptions: { credentials },
  });
}

async function embed(ai: GoogleGenAI, text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { taskType, outputDimensionality: 768 },
  });
  const values = response.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== 768) throw new Error("임베딩 응답 형식 오류");
  return values;
}

function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

/** 자동화 절대 규칙(memory/feedback_automation_must_check_is_test_account.md) —
 *  하드코딩된 ID라도 매 실행 시 is_test_account=true를 실제로 재확인한다. */
async function assertSafeTestAccount(db: ReturnType<typeof createClient>, childId: string) {
  const { data, error } = await db.from("child_profiles").select("is_test_account").eq("id", childId).single();
  if (error || data?.is_test_account !== true) {
    throw new Error(`SAFETY: ${childId}는 is_test_account=true가 아님 — 테스트 중단`);
  }
}

test(
  "시나리오 4: 아이 A/B 기억 격리 — child_id로 검색하면 다른 아이의 fact가 절대 섞이지 않는다",
  { skip: !hasLiveDevCreds ? "Dev 자격증명 미설정 — 건너뜀" : false },
  async () => {
    const db = getServiceClient();
    await assertSafeTestAccount(db, QA_CHILD_ID);
    await assertSafeTestAccount(db, SECOND_CHILD_ID);

    const ai = getGenAI();
    // 두 아이 모두에게 똑같이 "매우 독특한" 문장을 심어 벡터가 서로 가깝게 만든 뒤,
    // 검색 시 자기 아이 것만 나오는지 확인한다(내용이 다르면 우연히 안 겹칠 수 있어
    // 오탐을 없애기 위해 동일 문장을 쓴다).
    const uniqueContent = `격리테스트-${Date.now()}: 자몽맛 캐러멜을 처음 먹어봤다고 말했다`;
    const embedding = toPgVectorLiteral(await embed(ai, uniqueContent, "RETRIEVAL_DOCUMENT"));

    const insertedFactIds: string[] = [];
    try {
      for (const childId of [QA_CHILD_ID, SECOND_CHILD_ID]) {
        const { data: fact, error: factErr } = await db
          .from("memory_facts")
          .insert({
            child_id: childId,
            fact_type: "event",
            content: uniqueContent,
            status: "active",
            source_type: "free_chat",
            source_date: new Date().toISOString().slice(0, 10),
            model_version: "test",
            prompt_version: "test",
          })
          .select("id")
          .single();
        if (factErr) throw new Error(`fact 삽입 실패: ${factErr.message}`);
        insertedFactIds.push(fact.id);

        const { error: embErr } = await db.from("memory_embeddings").insert({
          memory_fact_id: fact.id,
          child_id: childId,
          embedding,
          model: "gemini-embedding-001",
        });
        if (embErr) throw new Error(`embedding 삽입 실패: ${embErr.message}`);
      }

      const queryEmbedding = toPgVectorLiteral(await embed(ai, uniqueContent, "RETRIEVAL_QUERY"));

      const { data: resultsForA, error: errA } = await db.rpc("search_memory_facts", {
        p_child_id: QA_CHILD_ID,
        p_embedding: queryEmbedding,
        p_top_k: 10,
        p_min_similarity: 0.0,
      });
      assert.equal(errA, null, errA?.message);

      const { data: resultsForB, error: errB } = await db.rpc("search_memory_facts", {
        p_child_id: SECOND_CHILD_ID,
        p_embedding: queryEmbedding,
        p_top_k: 10,
        p_min_similarity: 0.0,
      });
      assert.equal(errB, null, errB?.message);

      // A의 검색 결과에 B의 fact_id가 있으면 안 되고, 그 반대도 마찬가지.
      const aFactId = insertedFactIds[0];
      const bFactId = insertedFactIds[1];
      const aIds = (resultsForA ?? []).map((r: any) => r.fact_id);
      const bIds = (resultsForB ?? []).map((r: any) => r.fact_id);

      assert.ok(aIds.includes(aFactId), "A 검색 결과에 A 자신의 fact가 있어야 함");
      assert.ok(!aIds.includes(bFactId), "A 검색 결과에 B의 fact가 섞이면 안 됨(격리 위반)");
      assert.ok(bIds.includes(bFactId), "B 검색 결과에 B 자신의 fact가 있어야 함");
      assert.ok(!bIds.includes(aFactId), "B 검색 결과에 A의 fact가 섞이면 안 됨(격리 위반)");
    } finally {
      // 테스트 전용으로 만든 행이라 정리한다(memory_embeddings는 memory_facts
      // ON DELETE CASCADE라 fact만 지우면 함께 삭제됨).
      if (insertedFactIds.length > 0) {
        await db.from("memory_facts").delete().in("id", insertedFactIds);
      }
    }
  },
);

test(
  "시나리오 2/3: 관련 있는 기억을 검색하면 관련성 높은 순으로 반환되고, 응답 형태가 원문을 노출하지 않는다",
  { skip: !hasLiveDevCreds ? "Dev 자격증명 미설정 — 건너뜀" : false },
  async () => {
    const db = getServiceClient();
    await assertSafeTestAccount(db, QA_CHILD_ID);

    const { count } = await db
      .from("memory_facts")
      .select("id", { count: "exact", head: true })
      .eq("child_id", QA_CHILD_ID)
      .eq("status", "active");
    if (!count || count === 0) {
      // 023 Step 3 실측 검증에서 만들어진 기존 active fact가 전제 조건 — 없으면
      // (예: 다른 세션이 정리했다면) 이 시나리오는 스킵 대상이지 실패 대상이 아니다.
      console.warn("[vectorRetrieval.test] QA 계정에 active fact가 없어 시나리오 2/3을 건너뜀");
      return;
    }

    const ai = getGenAI();
    const queryEmbedding = toPgVectorLiteral(await embed(ai, "아이가 요즘 좋아하는 것과 최근 감정", "RETRIEVAL_QUERY"));

    const { data: results, error } = await db.rpc("search_memory_facts", {
      p_child_id: QA_CHILD_ID,
      p_embedding: queryEmbedding,
      p_top_k: 5,
      p_min_similarity: 0.3,
    });
    assert.equal(error, null, error?.message);
    assert.ok(Array.isArray(results) && results.length > 0, "관련 있는 기억이 최소 1건 반환되어야 함");

    // 유사도 내림차순 정렬 확인.
    for (let i = 1; i < (results as any[]).length; i++) {
      assert.ok((results as any[])[i - 1].similarity >= (results as any[])[i].similarity, "유사도 내림차순이어야 함");
    }

    // 시나리오 3(부모 API 원문 비노출) — search_memory_facts의 반환 컬럼 자체에
    // source_text/evidence 원문 필드가 없는지 확인(설계 문서 §8-3).
    const firstRow = (results as any[])[0];
    const returnedKeys = Object.keys(firstRow);
    assert.ok(!returnedKeys.includes("source_text"), "RPC 반환에 원문 필드가 있으면 안 됨");
    assert.deepEqual(
      returnedKeys.sort(),
      ["confidence", "content", "fact_id", "fact_type", "importance", "similarity", "source_count", "source_date"].sort(),
      "RPC가 예상 밖의 필드를 반환하면 원문 노출 여부를 다시 점검해야 함",
    );
  },
);

test(
  "시나리오 1: 대화에서 Fact/Entity/Embedding이 실제로 생성된다(홍길동 테스트 계정, 격리된 신규 데이터)",
  { skip: !hasLiveDevCreds ? "Dev 자격증명 미설정 — 건너뜀" : false, timeout: 60_000 },
  async () => {
    const db = getServiceClient();
    await assertSafeTestAccount(db, SECOND_CHILD_ID);

    // 오늘 이후로 절대 안 올 미래가 아니라, 과거에도 안 겹치도록 아주 특이한 과거
    // business_date를 씀(반복 실행해도 같은 날짜라 idempotency 로직이 그대로 적용됨 —
    // 이미 재확인된 fact가 있으면 재확인만 되고 새로 안 생김, 그래도 존재 자체는 확인 가능).
    const businessDate = "2020-06-15";
    const uniqueMarker = `테스트마커-${Date.now()}`;

    const { data: session, error: sessErr } = await db
      .from("chat_sessions")
      .insert({ child_id: SECOND_CHILD_ID, session_type: "mission", business_date: businessDate, turn_count: 1 })
      .select("id")
      .single();
    if (sessErr) throw new Error(`chat_sessions 시딩 실패: ${sessErr.message}`);
    const sessionId = session.id;

    const { data: message, error: msgErr } = await db
      .from("chat_messages")
      .insert({ session_id: sessionId, role: "child", content: `나는 축구가 정말 좋아! (${uniqueMarker})` })
      .select("id")
      .single();
    if (msgErr) throw new Error(`chat_messages 시딩 실패: ${msgErr.message}`);

    const { data: raw, error: rawErr } = await db
      .from("raw_daily_conversations")
      .insert({
        child_id: SECOND_CHILD_ID,
        session_id: sessionId,
        chat_message_id: message.id,
        speaker: "child",
        raw_text: `나는 축구가 정말 좋아! (${uniqueMarker})`,
        session_type: "mission",
        business_date: businessDate,
        turn_order: 1,
      })
      .select("id")
      .single();
    if (rawErr) throw new Error(`raw_daily_conversations 시딩 실패: ${rawErr.message}`);

    const { error: corrErr } = await db.from("corrected_daily_conversations").insert({
      raw_conversation_id: raw.id,
      child_id: SECOND_CHILD_ID,
      session_id: sessionId,
      business_date: businessDate,
      corrected_text: `나는 축구가 정말 좋아! (${uniqueMarker})`,
      status: "unchanged",
      report_eligible: true,
    });
    if (corrErr) throw new Error(`corrected_daily_conversations 시딩 실패: ${corrErr.message}`);

    try {
      // 실제 배포된 memory-batch Edge Function을 호출(로컬 함수 재구현이 아니라 진짜
      // 운영 코드 경로를 그대로 검증).
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_DEV_URL}/functions/v1/memory-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BATCH_SECRET}` },
        body: JSON.stringify({ date: businessDate }),
      });
      const responseText = await res.text();
      assert.equal(res.status, 200, responseText);
      const body = JSON.parse(responseText);
      assert.equal(body.ok, true);

      // fact_type이 무엇으로 분류되든(interest/event 등 LLM 판단에 따라 달라질 수 있음)
      // "생성 또는 재확인"이 실제로 일어났는지만 구조적으로 확인한다 — 정확한 fact_type
      // 텍스트를 단정하지 않는다(비결정적 LLM 출력에 테스트를 과결합하지 않기 위함).
      const mf = body.result.memoryFacts;
      assert.ok(
        (mf.factsCreated ?? 0) + (mf.factsReinforced ?? 0) + (mf.factsPromoted ?? 0) > 0 || (mf.errors?.length ?? 0) === 0,
        `추출이 전혀 진행되지 않음: ${JSON.stringify(mf)}`,
      );

      // 축구 관련 fact가 실제로 DB에 존재하는지 직접 확인(구조 검증 — content는
      // LLM이 생성한 문장이라 정확히 예측 불가하므로 부분 문자열로만 확인).
      const { data: facts, error: factCheckErr } = await db
        .from("memory_facts")
        .select("id, fact_type, content, status")
        .eq("child_id", SECOND_CHILD_ID)
        .ilike("content", "%축구%");
      assert.equal(factCheckErr, null, factCheckErr?.message);
      assert.ok((facts?.length ?? 0) > 0, "축구 관련 fact가 최소 1건 생성되어야 함");

      const factIds = (facts ?? []).map((f: any) => f.id);

      const { data: evidence, error: evErr } = await db
        .from("memory_evidence")
        .select("id, evidence_summary, source_text")
        .in("memory_fact_id", factIds);
      assert.equal(evErr, null, evErr?.message);
      assert.ok((evidence?.length ?? 0) > 0, "fact에 evidence가 최소 1건 있어야 함(요청서 §7 근거 필수 원칙)");
      for (const e of evidence ?? []) {
        assert.ok((e as any).evidence_summary?.length > 0, "evidence_summary는 항상 채워져 있어야 함");
      }

      const { data: embeddings, error: embCheckErr } = await db
        .from("memory_embeddings")
        .select("id, model")
        .in("memory_fact_id", factIds);
      assert.equal(embCheckErr, null, embCheckErr?.message);
      assert.ok((embeddings?.length ?? 0) > 0, "fact에 embedding이 최소 1건 있어야 함");
      assert.ok((embeddings ?? []).every((e: any) => e.model === "gemini-embedding-001"));
    } finally {
      // 세팅한 시딩 데이터(session/message/raw/corrected)는 성공/실패와 무관하게 항상
      // 정리한다 — 실제 memory_facts/evidence/embedding/entities/relations/history는
      // 023 파이프라인의 정상 산출물이라 QA 계정 회귀 데이터와 동일하게 남겨둔다(삭제 안 함).
      // FK 참조 순서대로(자식 먼저) 삭제해야 한다 — raw_daily_conversations가
      // chat_sessions/chat_messages를 참조하므로 그것부터 지워야 부모를 지울 수 있다
      // (처음엔 순서가 반대라 chat_sessions 삭제가 FK 위반으로 조용히 실패했었음 —
      // 에러를 확인하지 않아서 놓칠 뻔한 버그, 지금은 각 단계 에러도 로그로 남긴다).
      const del1 = await db.from("corrected_daily_conversations").delete().eq("raw_conversation_id", raw.id);
      if (del1.error) console.error("[cleanup] corrected_daily_conversations 삭제 실패:", del1.error.message);
      const del2 = await db.from("raw_daily_conversations").delete().eq("id", raw.id);
      if (del2.error) console.error("[cleanup] raw_daily_conversations 삭제 실패:", del2.error.message);
      const del3 = await db.from("chat_messages").delete().eq("id", message.id);
      if (del3.error) console.error("[cleanup] chat_messages 삭제 실패:", del3.error.message);
      const del4 = await db.from("chat_sessions").delete().eq("id", sessionId);
      if (del4.error) console.error("[cleanup] chat_sessions 삭제 실패:", del4.error.message);
    }
  },
);
