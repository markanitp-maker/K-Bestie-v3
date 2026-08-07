// GCP billing_export(BigQuery) 조회 — 실제 사용 원가/크레딧/순청구액을 SKU 단위로 가져온다.
// 필요 환경변수:
//   GCP_BILLING_PROJECT_ID   billing_export가 있는 GCP 프로젝트 (예: k-bestie3)
//   GCP_BILLING_DATASET      billing_export 데이터세트명 (예: billing_export)
//   GCP_BILLING_SA_KEY_JSON  조회 전용 서비스 계정 키(JSON 전체를 문자열로)
// 서비스 계정 필요 권한: 해당 데이터세트에 BigQuery Data Viewer + 프로젝트에 BigQuery Job User.
// 환경변수가 없으면 조회를 시도하지 않고 "설정 안 됨" 상태를 반환한다(대시보드가 깨지지 않도록).
//
// 2026-07-27 재검증(대표님 지시 — 2026-07-01~27 실측치와 정확히 일치 확인됨):
//   - billing_export의 cost/credits.amount는 이미 KRW다(currency 컬럼이 문자열 그대로 "KRW").
//     과거 코드가 여기에 USD_TO_KRW(1400)를 곱해 실제 청구액을 1400배 부풀리던 버그를 여기서 제거했다.
//   - grossCost = SUM(cost), creditAmount = SUM(credits.amount)(음수), netCost = grossCost + creditAmount.
//   - service "Cloud Speech API"         → stt    (검증치 6,369원)
//   - service "Cloud Text-to-Speech API" → tts
//   - service "Cloud Run"                → cloud_run (검증치 769원)
//   - service "Cloud Storage"            → cloud_storage (검증치 8원)
//   - service "Vertex AI":
//       Gemini text/prediction SKU → vertex_ai_gemini (모델 버전과 무관)
//       Embedding SKU → vertex_ai_embeddings, Live/AV2A SKU → live_realtime_audio
//   - 그 외 서비스(Cloud Logging/Secret Manager/BigQuery/Cloud Build/Artifact Registry 등)
//     → other(미분류) — 대부분 과금 대상이 아닌 무료 메터링 행이라 금액은 사실상 0에 수렴한다.
// 주의: billing_export는 회사 전체 청구서라 A~E 모드·아이·가족·세션 단위로는 쪼갤 수 없다.
//       그 단위 실청구는 usage_events 사용량 비중 기반 '배분 추정액'으로만 제공한다(호출부에서 배분).

import { BigQuery } from "@google-cloud/bigquery";
import { formatKstDate } from "@/lib/billing/periodRange";

// 서비스와 SKU family를 기준으로 분류하며 모델 버전 문자열로 비용을 나누지 않는다.
// cloud_run = 라이브 음성 릴레이 인프라. cloud_storage = 저장소. other = 위 6종 외 전부(미분류 집계용).
export type BillingCategory =
  | "stt"
  | "tts"
  | "vertex_ai_gemini"
  | "vertex_ai_embeddings"
  | "live_realtime_audio"
  | "cloud_run"
  | "cloud_storage"
  | "cloud_logging"
  | "bigquery"
  | "artifact_registry"
  | "secret_manager"
  | "other";

export const KNOWN_BILLING_CATEGORIES: Exclude<BillingCategory, "other">[] = [
  "stt",
  "tts",
  "vertex_ai_gemini",
  "vertex_ai_embeddings",
  "live_realtime_audio",
  "cloud_run",
  "cloud_storage",
  "cloud_logging",
  "bigquery",
  "artifact_registry",
  "secret_manager",
];

export const BILLING_CATEGORY_LABELS: Record<BillingCategory, string> = {
  stt: "Speech-to-Text",
  tts: "Text-to-Speech",
  vertex_ai_gemini: "Vertex AI - Gemini",
  vertex_ai_embeddings: "Vertex AI - Embeddings",
  live_realtime_audio: "Live / Realtime Audio",
  cloud_run: "Cloud Run",
  cloud_storage: "Cloud Storage",
  cloud_logging: "Cloud Logging",
  bigquery: "BigQuery",
  artifact_registry: "Artifact Registry",
  secret_manager: "Secret Manager",
  other: "기타/미분류",
};

