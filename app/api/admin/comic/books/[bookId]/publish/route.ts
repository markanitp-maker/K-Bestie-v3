import { NextResponse, type NextRequest } from "next/server";

import { requireComicAdmin } from "@/lib/comic/adminAuth";
import { checkPublishGate, type UploadedFile } from "@/lib/comic/uploadValidation";

export const runtime = "nodejs";

type Params = { params: Promise<{ bookId: string }> };

/**
 * Publish Gate (SPEC §36).
 *
 * 아홉 항목이 모두 PASS 해야 공개한다. 하나라도 실패하면 **비공개를 유지한다** —
 * 부분 공개는 없다. 관리자 화면이 먼저 걸러도 여기서 다시 본다.
 *
 * 검증 대상은 화면이 보낸 값이 아니라 **DB 에 실제로 기록된 페이지**다.
 * 업로드가 중간에 끊겨 행이 덜 들어갔으면 여기서 걸린다.
 */
export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  const { bookId } = await params;

  const { data: book } = await admin.service
    .from("game_comic_books")
    .select("id, title, synopsis")
    .eq("id", bookId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!book) return NextResponse.json({ error: "book_not_found" }, { status: 404 });

  const { data: latest } = await admin.service
    .from("game_comic_book_versions")
    .select("version, page_count")
    .eq("book_id", bookId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) {
    return NextResponse.json(
      { error: "publish_gate_failed", issues: [{ code: "missing_body", detail: "업로드된 버전이 없다" }] },
      { status: 400 },
    );
  }

  const { data: pages } = await admin.service
    .from("game_comic_pages")
    .select("page_number, storage_path, content_type, byte_size, width, height")
    .eq("book_id", bookId)
    .eq("version", latest.version)
    .order("page_number");

  const files: UploadedFile[] = (pages ?? []).map((p) => ({
    filename: `${String(p.page_number).padStart(2, "0")}.${p.content_type === "image/webp" ? "webp" : "jpg"}`,
    byteSize: Number(p.byte_size),
    width: p.width,
    height: p.height,
  }));

  const gate = checkPublishGate({
    title: book.title,
    synopsis: book.synopsis,
    files,
    // 기록된 페이지 수와 version 이 선언한 본문 수가 맞아야 전부 올라간 것이다.
    allAssetsUploaded: files.filter((f) => !f.filename.startsWith("00.")).length === latest.page_count,
  });

  if (!gate.ok) {
    return NextResponse.json({ error: "publish_gate_failed", issues: gate.issues }, { status: 400 });
  }

  const { data, error } = await admin.service
    .from("game_comic_books")
    .update({ is_published: true, published_version: latest.version })
    .eq("id", bookId)
    .select("id, is_published, published_version")
    .single();

  if (error) {
    console.error("[admin/comic/publish] 공개 실패:", error);
    return NextResponse.json({ error: "publish_failed" }, { status: 500 });
  }

  await admin.service
    .from("game_comic_book_versions")
    .update({ published_at: new Date().toISOString() })
    .eq("book_id", bookId)
    .eq("version", latest.version);

  return NextResponse.json({ ok: true, book: data });
}

/** 비공개 전환. 진행 중 세션은 자기 버전을 계속 본다(계약 §9). */
export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  const { bookId } = await params;
  const { data, error } = await admin.service
    .from("game_comic_books")
    .update({ is_published: false })
    .eq("id", bookId)
    .select("id, is_published, published_version")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "unpublish_failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "book_not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, book: data });
}
