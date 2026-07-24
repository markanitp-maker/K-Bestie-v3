// GCP billing_export(BigQuery) 조회 — STT/TTS/Live/LLM 실제 청구액(SKU별)을 서비스 4종으로 분류해 가져온다.
// 필요 환경변수:
//   GCP_BILLING_PROJECT_ID   billing_export가 있는 GCP 프로젝트 (예: k-bestie3)
//   GCP_BILLING_DATASET      billing_export 데이터세트명 (예: billing_export)
//   GCP_BILLING_SA_KEY_JSON  조회 전용 서비스 계정 키(JSON 전체를 문자열로)
// 서비스 계정 필요 권한: 해당 데이터세트에 BigQuery Data Viewer + 프로젝트에 BigQuery Job User.
// 환경변수가 없으면 조회를 시도하지 않고 "설정 안 됨" 상태를 반환한다(대시보드가 깨지지 않도록).
//
// 2026-07-22 표본 조사로 확인한 실제 service/sku 문자열 기준으로 분류한다:
//   - service "Cloud Speech API"        → stt   (구 코드의 "Cloud Speech-to-Text API"는 실제와 불일치해 STT 집계가 비어 있던 버그를 여기서 수정)
//   - service "Cloud Text-to-Speech API"→ tts
//   - service "Vertex AI" + sku "…Live Audio/Live Text/AV2A…" → live_audio
//   - service "Vertex AI" + sku "…GA Text/Thinking…"          → llm
// 주의: billing_export는 회사 전체 청구서라 A~E 모드·아이·가족·세션 단위로는 쪼갤 수 없다.
//       그 단위 실청구는 usage_events 사용량 비중 기반 '배분 추정액'으로만 제공한다(호출부에서 배분).

import { BigQuery } from "@google-cloud/bigquery";
import { USD_TO_KRW } from "@/lib/plan/pricing";

// stt/tts/live_audio/llm = AI 4종. cloud_run = 라이브 음성 릴레이(vertex-live-relay) 인프라 실청구.
export type BillingService = "stt" | "tts" | "live_audio" | "llm" | "cloud_run";

export interface GcpBillingDayRow {
  day: string; // YYYY-MM-DD
  service: BillingService;
  costKrw: number;
}

export interface GcpBillingResult {
  configured: boolean;
  error?: string;
  rows: GcpBillingDayRow[];
  totalsByService: Record<BillingService, number>;
  /** GCP billing export는 통상 하루 지연되어 반영된다 — 이 날짜(오늘) 이후 데이터는 "집계 중"으로 취급. */
  dataCutoffDate: string;
}

let cachedClient: BigQuery | null = null;
let cachedBillingTable: string | null = null;

function getClient(): BigQuery | null {
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const keyJson = process.env.GCP_BILLING_SA_KEY_JSON;
  if (!projectId || !keyJson) return null;

  if (!cachedClient) {
    const credentials = JSON.parse(keyJson);
    cachedClient = new BigQuery({ projectId, credentials });
  }
  return cachedClient;
}

/** service.description + sku.description을 4종 서비스 중 하나로 분류. 대상 아니면 null. (테스트 위해 export) */
export function classifyBillingRow(serviceDesc: string, skuDesc: string): BillingService | null {
  const s = (serviceDesc ?? "").toLowerCase();
  const sku = (skuDesc ?? "").toLowerCase();

  // Cloud Run: 라이브 음성 릴레이(vertex-live-relay) 인프라. text-to-speech보다 먼저 판별할 필요는 없으나 명시적으로 우선.
  if (s.includes("cloud run")) return "cloud_run";
  // STT: "Cloud Speech API" / "Cloud Speech-to-Text*"
  if (s.includes("speech-to-text") || s === "cloud speech api" || (s.includes("speech") && !s.includes("text-to-speech"))) {
    return "stt";
  }
  // TTS: "Cloud Text-to-Speech API"
  if (s.includes("text-to-speech")) {
    return "tts";
  }
  // Vertex AI: sku로 Live vs LLM 구분
  if (s.includes("vertex")) {
    if (sku.includes("live") || sku.includes("av2a") || sku.includes("audio")) return "live_audio";
    return "llm"; // GA Text / Thinking / 기타 Vertex 텍스트
  }
  return null;
}

