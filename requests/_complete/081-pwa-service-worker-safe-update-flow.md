# Request: PWA 새 버전 적용 실패 팝업 오경보 제거 및 안전한 업데이트 플로우 개선

> 완료: 2026-08-08 | main `7da90d4` | Dev `dpl_6PJEorTxL78phbWrxMXJrMXV2h92` | Production `dpl_DunaAp7yK6jgZ9zHsrVrcmWn1kuJ`

## 0. 배경

Production PWA에서 아래 팝업이 반복적으로 노출되는 문제가 있다.

```text
새 버전을 적용하지 못했어요.
인터넷 연결을 확인한 뒤 다시 시도해 주세요.
```

Antigravity 읽기 전용 감사 결과, 실제 원인은 인터넷 장애가 아니라 **Service Worker 업데이트 전환 로직의 3초 고정 타임아웃과 중복 `skipWaiting()` 제어로 인한 UI 오경보**로 확인되었다.

현재 실제 흐름:

```text
새 SW 감지
→ update_available
→ 사용자가 지금 업데이트/다시 시도
→ waitingWorker.postMessage({ type: "SKIP_WAITING" })
→ activating
→ 3초 내 controllerchange 미발생
→ error
→ 실패 팝업
```

핵심 문제:

1. `controllerchange`를 3초 안에 강제 기대
2. SW install 단계에서 이미 `self.skipWaiting()` 자동 호출
3. message에서도 다시 `SKIP_WAITING`
4. waitingWorker 참조가 stale 상태가 될 수 있음
5. `sessionStorage` reload guard와 3초 타이머가 충돌 가능
6. 실제 네트워크 오류와 SW 활성화 지연을 구분하지 않고 모두 인터넷 오류 문구로 표시
7. `다시 시도`가 동일한 실패 플로우를 반복 실행

이번 작업의 목적은 **앱 사용을 막지 않으면서, 새 버전이 실제 준비됐을 때만 안전하게 반영하고, 실패 시 반복 팝업을 만들지 않는 PWA 업데이트 UX**로 변경하는 것이다.

---

## 1. 확정 정책

### 기본 원칙

```text
업데이트 실패 ≠ 앱 사용 실패
```

새 버전 적용이 지연되거나 실패해도 사용자는 현재 버전을 계속 사용할 수 있어야 한다.

업데이트 실패 때문에:

- 전체 화면 차단 금지
- 기능 사용 중단 금지
- 반복 팝업 금지
- 무한 재시도 금지

### 목표 UX

정상:

```text
새 버전 준비 완료
→ 업데이트 적용
→ 새로고침
→ 최신 버전
```

지연:

```text
새 버전 준비 중
→ 기존 버전 계속 사용
→ 백그라운드 재확인
```

오류:

```text
업데이트 적용 지연
→ 기존 버전 유지
→ 사용자가 원하면 새로고침
```

---

## 2. 수정 대상 파일

최소 대상:

```text
components/PwaServiceWorker.tsx
app/api/pwa/sw/route.ts
```

필요 시:

```text
next.config.ts
```

단, rewrite 구조가 이미 정상이라면 변경하지 않는다.

---

## 3. 현재 3초 타임아웃 제거/완화

현재 문제:

```ts
setTimeout(() => {
  setPwaState((prev) => (prev === "activating" ? "error" : prev));
}, 3000);
```

이 로직 때문에 정상적인 모바일 SW 활성화 지연도 오류 처리된다.

변경:

- 3초 고정 실패 판정 제거
- 최소 6~8초 이상으로 완화하거나
- 더 권장: 시간 경과만으로 즉시 `error` 상태로 바꾸지 않음

권장 흐름:

```text
activating
→ controllerchange 대기
→ 일정 시간 지나도 미발생
→ "지연" 상태
→ 기존 앱 유지
```

즉:

```text
timeout != hard error
```

---

## 4. `skipWaiting()` 제어 흐름 단일화

현재:

```text
install 이벤트
→ self.skipWaiting()

메인 스레드 message
→ SKIP_WAITING
→ self.skipWaiting()
```

두 군데에서 중복 실행 가능.

변경 원칙:

- `skipWaiting()` 제어 위치를 하나로 통일
- 사용자 선택 업데이트 UX를 유지하려면 install 단계 자동 `self.skipWaiting()` 제거를 우선 검토
- 사용자가 `지금 업데이트`를 눌렀을 때만 waiting worker가 `SKIP_WAITING` 처리

권장:

```text
install
→ precache
→ waiting

사용자 "지금 업데이트"
→ postMessage(SKIP_WAITING)

SW message handler
→ self.skipWaiting()

activate
→ cache cleanup
→ clients.claim()
→ controllerchange
→ reload
```

단, 현재 PWA 정책이 자동 활성화를 의도한 구조라면 사용자 버튼 자체를 제거하는 대안도 가능하다.

이번 Request에서는 **사용자 확인 버튼을 유지하는 방향을 기본안**으로 한다.

---

## 5. waitingWorker stale reference 방어

`waitingWorker`가 이미:

```text
activating
activated
redundant
```

