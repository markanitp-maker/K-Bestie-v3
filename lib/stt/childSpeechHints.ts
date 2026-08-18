// GCP Speech-to-Text speechContexts 힌트 — 아동 발음 특성/서비스 고유어 보정용.
// 추후 확장 가능하도록 상수로 분리. route에서 import 해서 사용.
export const CHILD_SPEECH_HINTS: string[] = ["케이", "황금열쇠", "미션"];

export const CHILD_SPEECH_HINT_BOOST = 10;

/** 끝말잇기 사전 힌트용 boost (기존 10보다 약간 높게 설정) */
export const WORD_CHAIN_HINT_BOOST = 15;

/** GCP Speech-to-Text 힌트 과다 주입 방지 상한선 (오인식 방지용) */
export const WORD_CHAIN_MAX_HINTS = 300;

/** 끝말잇기 세션 조회 타임아웃 (STT 지연 방지) */
export const WORD_CHAIN_LOOKUP_TIMEOUT_MS = 500;
