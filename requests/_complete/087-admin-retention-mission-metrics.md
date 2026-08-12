# 087 관리자 리텐션 미션 지표 분리

## 상태

- 작업중

## 요구사항

- 기존 `missionCount` 의미는 유지하고 UI 명칭을 `미션 시도`로 변경한다.
- 선택 기간 내 `mission_progress.status='COMPLETED'`만 집계한 `completedMissionCount`를 추가한다.
- `child_mission_onboarding_events.mission_completed_count`를 기간 필터와 무관한 `N/60` 30일 이벤트 값으로 표시한다.
- 최소 `미션 시도 | 미션 완료 | 30일 이벤트`를 한눈에 구분한다.
- 기존 기간 필터·자유대화·놀이·D1/D3/D7·기존 API 소비처를 회귀시키지 않는다.
- Development 검증 후 Production 배포와 읽기 전용 스모크를 수행한다.