상태라면 동일 객체에 `postMessage`만 반복하지 않는다.

`triggerUpdate()` 실행 전 실제 registration 상태를 다시 확인한다.

권장 확인:

```text
registration.waiting
registration.installing
registration.active
waitingWorker.state
```

처리:

```text
registration.waiting 존재
→ SKIP_WAITING 전송

waiting 없음 + active가 새 버전
→ reload

installing/activating
→ 전환 완료 대기

stale/redundant
→ registration.update() 후 상태 재확인
```

---

## 6. `controllerchange` 리스너와 타이머 정리

현재 activation timeout과 `controllerchange` 이벤트가 독립적으로 움직여 상태 충돌 가능.

반드시:

- timeout ID를 ref로 보관
- controllerchange 성공 시 timeout clear
- component unmount 시 clear
- update retry 시 기존 timeout clear
- 중복 controllerchange listener 방지

예:

```text
activationTimerRef
controllerChangeHandledRef
```

사용.

---

## 7. sessionStorage reload guard 수정

현재:

```text
pwa_sw_reloaded_${currentSha}
```

가 이미 true이면 controllerchange 발생 후 reload를 생략할 수 있다.

이 경우 activation timer가 남아 error로 덮어쓰는 문제가 생길 수 있다.

변경:

```text
controllerchange 발생
→ update 적용 성공으로 간주
→ timer clear
→ pwaState = idle 또는 success
```

reload guard가 true더라도:

```text
error로 전환되면 안 됨
```

reload 여부와 update 성공 판정을 분리한다.

---

## 8. "다시 시도" 버튼 동작 변경

현재:

```text
다시 시도
→ 같은 triggerUpdate()
→ 동일 stale worker
→ 동일 3초 timeout
→ 무한 반복
```

변경 권장:

### 1순위

```text
다시 시도
→ registration.update()
→ 최신 registration 상태 재확인
→ waiting worker 있으면 업데이트
→ 없으면 안전 새로고침
```

### fallback

```text
window.location.reload()
```

단순히 동일한 stale worker에 `SKIP_WAITING`을 반복하지 않는다.

---

## 9. 오류 메시지 실제 원인별 분리

현재 모든 실패:

```text
인터넷 연결을 확인한 뒤 다시 시도해 주세요.
```

로 표시.

변경:

### 실제 오프라인

조건:

```text
navigator.onLine === false
```

문구:

```text
인터넷 연결이 끊겨 있어 업데이트할 수 없어요.
연결 후 다시 시도해 주세요.
```

### SW 적용 지연

문구:

```text
새 버전 적용이 조금 늦어지고 있어요.
현재 버전은 계속 사용할 수 있습니다.
```

버튼:

```text
[나중에] [새로고침]
```

### registration.update 실패

문구:

```text
새 버전을 확인하지 못했어요.
현재 버전은 계속 사용할 수 있습니다.
```

### chunk/load 오류

실제 감지 가능한 경우:

```text
새 버전 파일을 불러오지 못했어요.
페이지를 새로고침해 주세요.
```

---

## 10. 오류 상태 UX 변경

현재:

```text
pwaState === "error"
→ alertdialog
```

변경:

오류가 발생하더라도 사용자가 앱을 계속 쓸 수 있다는 문구를 반드시 포함한다.

권장:

```text
업데이트가 지연되고 있어요.
현재 버전은 계속 사용할 수 있습니다.

[나중에] [새로고침]
```

`인터넷 연결 확인` 문구는 실제 offline인 경우에만 사용한다.

---

## 11. "나중에" 정책

현재 10분 cooldown 유지 가능.

```text
DISMISS_COOLDOWN_MS = 10분
```

단, 동일 build SHA에 대해 반복 노출을 더 줄인다.

권장:

```text
동일 SHA에서 1회 dismiss
→ 최소 10분 동안 재표시 안 함
→ visibilitychange 때 무조건 즉시 재표시하지 않음
```

가능하면 현재 세션에서 동일 SHA의 error dialog는 한 번 이상 반복 노출하지 않는다.

---

## 12. 백그라운드 재확인

사용자가 `나중에`를 누르면:

```text
현재 앱 계속 사용
```

백그라운드에서 다음 이벤트 때 조용히 update check:

```text
online
visibilitychange
앱 재진입
정해진 간격
```

단, 실패할 때마다 팝업 재표시하지 않는다.

새 waiting worker가 실제 준비됐을 때만 update_available UI 재노출.

---

## 13. 기존 버전 안전 유지

업데이트 실패 시 기존 활성 Service Worker와 캐시를 즉시 제거하지 않는다.

원칙:

```text
새 버전 activate 성공 전
→ 기존 active SW 유지
```

새 SW 활성화 성공 후:

```text
구버전 cache 정리
```

현재 activate 시 cache cleanup 구조를 유지하되, 설치 실패 때문에 기존 cache가 먼저 지워지는 흐름이 없는지 확인한다.

---

## 14. 캐시 정책 유지

현재:

```text
CACHE_NAME = kbestie-shell-${buildId}
```

