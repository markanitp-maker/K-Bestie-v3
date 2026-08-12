# 040 — PWA 새 버전 감지·업데이트 안내·안전한 새로고침 복구

## 1. 작업 목적

동일한 개발 서버에 새 프런트엔드 버전을 배포했는데도 설치형 PWA에서 다음 문제가 발생하고 있다.

- PC 설치형 PWA가 이전 JS·CSS와 화면 구조를 계속 표시함
- 모바일 브라우저와 PC PWA가 서로 다른 UI를 표시함
- 새 버전이 배포되어도 업데이트 안내가 나타나지 않음
- 사용자가 직접 PWA를 제거하거나 사이트 데이터를 삭제해야 최신 화면이 적용됨
- Service Worker와 Cache Storage에 이전 빌드가 장기간 남을 가능성이 있음

새로운 사용자 화면 버전이 배포되면 설치형 PWA가 이를 감지하여 다음 안내를 표시하도록 수정한다.

```text
새로운 버전이 준비됐어요.
최신 버전으로 다시 시작해 주세요.

[나중에] [새로고침]
```

사용자가 `새로고침`을 누르면 새 Service Worker를 활성화하고 화면을 정확히 한 번만 다시 불러와 최신 JS·CSS를 적용해야 한다.

---

## 2. 핵심 정책

### 업데이트 안내 대상

다음 조건을 모두 만족할 때 업데이트 안내를 표시한다.

1. 현재 페이지를 제어하는 기존 Service Worker가 존재함
2. 서버에서 새로운 Service Worker 또는 새로운 프런트엔드 Build가 발견됨
3. 새 버전이 설치되어 활성화를 기다리거나, 현재 앱 Build ID와 서버 Build ID가 다름
4. 최초 PWA 설치가 아니라 기존 설치본의 업데이트임

### 업데이트 안내 제외 대상

다음에는 업데이트 안내를 표시하지 않는다.

- 최초 Service Worker 설치
- PWA 최초 설치 직후
- API 응답이나 DB 데이터만 변경된 경우
- 사용자 화면 번들이 변경되지 않은 서버 전용 배포
- 현재 클라이언트와 서버의 Build ID가 동일한 경우
- 동일 업데이트를 이미 적용한 직후
- 새로고침 중이거나 `controllerchange` 처리 중인 경우

### 배포 기준

모든 배포 횟수 자체를 기준으로 하지 않는다.

다음 중 하나가 변경된 클라이언트 Build에서 새 버전으로 판단한다.

- JavaScript Bundle
- CSS Bundle
- App Shell
- PWA Manifest
- 정적 UI Asset
- Service Worker Precache Manifest
- 클라이언트 Route 또는 화면 컴포넌트

프런트엔드 Build ID가 바뀐 배포는 설치형 PWA에서 업데이트 감지 대상이어야 한다.

---

## 3. 정상 업데이트 흐름

최종 동작은 다음과 같아야 한다.

```text
새 프런트엔드 버전 배포
→ 기존 PWA가 업데이트 확인
→ 새 Service Worker 또는 새 Build 발견
→ 새 Worker 설치
→ 기존 화면을 즉시 강제 종료하지 않음
→ 전역 업데이트 안내 표시
→ 사용자가 새로고침 선택
→ waiting Worker에 활성화 요청
→ controllerchange 확인
→ 화면 정확히 1회 새로고침
→ 최신 JS·CSS 적용
→ 업데이트 안내 제거
```

---

## 4. 선행 감사

코드 수정 전에 현재 프로젝트의 실제 PWA 구조를 감사한다.

확인 대상:

