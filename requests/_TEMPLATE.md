# [여기에 작업 제목을 한 줄로 - 예: 놀이 화면에 최근 플레이 이력 배지 추가]

## 범위

작업 전 `docs/conventions.md`를 먼저 읽고 따를 것. 이 지시서가 수정을 허용하는
파일과 디렉터리를 명시적으로 나열한다 - 여기 없는 파일은 건드리지 않는다.

- 예: `app/child/play/page.tsx` 파일 1개만 수정
- 예: `lib/goldkey/` 하위 파일만 수정, `lib/mission/`은 건드리지 않음

## 요구사항

무엇을 어떻게 바꿔야 하는지 구체적으로 서술한다 - 파일:줄 번호, 기존 코드 발췌,
바뀐 후 코드 발췌를 포함하면 처리 정확도가 올라간다.

예시:
- `app/child/play/page.tsx`의 `GAMES` 배열 렌더링 부분(`GAMES.map((game) => (...))`)
  에서, 각 카드 우측 하단에 최근 플레이 시각을 작게 표시한다.
- 데이터는 이미 존재하는 `GET /api/play/session?child_id=...&play_type=...` 응답의
  `lastPlayedAt` 필드를 사용한다(새 API를 만들지 않는다).

## 완료조건

이 지시서가 "끝났다"고 판단할 수 있는 구체적 기준을 나열한다.

예시:
- `npx tsc --noEmit` 클린
- `npx next build` 성공
- `git diff --stat`로 범위에 명시한 파일만 변경됐는지 확인
- (해당하면) Dev 환경에서 실제 화면 확인

## 공유파일 수정

`docs/conventions.md`의 "공유파일목록"에 있는 파일(예: `package.json`,
`middleware.ts`, `app/child/missions/page.tsx` 등)을 이 작업이 수정해야 한다면
여기에 명시적으로 적는다 - 명시되지 않은 공유 파일은 절대 건드리지 않는다.

예시: 이 작업은 공유 파일을 수정하지 않는다.
(수정이 필요하면: "`app/child/missions/page.tsx`의 X번째 줄 근처 Y 로직만 수정
- 다른 트랙과 겹치지 않도록 이 줄 범위 밖은 건드리지 않는다.")
