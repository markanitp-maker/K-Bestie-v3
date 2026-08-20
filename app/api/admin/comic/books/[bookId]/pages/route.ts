import { NextResponse, type NextRequest } from "next/server";

import { requireComicAdmin } from "@/lib/comic/adminAuth";
import {
  storagePathFor,
  validateUpload,
  type UploadedFile,
} from "@/lib/comic/uploadValidation";

export const runtime = "nodejs";

const BUCKET = "comic-book-assets";
type Params = { params: Promise<{ bookId: string }> };

/**
 * 이미지 전체 세트 업로드 (SPEC §37).
 *
 * 페이지 단위 교체·삽입·삭제는 지원하지 않는다. 항상 세트 전체를 받고
 * **새 version 을 만든다.** 기존 version 과 그 자산은 그대로 남는다 —
 * 진행 중 세션이 시작 당시 버전을 끝까지 봐야 하기 때문이다(계약 §5).
 *
 * 같은 경로를 덮어쓰지 않는다. 경로에 version 이 들어가므로 충돌 자체가 없고,
 * 혹시 있으면 upsert 하지 않고 실패시킨다.
 */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  const { bookId } = await params;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart_required" }, { status: 400 });

  const entries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (entries.length === 0) return NextResponse.json({ error: "files_required" }, { status: 400 });

  // 이미지 크기는 클라이언트가 보고한 값을 신뢰하지 않고 서버에서 읽는다.
  const measured: Array<{ file: File; meta: UploadedFile }> = [];
  for (const file of entries) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const size = await measureImage(buffer);
    if (!size) {
      return NextResponse.json(
        { error: "unreadable_image", filename: file.name },
        { status: 400 },
      );
    }
    measured.push({
      file,
      meta: {
        filename: file.name,
        byteSize: buffer.byteLength,
        width: size.width,
        height: size.height,
      },
    });
  }

  const validation = validateUpload(measured.map((m) => m.meta));
  if (!validation.ok) {
    return NextResponse.json({ error: "validation_failed", issues: validation.issues }, { status: 400 });
  }

  const { data: book } = await admin.service
    .from("game_comic_books")
    .select("id, published_version")
    .eq("id", bookId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!book) return NextResponse.json({ error: "book_not_found" }, { status: 404 });

  const { data: latest } = await admin.service
    .from("game_comic_book_versions")
    .select("version")
    .eq("book_id", bookId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (latest?.version ?? 0) + 1;
  const bodyPages = validation.pages.filter((p) => p.pageNumber >= 1).length;

  const { error: versionErr } = await admin.service
    .from("game_comic_book_versions")
    .insert({ book_id: bookId, version, page_count: bodyPages });
  if (versionErr) {
    console.error("[admin/comic/pages] version 생성 실패:", versionErr);
    return NextResponse.json({ error: "version_insert_failed" }, { status: 500 });
  }

  const rows = [];
  for (const page of validation.pages) {
    const source = measured.find((m) => m.meta.filename === page.file.filename);
    if (!source) continue;

    const path = storagePathFor(bookId, version, page);
    const { error: uploadErr } = await admin.service.storage
      .from(BUCKET)
      .upload(path, await source.file.arrayBuffer(), {
        contentType: page.extension === "webp" ? "image/webp" : "image/jpeg",
        upsert: false, // 덮어쓰기 금지 — immutable 자산이다
      });

    if (uploadErr) {
      console.error("[admin/comic/pages] 업로드 실패:", uploadErr, { path });
      return NextResponse.json({ error: "upload_failed", path }, { status: 500 });
    }

    rows.push({
      book_id: bookId,
      version,
      page_number: page.pageNumber,
      storage_path: path,
      content_type: page.extension === "webp" ? "image/webp" : "image/jpeg",
      byte_size: page.file.byteSize,
      width: page.file.width,
      height: page.file.height,
    });
  }

  const { error: pagesErr } = await admin.service.from("game_comic_pages").insert(rows);
  if (pagesErr) {
    console.error("[admin/comic/pages] 페이지 기록 실패:", pagesErr);
    return NextResponse.json({ error: "pages_insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, version, pageCount: bodyPages }, { status: 201 });
}

/** 이미지 헤더에서 크기를 읽는다. sharp 는 이 저장소에 이미 있다. */
async function measureImage(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
