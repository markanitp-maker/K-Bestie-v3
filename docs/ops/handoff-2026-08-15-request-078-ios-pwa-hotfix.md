# Request 078 iOS PWA 업데이트 실패 핫픽스 인수인계

작성 시각: 2026-08-15 14:38 KST  
수신: Claude Code  
상태: **게이트② agy 실제 Dev 브라우저 QA 중 사용자 요청으로 중단 — Production 미배포**

## 1. 사용자 증상과 확정 원인

Production iPhone PWA에서 다음 중앙 모달이 노출됐다.

- `새 버전을 확인하지 못했어요`
- `현재 버전은 계속 사용할 수 있습니다.`
- `다시 업데이트`

서버에는 실제 신규 078 배포가 있었고 `/api/client-version`, `/sw.js`, document deployment marker와 precache 11개 자산은 모두 정상·동일 deployment였다. 서버 오류가 아니라 iOS/WebKit의 비동기 Service Worker lifecycle을 클라이언트가 너무 빨리 실패로 판정한 것이 원인이다.

확정된 race:

1. reload 직후 `navigator.serviceWorker.controller`가 잠시 `null`일 수 있음.
2. installed 이후 `registration.waiting` 할당이 늦을 수 있음.
3. waiting/controller identity MessageChannel 응답이 WebKit에서 늦거나 source URL이 empty/null일 수 있음.

## 2. 구현·검증 완료 상태

핫픽스 커밋: `5cadd2a` (`[수정] iPhone PWA 업데이트 검증 지연 허용`)  
기준 커밋: `378d96d`  
핫픽스 worktree: `E:/VibeCoding/K-Bestie-v3/.codex-worktrees/078-qa-3302fb3`  
배포 전용 clean worktree: `E:/VibeCoding/K-Bestie-v3/.codex-worktrees/078-deploy-5cadd2a`

변경 파일 8개:

- `app/api/pwa/sw/route.test.ts`
- `components/PwaServiceWorker.test.tsx`
- `components/PwaServiceWorker.tsx`
- `lib/pwa/renderServiceWorker.ts`
- `lib/pwa/swProtocol.test.ts`
- `lib/pwa/swProtocol.ts`
- `lib/pwa/updateFlow.test.ts`
- `lib/pwa/updateFlow.ts`

주요 변경:

- controller/identity와 delayed waiting worker를 bounded wait로 재검증.
- 정확한 worker object/identity/nonce가 유지될 때만 activation.
- unmount/AbortSignal 시 in-flight identity timer·MessagePort 즉시 정리, legacy v0 fallback 차단.
- empty/null source URL은 transferred MessagePort identity 응답에만 제한적으로 허용.
- cross-origin/null activation 및 ACK/NACK vote는 consensus에 영향 0.

정적·자동 검증:

- 집중 테스트: 44/44 PASS
- 전체 `npm run test:pwa-update`: 203/203 PASS
- TypeScript `tsc --noEmit`: 0 errors
- `git diff --check`: PASS
- Vercel clean build: PASS
- 독립 Codex 정적 리뷰: **통과 — 위반 없음**

## 3. Dev 배포 상태

Dev 프로젝트: `k-bestie-v3-dev` (`prj_I9nJJTE0EwJut9M4uHLDaJntXGW0`)  
Dev deployment: `dpl_7kUFKNSgN4pPFZVN7oLCZZEq8tAt`  
배포 URL: `https://k-bestie-v3-rd7p5aklu-markanitp.vercel.app`  
Dev alias: `https://k-bestie-v3-dev.vercel.app`  
상태: READY

첫 Windows 배포는 QA worktree의 `node_modules` reparse point를 Vercel CLI가 `lstat`하다 EACCES로 업로드 전 실패했다. 제품 실패가 아니다. 동일 커밋의 dependency 없는 clean deploy worktree에서 재배포해 정상 완료했다.

## 4. 중단된 항목

fresh agy가 실제 Dev Playwright 6개 시나리오를 실행 중이었으나, 사용자가 토큰 절약을 위해 인수인계 후 중단을 지시해 프로세스를 종료했다. agy는 최종 PASS/FAIL을 반환하지 않았다. 따라서 **게이트②는 미완료이며 Request 078 완료/Production 배포 완료로 판정하면 안 된다.**

중단 전 agy 출력:

- Dev alias 대상 실행 시작
- 공식 QA 계정 탐색 후 `qatesti-dev` 사용 보고
- 실제 Playwright 6개 시나리오 실행 중
- 최종 결과 없음

## 5. 다음 세션 필수 순서

1. `requests/_dashboard.md`를 `작업중 — Claude Code 인수 후 fresh agy Dev QA 재개`로 먼저 갱신.
2. 코드 변경 없이 fresh agy로 `qa-078-pwa-safe-update.spec.ts` 실제 Dev 6개 시나리오를 처음부터 재실행.
3. 반드시 확인:
   - iOS/WebKit controller initial-null 뒤 정상 identity 정착.
   - delayed waiting assignment 뒤 정확한 worker activation.
   - identity 대기 중 unmount 시 marker/telemetry/UI 변경 0, legacy fallback 0.
   - worker 교체/redundant 시 stale activation 0.
   - cross-origin/null activation 및 vote 영향 0.
   - 안전 화면에서 target worker 1회 적용, 의도된 reload 최대 1회, 업데이트 모달 해소.
4. Dev E2E 전부 PASS할 때만 `5cadd2a`를 현재 main 위에 안전 통합한다. 현재 커밋은 detached worktree에 있으므로 무조건 main을 덮지 말고 main 최신 상태와 파일 충돌을 먼저 확인한다.
5. origin/main push 후 Production 전용 clean worktree와 정확한 Production project ID `prj_7uTHei8ux61x9wYi9PTWhgqGPRaz`를 확인한다.
6. 사용자의 기존 Production 승인 범위는 Request 078 Dev QA 통과 후 배포까지였지만, QA 결과가 없으므로 현 시점 Production 배포 금지.
7. Production 배포 후 `/api/client-version`, `/sw.js`, document marker 3중 일치 및 iPhone PWA 실제 업데이트 1회를 smoke 검증한다.

## 6. 주의 사항

- Production DB, migration, env, 고객 데이터 변경은 이 핫픽스와 무관하며 실행하지 않았다.
- 현재 루트 worktree에는 다른 세션 변경이 많다. 루트에서 `vercel --prod` 금지. 반드시 clean worktree를 사용한다.
- `.vercel/project.json`은 worktree별로 확인한다. Dev/Production 프로젝트를 혼동하지 않는다.
- 실패 모달을 숨기는 방식으로 해결하면 안 된다. exact controller/worker identity 검증은 유지해야 한다.
- 사용자가 제공한 화면은 캐시만의 문제가 아니라 실제 update verification race 증거다.

## 7. 최종 상태

- 코드 구현: 완료
- 자동 테스트/타입/빌드: 완료
- 게이트① 독립 정적 리뷰: 통과
- Dev 배포: 완료
- 게이트② 실제 Dev 브라우저 QA: **중단/미완료**
- origin/main push: 미수행
- Production 배포: **미수행**
