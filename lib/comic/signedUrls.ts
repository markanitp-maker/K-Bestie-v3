/**
 * 만화 이미지 signed URL 발급 (통합 계약 §9)
 *
 * URL 은 **저장하지 않는다.** 조회 시점에 발급하고 응답에만 실어 보낸다.
 * 세션은 5시간인데 URL TTL 은 그보다 짧을 수 있어, 만료되면 K-Toon 이
 * 다시 요청한다(SPEC §34 이미지 재시도).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "comic-book-assets";
/** 1시간. 만료 시 K-Toon 이 재요청하므로 길게 잡을 이유가 없다. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export async function signPaths(
  service: SupabaseClient,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const { data, error } = await service.storage
    .from(BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error("[comic/signedUrls] 발급 실패:", error);
    return result;
  }

  for (const item of data) {
    if (item.signedUrl && item.path) result.set(item.path, item.signedUrl);
  }
  return result;
}
