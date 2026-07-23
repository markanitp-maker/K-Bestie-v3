export function toKSTDateStr(iso: string) {
  const d = new Date(iso);
  d.setHours(d.getHours() + 9);
  return d.toISOString().slice(0, 10);
}

export function getOffsetDateStr(dateStr: string, offsetDays: number) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// id를 chunkSize 단위로 나눠 조회하되, 각 chunk 결과가 pageSize(=Postgrest 기본 최대 반환
// 행 수)에 도달하면 더 있을 수 있다고 보고 range()로 다음 페이지까지 이어 붙인다 — 그렇지
// 않으면 한 chunk의 메시지 수가 많을 때(200세션 × 다수 메시지) 조용히 잘려서 턴수가
// 과소집계될 수 있다. 쿼리 에러는 삼키지 않고 던져서 상위에서 500으로 처리하게 한다.
export async function fetchInChunks<T>(
  queryFn: (chunk: string[], rangeFrom: number, rangeTo: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  ids: string[],
  chunkSize = 200,
  pageSize = 1000
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    let offset = 0;
    while (true) {
      const { data, error } = await queryFn(chunk, offset, offset + pageSize - 1);
      if (error) throw new Error(`fetchInChunks: ${error.message}`);
      const rows = data ?? [];
      results.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }
  return results;
}