1. Service Worker 등록 파일과 등록 위치
2. `next-pwa`, Workbox, Serwist 또는 자체 Service Worker 중 실제 사용 방식
3. 생성된 Service Worker 파일 경로
4. Precache Manifest 생성 방식
5. `skipWaiting` 설정
6. `clientsClaim` 설정
7. Service Worker Cache Name
8. Runtime Cache 정책
9. `updatefound` 처리 여부
10. `registration.waiting` 처리 여부
11. Workbox `waiting` 이벤트 처리 여부
12. `controllerchange` 처리 여부
13. `registration.update()` 호출 여부
14. 기존 업데이트 Toast 또는 Modal 컴포넌트 존재 여부
15. Service Worker 등록이 특정 화면에서만 이루어지는지 여부
16. 개발·Preview·Production 환경별 PWA 설정 차이
17. 현재 Build ID 또는 Commit SHA 노출 방식
18. 기존 미션·자유대화 진행 상태를 전역에서 확인하는 방법
19. 설치형 PWA와 일반 브라우저의 캐시 정책 차이
20. 현재 미커밋 변경

구현 방식을 추정하여 Service Worker를 중복 등록하지 않는다.

기존 PWA 라이브러리가 제공하는 업데이트 API가 있으면 우선 재사용한다.

---

## 5. 전역 업데이트 관리자

업데이트 감지와 UI는 특정 페이지가 아니라 앱 최상위에서 관리한다.

권장 위치:

- Root Layout
- App Provider
- 전역 PWA Provider
- 전체 아이·부모 화면을 감싸는 공통 Client Provider

업데이트 안내는 다음 화면에서도 정상적으로 표시될 수 있어야 한다.

- 로그인
- 아이 홈
- 미션 대화
- 자유대화
- 케이와 놀이
- 부모 홈
- 일간 리포트
- 주간 리포트
- 부모와 케이 대화
- 설정
- 관리자 화면

아이 홈 컴포넌트에만 업데이트 코드를 넣지 않는다.

---

## 6. 권장 상태 구조

실제 프로젝트 구조를 우선하되 최소한 다음 상태를 구분한다.

```text
idle
checking
update_available
deferred_during_session
activating
reloading
up_to_date
error
```

권장 파생 상태:

```text
hasExistingController
hasWaitingWorker
isFirstInstall
isUpdateAvailable
isCriticalSessionActive
isApplyingUpdate
hasReloadedForCurrentVersion
```

UI와 Service Worker 처리가 서로 다른 Boolean으로 분산되어 불일치하지 않도록 전역 Provider를 단일 Source of Truth로 사용한다.

---

## 7. 업데이트 확인 시점

다음 시점에 `registration.update()` 또는 현재 PWA 라이브러리의 동등한 업데이트 확인 기능을 실행한다.

### 필수 확인 시점

- 앱 최초 실행
- 설치형 PWA 실행
- 페이지가 다시 `visible` 상태가 됐을 때
- 브라우저 또는 PWA가 Background에서 Foreground로 복귀했을 때
- `online` 이벤트로 네트워크가 복구됐을 때
- 마지막 업데이트 확인 후 일정 시간이 지난 상태에서 앱을 다시 사용할 때

### 중복 검사 방지

- 동일 이벤트에서 여러 번 호출하지 않음
- 짧은 시간 안에 반복되는 `visibilitychange`를 debounce 또는 throttle 처리
- 업데이트 확인 진행 중에는 중복 호출하지 않음
- 과도한 주기 Polling 금지

권장 최소 간격은 현재 운영 정책에 맞추되, 앱 실행 및 Foreground 복귀 시에는 최신 버전을 빠르게 확인할 수 있어야 한다.

---

## 8. 최초 설치와 업데이트 구분

최초 Service Worker 설치에는 업데이트 안내를 표시하지 않는다.

구분 기준:

- `navigator.serviceWorker.controller` 존재 여부
- 기존 활성 Worker 존재 여부
- 등록 객체의 active/waiting/installing 상태
- 현재 PWA 라이브러리에서 제공하는 `isUpdate` 또는 동등 정보

### 최초 설치

```text
기존 Controller 없음
→ Service Worker 최초 설치
→ 업데이트 안내 표시하지 않음
```

### 실제 업데이트

```text
기존 Controller 있음
→ 새로운 Worker 설치
→ waiting 상태
→ 업데이트 안내 표시
```

최초 방문 시 “새로운 버전이 준비됐어요”가 잘못 나타나지 않게 한다.

---

## 9. 업데이트 발견 처리

다음 상황을 모두 지원한다.

### 앱 실행 중 새 Worker 발견

