/**
 * GCAI (Google Cloud AI) A/B 프로필 게이트웨이
 * 중앙에서 GCP 연결 환경변수를 관리하여 런타임에 동적 스위칭을 지원합니다.
 */

export type GcaiProfile = 'A' | 'B';

export interface GcaiEnvKeys {
  GOOGLE_CLOUD_PROJECT: string;
  GOOGLE_CLOUD_LOCATION: string;
  GCP_VERTEX_SA_KEY_JSON: string;
  VERTEX_LIVE_RELAY_URL: string;
  VERTEX_LIVE_RELAY_SECRET: string;
  GCP_STT_API_KEY: string;
  GCP_TTS_API_KEY: string;
}

/**
 * GCAI_ACTIVE_PROFILE 환경변수를 읽어 현재 활성화된 프로필을 반환합니다.
 * 미설정 시 하위호환을 위해 기본값 'A'로 안전하게 동작합니다.
 */
export function getActiveGcaiProfile(): GcaiProfile {
  const profile = process.env.GCAI_ACTIVE_PROFILE || 'A';
  if (profile !== 'A' && profile !== 'B') {
    throw new Error(`Invalid GCAI_ACTIVE_PROFILE: ${profile}. Must be 'A' or 'B'.`);
  }
  return profile as GcaiProfile;
}

/**
 * 활성 프로필(A/B)에 대응하는 환경변수 키 이름 매핑을 반환합니다.
 * 프로필 A는 기존 환경변수 이름을 그대로 사용하고, 프로필 B는 GCAI_B_ 접두사가 붙은 이름을 사용합니다.
 */
export function getGcaiEnvKeys(profile: GcaiProfile): GcaiEnvKeys {
  if (profile === 'A') {
    return {
      GOOGLE_CLOUD_PROJECT: 'GOOGLE_CLOUD_PROJECT',
      GOOGLE_CLOUD_LOCATION: 'GOOGLE_CLOUD_LOCATION',
      GCP_VERTEX_SA_KEY_JSON: 'GCP_VERTEX_SA_KEY_JSON',
      VERTEX_LIVE_RELAY_URL: 'VERTEX_LIVE_RELAY_URL',
      VERTEX_LIVE_RELAY_SECRET: 'VERTEX_LIVE_RELAY_SECRET',
      GCP_STT_API_KEY: 'GCP_STT_API_KEY',
      GCP_TTS_API_KEY: 'GCP_TTS_API_KEY',
    };
  } else {
    return {
      GOOGLE_CLOUD_PROJECT: 'GCAI_B_GOOGLE_CLOUD_PROJECT',
      GOOGLE_CLOUD_LOCATION: 'GCAI_B_GOOGLE_CLOUD_LOCATION',
      GCP_VERTEX_SA_KEY_JSON: 'GCAI_B_VERTEX_SA_KEY_JSON',
      VERTEX_LIVE_RELAY_URL: 'GCAI_B_VERTEX_LIVE_RELAY_URL',
      VERTEX_LIVE_RELAY_SECRET: 'GCAI_B_VERTEX_LIVE_RELAY_SECRET',
      GCP_STT_API_KEY: 'GCAI_B_STT_API_KEY',
      GCP_TTS_API_KEY: 'GCAI_B_TTS_API_KEY',
    };
  }
}
