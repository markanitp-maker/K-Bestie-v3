// 성장정보 API 응답 형태. 서버 라우트와 부모 화면이 함께 쓰는 client-safe 타입 모듈이다.
// (lib/growth/service.ts 는 서버 전용 supabase 클라이언트를 import 하므로 화면에서 직접 쓰지 않는다.)

import type { GrowthSex, GrowthSummary } from "./index";

export interface GrowthProfileView {
  birthDate: string;
  consentVersion: string;
  consentAt: string;
}

export interface GrowthStateResponse {
  /** 성장정보 최초 설정이 끝났는지. false 면 부모에게 설정 플로우를 띄운다. */
  configured: boolean;
  profile: GrowthProfileView | null;
  /** child_profiles.gender — 성별 Source of Truth. null 이면 최초 설정에서 함께 받는다. */
  gender: GrowthSex | null;
  childName: string | null;
  summary: GrowthSummary | null;
}
