// 일일 배치 Edge Function — 매일 04:00 KST pg_cron 호출
//   Step 1: 자유 대화 세션 마감  →  Step 2: 일일 리포트 생성(감정판정/8카드 포함)
//   (주간 요약은 별도 weekly-batch 함수가 토요일 06:00 KST에 실행 — 순서: 일일(04시) → 주간(06시))
//
// 배포:  supabase functions deploy daily-batch
// 시크릿: supabase secrets set BATCH_SECRET=... GEMMA_API_KEY=...
//         (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 자동 주입)

import {
  serviceClient,
  closeFreeSessions,
  generateDailyReports,
  kstToday,
  checkAuth,
  deleteExpiredChatMessages,
  deleteExpiredConversationPipelineData,
  purgeExpiredMemoryEvidence,
} from "../_shared/batch.ts";

Deno.serve(async (req: Request) => {
  const unauthorized = checkAuth(req);
  if (unauthorized) return unauthorized;

  let body: { date?: string } = {};
  try { body = await req.json(); } catch { /* body 없으면 기본값 */ }

  const targetDate = body.date ?? kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return new Response(JSON.stringify({ error: "date must be YYYY-MM-DD" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const start = Date.now();
  try {
    const db = serviceClient();
    // 순서 보장: (1) 세션 마감 → (2) 일일 리포트
    const step1 = await closeFreeSessions(db, targetDate);
    const step2 = await generateDailyReports(db, targetDate);
    
    // Step 3: 대화 내역(chat_messages) 7일 경과 자동 파기
    const isDeleteEnabled = Deno.env.get("CHAT_RETENTION_DELETE_ENABLED") === "true";
    const step3 = await deleteExpiredChatMessages(db, !isDeleteEnabled);

    // Step 4: requests/018 — raw_daily_conversations/corrected_daily_conversations 7일 경과 자동 파기
    // (리포트 생성 완료 + 7일 기준, 같은 CHAT_RETENTION_DELETE_ENABLED 플래그 재사용)
    const step4 = await deleteExpiredConversationPipelineData(db, !isDeleteEnabled);

    // Step 5(023, 신규): memory_evidence 원문(source_text 등) 7일 경과 자동 파기(§8-2).
    // 별도 try/catch — 이 신규 파이프라인 실패가 위 기존 4단계 성공 응답을 막지 않게 한다.
    let step5: unknown;
    try {
      step5 = await purgeExpiredMemoryEvidence(db, !isDeleteEnabled);
    } catch (e) {
      console.error("[daily-batch] purgeExpiredMemoryEvidence(023) 실패(기존 파이프라인과 무관, 계속 진행):", e);
      step5 = { error: String(e) };
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          date: targetDate,
          step1_close: step1,
          step2_reports: step2,
          step3_retentionDelete: step3,
          step4_conversationPipelineRetentionDelete: step4,
          step5_memoryEvidencePurge: step5,
          durationMs: Date.now() - start
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[daily-batch] 실패:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
