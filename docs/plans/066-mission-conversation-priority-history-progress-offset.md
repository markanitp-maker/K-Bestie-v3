# 066 미션 대화 우선순위 표시 및 진행률 위치

## 대상과 범위

- 대상: `components/MissionConversationLayout.tsx`
- 현재/지난/지지난 케이 발화의 표시 우선순위를 실제 측정 높이에 따라 결정한다.
- 별 진행률 컨테이너만 7px 하향하고, 대화 영역의 사용 가능 높이를 함께 재계산한다.

## 변경하지 않는 항목

- 미션 질문·답변·진행률 계산, 음성/자동·수동/입력 처리, 마스코트 및 하단 조작 UI, DB/API/RPC.

## 위험과 검증

- 현재 발화의 전체 높이를 우선 확보한 뒤 오래된 발화부터 React 렌더 단계에서 제외한다.
- current bubble tail과 mascot-stage 사이 20px 간격을 코드로 고정하고, iPhone 390×844 기준 좌표식을 기록한다.
- `npx tsc --noEmit` 및 개발 서버 미실행 상태에서 `npm run build`를 실행한다.

## §10 좌표 기록 (iPhone 390×844, 코드 레벨)

- 헤더 bottom: `safe-area-inset-top + 50px` (iPhone notch 47px이면 97px).
- 별 진행률: 변경 전 top `safe-area-inset-top + 54px` (101px), bottom 151px, height 50px;
  변경 후 top `safe-area-inset-top + 61px` (108px), bottom 158px, height 50px. 정확히 +7px이다.
- 대화 영역 top: 진행률 bottom + `clamp(12px, 2dvh, 20px)` (844px에서 약 175px);
  bottom은 변경하지 않은 mascot row의 top이며, height는 남은 grid row를 사용한다.
- 지지난/지난/현재 발화 top·bottom: `ResizeObserver`가 current/previous/older의 실제
  `offsetHeight`로 계산한다. 지지난·지난은 해당 높이와 10px 간격까지 남을 때만 렌더링한다.
- 현재 말풍선 tail bottom: 대화영역 bottom - 19.5px (`pb-8` 32px - tail 12.5px).
- 마스코트 top: 대화영역 bottom(기존 mascot row 시작점, 위치·크기 무변경). 따라서
  현재 tail bottom → mascot top 간격은 19.5px으로 목표 16~24px 안이다.

실기기 좌표 및 스크린샷은 동적 E2E QA에서 확인한다.
