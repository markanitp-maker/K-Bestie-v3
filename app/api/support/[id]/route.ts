import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveNotificationScope } from "@/lib/notifications/scope";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveNotificationScope(user.id);

  const { id } = await params;
  const service = createServiceClient();
  const { data: supportRequest, error } = await service
    .from("support_requests")
    .select("id,request_number,category,subject,body,status,created_at,updated_at,resolved_at,user_response,responded_at,submitter_role")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[api/support/detail] lookup failed", { code: error.code ?? "unknown" });
    return NextResponse.json({ error: "Request lookup failed" }, { status: 500 });
  }
  if (!supportRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: attachments, error: attachmentError } = await service
    .from("feedback_request_attachments")
    .select("id,original_filename,mime_type,file_size,storage_path,display_order")
    .eq("feedback_request_id", id)
    .eq("user_id", user.id)
    .eq("upload_status", "uploaded")
    .order("display_order", { ascending: true });
  if (attachmentError) {
    console.error("[api/support/detail] attachment lookup failed", { code: attachmentError.code ?? "unknown" });
    return NextResponse.json({ error: "Attachment lookup failed" }, { status: 500 });
  }

  const safeAttachments = [];
  for (const attachment of attachments ?? []) {
    const { data: signed, error: signedError } = await service.storage
      .from("feedback-attachments")
      .createSignedUrl(attachment.storage_path, 3600);
    if (signedError) {
      console.error("[api/support/detail] signed url failed", { attachmentId: attachment.id });
      continue;
    }
    safeAttachments.push({
      id: attachment.id,
      original_filename: attachment.original_filename,
      mime_type: attachment.mime_type,
      file_size: attachment.file_size,
      display_order: attachment.display_order,
      signed_url: signed.signedUrl,
    });
  }

  return NextResponse.json({
    request: {
      ...supportRequest,
      effective_role: scope?.role ?? (supportRequest.submitter_role === "child" ? "child" : "parent"),
      attachments: safeAttachments,
    },
  });
}
