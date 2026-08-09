// 주간 배치 Edge Function — 매주 토요일 06:00 KST pg_cron 호출
//   Step 3: 직전 완료 주간(토요일~금요일) 요약 생성
//   크론이 토요일로 고정 호출하므로 forceWeekly=true 로 실행(요일 경계 흔들림 방지).
//   순서: 같은 토요일 04:00 일일 배치(daily-batch) 이후 06:00 에 실행 — 일일→주간 순서 유지.
//
// 배포:  supabase functions deploy weekly-batch
// 시크릿: daily-batch 와 동일 (BATCH_SECRET, GEMMA_API_KEY)

import {
  serviceClient,
  generateWeeklySummary,
  kstToday,
  checkAuth,
} from "../_shared/batch.ts";

Deno.serve(async (req: Request) => {
  const unauthorized = checkAuth(req);
  if (unauthorized) return unauthorized;

  let body: { date?: string; forceWeekly?: boolean } = {};
  try { body = await req.json(); } catch { /* body 없으면 기본값 */ }

  const targetDate = body.date ?? kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return new Response(JSON.stringify({ error: "date must be YYYY-MM-DD" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const forceWeekly = body.forceWeekly ?? true;

  const start = Date.now();
  try {
    const db = serviceClient();
    const step3 = await generateWeeklySummary(db, targetDate, forceWeekly);
    return new Response(
      JSON.stringify({
        ok: true,
        result: { date: targetDate, step3_weekly: step3, durationMs: Date.now() - start },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[weekly-batch] 실패:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
