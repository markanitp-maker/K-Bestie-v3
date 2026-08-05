// 서비스 단계(BETA/PAID) 단일 서버 설정값 — 요청서 §7.2 "서비스 단계 전환은 날짜를 여러
// 화면에 하드코딩하지 않는다. 기존 운영 설정 또는 단일 서버 설정값을 사용한다"에 대응.
// 프로젝트에 기존 서비스 단계 설정 구조가 없어(스캔 결과 미확인) 최소 범위로 신설한다.
// PAID로 전환하려면 Vercel 환경변수 SERVICE_PHASE=PAID를 설정한다(대표님 조치 필요 — 코드
// 배포와 무관하게 이 값만 바꾸면 즉시 반영됨).
export type ServicePhase = "BETA" | "PAID";

export function getServicePhase(): ServicePhase {
  const raw = (process.env.SERVICE_PHASE ?? "BETA").trim().toUpperCase();
  return raw === "PAID" ? "PAID" : "BETA";
}
