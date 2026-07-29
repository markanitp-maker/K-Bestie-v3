// requests/031-mission-lock.md — Production 전용 미션 시간제·완료잠금 스위치.
// 기존 MISSION_TIME_GATE_ENABLED(베타 오픈 전까지 전 환경 기본 비활성화, 시간 게이트
// 자체의 on/off)와는 별개의 플래그다. 이 플래그가 켜지면(Production에서만 설정 예정)
// 시간 게이트가 강제로 켜지고, 경계값도 미션-I 12~17시/미션-II 19~23시(미만)로
// 바뀌며, 완료한 라운드는 재도전 확인 없이 즉시 잠금 처리된다. 꺼져 있으면(Dev 등)
// 기존 동작(MISSION_TIME_GATE_ENABLED 및 13~17시/19~23시 포함 경계)이 그대로 유지된다.
export function isMissionScheduleEnforced(): boolean {
  return process.env.MISSION_SCHEDULE_ENFORCED === "true";
}
