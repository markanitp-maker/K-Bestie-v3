import { serviceClient, generateMemorySummaries, generateMemoryFacts, kstToday, checkAuth } from "../_shared/batch.ts";

Deno.serve(async (req: Request) => {
  const unauthorized = checkAuth(req);
  if (unauthorized) return unauthorized;

  let body: { date?: string; childId?: string } = {};
  try { body = await req.json(); } catch { /* 본문 없으면 기본값 */ }

  const targetDate = body.date ?? kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return new Response(JSON.stringify({ error: "date must be YYYY-MM-DD" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const childId = body.childId ?? undefined;
  if (childId !== undefined && childId !== null) {
    if (typeof childId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(childId)) {
      return new Response(JSON.stringify({ error: "childId must be valid UUID" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
  }

  const start = Date.now();
  try {
    const db = serviceClient();
    const result = await generateMemorySummaries(db, targetDate, childId);

    let memoryFacts: any = { skipped: true };
    try {
      memoryFacts = await generateMemoryFacts(db, targetDate, childId);
    } catch (e) {
      console.error("[memory-batch] generateMemoryFacts 실패:", e);
      memoryFacts = { error: String(e), errors: childId ? [{ childId, error: String(e) }] : [] };
    }

    // Check if fact-generation failed for the target child
    if (childId) {
      const summaryErr = (result.errors || []).find((e: any) => e.childId === childId);
      if (summaryErr) {
        return new Response(JSON.stringify({ error: `Memory summary failed: ${summaryErr.error}`, ok: false }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }

      const factErr = (memoryFacts?.errors || []).find((e: any) => e.childId === childId);
      if (factErr || memoryFacts?.error) {
        const errMsg = factErr ? factErr.error : String(memoryFacts.error);
        return new Response(JSON.stringify({ error: `Memory facts failed: ${errMsg}`, ok: false }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result: { date: targetDate, childId: childId ?? null, ...result, memoryFacts, durationMs: Date.now() - start },
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
