# Request 071 — 모바일 키보드 하단 공백 수정 계획

## 범위

- `hooks/useKeyboardConversationViewport.ts`: 기존 Visual Viewport 측정 계약 유지
- `components/MissionConversationLayout.tsx`: 키보드 열린 동안 실측 높이 적용, safe-area 중복 제거
- `app/child/missions/page.tsx`: PC DemoFrame용 `height: 100% !important`가 키보드 실측 높이를 덮지 않게 예외 처리
- `app/chat/page.tsx`: 자유대화 실측 높이·텍스트 입력 하단 padding 적용
- `app/demo/components/DemoFrame.tsx`: 자유대화가 넘긴 모바일 키보드 높이에서 부모 스크롤 중첩 차단
- 관련 Mission/DemoFrame/Free Chat 회귀 테스트

## 실행 단위

1. Mission viewport와 safe-area 처리 — Visual Viewport 높이를 두 대화 컨테이너에 적용하고 키보드가 열렸을 때만 하단 safe-area를 제외한다.
2. Free Chat/DemoFrame 처리 — 모바일 부모 `overflow-y-auto`와 내부 `100dvh` 중첩을 키보드 열린 동안만 제거한다.
3. 회귀 테스트 — 키보드 열림/닫힘 높이·overflow·padding 계약과 기존 UI 요소 보존을 고정한다.
4. 게이트와 배포 — 관련 테스트, typecheck, build, 정적 검토 후 Dev에서 실측한다. 실제 iOS/Android 단말 확인 전 Production은 배포하지 않는다.

## 위험과 제한

- UA 분기, 고정 기기별 px, transform/negative margin, 전역 viewport metadata는 사용하지 않는다.
- PC DemoFrame과 키보드 닫힌 음성 UI는 기존 높이·스크롤·safe-area 계약을 유지한다.
- 실제 OS 키보드는 데스크톱 에뮬레이션으로 확증할 수 없으므로 Dev 배포 후 Owner 실기기 매트릭스를 완료 조건으로 둔다.
