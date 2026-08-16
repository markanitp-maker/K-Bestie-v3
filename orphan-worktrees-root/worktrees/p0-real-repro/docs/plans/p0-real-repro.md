# P0 Mission 수동 입력 회귀 실제 컴포넌트 재현 계획

## 대상 파일

- `app/child/missions/page.tsx`
- 실제 페이지 마운트용 신규 jsdom 테스트 파일 및 `package.json` 테스트 등록
- 재현 시 원인에 직접 대응하는 최소 구현 파일
- `docs/reports/p0-real-repro.md`
- `requests/_dashboard.md`

## 변경 개요

1. Chromium 없이 jsdom에서 실제 Mission 페이지를 마운트하고 외부 네트워크·미디어 훅만 mock 처리한다.
2. manual localStorage를 사전 설정해 신규/이어하기의 effect·상태 및 mic spy 호출 타임라인을 수집한다.
3. keyboard 전환과 실제 텍스트 입력을 수행해 입력 가드의 차단 상태를 실행 결과로 확정한다.
4. 재현될 때만 최소 수정하고 동일 테스트의 전후 결과를 비교한다.
5. 타입체크, 전체 테스트, 개발 서버가 없는 상태의 클린 빌드로 검증한다.

## 위험요소

- 페이지가 다수 API와 브라우저 API에 결합돼 있어 mock 경계가 넓지만, 페이지 자체는 대체하지 않는다.
- 테스트 도구가 현재 의존성에 없으면 lockfile을 포함한 테스트 전용 devDependency 추가가 필요하다.
- 상태 추적용 instrumentation은 제품 동작을 바꾸지 않도록 테스트 주입 경계로 제한한다.
