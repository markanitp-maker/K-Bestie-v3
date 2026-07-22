import { serviceClient, generateMemorySummaries, kstToday, checkAuth } from "../_shared/batch.ts";

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
    return new Response(
      JSON.stringify({ ok: true, result: { date: targetDate, ...result, durationMs: Date.now() - start } }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[memory-batch] 실패:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