- `updatefound`
- Workbox `waiting`
- 새 Worker의 `statechange`
- `installed` 이후 기존 Controller 존재 확인

### 앱 실행 전에 이미 Waiting Worker 존재

앱이 시작될 때 `registration.waiting`이 이미 존재하면 이벤트 발생만 기다리지 말고 즉시 업데이트 가능 상태로 처리한다.

즉, 다음 두 경우 모두 안내가 떠야 한다.

```text
앱 사용 중 새 업데이트 발견
```

```text
앱을 다시 열었을 때 이미 새 Worker가 waiting 상태
```

---

## 10. 업데이트 안내 UI

### 기본 문구

제목:

```text
새로운 버전이 준비됐어요
```

설명:

```text
최신 기능과 화면을 사용하려면 새로고침해 주세요.
```

버튼:

```text
나중에
새로고침
```

### 디자인

- 앱 전역에서 보이는 Modal, Bottom Sheet 또는 상단 Banner
- K-Navy 제목
- K-Orange `새로고침` 버튼
- `나중에`는 보조 버튼
- 모바일 safe-area 반영
- 현재 화면의 주요 CTA와 겹치지 않음
- 문의 버튼과 겹치지 않음
- 부모 하단 Navigation과 겹치지 않음
- 설치 안내 Banner와 동시에 겹쳐 나타나지 않도록 우선순위 조정

### 접근성

- `role="dialog"` 또는 적절한 alert dialog
- 제목과 설명 연결
- 키보드 Focus 이동
- Screen Reader에서 한 번만 알림
- 버튼 터치 영역 최소 44×44px
- `새로고침` 처리 중 `aria-busy`
- 중복 클릭 방지

---

## 11. `나중에` 동작

일반 화면에서 사용자가 `나중에`를 누르면 현재 화면을 유지한다.

단 다음을 지킨다.

- 업데이트 가능 상태 자체를 삭제하지 않음
- 동일 앱 실행 세션에서 일정 시간 후 다시 안내 가능
- 앱을 다시 실행하거나 Foreground로 복귀했을 때 재안내 가능
- 새 Worker를 제거하지 않음
- 새 버전을 적용한 것처럼 Build ID를 갱신하지 않음
- `나중에`가 영구 업데이트 거부가 되지 않게 함

재안내 간격은 기존 Toast 또는 Modal 정책과 일관되게 적용한다.

---

## 12. `새로고침` 동작

사용자가 `새로고침`을 선택하면 다음 순서로 처리한다.

1. 버튼 중복 클릭 차단
2. 상태를 `activating`으로 변경
3. Waiting Worker 존재 여부 재확인
4. Waiting Worker에 `SKIP_WAITING` 메시지 전송
5. `controllerchange` 이벤트 대기
6. 새로운 Controller가 적용됐는지 확인
7. 정확히 한 번만 `window.location.reload()` 실행
8. 새 페이지에서 최신 Build ID 확인
9. 업데이트 UI 제거

권장 메시지:

```text
SKIP_WAITING
```

기존 Service Worker가 다른 메시지 규격을 사용하면 해당 규격을 재사용한다.

---

## 13. Service Worker 메시지 처리

Service Worker는 클라이언트에서 다음 메시지를 받으면 새 Worker 활성화를 진행할 수 있어야 한다.

예시:

```javascript
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
```

실제 PWA 라이브러리가 이를 자동 지원한다면 중복 메시지 핸들러를 만들지 않는다.

`skipWaiting`은 사용자가 업데이트를 승인한 시점에 실행하는 것을 기본으로 한다.

---

## 14. `controllerchange` 1회 처리

`controllerchange`가 여러 번 발생하거나 Effect가 재등록되어 무한 새로고침되지 않도록 한다.

필수 방어:

- `hasReloaded` 또는 동등한 메모리 플래그
- 필요하면 `sessionStorage`에 현재 적용 중 Build ID 저장
- 동일 Worker 활성화 과정에서 Reload 1회만 허용
- `controllerchange` Listener Cleanup
- React Strict Mode의 Effect 중복 실행 고려
- 여러 탭에서 동시에 업데이트 적용될 때 중복 Reload 방지

