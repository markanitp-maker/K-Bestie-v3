import { after, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveChildForUser } from "@/lib/child/testAccount";
import { getSupabaseTarget } from "@/lib/supabase/env";
import { normalizeSubmissionCategory } from "@/lib/admin/customerRequests";
import {
  MAX_PAYLOAD_BYTES,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_CURRENT_ROUTE_LENGTH,
  MAX_APP_SURFACE_LENGTH,
  MAX_APP_VERSION_LENGTH,
  isValidEmail,
  getClientIp,
  checkGuestRateLimit,
  normalizeOptionalString,
  generateRequestNumber,
} from "@/lib/support/landingInquiry";
import { notifyDiscordOfNewSupportRequest } from "@/lib/support/discord";
import { resolveNotificationScope } from "@/lib/notifications/scope";

export const runtime = "nodejs";

const SUPPORT_LIST_FIELDS = "id,request_number,category,subject,body,status,created_at,updated_at,user_response,responded_at,submitter_role";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveNotificationScope(user.id);

  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20, 1), 50);
  const from = (page - 1) * pageSize;
  const service = createServiceClient();
  const { data, error, count } = await service
    .from("support_requests")
    .select(SUPPORT_LIST_FIELDS, { count: "exact" })
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) {
    console.error("[api/support] own request list failed", { code: error.code ?? "unknown" });
    return NextResponse.json({ error: "Request lookup failed" }, { status: 500 });
  }
  return NextResponse.json({
    requests: (data ?? []).map((item) => ({
      ...item,
      effective_role: scope?.role ?? (item.submitter_role === "child" ? "child" : "parent"),
    })),
    pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
  });
}

