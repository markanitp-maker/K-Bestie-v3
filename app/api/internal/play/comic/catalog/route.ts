import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/server";
import { signPaths } from "@/lib/comic/signedUrls";
import { verifyInternalPlayRequest } from "@/lib/play/internalApiAuth";

export const runtime = "nodejs";

/**
 * GET /api/internal/play/comic/catalog — K-Toon 전용 (통합 계약 §9)
 *
 * 공개(is_published)이고 deleted_at 이 NULL 인 책만 반환한다.
 * 인증은 기존 verifyInternalPlayRequest 를 재사용한다(계약 §2).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = verifyInternalPlayRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const service = createServiceClient();
  const { data: books, error } = await service
    .from("game_comic_books")
    .select("id, title, synopsis, published_version")
    .eq("is_published", true)
    .is("deleted_at", null)
    .not("published_version", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[internal/comic/catalog] 조회 실패:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = books ?? [];
  if (rows.length === 0) return NextResponse.json({ books: [] });

  // 표지(page_number = 0)만 모아 한 번에 서명한다.
  const covers = await service
    .from("game_comic_pages")
    .select("book_id, version, storage_path")
    .in("book_id", rows.map((b) => b.id))
    .eq("page_number", 0);

  const coverByBook = new Map<string, string>();
  for (const c of covers.data ?? []) {
    const book = rows.find((b) => b.id === c.book_id);
    if (book && book.published_version === c.version) coverByBook.set(c.book_id, c.storage_path);
  }

  const signed = await signPaths(service, [...coverByBook.values()]);

  const counts = await service
    .from("game_comic_book_versions")
    .select("book_id, version, page_count")
    .in("book_id", rows.map((b) => b.id));

  return NextResponse.json({
    books: rows.map((b) => {
      const path = coverByBook.get(b.id);
      const count = (counts.data ?? []).find(
        (v) => v.book_id === b.id && v.version === b.published_version,
      );
      return {
        bookId: b.id,
        title: b.title,
        synopsis: b.synopsis,
        coverUrl: path ? (signed.get(path) ?? "") : "",
        pageCount: count?.page_count ?? 0,
        version: b.published_version,
      };
    }),
  });
}
