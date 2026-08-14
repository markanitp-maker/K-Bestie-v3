import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { CUSTOMER_REQUEST_CATEGORIES, CUSTOMER_REQUEST_STATUSES, isCustomerRequestCategory, isCustomerRequestStatus, kstDateRange } from "@/lib/admin/customerRequests";

export const runtime = "nodejs";

const PAGE_SIZES = new Set([25, 50, 100]);
const quoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const category = params.get("category");
  const status = params.get("status");
  const role = params.get("submitter_role") ?? params.get("role");
  const q = (params.get("q") ?? params.get("search") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const requestedSize = Number.parseInt(params.get("pageSize") ?? "25", 10);
  const pageSize = PAGE_SIZES.has(requestedSize) ? requestedSize : 25;
  const { from, toExclusive } = kstDateRange(params.get("startDate"), params.get("endDate"));

  if (category && !isCustomerRequestCategory(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  if (status && !isCustomerRequestStatus(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  if (role && !["parent", "child", "guest"].includes(role)) return NextResponse.json({ error: "Invalid submitter role" }, { status: 400 });

  const service = createServiceClient();
  let matchingChildIds: string[] = [];
  let matchingParentIds: string[] = [];

  if (q) {
    const pattern = `%${q}%`;
    const [childrenResult, parentsResult, accountsResult] = await Promise.all([
      service.from("child_profiles").select("id").ilike("name", pattern).limit(200),
      service.from("parents").select("id").or(`name.ilike.${quoted(pattern)},email.ilike.${quoted(pattern)}`).limit(200),
      service.from("member_accounts").select("id").or(`username.ilike.${quoted(pattern)},email.ilike.${quoted(pattern)},display_name.ilike.${quoted(pattern)}`).limit(200),
    ]);
    matchingChildIds = (childrenResult.data ?? []).map((row) => row.id);
    matchingParentIds = Array.from(new Set([...(parentsResult.data ?? []).map((row) => row.id), ...(accountsResult.data ?? []).map((row) => row.id)]));
  }

  let query = service
    .from("support_requests")
    .select("*, attachments:feedback_request_attachments(*)", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (status) query = query.eq("status", status);
  if (role) query = query.eq("submitter_role", role);
  if (from) query = query.gte("created_at", from);
  if (toExclusive) query = query.lt("created_at", toExclusive);
  if (q) {
    const pattern = quoted(`%${q}%`);
    const filters = [
      `request_number.ilike.${pattern}`,
      `subject.ilike.${pattern}`,
      `body.ilike.${pattern}`,
      `contact_email.ilike.${pattern}`,
    ];
    if (matchingChildIds.length) filters.push(`child_id.in.(${matchingChildIds.join(",")})`);
    if (matchingParentIds.length) filters.push(`user_id.in.(${matchingParentIds.join(",")})`);
    query = query.or(filters.join(","));
  }

  const start = (page - 1) * pageSize;
  const [{ data, error, count }, categoryCounts, statusCounts] = await Promise.all([
    query.range(start, start + pageSize - 1),
    Promise.all(CUSTOMER_REQUEST_CATEGORIES.map(async (value) => {
      const result = await service.from("support_requests").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("category", value);
      return [value, result.count ?? 0] as const;
    })),
    Promise.all(CUSTOMER_REQUEST_STATUSES.map(async (value) => {
      let counter = service.from("support_requests").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", value);
      if (category) counter = counter.eq("category", category);
      return [value, (await counter).count ?? 0] as const;
    })),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const childIds = Array.from(new Set(rows.map((row) => row.child_id).filter(Boolean))) as string[];
  const userIds = Array.from(new Set(rows.flatMap((row) => [row.user_id, row.guardian_id]).filter(Boolean))) as string[];
  const requestIds = rows.map((row) => row.id);

  const [childrenResult, parentsResult, membersResult, auditResult] = await Promise.all([
    childIds.length ? service.from("child_profiles").select("id,name,family_id,member_id").in("id", childIds) : Promise.resolve({ data: [] }),
    userIds.length ? service.from("parents").select("id,name,email").in("id", userIds) : Promise.resolve({ data: [] }),
    userIds.length ? service.from("family_members").select("user_id,family_id").in("user_id", userIds).is("deleted_at", null) : Promise.resolve({ data: [] }),
    requestIds.length ? service.from("admin_audit_log").select("resource_id,action,admin_email,before_snapshot,after_snapshot,created_at").eq("resource_type", "support_requests").in("resource_id", requestIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const children = childrenResult.data ?? [];
  const memberIds = children.map((row: any) => row.member_id).filter(Boolean);
  const accountsResult = memberIds.length
    ? await service.from("member_accounts").select("id,username,email,display_name").in("id", memberIds)
    : { data: [] };

  const familyIds = Array.from(new Set([
    ...children.map((row: any) => row.family_id).filter(Boolean),
    ...(membersResult.data ?? []).map((row: any) => row.family_id).filter(Boolean),
  ]));
  const familiesResult = familyIds.length
    ? await service.from("families").select("id,name").in("id", familyIds)
    : { data: [] };

  const childMap = new Map(children.map((row: any) => [row.id, row]));
  const parentMap = new Map((parentsResult.data ?? []).map((row: any) => [row.id, row]));
  const familyByUser = new Map((membersResult.data ?? []).map((row: any) => [row.user_id, row.family_id]));
  const accountMap = new Map((accountsResult.data ?? []).map((row: any) => [row.id, row]));
  const familyMap = new Map((familiesResult.data ?? []).map((row: any) => [row.id, row.name]));
  const auditByRequest = new Map<string, any[]>();
  for (const entry of auditResult.data ?? []) {
    const list = auditByRequest.get(entry.resource_id) ?? [];
    list.push(entry);
    auditByRequest.set(entry.resource_id, list);
  }

  const requests = rows.map((row) => {
    const child: any = row.child_id ? childMap.get(row.child_id) : null;
    const parent: any = parentMap.get(row.user_id) ?? parentMap.get(row.guardian_id);
    const account: any = child?.member_id ? accountMap.get(child.member_id) : null;
    const familyId: any = child?.family_id ?? familyByUser.get(row.user_id) ?? familyByUser.get(row.guardian_id) ?? null;
    return {
      ...row,
      submitter_name: row.submitter_role === "child"
        ? child?.name ?? account?.display_name ?? null
        : row.submitter_role === "guest"
          ? null
          : parent?.name ?? null,
      submitter_login: row.submitter_role === "child"
        ? account?.username ?? account?.email ?? null
        : row.submitter_role === "guest"
          ? row.contact_email ?? null
          : parent?.email ?? null,
      family_id: familyId,
      family_name: familyMap.get(familyId) ?? null,
      audit_history: auditByRequest.get(row.id) ?? [],
    };
  });

  const attachments = requests.flatMap((row) => row.attachments ?? []).filter((item) => item.upload_status === "uploaded" && item.storage_path);
  if (attachments.length) {
    const paths = attachments.map((item) => item.storage_path);
    const { data: signed } = await service.storage.from("feedback-attachments").createSignedUrls(paths, 3600);
    const urlMap = new Map(paths.map((path, index) => [path, signed?.[index]?.signedUrl ?? null]));
    for (const row of requests) for (const item of row.attachments ?? []) item.signed_url = urlMap.get(item.storage_path) ?? null;
  }

  const categories = Object.fromEntries(categoryCounts);
  return NextResponse.json({
    requests,
    pagination: { page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) },
    counters: { total: Object.values(categories).reduce((sum: number, value) => sum + Number(value), 0), categories, statuses: Object.fromEntries(statusCounts) },
  });
}