// 위젯은 첨부 업로드(app/api/support/attachments)와 문의 제출에 같은 idempotency
// 값을 upload_session_id/idempotency_key로 같이 보낸다. 제출 시점에 그 세션으로
// 올라온 첨부들을 이번에 생성/확인된 support_requests 행에 연결해야, 관리자 쪽의
// feedback_request_id 기준 조인에 첨부가 나타난다.
async function linkAttachments(
  serviceClient: ReturnType<typeof createServiceClient>,
  uploadSessionId: string,
  userId: string,
  supportRequestId: string
) {
  const { error } = await serviceClient
    .from("feedback_request_attachments")
    .update({ feedback_request_id: supportRequestId })
    .eq("upload_session_id", uploadSessionId)
    .eq("user_id", userId)
    .is("feedback_request_id", null)
    .neq("upload_status", "deleted");

  if (error) {
    console.error("[api/support] attachment link error:", error.message || error.code || "unknown");
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    const declaredBytes = contentLength ? Number.parseInt(contentLength, 10) : 0;
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, "utf8") > MAX_PAYLOAD_BYTES) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
      }
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const {
      category: submittedCategory,
      subject,
      content,
      current_route,
      device_info,
      app_surface,
      app_version,
      idempotency_key,
      contact_email,
    } = body;

    const idempotencyKey = normalizeOptionalString(idempotency_key, MAX_IDEMPOTENCY_KEY_LENGTH);
    const serviceClient = createServiceClient();

    // 1) 랜딩 문의 경로 (app_surface === "landing")
    // 로그인 쿠키 보유 여부와 무관하게 app_surface=landing 요청은 랜딩 전용 NULL-identity 익명 경로로 처리한다.
    if (app_surface === "landing") {
      // contact_email 필수 및 보수적 형식·길이 검증
      if (!isValidEmail(contact_email)) {
        return NextResponse.json({ error: "Invalid contact email" }, { status: 400 });
      }
      const trimmedEmail = (contact_email as string).trim();

      // content 검증 (2~2000자 trim)
      const finalContent = typeof content === "string" ? content.trim() : "";
      if (finalContent.length < 2 || finalContent.length > 2000) {
        return NextResponse.json({ error: "Content length invalid" }, { status: 400 });
      }

      // Idempotency 확인: landing/null-user/contact_email 조건을 결합하여 타 접수번호 유출 방지
      if (idempotencyKey) {
        const { data: existingByKey } = await serviceClient
          .from("support_requests")
          .select("id, request_number")
          .eq("idempotency_key", idempotencyKey)
          .eq("app_surface", "landing")
          .is("user_id", null)
          .eq("contact_email", trimmedEmail)
          .maybeSingle();
        if (existingByKey?.request_number) {
          return NextResponse.json({ ok: true, request_number: existingByKey.request_number });
        }
      }

      // IP Rate Limit 검증 (unknown IP도 동일 키로 보호)
      const clientIp = getClientIp(request);
      if (!checkGuestRateLimit(clientIp)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }

      const request_number = generateRequestNumber();
      const environment = getSupabaseTarget();

      // 클라이언트가 보낸 식별자 무시, 모두 null 및 지정값으로 저장
      const insertPayload = {
        user_id: null,
        child_id: null,
        guardian_id: null,
        submitter_role: "guest",
        category: "inquiry",
        subject: "문의하기",
        body: finalContent,
        contact_email: trimmedEmail,
        app_surface: "landing",
        status: "open",
        request_number,
        environment,
        current_route: normalizeOptionalString(current_route, MAX_CURRENT_ROUTE_LENGTH),
        app_version: normalizeOptionalString(app_version, MAX_APP_VERSION_LENGTH),
        device_info: typeof device_info === "object" && device_info !== null ? device_info : null,
        idempotency_key: idempotencyKey,
      };

      const { data: inserted, error: insertErr } = await serviceClient
        .from("support_requests")
        .insert(insertPayload)
        .select("id,created_at")
        .single();

      if (insertErr) {
        if (insertErr.code === "23505" && insertPayload.idempotency_key) {
          const { data: existing } = await serviceClient
            .from("support_requests")
            .select("id, request_number")
            .eq("idempotency_key", insertPayload.idempotency_key)
            .eq("app_surface", "landing")
            .is("user_id", null)
            .eq("contact_email", trimmedEmail)
            .maybeSingle();
          if (existing?.request_number) {
            return NextResponse.json({ ok: true, request_number: existing.request_number });
          }
        }
        console.error("[api/support] insert error:", insertErr.code || "unknown");
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      if (inserted?.id) {
        after(() => notifyDiscordOfNewSupportRequest({
            category: "inquiry",
            requestNumber: request_number,
            requestId: inserted.id,
            appSurface: "landing",
            createdAt: inserted.created_at ?? new Date().toISOString(),
          }, new URL(request.url).origin)
        );
      }

      return NextResponse.json({ ok: true, request_number });
    }

    // 2) 로그인 (Authenticated) 경로 — 기존 부모/아이 계약 보존
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const category = normalizeSubmissionCategory(submittedCategory);
    if (!category) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const isInquiry = category === "inquiry";
    const finalSubject = isInquiry ? "문의하기" : (typeof subject === "string" ? subject : "").trim();
    const finalContent = (typeof content === "string" ? content : "").trim();

    if (finalSubject.length < 2 || finalSubject.length > 100) {
      return NextResponse.json({ error: "Subject length invalid" }, { status: 400 });
    }

    if (finalContent.length < 2 || finalContent.length > 2000) {
      return NextResponse.json({ error: "Content length invalid" }, { status: 400 });
    }

    // codex 지적: 이 검사가 idempotency_key 확인보다 먼저 실행되면, 이미 성공한 제출을
    // 네트워크 문제로 재시도하는 정상 케이스가 (원래 접수번호를 돌려받는 대신) 429로
    // 막혀버린다 - 진짜 idempotent 응답이 아니게 된다. 그래서 같은 idempotency_key의
    // 기존 접수가 있는지부터 먼저 확인하고, 있으면 그 접수번호를 그대로 반환하고 끝낸다
    // (이 요청은 "새 제출 시도"가 아니라 "이미 처리된 시도의 재확인"이므로 rate limit
    // 대상이 아니다). 새 시도(다른/없는 키)에 대해서만 이후 10초 rate limit을 적용한다.
    // Idempotency 확인: user_id 소유권으로 제한하여 타 사용자 접수번호 유출 방지
    if (idempotencyKey) {
      const { data: existingByKey } = await serviceClient
        .from("support_requests")
        .select("id, request_number")
        .eq("idempotency_key", idempotencyKey)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existingByKey?.request_number) {
        await linkAttachments(serviceClient, idempotencyKey, user.id, existingByKey.id);
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
      app_surface: normalizeOptionalString(app_surface, MAX_APP_SURFACE_LENGTH),
      current_route: normalizeOptionalString(current_route, MAX_CURRENT_ROUTE_LENGTH),
      app_version: normalizeOptionalString(app_version, MAX_APP_VERSION_LENGTH),
      environment,
      device_info: typeof device_info === "object" && device_info !== null ? device_info : null,
      idempotency_key: idempotencyKey,
      status: "open",
    };

    const { data: inserted, error: insertErr } = await serviceClient
      .from("support_requests")
      .insert(insertPayload)
      .select("id,created_at")
      .single();

    if (insertErr) {
      // 23505 = unique_violation. idempotency_key 유니크 제약에 걸린 경우 (user_id 소유권 일치 시만 반환)
      if (insertErr.code === "23505" && insertPayload.idempotency_key) {
        const { data: existing } = await serviceClient
          .from("support_requests")
          .select("id, request_number")
          .eq("idempotency_key", insertPayload.idempotency_key)
          .eq("user_id", user.id)
          .maybeSingle();
        if (existing?.request_number) {
          await linkAttachments(serviceClient, insertPayload.idempotency_key, user.id, existing.id);
          return NextResponse.json({ ok: true, request_number: existing.request_number });
        }
      }
      console.error("[api/support] insert error:", insertErr.code || "unknown");
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (idempotencyKey && inserted?.id) {
      await linkAttachments(serviceClient, idempotencyKey, user.id, inserted.id);
    }

    if (inserted?.id) {
      after(() => notifyDiscordOfNewSupportRequest({
          category,
          requestNumber: request_number,
          requestId: inserted.id,
          appSurface: insertPayload.app_surface,
          createdAt: inserted.created_at ?? new Date().toISOString(),
        }, new URL(request.url).origin)
      );
    }

    return NextResponse.json({ ok: true, request_number });
  } catch (error) {
    console.error("[api/support] unhandled error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
