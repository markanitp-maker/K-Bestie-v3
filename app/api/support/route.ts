import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { getSupabaseTarget } from "@/lib/supabase/env";

export const runtime = "nodejs";

function generateRequestNumber() {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REQ-${dateStr}-${randomStr}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { category, subject, content, current_route, device_info, app_surface, app_version, idempotency_key } = body;

    if (!["voc", "feature", "bug"].includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const isVoc = category === "voc";
    const finalSubject = isVoc ? "문의하기" : (subject || "").trim();
    const finalContent = (content || "").trim();

    if (finalSubject.length < 2 || finalSubject.length > 100) {
      return NextResponse.json({ error: "Subject length invalid" }, { status: 400 });
    }

    if (finalContent.length < 2 || finalContent.length > 2000) {
      return NextResponse.json({ error: "Content length invalid" }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const idempotencyKey = typeof idempotency_key === "string" && idempotency_key ? idempotency_key : null;

    // codex 지적: 이 검사가 idempotency_key 확인보다 먼저 실행되면, 이미 성공한 제출을
    // 네트워크 문제로 재시도하는 정상 케이스가 (원래 접수번호를 돌려받는 대신) 429로
    // 막혀버린다 - 진짜 idempotent 응답이 아니게 된다. 그래서 같은 idempotency_key의
    // 기존 접수가 있는지부터 먼저 확인하고, 있으면 그 접수번호를 그대로 반환하고 끝낸다
    // (이 요청은 "새 제출 시도"가 아니라 "이미 처리된 시도의 재확인"이므로 rate limit
    // 대상이 아니다). 새 시도(다른/없는 키)에 대해서만 이후 10초 rate limit을 적용한다.
    if (idempotencyKey) {
      const { data: existingByKey } = await serviceClient
        .from("support_requests")
        .select("request_number")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingByKey?.request_number) {
        return NextResponse.json({ ok: true, request_number: existingByKey.request_number });
      }
    }

    // Rate limit check: max 1 new submission per 10 seconds per user
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    const { count } = await serviceClient
      .from("support_requests")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", tenSecondsAgo);

    if (count && count > 0) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Determine user role and child/guardian ids
    let submitter_role = "parent";
    let guardian_id: string | null = user.id;
    let child_id: string | null = null;

    const { data: member } = await serviceClient
      .from("family_members")
      .select("id, role, family_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (member && member.role === "child") {
      submitter_role = "child";
      const childData = await resolveChildForUser(serviceClient, user.id);
      if (childData) {
        child_id = childData.childId;
      }
      
      // Find a guardian for this child (owner_parent or parent in the same family)
      const { data: guardians } = await serviceClient
        .from("family_members")
        .select("user_id")
        .eq("family_id", member.family_id)
        .in("role", ["owner_parent", "parent"])
        .limit(1);
      
      if (guardians && guardians.length > 0) {
        guardian_id = guardians[0].user_id;
      } else {
        guardian_id = null;
      }
    } else if (member && (member.role === "parent" || member.role === "owner_parent")) {
      submitter_role = "parent";
      guardian_id = user.id;
      // If a parent is submitting, they might not associate it with a specific child in this UX
      // (The prompt doesn't ask to select a child for feedback intake)
      child_id = null;
    }

    const request_number = generateRequestNumber();
    const environment = getSupabaseTarget();

    const insertPayload = {
      user_id: user.id,
      child_id: child_id,
      category,
      subject: finalSubject,
      body: finalContent,
      request_number,
      submitter_role,
      guardian_id,
      app_surface,
      current_route,
      app_version,
      environment,
      device_info,
      idempotency_key: idempotencyKey,
      status: "open"
    };

    const { error: insertErr } = await serviceClient
      .from("support_requests")
      .insert(insertPayload);

    if (insertErr) {
      // 23505 = unique_violation. idempotency_key 유니크 제약에 걸린 경우 - 연타나
      // 네트워크 재시도로 같은 시도가 두 번 도착한 것이므로, 새로 만들지 않고 이미
      // 저장된 원래 접수 건의 request_number를 그대로 돌려줘 클라이언트에는 정상
      // 성공으로 보이게 한다(진짜 idempotent 응답 - count-then-insert의 경합 없음).
      if (insertErr.code === "23505" && insertPayload.idempotency_key) {
        const { data: existing } = await serviceClient
          .from("support_requests")
          .select("request_number")
          .eq("idempotency_key", insertPayload.idempotency_key)
          .maybeSingle();
        if (existing?.request_number) {
          return NextResponse.json({ ok: true, request_number: existing.request_number });
        }
      }
      console.error("[api/support] insert error:", insertErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, request_number });

  } catch (error) {
    console.error("[api/support] unhandled error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
