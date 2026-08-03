import { getSupabaseTarget } from "@/lib/supabase/env";

export type AppEventEnvironment = "development" | "production";

/** 이벤트 관련 DB 컬럼/웹훅 payload에 쓰는 environment 값. 클라이언트 제출값을 신뢰하지
 *  않고 항상 서버의 실제 Supabase target에서 파생한다(fail-closed 분리 원칙). */
export function getAppEventEnvironment(): AppEventEnvironment {
  return getSupabaseTarget() === "prod" ? "production" : "development";
}
