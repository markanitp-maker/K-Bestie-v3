# 102 배포 중 청크 소실 — 발생 자체를 막는 후속 조치

## 배경

2026-08-14 20:08~20:55 KST, 실계정 아이(김지호 / jiho0520 / child_id
`f300b0aa-6c4a-4b7c-b975-e62efce7be5d`)가 자유대화·미션을 전혀 쓰지 못했다.

확정된 사실:

- 자유대화 세션 `9c9054f8-...` turn_count 0, 오늘 mission_progress 행 미생성.
- 같은 시간대 프로덕션 5xx·런타임 에러 0건. `/api/mission/v3/start` 호출 0회.
- 그 47분 사이 프로덕션 배포 3회 — 20:22 `dpl_8Pzm`, 20:33 `dpl_GfYS`,
  20:38 `dpl_9AX8`. 모두 이 장애를 고치려던 배포였다.
- `client_version_events` 기준 기기가 세션 중간에 `dpl_D2vz` → `dpl_9AX8`로
  갈아탔고, sw_version도 `kbestie-shell-local` → `kbestie-shell-2026-08-14.1`로 바뀌었다.

커밋 `ecaa486` + `d5abdc3`으로 **감지 후 자동 복구**는 넣었다. 아래는 **발생
자체를 막는** 후속이며 별도 QA가 필요해 분리했다.

## 범위

- `app/api/pwa/sw/route.ts`
- `next.config.ts`
- `docs/ops/` (배포 운영 규칙)

## 할 일

### 1. `/_next/static/`을 캐시 우선 화이트리스트에서 제거 (근본 원인)

Next 청크는 파일명이 콘텐츠 해시이고 `Cache-Control: immutable`로 나가므로
브라우저 HTTP 캐시가 이미 같은 일을 한다. 서비스워커가 이를 버전명 캐시에
캐시 우선으로 또 담으면서 "배포가 나가도 옛 청크가 남고 새 청크는 404"라는
이번 실패 양상이 만들어졌다.

`isNextStatic`을 캐시 우선 분기에서 빼고 네트워크 우선 + 캐시 폴백으로 바꾼다.
오프라인 동작과 초기 로딩 특성이 함께 바뀌므로 QA 필수:
- 기내모드에서 이미 방문한 화면 새로고침
- 첫 진입 로딩 시간 회귀 여부
- `/offline` 안내 화면 정상 노출

### 2. 클라이언트 빌드 식별자 실제 주입

`next.config.ts`의 `NEXT_PUBLIC_DEPLOYMENT_SHA`가
`process.env.VERCEL_GIT_COMMIT_SHA || "local"`인데, CLI 배포에는
`VERCEL_GIT_COMMIT_SHA`가 없어 **프로덕션 모든 클라이언트가 `"local"`로
기록됐다**. 이번 진단에서 기기별 버전 추적이 사실상 불가능했던 원인이다.
`VERCEL_DEPLOYMENT_ID` 또는 `PWA_CLIENT_VERSION`으로 폴백을 바꾼다.

### 3. 자동 복구 텔레메트리

`recoverStaleClient`가 새로고침하기 직전에 `keepalive` 비콘을 남긴다. 지금은
복구가 실제로 동작했는지 다음 장애 때 증명할 방법이 없다 — 이번 진단 자체가
서버 로그 0건 상태에서의 추론이었다.

### 4. 서비스워커 통지 커버리지

`notifyStaleAsset(event.clientId)`는 preload/prefetch·worker 컨텍스트에서
`clientId`가 빈 문자열이면 조용히 사라진다. `clientId`가 없을 때만
`matchAll({type:"window"})` 폴백을 둔다(정상 탭 오염 없이 커버리지 회복).

### 5. 배포 운영 규칙 (코드 아님, 즉시 적용)

**아이 사용 시간대(평일 16:00~21:30 KST) 프로덕션 배포 금지.** 이번 장애의
직접 원인이다. 장애 대응 중이라도 마찬가지다 — 고치려는 배포가 그 아이의
화면을 다시 깨뜨린다. 긴급 수정이 필요하면 대표 판단으로만 예외.

### 6. Vercel Skew Protection 검토 (별건, 즉시 켜지 말 것)

프로젝트 `k-bestie-v3`의 `skewProtectionMaxAge`는 현재 미설정이다. 켜면 이
장애 유형이 플랫폼 차원에서 사라지지만, 이 앱의 자체 서비스워커 버전 관리와
맞물리는 지점을 먼저 확인해야 한다 — 요청이 자기 배포로 고정되면
`/api/client-version`과 `/sw.js`도 옛 배포로 고정돼 **클라이언트가 옛 빌드에
영구히 갇힐 수 있다**. Dev에서 검증 후 결정한다.

## 완료 기준

- 1·2·4번 반영 후 Dev에서 "배포 중 사용" 시나리오 재현 QA 통과
- 5번은 `docs/ops/`에 명문화
- 6번은 Dev 검증 결과와 함께 판단 보고
