# 067 부모 공통 헤더 아이 시작하기 중앙 고정

## 대상 및 범위

- `components/ParentHeader.tsx`: 네 부모 주요 탭이 공유하는 헤더에 기존 아이 시작 모달을 재사용하는 CTA를 추가한다.
- `app/parent/home/components/ParentHomeHeader.tsx`: 독자 헤더 마크업을 제거하고 공통 헤더의 기존 홈 콜백을 위임한다.
- 부모 홈·리포트·케이와 대화(`/parent/guide`)·설정의 본문, 아이/알림 데이터, 인증과 DB는 수정하지 않는다.

## 구현 방식 및 위험요소

- 상대 폭과 무관하게 CTA의 중심이 헤더 콘텐츠 영역의 50%에 놓이도록 relative 헤더 안에 absolute `left-1/2 -translate-x-1/2`을 사용한다.
- 오른쪽 아이 이름은 제한 폭과 ellipsis를 유지해 긴 이름이 CTA를 밀지 않게 한다.
- 홈은 기존 `onStartChild`와 페이지 상태를 그대로 사용한다. 다른 탭은 동일한 `ChildStartGuideModal`을 공통 헤더에서 재사용한다.
- 모바일에서 좌·우 영역이 겹치지 않는지 클래스와 `min-w-0`/축소 규칙을 타입·빌드 검증으로 확인한다.