구조 유지.

`/sw.js`:

```text
Cache-Control: no-cache, no-store, must-revalidate
```

유지.

불필요한 전체 cache clear 금지.

---

## 15. PWA 업데이트 상태 머신 정리

권장 상태:

```text
idle
checking
update_available
activating
delayed
offline
error
```

가능하면 `delayed`를 추가한다.

정의:

```text
idle
→ 평상시

checking
→ 새 SW 확인 중

update_available
→ waiting worker 준비 완료

activating
→ SKIP_WAITING 이후 controllerchange 대기

delayed
→ activation 지연, 기존 버전 사용 가능

offline
→ 네트워크 없음

error
→ 실제 registration/update 실패
```

단순 timeout을 error로 사용하지 않는다.

---

## 16. iOS 대응

iOS Safari / 홈 화면 PWA는 Service Worker 수명주기 지연이 빈번하다.

따라서:

- 3초 hard timeout 금지
- controllerchange 누락 가능성 고려
- reload 중심 fallback 허용
- 앱 foreground 복귀 시 update registration 재확인
- 동일 팝업 반복 금지

iPhone XS 등 구형 WebKit에서도 검증한다.

---

## 17. Android 대응

Android Chrome standalone:

- 저전력 모드
- Wi-Fi ↔ LTE 전환
- background/foreground

상태에서 activation 지연 테스트.

---

## 18. Desktop 대응

Chrome / Edge:

```text
새 버전 감지
→ 업데이트
→ controllerchange
→ reload
```

정상 흐름 유지.

---

## 19. 로그/진단

민감정보 없이 PWA 상태 전환 정도만 개발 로그로 확인 가능하게 한다.

예:

```text
[PWA] update_available
[PWA] activation_started
[PWA] controller_changed
[PWA] activation_delayed
[PWA] update_check_failed
```

Production에서는 과도한 console spam 금지.

필요하면 development-only logging.

---

## 20. 테스트 시나리오

### Case 1 정상 업데이트

```text
구버전 실행
→ 새 배포
→ update_available
→ 지금 업데이트
→ controllerchange
→ reload
→ 최신 버전
```

PASS.

### Case 2 controllerchange 5초 지연

```text
3초 초과
```

해도 error 팝업이 뜨면 실패.

기대:

```text
activating 또는 delayed
기존 앱 사용 가능
```

### Case 3 stale waitingWorker

waiting worker가 이미 activating/activated인 상태에서 다시 시도.

기대:

```text
무한 SKIP_WAITING 반복 없음
안전 reload/update check
```

### Case 4 offline

```text
navigator.onLine = false
```

실제 인터넷 안내 문구 표시.

### Case 5 나중에

```text
나중에
→ 현재 버전 계속 사용
→ 동일 SHA 10분 이내 팝업 재등장 없음
```

### Case 6 iOS foreground 복귀

```text
PWA background
→ foreground
```

SW check가 앱 사용을 방해하지 않아야 함.

### Case 7 Android network switch

Wi-Fi ↔ LTE 전환 중 update.

앱 사용 중단/무한 팝업 없음.

---

## 21. E2E / Browser 검증

최소:

```text
Desktop Chrome
Android Chrome PWA
iOS Safari/PWA
```

확인:

- 무한 팝업 0건
- 기존 버전 사용 가능
- 정상 새 버전 적용
- 동일 build reload loop 0건
- controllerchange listener 중복 0건
- stale worker 재시도 loop 0건

---

## 22. 완료 조건

- 3초 hard error 판정 제거
- skipWaiting 중복 제어 제거
- stale waitingWorker 방어
- controllerchange 성공 시 timer clear
- sessionStorage guard와 error 상태 충돌 제거
- 실제 offline과 SW activation delay 메시지 분리
- 다시 시도 무한 반복 제거
- 나중에 후 반복 팝업 방지
- 기존 앱 사용 가능
- 최신 SW 정상 적용
- iOS 검증
- Android 검증
- Desktop 검증
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production PWA 스모크 테스트 PASS

---

## 23. 완료 보고 형식

1. 기존 팝업 발생 원인
2. 3초 timeout 변경 내용
3. skipWaiting 단일화 방식
4. waitingWorker stale 방어
5. controllerchange/timer 처리
6. sessionStorage guard 수정
7. 다시 시도 동작
8. 나중에 cooldown
9. 오류 메시지 분리
10. 기존 버전 유지 방식
11. iOS 테스트
12. Android 테스트
13. Desktop 테스트
14. 수정 파일
15. TypeScript/Build
16. Dev E2E
17. Production 배포 커밋
18. Deployment ID / READY
19. Production 스모크 테스트
20. 남은 위험

---

## 24. 작업 제한

- 인터넷 장애로 확정하지 말 것
- 단순 timeout 증가만 하고 근본 stale worker 문제를 남기지 말 것
- 전체 cache 무조건 삭제 금지
- 기존 active SW를 새 SW 성공 전 강제 제거 금지
- 무한 reload loop 금지
- Production 사용자 데이터 변경 금지
- API Key/Token/Secret 출력 금지
