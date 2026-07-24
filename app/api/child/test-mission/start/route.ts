import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveTestChild } from "@/lib/child/testAccount";

export const runtime = "nodejs";

// POST /api/child/test-mission/start
// 테스트 계정(is_test_account) A~E 미션 시작. 고정 10개 질문(test_mission_fixed_questions)을 사용하고,
// 진행률·유효답변·완료·황금열쇠는 기존 공통 오케스트레이터(/api/mission/answer, record_v2_mission_answer RPC)를
// 그대로 재사용한다(복제 없음). 이 엔드포인트는 세션/진행행 생성 + 고정 질문 주입만 담당한다.
// - 활성 override(test_mode_overrides)에서 conversation_mode(A~E)를 읽어 함께 반환(usage_events 태깅용).
// - demo_mode=true 로 세션을 표시해 정식 리포트 집계에서 제외.
// - 일반 계정/부모/미인증/override 없음 → 403/400. tier는 절대 변경하지 않는다.
export async function POST(req: Request) {
  // forceNew=true('새 테스트 시작'/'다시 테스트'): 활성 세션을 종료(이력·usage 보존)하고 새 mission_session_id로 처음부터.
  let forceNew = false;
  try { const body = await req.json(); forceNew = body?.forceNew === true; } catch { /* 본문 없음 = 이어하기 */ }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const test = await resolveTestChild(svc, user.id);
  if (!test) return NextResponse.json({ error: "Forbidden: 테스트 계정이 아닙니다" }, { status: 403 });
  const childId = test.childId;

  // 1. 활성 override(선택한 A~E 모드) 확인 — 없으면 먼저 모드를 선택해야 한다.
  const { data: override } = await svc
    .from("test_mode_overrides")
    .select("conversation_mode")
    .eq("child_id", childId)
    .maybeSingle();
  if (!override?.conversation_mode) {
    return NextResponse.json({ error: "먼저 대화 방식(A~E)을 선택하세요" }, { status: 400 });
  }
  const mode = override.conversation_mode as string;

  // 2. 고정 10개 질문 로드(순서 보장)
  const { data: fixedRows, error: fixedErr } = await svc
    .from("test_mission_fixed_questions")
    .select("order_index, question_id")
    .order("order_index", { ascending: true });
  if (fixedErr || !fixedRows || fixedRows.length !== 10) {
    return NextResponse.json({ error: "고정 질문 세트가 준비되지 않았습니다" }, { status: 500 });
  }
  const questionIds = fixedRows.map((r) => r.question_id as string);

  const { data: questions } = await svc
    .from("mission_questions")
    .select("id, question_text, dashboard_area_tag")
    .in("id", questionIds);
  const ordered = questionIds.map((qid) => (questions ?? []).find((q) => q.id === qid)).filter(Boolean);

  // 3. forceNew('새 테스트 시작'): 활성 테스트 세션을 모두 종료(이력·usage 보존) 후 새 세션으로 진행.
  if (forceNew) {
    const { error: closeErr } = await svc.from("chat_sessions").update({ ended_at: new Date().toISOString() })
      .eq("child_id", childId).eq("session_type", "mission").eq("demo_mode", true).eq("test_mode", mode).is("ended_at", null);
    if (closeErr) return NextResponse.json({ error: "이전 세션 종료 실패: " + closeErr.message }, { status: 500 });
  }

  // 4. 이어하기: 활성(ended_at NULL) 테스트 미션 세션 재사용(재입장 복원).
  //    단 '완료(COMPLETED)된 세션은 활성 복원 대상에서 제외' — 종료 표시(이력 보존) 후 새 세션을 만들어
  //    완료 화면을 잘못 이어받아 새 테스트를 못 하는 문제를 방지한다. forceNew면 위에서 이미 종료됨.
  let activeRow: { id: string; mission_progress: unknown } | null = null;
  if (!forceNew) {
    const { data } = await svc
      .from("chat_sessions")
      .select("id, mission_progress!inner(valid_answer_count, question_ids, question_states, status, required_valid_count)")
      .eq("child_id", childId)
      .eq("session_type", "mission")
      .eq("demo_mode", true)
      .eq("test_mode", mode)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeRow = (data as { id: string; mission_progress: unknown } | null) ?? null;
  }

  const activeProgress = activeRow
    ? (Array.isArray(activeRow.mission_progress) ? activeRow.mission_progress[0] : activeRow.mission_progress) as
        { valid_answer_count?: number; status?: string; required_valid_count?: number; question_ids?: string[]; question_states?: Record<string, string> } | null
    : null;
  const activeCompleted = activeProgress
    ? (activeProgress.status === "COMPLETED" || (activeProgress.valid_answer_count ?? 0) >= 10)
    : false;

  if (activeRow && activeCompleted) {
    // 완료 세션 종료 표시(이력·usage 보존) → 아래에서 새 세션 생성. 실패 시 중단(잘못된 활성 세션 잔존 방지).
    const { error: closeErr } = await svc.from("chat_sessions").update({ ended_at: new Date().toISOString() }).eq("id", activeRow.id);
    if (closeErr) return NextResponse.json({ error: "완료 세션 종료 실패: " + closeErr.message }, { status: 500 });
  }

  if (activeRow && !activeCompleted && activeProgress) {
    const validCount = activeProgress.valid_answer_count ?? 0;
    return NextResponse.json({
      resumed: true,
      sessionId: activeRow.id,
      mode,
      engine_version: "v2",
      requiredCount: activeProgress.required_valid_count ?? 10,
      validAnswerCount: validCount,
      progressPercent: validCount * 10,
      completed: false,
      questionIds: activeProgress.question_ids ?? questionIds,
      questions: ordered,
      questionStates: activeProgress.question_states ?? {},
    });
  }

  // 4. 신규 세션 생성 (demo_mode=true — 정식 리포트 제외)
  const { data: session, error: sessErr } = await svc
    .from("chat_sessions")
    .insert({ child_id: childId, session_type: "mission", demo_mode: true, test_mode: mode })
    .select("id")
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: sessErr?.message ?? "세션 생성 실패" }, { status: 500 });
  }
  await svc.from("chat_sessions").update({ mission_id: session.id }).eq("id", session.id);

  const questionStates: Record<string, string> = {};
  for (const qid of questionIds) questionStates[qid] = "pending";

  // KST business_date (NOT NULL)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const businessDate = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;

  const { error: progErr } = await svc.from("mission_progress").insert({
    session_id: session.id,
    child_id: childId,
    business_date: businessDate,
    valid_answer_count: 0,
    question_ids: questionIds,
    question_states: questionStates,
    round_type: "common",
    required_valid_count: 10,
    engine_version: "v2",
    status: "IN_PROGRESS",
  });
  if (progErr) {
    await svc.from("chat_sessions").delete().eq("id", session.id);
    return NextResponse.json({ error: progErr.message }, { status: 500 });
  }

  // 공통 오케스트레이터(mission/answer V2)가 기대하는 출제이력 PRIMARY 행 생성 — mission/start V2와 동일 구조.
  const historyRows = questionIds.map((qid, idx) => ({
    child_id: childId,
    question_id: qid,
    question_role: "PRIMARY",
    selected_order: idx + 1,
    session_id: session.id,
  }));
  const { error: histErr } = await svc.from("mission_question_history").insert(historyRows);
  if (histErr) {
    await svc.from("mission_progress").delete().eq("session_id", session.id);
    await svc.from("chat_sessions").delete().eq("id", session.id);
    return NextResponse.json({ error: histErr.message }, { status: 500 });
  }

  return NextResponse.json({
    resumed: false,
    sessionId: session.id,
    mode,
    engine_version: "v2",
    requiredCount: 10,
    validAnswerCount: 0,
    progressPercent: 0,
    completed: false,
    questionIds,
    questions: ordered,
    questionStates,
  });
}