다음 상태가 발생하면 안 된다.

```text
controllerchange
→ reload
→ controllerchange
→ reload
→ 무한 반복
```

---

## 15. Waiting Worker가 없는 예외

업데이트 UI가 열려 있는 동안 Worker 상태가 바뀌어 `registration.waiting`이 사라질 수 있다.

이 경우:

1. 현재 active Worker와 Build ID 재확인
2. 새 Worker가 이미 활성화됐다면 안전한 1회 Reload
3. 업데이트가 취소 또는 실패했다면 재확인 안내
4. 무조건 Reload하거나 Service Worker를 새로 중복 등록하지 않음

오류 문구:

```text
새 버전을 적용하지 못했어요.
잠시 후 다시 시도해 주세요.
```

---

## 16. 미션·자유대화 진행 중 정책

내친구 케이는 상태가 있는 음성 대화를 제공하므로 새 버전 발견 즉시 강제 Reload하지 않는다.

### 중요 세션

다음 상태를 중요 세션으로 취급한다.

- 미션 active
- 미션 답변 처리 중
- 미션 완료 및 보상 처리 중
- 자유대화 active
- Gemini Live 연결 중
- 아이 음성 입력 중
- 케이 음성 출력 중
- 텍스트 답변 작성 중
- 놀이 handoff 또는 결과 저장 중

### 안내 문구

```text
새로운 버전이 준비됐어요.
현재 대화를 마친 뒤 업데이트할게요.
```

### 동작

- 새 Worker 존재는 전역 상태에 저장
- 진행 중 세션을 강제로 끊지 않음
- 즉시 `skipWaiting` 실행하지 않음
- 즉시 Reload하지 않음
- 현재 답변과 세션 상태 저장
- 미션 또는 대화 종료 후 업데이트 안내 표시
- 사용자가 명시적으로 종료한 뒤 적용
- 미션 보상 Transaction 중에는 적용 금지

---

## 17. 세션 종료 후 업데이트

중요 세션 중 업데이트를 미뤘다면 다음 시점에 다시 안내한다.

- 미션 화면 정상 종료
- 미션 중단 저장 완료
- 황금열쇠 보상 처리 완료
- 자유대화 종료
- 음성 세션 연결 해제 완료
- 놀이 완료·환불 Callback 완료
- 아이 홈 또는 부모 홈으로 복귀

다음 순서로 처리한다.

```text
세션 안전 저장 완료
→ 음성·입력 연결 종료
→ Deferred Update 확인
→ 업데이트 안내 표시
→ 사용자 승인
→ Worker 활성화
→ 1회 Reload
```

세션 저장 완료 전에 업데이트를 적용하지 않는다.

---

## 18. 중요한 보안·데이터 보호 기준

업데이트 적용 과정에서 다음 데이터가 손실되지 않아야 한다.

- 미션 유효 답변
- 현재 진행률
- 현재 질문
- 미션 이어하기 상태
- 자유대화 저장 결과
- 황금열쇠 보상 Transaction
- 놀이 차감·환불 상태
- 부모 입력 중인 문의 내용
- 자녀 프로필 수정 중인 내용

중요한 저장 요청이 진행 중일 때는 업데이트 적용을 잠시 차단한다.

---

## 19. Build ID 도입 및 비교

현재 앱 Bundle과 배포 서버의 버전을 명확히 비교할 수 있도록 Build ID를 제공한다.

권장 후보:

- Git Commit SHA
- Vercel Deployment ID
- CI Build Number
- 생성 시각을 포함한 고유 Build ID

동일 Build의 앱과 Service Worker가 동일한 Build ID를 사용해야 한다.

예시:

```text
NEXT_PUBLIC_BUILD_ID
SERVICE_WORKER_BUILD_ID
```

또는 현재 빌드 시스템에서 안전하게 주입할 수 있는 기존 변수를 사용한다.

### 금지

- 브라우저에서 매 실행마다 무작위 버전 생성
- 사용자별로 다른 Build ID 생성
- Date.now()를 런타임마다 호출해 항상 새 버전처럼 판단
- Secret 값을 클라이언트에 노출

---

## 20. Build Version 진단 정보

