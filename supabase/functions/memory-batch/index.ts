import { serviceClient, generateMemorySummaries, generateMemoryFacts, kstToday, checkAuth } from "../_shared/batch.ts";

Deno.serve(async (req: Request) => {
  const unauthorized = checkAuth(req);
  if (unauthorized) return unauthorized;

  let body: { date?: string } = {};
  try { body = await req.json(); } catch { /* 본문 없으면 기본값 */ }

  const targetDate = body.date ?? kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return new Response(JSON.stringify({ error: "date must be YYYY-MM-DD" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const start = Date.now();
  try {
    const db = serviceClient();
    const result = await generateMemorySummaries(db, targetDate);

    // 023 LLM Wiki(신규, Step 3) — 기존 child_memory 파이프라인과 완전히 병렬,
    // 별도 try/catch로 감싸 이 신규 파이프라인의 실패가 위 기존 결과(result)의
    // 성공 응답을 절대 막지 않게 한다.
    let memoryFacts: unknown = { skipped: true, reason: "not run due to error" };
    try {
      memoryFacts = await generateMemoryFacts(db, targetDate);
    } catch (e) {
      console.error("[memory-batch] generateMemoryFacts(023) 실패(기존 파이프라인과 무관, 계속 진행):", e);
      memoryFacts = { error: String(e) };
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result: { date: targetDate, ...result, memoryFacts, durationMs: Date.now() - start },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[memory-batch] 실패:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