// Gemini SKU를 모델 사용 형태로 세분화 — 제품(Live/LLM/TTS) 단위로 임의 배분하지 않고
// SKU 문자열 자체로 판별한다(대표님 지시: "제품 단위로 임의 배분 금지").
export type GeminiUsageDimension = "input_audio" | "output_audio" | "text_input" | "text_output" | "other";

export function classifyGeminiDimension(skuDesc: string): GeminiUsageDimension {
  const sku = (skuDesc ?? "").toLowerCase();
  if (sku.includes("audio input")) return "input_audio";
  if (sku.includes("audio") && (sku.includes("output") || sku.includes("av2a"))) return "output_audio";
  if (sku.includes("text input")) return "text_input";
  if (sku.includes("text output")) return "text_output";
  return "other";
}

export interface CostTriplet {
  grossCostKrw: number;
  creditKrw: number;
  netCostKrw: number;
}

function emptyTriplet(): CostTriplet {
  return { grossCostKrw: 0, creditKrw: 0, netCostKrw: 0 };
}

function addTriplet(a: CostTriplet, b: CostTriplet): CostTriplet {
  return { grossCostKrw: a.grossCostKrw + b.grossCostKrw, creditKrw: a.creditKrw + b.creditKrw, netCostKrw: a.netCostKrw + b.netCostKrw };
}

export interface GcpBillingSkuRow {
  service: string; // 원본 service.description
  serviceId: string;
  sku: string; // 원본 sku.description
  skuId: string;
  projectId: string;
  projectName: string;
  category: BillingCategory;
  geminiDimension?: GeminiUsageDimension;
  usageAmount: number;
  usageUnit: string;
  cost: CostTriplet;
}

export interface GcpBillingResult {
  configured: boolean;
  error?: string;
  total: CostTriplet;
  totalsByCategory: Record<BillingCategory, CostTriplet>;
  skuRows: GcpBillingSkuRow[]; // Gemini 모델/오디오입력/오디오출력/텍스트입력/텍스트출력 매핑용 SKU 상세
  unclassified: {
    count: number; // 미분류(other)로 떨어진 SKU 그룹 수
    services: string[]; // 미분류로 걸린 실제 service.description 목록
    cost: CostTriplet;
    ratePct: number; // unclassified.cost.grossCostKrw / total.grossCostKrw * 100 (분모 0이면 0)
  };
  /** GCP billing export는 통상 하루 지연되어 반영된다 — 이 날짜(오늘) 이후 데이터는 "집계 중"으로 취급. */
  dataCutoffDate: string;
  latestDataAt: string | null;
  projectScope: string[];
}

let cachedClient: BigQuery | null = null;
let cachedBillingTable: string | null = null;

// claude-review 지적: JSON.parse가 fetchGcpBilling의 try/catch 바깥에서 호출되면
// GCP_BILLING_SA_KEY_JSON 값이 손상된 경우(오타로 잘림 등) 여기서 던진 예외가 잡히지
// 않고 API 라우트 전체를 500으로 죽인다 — "환경변수 미설정 시 대시보드가 깨지지
// 않도록" 계약을 여기서도 지키기 위해 이 함수 자체가 예외를 삼키고 null을 반환한다.
function getClient(): BigQuery | null {
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const keyJson = process.env.GCP_BILLING_SA_KEY_JSON;
  if (!projectId || !keyJson) return null;

  if (!cachedClient) {
    try {
      const credentials = JSON.parse(keyJson);
      cachedClient = new BigQuery({ projectId, credentials });
    } catch {
      return null;
    }
  }
  return cachedClient;
}