문제 해결과 QA를 위해 다음 정보를 확인할 수 있는 임시 진단 기능을 추가한다.

```text
App Build ID
Service Worker Active Version
Service Worker Waiting Version
Service Worker State
Cache Name
display-mode
window.innerWidth
visualViewport.width
devicePixelRatio
```

진단 정보는 다음 중 프로젝트에 맞는 안전한 방식으로 제공한다.

- 관리자 또는 개발 모드 진단 패널
- 개발자 Console의 단일 구조화 로그
- URL 개발 플래그가 있을 때만 노출

일반 사용자 화면에 Git SHA 전체를 상시 노출하지 않는다.

민감한 환경변수나 토큰을 출력하지 않는다.

---

## 21. Cache 이름과 버전 정책

이전 빌드 Cache가 새 배포 뒤에도 계속 JS·CSS를 제공하지 않도록 Cache 이름에 버전 또는 Build ID를 반영한다.

예시 개념:

```text
k-bestie-precache-{buildId}
k-bestie-runtime-{cacheVersion}
```

실제 라이브러리의 Cache Naming 정책을 우선한다.

새 Worker 활성화 시 다음을 처리한다.

- 현재 Build에서 사용하지 않는 이전 Precache 정리
- 사용 중인 Cache 무작위 전체 삭제 금지
- 다른 Origin 또는 다른 프로젝트 Cache 삭제 금지
- Runtime Cache와 Precache의 역할 구분
- 오프라인 필수 자산 보존

---

## 22. JS·CSS 캐시 정책

버전이 변경된 정적 자산은 파일 해시 기반으로 교체되어야 한다.

다음 문제가 발생하지 않도록 한다.

- 새로운 HTML이 이전 JS Bundle을 참조
- 이전 HTML이 새로운 Chunk를 참조
- CSS만 이전 버전으로 남음
- Service Worker가 Navigation 응답을 장기간 Cache First로 고정
- 삭제된 Chunk를 계속 요청
- 여러 배포의 App Shell이 혼합됨

Navigation과 App Shell 전략은 현재 Next.js/PWA 구조를 확인해 안전하게 설정한다.

---

## 23. 개발 환경 정책

개발 환경에서 PWA를 실제로 설치해 검증하는 현재 운영 방식을 지원해야 한다.

### 요구사항

- 개발용 Service Worker Cache가 운영 Cache와 분리됨
- Dev Build 변경 시 이전 Dev Cache가 새 UI를 계속 제공하지 않음
- 동일 개발 도메인의 새 Build를 감지할 수 있음
- 개발 중 HMR과 설치형 PWA 테스트 정책이 충돌하지 않음
- 일반 Local Development에서 Service Worker를 비활성화하는 기존 정책이 있다면 Preview/Dev 배포 환경과 구분
- 개발용 PWA를 삭제해야만 업데이트되는 구조 금지

### 권장 구분

```text
local development
dev deployment
preview deployment
production
```

각 환경의 Service Worker 등록·Cache 이름·업데이트 UI 정책을 명확하게 분리한다.

---

## 24. Production 정책

Production에서는 다음을 보장한다.

- 오프라인 또는 재방문 성능 정책 유지
- 새 버전 감지 가능
- 사용자 승인 후 안전한 업데이트
- 중요 세션 중 강제 Reload 금지
- 이전 Cache 정리
- 업데이트 실패 시 기존 활성 앱 사용 가능
- 새 Worker 활성화 실패가 앱 전체 장애로 확산되지 않음

Production 오프라인 정책을 수정하기 전에 현재 캐시 대상과 영향도를 확인한다.

---

## 25. 여러 탭과 여러 창

브라우저 탭과 설치형 PWA 창이 동시에 열려 있을 수 있다.

다음 상황을 처리한다.

- 브라우저 탭에서 업데이트 적용
- PC PWA 창에서 업데이트 대기
- 다른 탭에서 새 Worker 활성화
- 여러 창에서 동시에 새로고침 클릭
- 한 창은 미션 진행 중이고 다른 창은 일반 화면