async function resolveBillingTable(client: BigQuery, dataset: string): Promise<string | null> {
  if (cachedBillingTable) return cachedBillingTable;

  const [rows] = await client.query({
    query: `
      SELECT table_name
      FROM \`${dataset}.INFORMATION_SCHEMA.TABLES\`
      WHERE table_name LIKE 'gcp_billing_export_v1%'
      ORDER BY table_name DESC
      LIMIT 1
    `,
  });
  const tableName = (rows?.[0] as { table_name?: string } | undefined)?.table_name;
  if (!tableName) return null;
  cachedBillingTable = tableName;
  return tableName;
}

function emptyTotals(): Record<BillingService, number> {
  return { stt: 0, tts: 0, live_audio: 0, llm: 0, cloud_run: 0 };
}

/** STT/TTS/Live/LLM 실제 청구액(일자·서비스별)을 [from, to) 기간으로 조회. */
export async function fetchGcpBilling(input: { from: Date; to: Date }): Promise<GcpBillingResult> {
  const today = new Date().toISOString().slice(0, 10);
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const dataset = process.env.GCP_BILLING_DATASET;

  const client = getClient();
  if (!client || !projectId || !dataset) {
    return { configured: false, rows: [], totalsByService: emptyTotals(), dataCutoffDate: today };
  }

  try {
    const table = await resolveBillingTable(client, `${projectId}.${dataset}`);
    if (!table) {
      return {
        configured: false,
        error: "billing_export 테이블을 찾을 수 없습니다",
        rows: [],
        totalsByService: emptyTotals(),
        dataCutoffDate: today,
      };
    }

    // service/sku 별로 원시 집계 후 코드에서 4종으로 분류(정확한 SKU 매칭을 위해 sku.description까지 조회).
    const [rows] = await client.query({
      query: `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS day,
          service.description AS service_desc,
          sku.description AS sku_desc,
          SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost_usd
        FROM \`${projectId}.${dataset}.${table}\`
        WHERE usage_start_time >= @from
          AND usage_start_time < @to
          AND (
            LOWER(service.description) LIKE '%speech%'
            OR LOWER(service.description) LIKE '%text-to-speech%'
            OR LOWER(service.description) LIKE '%vertex%'
            OR LOWER(service.description) LIKE '%cloud run%'
          )
        GROUP BY day, service_desc, sku_desc
        ORDER BY day ASC
      `,
      params: { from: input.from.toISOString(), to: input.to.toISOString() },
    });

    const totalsByService = emptyTotals();
    const dayServiceMap = new Map<string, number>(); // key: `${day}|${service}`
    for (const r of rows as Array<{ day: string; service_desc: string; sku_desc: string; cost_usd: number }>) {
      const service = classifyBillingRow(r.service_desc, r.sku_desc);
      if (!service) continue;
      const costKrw = (r.cost_usd ?? 0) * USD_TO_KRW;
      totalsByService[service] += costKrw;
      const key = `${r.day}|${service}`;
      dayServiceMap.set(key, (dayServiceMap.get(key) ?? 0) + costKrw);
    }

    const resultRows: GcpBillingDayRow[] = Array.from(dayServiceMap.entries())
      .map(([key, costKrw]) => {
        const [day, service] = key.split("|");
        return { day, service: service as BillingService, costKrw };
      })
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    return { configured: true, rows: resultRows, totalsByService, dataCutoffDate: today };
  } catch (err) {
    // 조회 실패 시 configured=false로 반환해 호출부가 실청구 0원이 아니라 '추정치'로 폴백하게 한다.
    // (환경변수는 설정됐지만 쿼리가 실패한 상태 — error로 원인을 함께 노출한다.)
    return {
      configured: false,
      error: (err as Error).message,
      rows: [],
      totalsByService: emptyTotals(),
      dataCutoffDate: today,
    };
  }
}