/** service.description + sku.description을 알려진 6종 중 하나로 분류. 대상 아니면 "other"(미분류). (테스트 위해 export) */
export function classifyBillingRow(serviceDesc: string, skuDesc: string): BillingCategory {
  const s = (serviceDesc ?? "").toLowerCase();
  const sku = (skuDesc ?? "").toLowerCase();

  if (s.includes("cloud run")) return "cloud_run";
  if (s.includes("cloud storage")) return "cloud_storage";
  if (s.includes("cloud logging") || s === "logging") return "cloud_logging";
  if (s.includes("bigquery")) return "bigquery";
  if (s.includes("artifact registry")) return "artifact_registry";
  if (s.includes("secret manager")) return "secret_manager";
  // STT: "Cloud Speech API" / "Cloud Speech-to-Text*"
  if (s.includes("speech-to-text") || s === "cloud speech api" || (s.includes("speech") && !s.includes("text-to-speech"))) {
    return "stt";
  }
  // TTS: "Cloud Text-to-Speech API"
  if (s.includes("text-to-speech")) {
    return "tts";
  }
  // Vertex AI는 모델 버전이 아니라 SKU family로 분류한다. 새 Gemini 버전은 같은
  // text/audio prediction family인 한 자동으로 기존 상위 카테고리에 포함된다.
  if (s.includes("vertex")) {
    if (sku.includes("embedding") || sku.includes("text embedding")) return "vertex_ai_embeddings";
    if (sku.includes("gemini") && (sku.includes("live audio") || sku.includes("av2a") || sku.includes("realtime"))) {
      return "live_realtime_audio";
    }
    if (sku.includes("gemini") && (sku.includes("prediction") || sku.includes("text input") || sku.includes("text output"))) {
      return "vertex_ai_gemini";
    }
    return "other";
  }
  return "other";
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

function emptyTotalsByCategory(): Record<BillingCategory, CostTriplet> {
  return {
    stt: emptyTriplet(),
    tts: emptyTriplet(),
    vertex_ai_gemini: emptyTriplet(),
    vertex_ai_embeddings: emptyTriplet(),
    live_realtime_audio: emptyTriplet(),
    cloud_run: emptyTriplet(),
    cloud_storage: emptyTriplet(),
    cloud_logging: emptyTriplet(),
    bigquery: emptyTriplet(),
    artifact_registry: emptyTriplet(),
    secret_manager: emptyTriplet(),
    other: emptyTriplet(),
  };
}

function emptyResult(configured: boolean, dataCutoffDate: string, projectScope: string[], error?: string): GcpBillingResult {
  return {
    configured,
    error,
    total: emptyTriplet(),
    totalsByCategory: emptyTotalsByCategory(),
    skuRows: [],
    unclassified: { count: 0, services: [], cost: emptyTriplet(), ratePct: 0 },
    dataCutoffDate,
    latestDataAt: null,
    projectScope,
  };
}

function getTargetProjectIds(): string[] {
  const raw = process.env.GCP_BILLING_TARGET_PROJECT_IDS ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  return Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)));
}

