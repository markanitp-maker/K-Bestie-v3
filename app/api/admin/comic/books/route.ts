import { NextResponse, type NextRequest } from "next/server";

import { requireComicAdmin } from "@/lib/comic/adminAuth";

export const runtime = "nodejs";

/** 관리자 책 목록 (SPEC §10). 휴지통 항목도 함께 본다. */
export async function GET(): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  const { data, error } = await admin.service
    .from("game_comic_books")
    .select("id, title, synopsis, published_version, is_published, deleted_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/comic/books] 목록 조회 실패:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json({ books: data ?? [] });
}

/** 책 생성 (SPEC §11). 이 시점에는 아직 이미지도 버전도 없다. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireComicAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status });

  let body: { title?: unknown; synopsis?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; synopsis?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const synopsis = typeof body.synopsis === "string" ? body.synopsis.trim() : "";
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

  const { data, error } = await admin.service
    .from("game_comic_books")
    .insert({ title, synopsis })
    .select("id, title, synopsis, is_published, published_version")
    .single();

  if (error) {
    console.error("[admin/comic/books] 생성 실패:", error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ book: data }, { status: 201 });
}
