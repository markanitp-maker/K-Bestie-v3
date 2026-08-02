import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSupabaseTarget } from "@/lib/supabase/env";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const upload_session_id = formData.get("upload_session_id") as string | null;
    const display_order = parseInt(formData.get("display_order") as string || "0", 10);
    const width = parseInt(formData.get("width") as string || "0", 10);
    const height = parseInt(formData.get("height") as string || "0", 10);

    if (!file || !upload_session_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Checking file signature (magic numbers) for basic validation to prevent renaming attacks
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let validSignature = false;

    // JPEG: FF D8 FF
    if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8 && uint8Array[2] === 0xFF) validSignature = true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    else if (uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && uint8Array[2] === 0x4E && uint8Array[3] === 0x47) validSignature = true;
    // WebP: RIFF ... WEBP
    else if (uint8Array[0] === 0x52 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 && uint8Array[3] === 0x46 &&
             uint8Array[8] === 0x57 && uint8Array[9] === 0x45 && uint8Array[10] === 0x42 && uint8Array[11] === 0x50) validSignature = true;
    // HEIC/HEIF: ftyp ...
    else if (uint8Array[4] === 0x66 && uint8Array[5] === 0x74 && uint8Array[6] === 0x79 && uint8Array[7] === 0x70) validSignature = true;

    if (!validSignature) {
      return NextResponse.json({ error: "Invalid file signature" }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    
    // Check max 3 images per session
    const { count } = await serviceClient
      .from("feedback_request_attachments")
      .select("*", { count: "exact", head: true })
      .eq("upload_session_id", upload_session_id)
      .eq("user_id", user.id)
      .neq("upload_status", "deleted");

    if (count !== null && count >= 3) {
      return NextResponse.json({ error: "Maximum 3 images allowed" }, { status: 400 });
    }

    const environment = getSupabaseTarget();
    const extension = file.type.split("/")[1] || "jpg";
    const stored_filename = crypto.randomUUID() + "." + extension;
    const storage_path = `${environment}/${upload_session_id}/${stored_filename}`;

    const { error: uploadError } = await serviceClient.storage
      .from("feedback-attachments")
      .upload(storage_path, arrayBuffer, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      console.error("[api/support/attachments] upload error:", uploadError);
      return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
    }

    const insertPayload = {
      user_id: user.id,
      upload_session_id,
      storage_bucket: "feedback-attachments",
      storage_path,
      original_filename: file.name,
      stored_filename,
      mime_type: file.type,
      file_size: file.size,
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      display_order,
      upload_status: "uploaded",
    };

    const { data: attachment, error: dbError } = await serviceClient
      .from("feedback_request_attachments")
      .insert(insertPayload)
      .select()
      .single();

    if (dbError) {
      console.error("[api/support/attachments] DB insert error:", dbError);
      // Try to clean up orphan file
      await serviceClient.storage.from("feedback-attachments").remove([storage_path]);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, attachment });

  } catch (error) {
    console.error("[api/support/attachments] unhandled error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Verify ownership
    const { data: attachment } = await serviceClient
      .from("feedback_request_attachments")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found or unauthorized" }, { status: 404 });
    }

    // Mark as deleted in DB
    const { error: dbError } = await serviceClient
      .from("feedback_request_attachments")
      .update({ upload_status: "deleted", deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (dbError) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // Delete from storage
    await serviceClient.storage
      .from(attachment.storage_bucket)
      .remove([attachment.storage_path]);

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("[api/support/attachments] unhandled DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