가능하면 `BroadcastChannel`, Service Worker Message 또는 기존 전역 동기화 방식을 사용해 새 버전 적용 상태를 공유한다.

중요 세션이 있는 창을 다른 창이 강제로 Reload하지 않도록 한다.

---

## 26. 설치형 PWA와 일반 브라우저 일관성

같은 서버와 Build ID를 사용하는 다음 환경에서 최신 UI가 일치해야 한다.

- 모바일 Safari 또는 Chrome
- Android 설치형 PWA
- iOS 홈 화면 추가 앱
- Windows 설치형 PWA
- 일반 PC 브라우저
- PWA Standalone Window

업데이트 적용 후 기기별 반응형 차이는 있을 수 있지만, 서로 다른 버전의 컴포넌트와 CSS가 표시되면 안 된다.

---

## 27. 업데이트 안내 우선순위

동시에 여러 전역 UI가 표시되지 않도록 우선순위를 정의한다.

권장 우선순위:

1. 인증·보안 오류
2. 미션 또는 결제·보상 중요 처리
3. PWA 새 버전 업데이트
4. PWA 설치 안내
5. 일반 Toast
6. 문의 버튼 TIP

중요 세션 중에는 업데이트 UI를 Deferred 상태로 두고 세션 종료 후 표시한다.

PWA 설치 안내와 새 버전 업데이트 안내를 동시에 표시하지 않는다.

---

## 28. 업데이트 실패 처리

다음 실패를 구분한다.

- Service Worker 등록 실패
- 업데이트 확인 실패
- 새 Worker 설치 실패
- Waiting Worker 활성화 실패
- `controllerchange` 미발생
- Reload 후 Build ID가 그대로임
- 네트워크 Offline
- Cache 정리 실패

사용자 안내:

```text
새 버전을 적용하지 못했어요.
인터넷 연결을 확인한 뒤 다시 시도해 주세요.
```

버튼:

```text
나중에
다시 시도
```

기존 활성 버전이 정상 동작한다면 앱을 사용하지 못하게 막지 않는다.

---

## 29. Offline 상태

Offline 상태에서는 새 업데이트를 적용하지 않는다.

- Waiting Worker가 이미 완전히 설치된 경우에도 현재 중요 세션 여부를 확인
- 새로운 Chunk가 필요한 상태라면 Online 복귀 후 적용
- Offline에서 무한 재시도 금지
- `online` 이벤트 발생 후 업데이트 재확인
- 기존 Offline App Shell을 무조건 삭제하지 않음

---

## 30. 기존 기능 보존

다음 기능은 변경하지 않는다.

- 아이 로그인
- 부모 로그인
- 미션 시작·이어하기
- 미션 질문 및 진행률
- 음성 입력과 Gemini Live
- 자유대화
- 황금열쇠 지급
- 놀이 차감·환불
- 부모 리포트
- 부모와 케이 대화
- 문의·건의·버그 신고
- PWA 설치 기능
- 관리자 기능
- DB 스키마
- Supabase 인증
- 리포트 생성 배치

이번 작업은 PWA Build 업데이트 감지·안내·적용 흐름 복구에 한정한다.

---

## 31. 구현 금지 사항

- 새 버전 감지 즉시 무조건 강제 Reload
- 미션 진행 중 자동 Reload
- 보상 Transaction 중 Reload
- Service Worker를 화면별로 중복 등록
- 최초 설치에 업데이트 안내 표시
- 매 페이지 이동마다 업데이트 Modal 표시
- Cache Storage 전체를 무조건 삭제
- 사용자가 저장 중인 데이터를 버리고 Reload
- `setInterval`로 짧은 주기 무한 업데이트 검사
- URL Query에 임의 Timestamp를 붙여 캐시 전체를 우회
- Service Worker 문제를 해결하기 위해 PWA 기능 전체 삭제
- Production 오프라인 정책을 검증 없이 제거
- UI에 Secret 또는 민감 환경변수 출력

---

## 32. 권장 컴포넌트 구조

실제 프로젝트 구조를 우선하되 다음 구조를 권장한다.

