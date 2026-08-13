// requests/031-mission-lock.md — v2 compatibility route와 Mission v3 단일 시간 게이트가
// 공유하는 서버 전용 Production 강제 스위치.
// 기존 MISSION_TIME_GATE_ENABLED(베타 오픈 전까지 전 환경 기본 비활성화, 시간 게이트
// 자체의 on/off)와는 별개의 플래그다. 이 플래그가 켜지면(Production에서만 설정 예정)
// 시간 게이트가 강제로 켜지면 신규 시작은 09:00~23:50 단일 창으로 제한되고, 완료한
// 미션은 round_type과 관계없이 즉시 잠금 처리된다. 꺼져 있으면(Dev 등) 신규 시작은
// 24시간 허용된다.
export function isMissionScheduleEnforced(): boolean {
  return process.env.MISSION_SCHEDULE_ENFORCED === "true";
}
