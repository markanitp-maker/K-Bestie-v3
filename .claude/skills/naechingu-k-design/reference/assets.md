# Brand Asset Rules — naechingu-k-design v2.0

> 아래 경로는 2026-07-25 코드베이스를 직접 확인해 검증한 실제 경로다(초안에 있던
> "Logo.png"/"mascot.png"/"favicon.png" 같은 평면 경로 추정을 실제 값으로 교정함).

## Logo

- 파일: `/public/Images/logo/Logo.png` (웹 경로 `/Images/logo/Logo.png`)
- 사용: Website, Official Document, Header
- 금지: Stretch, Color Change, Outline

## Mascot

- 파일: `/public/Images/mascot/mascot-standing.png` (웹 경로 `/Images/mascot/mascot-standing.png`)
- 사용: Child Screen, Friendly Message, Reward
- 금지: AI 재생성, 얼굴 변경, 색상 변경

## Favicon

- 파일: `/public/icons/favicon-16.png`, `/public/icons/favicon-32.png`
- `/public/Images/logo/favicon.png`도 프로젝트에 별도로 존재한다 — 실제 `<link rel="icon">`
  참조가 어느 파일을 가리키는지 확인한 뒤 하나로 통합할 것. 임의로 둘 중 하나를
  삭제하지 않는다(이번 v2.0 작업 범위 밖 — 발견 사항으로만 기록).
- 사용: App Icon, Browser Icon
- 16px 환경: 별도 단순화 버전(`favicon-16.png`) 사용
