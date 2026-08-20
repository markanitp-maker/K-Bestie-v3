import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { signPaths } from "@/lib/comic/signedUrls";
import { verifyInternalPlayRequest } from "@/lib/play/internalApiAuth";

export const runtime = "nodejs";

type Params = { params: Promise<{ bookId: string }> };

/**
 * GET /api/internal/play/comic/book/{bookId}?version={n} — K-Toon 전용 (계약 §9)
 *
 * version 을 지정하면 **그 버전을 반환한다.** 진행 중 세션은 항상
 * selectedBookVersion 을 명시하므로, 관리자가 새 버전을 올려도 읽던 아이는
 * 시작 당시 버전을 끝까지 본다.
 *
 * 삭제 요청(deleted_at)된 책이라도 **활성 세션이 참조하는 버전은 정상 제공한다** —
 * 읽는 도중에 화면이 깨지면 안 되기 때문이다. 대신 Catalog 에서는 이미 빠져 있다.
 */
export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = verifyInternalPlayRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const { bookId } = await params;
  const requested = request.nextUrl.searchParams.get("version");

  const service = createServiceClient();
  const { data: book } = await service
    .from("game_comic_books")
    .select("id, title, synopsis, published_version, deleted_at")
    .eq("id", bookId)
    .maybeSingle();

  if (!book) return NextResponse.json({ error: "book_not_found" }, { status: 404 });

  const version = requested !== null ? Number(requested) : book.published_version;
  if (!Number.isInteger(version) || version === null) {
    return NextResponse.json({ error: "version_required" }, { status: 400 });
  }

  // 삭제된 책은 version 을 명시한 경우에만 제공한다 —
  // 진행 중 세션의 이어읽기만 허용하고 신규 진입은 막는다.
  if (book.deleted_at && requested === null) {
    return NextResponse.json({ error: "book_not_found" }, { status: 404 });
  }

  const { data: versionRow } = await service
    .from("game_comic_book_versions")
    .select("version, page_count")
    .eq("book_id", bookId)
    .eq("version", version)
    .maybeSingle();

  if (!versionRow) return NextResponse.json({ error: "version_not_found" }, { status: 404 });

  const { data: pages } = await service
    .from("game_comic_pages")
    .select("page_number, storage_path")
    .eq("book_id", bookId)
    .eq("version", version)
    .order("page_number");

  const rows = pages ?? [];
  const signed = await signPaths(service, rows.map((p) => p.storage_path));

  return NextResponse.json({
    bookId: book.id,
    version: versionRow.version,
    title: book.title,
    synopsis: book.synopsis,
    pageCount: versionRow.page_count,
    pages: rows.map((p) => ({
      pageNumber: p.page_number,
      url: signed.get(p.storage_path) ?? "",
    })),
  });
}
