import { NextResponse, type NextRequest } from "next/server";

import { requireComicAdmin } from "@/lib/comic/adminAuth";

export const runtime = "nodejs";

type Params = { params: Promise<{ bookId: string }> };

/**
 * 메타 수정 (SPEC §37).
 *
 * 제목·줄거리 수정은 **version 을 올리지 않는다.** 이미지 세트를 다시 올릴 때만
 * 올린다. 그래서 이 라우트는 published_version 을 건드리지 않는다.
 */
export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  const { bookId } = await params;
  let body: { title?: unknown; synopsis?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; synopsis?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
    patch.title = title;
  }
  if (typeof body.synopsis === "string") patch.synopsis = body.synopsis.trim();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const { data, error } = await admin.service
    .from("game_comic_books")
    .update(patch)
    .eq("id", bookId)
    .is("deleted_at", null)
    .select("id, title, synopsis, published_version, is_published")
    .maybeSingle();

  if (error) {
    console.error("[admin/comic/books/:id] 수정 실패:", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "book_not_found" }, { status: 404 });

  return NextResponse.json({ book: data });
}

/**
 * 삭제 (SPEC P1-5) — 즉시 Unpublish + deleted_at.
 *
 * 물리 삭제하지 않는다. 30일 휴지통에서 복구할 수 있고, 그 뒤에도 GC 가
 * 참조 안전성을 확인한 뒤에만 자산을 정리한다. 진행 중 세션이 참조하는
 * 버전은 삭제 요청과 무관하게 계속 제공된다.
 */
export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  const { bookId } = await params;
  const { data, error } = await admin.service
    .from("game_comic_books")
    .update({ is_published: false, deleted_at: new Date().toISOString() })
    .eq("id", bookId)
    .is("deleted_at", null)
    .select("id, is_published, deleted_at")
    .maybeSingle();

  if (error) {
    console.error("[admin/comic/books/:id] 삭제 실패:", error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "book_not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, book: data });
}