```text
RootLayout
└─ PwaUpdateProvider
   ├─ ServiceWorkerRegistration
   ├─ UpdateCheckCoordinator
   ├─ CriticalSessionGuard
   ├─ PwaUpdatePrompt
   └─ BuildVersionDiagnostics
```

권장 Hook:

```text
usePwaUpdate()
useCriticalSessionState()
useBuildVersion()
```

권장 Provider 반환값:

```text
status
isUpdateAvailable
isDeferred
currentBuildId
waitingBuildId
checkForUpdate()
applyUpdate()
deferUpdate()
retryUpdate()
```

---

## 33. QA 시나리오

### 최초 설치

1. Service Worker가 없는 새 브라우저
2. 앱 최초 방문
3. Worker 설치
4. 업데이트 안내 미표시
5. 앱 정상 동작
6. PWA 설치 정상

### 새 버전 배포

1. Build A 설치형 PWA 실행
2. Build B 배포
3. PWA 실행 또는 Foreground 복귀
4. 업데이트 확인
5. Waiting Worker 감지
6. 업데이트 안내 표시
7. `새로고침` 선택
8. `SKIP_WAITING`
9. `controllerchange`
10. Reload 정확히 1회
11. Build B 적용
12. 안내 제거

### 앱 실행 전에 Waiting Worker 존재

1. Build B가 이미 설치되어 Waiting 상태
2. PWA 재실행
3. 이벤트 발생을 기다리지 않고 업데이트 안내 표시
4. 정상 적용

### 나중에

1. 업데이트 안내 표시
2. `나중에` 선택
3. 현재 화면 유지
4. 중요 데이터 손실 없음
5. Foreground 복귀 또는 다음 실행에서 재안내

### 미션 진행 중

1. Build A에서 미션 진행
2. Build B 배포
3. 업데이트 감지
4. 강제 Reload 없음
5. `현재 대화를 마친 뒤 업데이트` 안내
6. 답변과 진행률 정상 저장
7. 미션 종료
8. 업데이트 안내 재표시
9. 사용자 승인
10. Build B 적용
11. 이어하기 및 보상 회귀 없음

### 자유대화 진행 중

- 음성 세션 강제 종료 없음
- 대화 저장 후 업데이트 가능
- TTS 도중 Reload 없음

### 황금열쇠 보상 처리 중

- Reward Transaction 완료 전 업데이트 적용 금지
- 보상 중복 지급 없음
- 보상 완료 후 업데이트 가능

### 여러 탭

- 두 탭에서 동시에 업데이트 감지
- 한 탭에서 적용
- 다른 탭 상태 동기화
- 무한 Reload 없음
- 미션 탭 강제 Reload 없음

### Offline

- Offline에서 업데이트 확인 실패
- 기존 앱 정상 사용
- Online 복귀 후 업데이트 재확인
- 정상 적용

### 업데이트 실패

- Worker 설치 실패
- Waiting Worker 없음
- `controllerchange` 미발생
- Reload 후 Build ID 불일치
- 사용자 재시도 가능
- 기존 앱 사용 가능

---

## 34. 실제 E2E 검증

최소 다음 순서로 실제 배포 기반 E2E를 수행한다.

### Dev

1. Dev Build A 배포
2. Windows PC에 PWA 설치
3. Build A 화면 확인
4. UI가 달라진 Dev Build B 배포
5. 기존 PWA를 삭제하지 않고 실행
6. 업데이트 안내 노출 확인
7. 새로고침 실행
8. 최신 UI 적용 확인
9. 모바일 Dev 브라우저와 Build ID 비교
10. PC PWA와 모바일이 동일 Build인지 확인

### Production 또는 Production과 동일한 Preview

1. Build A 배포
2. PWA 설치
3. Build B 배포
4. 일반 화면 업데이트
5. 미션 진행 중 업데이트
6. 자유대화 진행 중 업데이트
7. Offline 복귀 업데이트
8. 여러 탭 업데이트
9. Cache 정리 확인
10. 이전 JS·CSS 미사용 확인

---

## 35. 반응형 및 환경 검증

다음 환경에서 업데이트 UI를 확인한다.