/** 실제 GCP 청구 원가(사용 원가/크레딧/순청구액)를 SKU 단위로 [from, to) 기간 조회. */
export async function fetchGcpBilling(input: { from: Date; to: Date }): Promise<GcpBillingResult> {
  const today = new Date().toISOString().slice(0, 10);
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const dataset = process.env.GCP_BILLING_DATASET;
  const targetProjectIds = getTargetProjectIds();

  const client = getClient();
  if (!client || !projectId || !dataset) {
    return emptyResult(false, today, targetProjectIds);
  }
  if (targetProjectIds.length === 0) {
    return emptyResult(false, today, [], "Production GCP project filter가 설정되지 않았습니다");
  }

  try {
    const table = await resolveBillingTable(client, `${projectId}.${dataset}`);
    if (!table) {
      return emptyResult(false, today, targetProjectIds, "billing_export 테이블을 찾을 수 없습니다");
    }

    // 대표님 지시: 특정 서비스만 사전 필터링하지 않는다 — 전체 서비스를 가져와 알려진 6종 외는
    // "other"(미분류)로 명시적으로 집계해야 미분류율(>1%) 경고가 의미를 가진다.
    const [rows] = await client.query({
      query: `
        SELECT
          service.description AS service_desc,
          service.id AS service_id,
          sku.description AS sku_desc,
          sku.id AS sku_id,
          project.id AS project_id,
          project.name AS project_name,
          SUM(cost) AS gross_cost,
          SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS credit_amount,
          SUM(usage.amount) AS usage_amount,
          ANY_VALUE(usage.unit) AS usage_unit,
          MAX(usage_end_time) AS latest_usage_end_time
        FROM \`${projectId}.${dataset}.${table}\`
        WHERE usage_start_time >= @from
          AND usage_start_time < @to
          AND project.id IN UNNEST(@targetProjectIds)
        GROUP BY service_desc, service_id, sku_desc, sku_id, project_id, project_name
      `,
      params: { from: input.from.toISOString(), to: input.to.toISOString(), targetProjectIds },
    });

    const totalsByCategory = emptyTotalsByCategory();
    const skuRows: GcpBillingSkuRow[] = [];
    const unclassifiedServices = new Set<string>();
    let unclassifiedGross = 0;
    let unclassifiedCredit = 0;
    let total = emptyTriplet();
    let latestDataAt: string | null = null;

    for (const r of rows as Array<{
      service_desc: string;
      service_id: string | null;
      sku_desc: string;
      sku_id: string | null;
      project_id: string | null;
      project_name: string | null;
      gross_cost: number | null;
      credit_amount: number | null;
      usage_amount: number | null;
      usage_unit: string | null;
      latest_usage_end_time: { value?: string } | string | null;
    }>) {
      const category = classifyBillingRow(r.service_desc, r.sku_desc);
      const grossCostKrw = r.gross_cost ?? 0;
      const creditKrw = r.credit_amount ?? 0;
      const netCostKrw = grossCostKrw + creditKrw;
      const cost: CostTriplet = { grossCostKrw, creditKrw, netCostKrw };

      totalsByCategory[category] = addTriplet(totalsByCategory[category], cost);
      total = addTriplet(total, cost);

      const row: GcpBillingSkuRow = {
        service: r.service_desc,
        serviceId: r.service_id ?? "",
        sku: r.sku_desc,
        skuId: r.sku_id ?? "",
        projectId: r.project_id ?? "",
        projectName: r.project_name ?? "",
        category,
        usageAmount: r.usage_amount ?? 0,
        usageUnit: r.usage_unit ?? "",
        cost,
      };
      if (category === "vertex_ai_gemini" || category === "live_realtime_audio") {
        row.geminiDimension = classifyGeminiDimension(r.sku_desc);
      }
      skuRows.push(row);

      const rawLatest = typeof r.latest_usage_end_time === "string" ? r.latest_usage_end_time : r.latest_usage_end_time?.value;
      if (rawLatest && (!latestDataAt || new Date(rawLatest) > new Date(latestDataAt))) latestDataAt = rawLatest;

      if (category === "other") {
        unclassifiedServices.add(r.service_desc);
        unclassifiedGross += grossCostKrw;
        unclassifiedCredit += creditKrw;
      }
    }

    const unclassifiedCost: CostTriplet = {
      grossCostKrw: unclassifiedGross,
      creditKrw: unclassifiedCredit,
      netCostKrw: unclassifiedGross + unclassifiedCredit,
    };
    const unclassifiedRatePct = total.grossCostKrw > 0 ? (Math.abs(unclassifiedCost.grossCostKrw) / total.grossCostKrw) * 100 : 0;

    return {
      configured: true,
      total,
      totalsByCategory,
      skuRows,
      unclassified: {
        count: skuRows.filter((r) => r.category === "other").length,
        services: Array.from(unclassifiedServices),
        cost: unclassifiedCost,
        ratePct: unclassifiedRatePct,
      },
      dataCutoffDate: latestDataAt ? formatKstDate(latestDataAt) : today,
      latestDataAt,
      projectScope: targetProjectIds,
    };
  } catch (err) {
    // 조회 실패 시 configured=false로 반환해 호출부가 실청구 0원이 아니라 '추정치'로 폴백하게 한다.
    return emptyResult(false, today, targetProjectIds, (err as Error).message);
  }
}
