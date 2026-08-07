import { getActiveGcaiProfile, getGcaiEnvKeys } from "@/app/api/_lib/gcaiProfiles";

export type AiRuntimeKind = "vercelVertex" | "supabaseVertex" | "cloudRunVertex" | "globalRest" | "embeddingDual";

export interface AiRuntimeMetadata {
  runtime: string;
  endpointLocation: string;
  credentialEnvKeys: string[];
  locationEnvKeys: string[];
  problems: string[];
  warnings: string[];
}

const SUPPORTED_VERTEX_LOCATIONS = new Set(["global", "us-central1"]);

function vercelVertexMetadata(): AiRuntimeMetadata {
  const problems: string[] = [];
  const warnings: string[] = [];
  let envKeys: ReturnType<typeof getGcaiEnvKeys>;

  try {
    envKeys = getGcaiEnvKeys(getActiveGcaiProfile());
  } catch {
    return {
      runtime: "Vercel Node",
      endpointLocation: "설정 오류",
      credentialEnvKeys: [],
      locationEnvKeys: ["GCAI_ACTIVE_PROFILE"],
      problems: ["GCAI 활성 프로필 설정이 유효하지 않습니다."],
      warnings,
    };
  }

  const location = process.env[envKeys.GOOGLE_CLOUD_LOCATION]?.trim() || "global";
  if (!SUPPORTED_VERTEX_LOCATIONS.has(location)) {
    problems.push(`Vercel Vertex에서 지원하도록 등록되지 않은 location(${location})입니다.`);
  } else if (location !== "global") {
    warnings.push(`Vercel 기본 location(global) 대신 ${location}을 사용 중입니다.`);
  }

  for (const key of [envKeys.GOOGLE_CLOUD_PROJECT, envKeys.GCP_VERTEX_SA_KEY_JSON]) {
    if (!process.env[key]?.trim()) problems.push(`${key}가 설정되지 않았습니다.`);
  }

  return {
    runtime: "Vercel Node",
    endpointLocation: location,
    credentialEnvKeys: [envKeys.GOOGLE_CLOUD_PROJECT, envKeys.GCP_VERTEX_SA_KEY_JSON],
    locationEnvKeys: [envKeys.GOOGLE_CLOUD_LOCATION],
    problems,
    warnings,
  };
}

const SUPABASE_VERTEX: AiRuntimeMetadata = {
  runtime: "Supabase Edge / Deno",
  endpointLocation: "us-central1",
  credentialEnvKeys: ["GOOGLE_CLOUD_PROJECT", "GCP_VERTEX_SA_KEY_JSON"],
  locationEnvKeys: ["GOOGLE_CLOUD_LOCATION"],
  problems: [],
  warnings: [],
};

const CLOUD_RUN_VERTEX: AiRuntimeMetadata = {
  runtime: "Cloud Run",
  endpointLocation: "us-central1",
  credentialEnvKeys: ["GOOGLE_CLOUD_PROJECT", "GCP_VERTEX_SA_KEY_JSON 또는 Cloud Run ADC"],
  locationEnvKeys: ["GOOGLE_CLOUD_LOCATION"],
  problems: [],
  warnings: [],
};

export function getAiRuntimeMetadata(kind: AiRuntimeKind): AiRuntimeMetadata {
  if (kind === "vercelVertex") return vercelVertexMetadata();
  if (kind === "supabaseVertex") return { ...SUPABASE_VERTEX, credentialEnvKeys: [...SUPABASE_VERTEX.credentialEnvKeys], locationEnvKeys: [...SUPABASE_VERTEX.locationEnvKeys] };
  if (kind === "cloudRunVertex") return { ...CLOUD_RUN_VERTEX, credentialEnvKeys: [...CLOUD_RUN_VERTEX.credentialEnvKeys], locationEnvKeys: [...CLOUD_RUN_VERTEX.locationEnvKeys] };
  if (kind === "globalRest") {
    return { runtime: "Google Cloud REST", endpointLocation: "Global REST API", credentialEnvKeys: [], locationEnvKeys: [], problems: [], warnings: [] };
  }

  const vercel = vercelVertexMetadata();
  return {
    runtime: "Vercel Node + Supabase Edge / Deno",
    endpointLocation: `Vercel: ${vercel.endpointLocation} / Edge: us-central1`,
    credentialEnvKeys: [...vercel.credentialEnvKeys, "Edge: GOOGLE_CLOUD_PROJECT", "Edge: GCP_VERTEX_SA_KEY_JSON"],
    locationEnvKeys: [...vercel.locationEnvKeys, "Edge: GOOGLE_CLOUD_LOCATION"],
    problems: [...vercel.problems],
    // 두 runtime의 location 차이는 각각 지원 범위이므로 그 자체로 경고가 아니다.
    warnings: [...vercel.warnings],
  };
}