- iPhone Safari
- iOS 홈 화면 추가 앱
- Android Chrome
- Android 설치형 PWA
- Windows Chrome PWA
- Windows Edge PWA
- 일반 PC 브라우저
- `390x844`
- `430x932`
- `768x1024`
- PC PWA 창 크기 변경

확인:

- 업데이트 Modal 잘림 없음
- 하단 Navigation과 겹침 없음
- 문의 버튼과 겹침 없음
- PWA 설치 Banner와 동시 표시 없음
- 모바일 키보드와 겹침 없음
- Safe Area 정상
- 접근성 Focus 정상

---

## 36. 완료 기준

다음 조건을 모두 만족해야 완료로 판정한다.

- 새 프런트엔드 Build 배포 후 기존 PWA가 업데이트를 감지함
- 기존 설치본에서만 업데이트 안내가 표시됨
- 최초 설치에는 업데이트 안내가 표시되지 않음
- 앱 시작 시 업데이트를 확인함
- Foreground 복귀 시 업데이트를 확인함
- Online 복귀 시 업데이트를 확인함
- 이미 Waiting Worker가 있는 상태에서도 안내가 표시됨
- 업데이트 UI가 앱 최상위에 연결됨
- 아이·부모·미션·놀이 화면에서 감지 가능함
- `새로고침` 선택 시 Waiting Worker가 활성화됨
- `controllerchange` 후 Reload가 정확히 한 번 실행됨
- 무한 Reload가 발생하지 않음
- 새로고침 후 최신 Build ID가 적용됨
- 이전 JS·CSS Cache가 계속 제공되지 않음
- 미션·자유대화 진행 중 강제 Reload가 발생하지 않음
- 중요 세션 종료 후 업데이트를 적용할 수 있음
- 미션 진행률과 이어하기 데이터가 보존됨
- 황금열쇠 보상이 중복 지급되지 않음
- 여러 탭에서 중복 적용 문제가 없음
- Dev와 Production Cache가 분리됨
- Production 오프라인 정책이 유지됨
- 모바일과 PC PWA가 동일 Build를 표시함
- 접근성 검증 통과
- lint 통과
- typecheck 통과
- 관련 test 통과
- production build 통과
- 실제 배포 E2E 통과

---

## 37. 작업 완료 보고

작업 완료 후 다음을 보고한다.

1. 현재 사용 중인 PWA 및 Service Worker 구현 방식
2. Service Worker 등록 파일과 위치
3. 업데이트 안내가 나타나지 않았던 정확한 원인
4. 기존 `skipWaiting` 및 `clientsClaim` 설정
5. 변경 파일 목록
6. 전역 업데이트 Provider 위치
7. 최초 설치와 업데이트 구분 방식
8. Waiting Worker 감지 방식
9. 앱 시작 업데이트 확인 방식
10. Foreground 복귀 업데이트 확인 방식
11. Online 복귀 업데이트 확인 방식
12. 업데이트 확인 중복 방지 방식
13. `SKIP_WAITING` 메시지 처리 방식
14. `controllerchange` 처리 방식
15. Reload 1회 보장 방식
16. 무한 Reload 방지 방식
17. 미션·자유대화 중요 세션 판정 방식
18. 중요 세션 중 업데이트 연기 방식
19. 세션 종료 후 업데이트 적용 방식
20. Build ID 생성 및 주입 방식
21. App Build와 Worker Build 비교 방식
22. Dev·Preview·Production Cache 이름
23. 이전 Cache 정리 방식
24. JS·CSS 최신 버전 적용 근거
25. 여러 탭 동기화 방식
26. Offline 처리 방식
27. 업데이트 실패 처리 방식
28. Windows PWA E2E 결과
29. Android PWA E2E 결과
30. iOS 홈 화면 앱 검증 결과
31. 일반 모바일 브라우저 검증 결과
32. Build A → Build B 실제 배포 검증 결과
33. 미션 진행 중 업데이트 QA 결과
34. 황금열쇠 보상 중 업데이트 QA 결과
35. 접근성 검증 결과
36. lint 결과
37. typecheck 결과
38. test 결과
39. production build 결과
40. 기존 미션·대화·놀이·리포트 기능 미변경 근거
41. 남아 있는 위험 요소