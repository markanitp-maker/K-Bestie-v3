# 101 — 부모·아이 홈 PWA 설치 환경별 통합 흐름 설계

## 1. 목적과 범위

부모 홈과 아이 홈의 하단 `앱 설치하기` 진입점을 하나의 환경 판별·설치 컨트롤러로 통합한다. 사용자는 브라우저 종류를 선택하지 않고 버튼 한 번만 누르며, 컨트롤러가 아래 우선순위로 행동을 결정한다.

1. 이미 standalone/PWA로 실행 중이면 설치 UI를 숨긴다.
2. In-App Browser면 외부 브라우저 안내 Modal을 연다.
3. `beforeinstallprompt`가 있으면 사용자 클릭 안에서 native prompt를 즉시 연다.
4. iPhone/iPad Safari면 Apple 절차를 설명하는 Modal을 연다.
5. 나머지는 공통 안내와 URL 복사를 제공하는 fallback Modal을 연다.

DB, 인증, manifest, Service Worker 등록·업데이트 정책은 변경하지 않는다. `/onboarding`과 `/parent/settings`는 기존 의미와 화면 구조를 유지하면서 공통 컨트롤러와 충돌하는 중복 판별만 최소 정리한다.

## 2. 현재 HEAD 분석

- `app/parent/home/page.tsx`와 `app/child/home/page.tsx`가 iOS·Kakao·native prompt 분기를 각각 복제하고, iOS 및 미지원 브라우저에서 native `alert()`를 호출한다.
- 두 홈 모두 Kakao 안내를 열 때 홈을 Modal로 덮는 대신 `KakaoInAppBrowserNotice` 전체 화면으로 조기 반환하므로 기존 화면 상태와 Back 동작이 불안정하다.
- `hooks/useInstallPrompt.ts`는 deferred event를 `any`로 저장하고 `standalone / iOS / prompt 보유`만 노출한다. In-App 우선순위, `appinstalled`, 초기 판별 완료 상태가 없다.
- `lib/pwa/standalone.ts`의 context는 `KAKAO_IN_APP / NORMAL_BROWSER / PWA_STANDALONE`만 구분한다. iPadOS desktop UA, NAVER, Instagram, Facebook, 기타 WebView가 빠져 있다.
- `components/pwa/KakaoInAppBrowserNotice.tsx`는 Kakao 전용이며 전체 페이지 UI다. URL 복사 fallback은 재사용 가치가 있다.
- `components/notifications/NotificationOnboarding.tsx`의 Push 미지원 복구 문구가 PWA 설치를 다시 유도해 홈 하단 진입점과 책임이 겹친다.
- `app/onboarding/page.tsx`와 `app/parent/settings/page.tsx`도 기존 hook을 직접 사용한다. `k_pwa_intro_seen`의 의미와 진행 시점은 유지해야 한다.
- `components/PwaServiceWorker.tsx`의 SW 상태 및 storage key는 설치 흐름과 별도이므로 수정 대상에서 제외한다.

## 3. 설계 결정

### 3.1 파일 구조

기존 파일을 우선 확장해 import 이동과 충돌 범위를 줄인다.

| 구분 | 파일 | 결정 |
|---|---|---|
| 수정 | `lib/pwa/standalone.ts` | 순수 환경 판별 타입과 함수를 확장한다. 별도 `browserContext.ts`는 만들지 않는다. |
| 수정 | `lib/pwa/standalone.test.ts` | 판별 우선순위와 대표 UA 회귀 테스트를 추가한다. |
| 수정 | `hooks/useInstallPrompt.ts` | typed deferred event와 공통 설치 컨트롤러 상태·행동을 제공한다. 이름은 유지한다. |
| 신규 | `components/pwa/PwaInstallGuideModal.tsx` | iOS, In-App, 일반 fallback을 discriminated props로 렌더링하는 단일 Modal을 만든다. |
| 수정 | `app/parent/home/page.tsx` | 페이지별 판별·alert·Kakao 전체화면 상태를 제거하고 공통 컨트롤러를 연결한다. |
| 수정 | `app/child/home/page.tsx` | 부모 홈과 같은 계약으로 연결한다. |
| 수정 | `app/onboarding/page.tsx` | 기존 소개/진행 의미는 유지하고 공통 컨트롤러와 Modal만 재사용한다. |
| 수정 | `app/parent/settings/page.tsx` | 설치 카드 구조는 유지하고 중복 환경 분기를 공통 컨트롤러로 교체한다. |
| 수정 | `components/notifications/NotificationOnboarding.tsx` | Push 미지원 문구에서 PWA 설치 유도만 제거한다. |
| 삭제 후보 | `components/pwa/KakaoInAppBrowserNotice.tsx` | 모든 import가 0건임을 `rg`로 확인한 뒤 삭제한다. URL 복사 로직은 새 Modal로 옮긴다. |
| 확인만 | `components/PwaServiceWorker.tsx` | 변경하지 않고 regression QA만 수행한다. |

`package.json`은 기존 `lib/pwa/standalone.test.ts` 실행 경로가 이미 포함되어 있으면 수정하지 않는다. 새 테스트 파일을 추가해야만 명시적으로 test script를 갱신한다.

### 3.2 Browser Context 계약

환경 판별은 브라우저 전역을 직접 읽지 않는 순수 함수와, 브라우저 값을 수집하는 hook으로 나눈다.

```ts
type InAppBrowserApp = "kakao" | "naver" | "instagram" | "facebook" | "other";

type PwaBrowserContext =
  | { kind: "standalone" }
  | { kind: "in-app-browser"; app: InAppBrowserApp; os: "ios" | "android" | "other" }
  | { kind: "installable-browser" }
  | { kind: "ios-safari"; device: "iphone" | "ipad" }
  | { kind: "regular-browser-unsupported"; os: "ios" | "android" | "other" };
```

순수 판별 입력에는 최소 `userAgent`, `platform`, `maxTouchPoints`, `standalone`, `hasInstallPrompt`를 전달한다. 순서는 반드시 `standalone → in-app → install prompt → iOS Safari → unsupported`다.

- standalone: `display-mode: standalone` 또는 iOS `navigator.standalone`.
- iPadOS desktop UA: `platform === "MacIntel" && maxTouchPoints > 1`도 iPad로 분류한다.
- iOS Safari: iOS/iPadOS이면서 `Safari` 토큰이 있고 `CriOS`, `FxiOS`, `EdgiOS`, `OPiOS` 및 In-App signature가 없는 경우만 해당한다.
- Kakao: `KAKAOTALK`.
- NAVER: `NAVER (inapp; ...)` 또는 `NAVER (higgs; ...)` 계열.
- Instagram: `Instagram` signature.
- Facebook: `FBAN` 또는 `FBAV` signature.
- other: Android WebView의 `; wv`/`Version/4.0` 조합이나 iOS `AppleWebKit + Mobile`이면서 Safari/알려진 iOS 브라우저가 아닌 경우. 휴리스틱이므로 대표 실제 기기 QA를 통과해야 한다.

Kakao와 NAVER 외 signature는 OS·앱 버전별 오탐 가능성이 있으므로 Production 문구에 특정 메뉴 위치를 고정하지 않는다.

### 3.3 공통 hook/controller 계약

`useInstallPrompt()`는 기존 이름을 유지하되 아래 기능을 한곳에서 책임진다.

```ts
interface PwaInstallController {
  context: PwaBrowserContext;
  isReady: boolean;
  canShowInstallEntry: boolean;
  activeGuide: null | "ios" | "in-app" | "unsupported";
  requestInstall: () => Promise<"accepted" | "dismissed" | "guide-opened" | "hidden">;
  closeGuide: () => void;
}
```

- local `BeforeInstallPromptEvent` interface를 선언해 `any`를 제거한다.
- `beforeinstallprompt`를 `preventDefault()`한 뒤 deferred event로 보관하고 context를 다시 계산한다.
- `requestInstall()`은 반드시 버튼 click handler에서 호출한다.
- native prompt가 끝나면 accepted/dismissed와 무관하게 소비된 event를 비운다. 같은 event를 재사용하지 않는다.
- `appinstalled` 수신 시 deferred event와 guide를 비우고 설치 진입점을 숨긴다.
- 초기 hydration 전 `isReady=false`로 두어 설치 배너가 순간 노출되지 않게 한다.
- standalone이면 `requestInstall()`은 UI를 열지 않고 `hidden`을 반환한다.
- In-App에서는 native prompt가 잡혀 있더라도 In-App 안내가 우선한다.
- 페이지는 UA, iOS, Kakao, prompt 존재 여부를 직접 검사하지 않는다.

브라우저에서 이미 설치됐지만 일반 탭으로 접속한 상태는 표준 API만으로 완전히 판별할 수 없다. 같은 세션의 `appinstalled`와 실제 standalone 실행은 숨기되, 별도 설치 이력 storage를 새 SSOT로 만들지 않는다.

### 3.4 Modal 계약

`PwaInstallGuideModal` 하나가 `context`에 따라 세 가지 본문을 렌더링한다.

#### iOS Safari

- 기기별 제목: `아이폰에 ... 설치하기` / `아이패드에 ... 설치하기`.
- Step Card 4개: `공유` → `홈 화면에 추가` → `웹 앱으로 열기` → `추가`.
- `홈 화면에 추가`가 없을 때 `동작 편집`에서 추가하는 fallback을 별도 안내한다.
- Apple UI 스크린샷을 고정하지 않고 `lucide-react`의 일반 아이콘만 사용한다.
- 화면 크기가 작으면 Modal 내부만 스크롤되며 닫기 버튼은 항상 접근 가능해야 한다.

#### In-App Browser

- 감지한 앱 이름만 제목에 반영한다. 알려지지 않으면 `이 앱의 브라우저에서 열려 있어요`로 표시한다.
- 공통 설명은 Safari/Chrome 같은 일반 브라우저에서 다시 열라는 내용으로 제한한다.
- 검증되지 않은 `우측 상단 ⋯` 같은 좌표와 메뉴명을 Production 문구로 고정하지 않는다.
- 외부 브라우저 직접 열기 버튼은 검증된 target을 만들 수 있을 때만 표시하고 사용자 클릭으로만 실행한다. 자동 redirect와 추정 custom scheme은 금지한다.
- 검증된 target이 없거나 실행이 실패하면 항상 `주소 복사하기`를 제공한다.

#### 일반 미지원 fallback

- 설치가 불가능하다고 단정하지 않고 현재 브라우저에서 native prompt가 제공되지 않았음을 설명한다.
- 브라우저 메뉴를 확인하는 일반 안내와 `주소 복사하기`, 닫기만 제공한다.

#### 공통 접근성·상태

- `role="dialog"`, `aria-modal="true"`, 제목 연결, Escape 닫기, 닫은 뒤 trigger focus 복원.
- 열려 있는 동안 background scroll을 잠그고 Modal body만 `overflow-y-auto`로 둔다.
- URL 복사는 Clipboard API 우선, 기존 `execCommand("copy")` fallback을 유지한다.
- 복사 성공/실패는 Modal 내부 `aria-live` 상태로 알리고 URL 원문은 로그·DB·analytics에 남기지 않는다.
- Modal close는 페이지 이동이나 홈 state 초기화를 일으키지 않는다.

### 3.5 화면 연결

#### 부모/아이 홈

- 기존 `hide_pwa_banner` session key와 닫기 동작은 유지한다.
- `isReady && canShowInstallEntry && !dismissedInSession`일 때만 기존 하단 배너를 보인다.
- CTA는 `requestInstall()`만 호출하며 페이지별 UA 분기와 `alert()`를 제거한다.
- Modal은 홈 DOM 위 overlay로 렌더링한다. 전체 페이지 조기 반환을 제거해 홈 state와 Browser Back을 보존한다.
- 두 화면의 문구·행동 계약은 같고, 기존 레이아웃 차이는 유지한다.

#### `/onboarding`

- `k_pwa_intro_seen`을 읽고 쓰는 조건과 `proceed()`의 인증/가족 경로는 변경하지 않는다.
- native prompt 결과를 처리하는 기존 진행 정책도 변경하지 않는다.
- iOS/In-App/fallback 안내는 새 Modal을 사용하되 Modal을 닫는 것만으로 intro seen을 기록하지 않는다.
- KakaoTalk In-App으로 처음 진입하면 설치 CTA 클릭을 요구하지 않고 In-App 안내 Modal을 진입당 한 번 자동으로 연다. 닫은 뒤에는 자동으로 다시 열지 않으며, native prompt나 외부 앱 이동은 자동 실행하지 않는다.
- `나중에` 동작은 기존대로 유지한다.

#### `/parent/settings`

- 설치 카드의 위치와 시각 구조를 유지한다.
- 설치 행동과 안내 Modal만 공통 controller를 사용한다.
- Push 설정, 로그아웃, 가족 설정에는 손대지 않는다.

#### `NotificationOnboarding`

- Push unsupported/recovery 상태에서 `앱 설치하기`를 유도하는 문장만 제거한다.
- 권한 요청, recovery 판단, CTA, storage, analytics는 변경하지 않는다.

## 4. 데이터 흐름

```text
window signals
(UA/platform/touch/display-mode/beforeinstallprompt/appinstalled)
        ↓
lib/pwa/standalone.ts의 순수 context resolver
        ↓
hooks/useInstallPrompt.ts의 단일 controller
        ├─ standalone → 진입점 숨김
        ├─ installable → 사용자 click → native prompt
        ├─ iOS Safari → iOS guide state
        ├─ In-App → app별 guide state
        └─ unsupported → common fallback state
        ↓
PwaInstallGuideModal + 부모/아이/온보딩/설정의 기존 CTA
```

서버·DB 왕복은 없다. 화면 간 영속 상태는 기존 `hide_pwa_banner`, `k_pwa_intro_seen`만 유지하고 새 설치 완료 storage key는 추가하지 않는다.

## 5. agy 구현 분할안

각 단위는 독립 실행 기준 10분 이내다. 작업 전 루트 `AGENTS.md §6~§10`과 `CLAUDE.md`를 읽고, 각 단위 종료 시 변경 파일과 미검증 항목을 보고한다.

### U1. 순수 환경 판별기와 회귀 테스트

- 파일: `lib/pwa/standalone.ts`, `lib/pwa/standalone.test.ts`
- 내용: discriminated union, iPadOS/Safari/In-App/unknown WebView 판별, 우선순위 구현.
- 완료: standalone이 모든 분기보다 우선, In-App이 prompt/Safari보다 우선인 테스트 포함. 대표 UA 및 빈 UA 테스트 통과.
- 검증: 해당 Node test 실행.

### U2. typed 설치 컨트롤러

- 파일: `hooks/useInstallPrompt.ts`
- 선행: U1
- 내용: `any` 제거, `beforeinstallprompt`, `appinstalled`, `isReady`, guide state, 단일 `requestInstall()` 구현.
- 완료: 소비된 prompt 재사용 없음, standalone 진입점 숨김, cleanup listener 존재.
- 검증: `tsc --noEmit` 대상 파일 오류 0건.

### U3. 공통 Modal 기반과 iOS 안내

- 파일: `components/pwa/PwaInstallGuideModal.tsx`
- 선행: U1
- 내용: accessible overlay, scroll/focus 처리, iPhone/iPad Step Card와 `동작 편집` fallback.
- 완료: native `alert()` 없이 작은 viewport에서 닫기 접근 가능.
- 검증: 정적 타입·접근성 속성 확인.

### U4. In-App/unsupported Modal과 URL 복사

- 파일: `components/pwa/PwaInstallGuideModal.tsx`
- 선행: U3
- 내용: 앱 이름별 제목, 검증된 일반 안내, Clipboard + legacy fallback, `aria-live`, nullable external target.
- 완료: direct-open target이 없어도 복사/닫기로 끝까지 진행 가능하며 자동 redirect가 없다.
- 검증: Kakao/NAVER/Instagram/Facebook/other/unsupported props별 렌더 분기 확인.

### U5. 부모 홈 연결

- 파일: `app/parent/home/page.tsx`
- 선행: U2, U4
- 내용: 로컬 UA/iOS/Kakao/alert/전체화면 분기 제거, 기존 배너에 controller와 Modal 연결.
- 완료: `hide_pwa_banner` 유지, Modal close 후 홈 state 유지, `alert(` 0건.
- 검증: `rg`와 typecheck.

### U6. 아이 홈 연결

- 파일: `app/child/home/page.tsx`
- 선행: U2, U4
- 내용/완료/검증: U5와 동일 계약으로 적용하고 아이 홈의 기존 미션·알림 상태는 변경하지 않는다.

### U7. 온보딩 최소 정합

- 파일: `app/onboarding/page.tsx`
- 선행: U2, U4
- 내용: 공통 controller/Modal 재사용, 전체화면 Kakao 분기 제거.
- 완료: `k_pwa_intro_seen`, `proceed()`, `나중에`, 인증 분기 의미가 diff 전후 동일.
- 검증: 관련 storage write 위치와 호출 조건 정적 비교.

### U8. 설정 정합 및 Kakao 전용 컴포넌트 정리

- 파일: `app/parent/settings/page.tsx`, `components/pwa/KakaoInAppBrowserNotice.tsx`
- 선행: U5~U7
- 내용: 설정 카드에 공통 controller 연결. `rg`로 import 0건 확인 후 Kakao 전용 전체화면 컴포넌트 삭제.
- 완료: 설정의 다른 기능 diff 없음, `useKakaoInApp`/`KakaoInAppBrowserNotice` 참조 0건.
- 검증: `rg`와 typecheck.

### U9. Push 문구 분리와 정적 통합 게이트

- 파일: `components/notifications/NotificationOnboarding.tsx` 및 위 전체 대상 확인
- 선행: U5~U8
- 내용: PWA 설치 유도 문구만 제거. 범위·금지사항·test script를 점검한다.
- 완료: Push 로직 diff 없음, home/onboarding/settings의 native `alert()` 0건, `components/PwaServiceWorker.tsx` diff 없음, 테스트·typecheck 통과.
- 검증: `git diff --check`, 관련 test, `tsc --noEmit`. dev 서버 실행 중이면 AGENTS 규칙에 따라 같은 working tree에서 build하지 않는다.

## 6. 병렬/순차 관계

- 순차 시작: U1 → U2.
- U1 완료 후 U2와 U3를 병렬 실행할 수 있다.
- U3 → U4는 같은 신규 Modal 파일을 편집하므로 순차다.
- U2와 U4 완료 후 U5와 U6를 서로 다른 격리 worktree에서 병렬 실행할 수 있다.
- U7은 U2/U4 이후 U5/U6와 병렬 가능하지만, 같은 루트 working tree 동시 편집은 금지한다.
- U8은 호출부 U5~U7 완료 후 진행한다.
- U9는 전체 코드 변경이 모인 뒤 마지막에 진행한다.

## 7. QA 인계

정적 게이트 통과 후 동적 E2E는 agy가 담당한다. 아래 각 행을 한 세션당 10분 이내의 독립 QA로 배정하고, 실제 기기/앱이 없으면 PASS로 추정하지 말고 `미검증`으로 기록한다.

### 핵심 자동/브라우저 QA

| 환경 | Parent/Child 공통 기대 결과 |
|---|---|
| standalone display mode | 하단 설치 UI 미노출 |
| Android Chromium + prompt | 클릭 1회로 native prompt, 중간 Modal 없음, dismiss 후 같은 event 재사용 없음 |
| iPhone Safari | 전용 Modal, 4 Step, 동작 편집 fallback, alert 0건 |
| iPadOS desktop UA Safari | iPad 제목과 동일 절차 |
| prompt 없는 일반 브라우저 | fallback Modal + URL 복사 + 닫기 |
| unknown WebView | In-App fallback Modal + URL 복사 |

### 실제 앱 QA

Parent와 Child 각각 KakaoTalk/NAVER/Instagram/Facebook의 iOS·Android를 확인한다.

- 앱 이름 감지와 제목이 맞다.
- 검증되지 않은 메뉴 좌표를 표시하지 않는다.
- 외부 브라우저 이동이 제공되면 반드시 사용자 클릭으로만 실행되고 실패 시 복사가 가능하다.
- Safari/Chrome 재진입 후 정상 설치 흐름으로 이어진다.
- Modal close, Browser Back 후 기존 홈 상태가 유지된다.

### 필수 회귀 QA

- Parent/Child Push Notification 안내와 권한 요청.
- SW 등록과 기존 update prompt/storage key.
- 로그인, 자동 로그인, Parent/Child 홈 진입.
- 기존 설치 PWA 실행과 설치 UI 미노출.
- `/onboarding`의 `k_pwa_intro_seen` 및 `나중에`.
- `/parent/settings`의 Push/로그아웃/가족 설정.

Dev 배포와 QA는 Claude의 단일 배포 주체 지정 뒤 수행한다. Production 배포는 이 설계 범위가 아니며 대표 승인과 Dev QA 증거가 필요하다.

## 8. 위험요소와 승인 기준

1. Instagram/Facebook/unknown WebView 판별은 공개적으로 안정된 단일 표준이 아니므로 실제 앱 버전 QA가 필수다. 오탐이면 `other` 안내로 안전하게 후퇴한다.
2. iOS의 일반 브라우저와 embedded WebView UA가 유사할 수 있다. 알려진 iOS 브라우저 제외 목록과 In-App 우선순위 테스트가 필요하다.
3. `beforeinstallprompt`는 제한 지원 기능이므로 이벤트 미수신을 오류로 처리하지 않는다.
4. 일반 브라우저 탭에서 이미 설치된 PWA를 완벽히 감지하는 표준은 없다. 별도 storage로 설치 완료를 추정하지 않는다.
5. 외부 앱/브라우저 scheme은 검증 전 도입하지 않는다. Android Intent를 추가하려면 실제 앱별 성공/실패와 fallback URL 검증 후 별도 승인한다.
6. Kakao/NAVER 메뉴의 정확한 이름·위치는 최신 iOS/Android 앱에서 확인할 때까지 공통 문구로 둔다.
7. 현재 저장소는 다른 작업의 dirty 변경이 있으므로 각 agy 작업은 격리 worktree를 사용하고 대상 파일 단위로 통합해야 한다.

## 9. 참고 근거

- Apple Safari 홈 화면 추가 절차: https://support.apple.com/guide/iphone/iph42ab2f3a7/ios
- MDN `beforeinstallprompt`: https://developer.mozilla.org/docs/Web/API/Window/beforeinstallprompt_event
- web.dev install prompt 흐름: https://web.dev/articles/customize-install
- KakaoTalk In-App UA: https://developers.kakao.com/docs/latest/ko/kakaotalk-social/common
- NAVER In-App UA: https://developers.naver.com/docs/utils/inappbrowser/
- Android Intent 공식 문서: https://developer.chrome.com/docs/android/intents

공식 문서가 현재 UI 문구를 보장하지 않는 Kakao/NAVER/Instagram/Facebook 메뉴 표현은 Dev 실제 기기 QA 전까지 확정하지 않는다.

## 10. 미해결 질문

- 실제 KakaoTalk/NAVER/Instagram/Facebook 최신 iOS·Android 기기 또는 테스트 장비 확보 여부.
- Android 특정 In-App에서 검증된 외부 Chrome Intent 버튼을 이번 101에 포함할지, URL 복사 fallback만으로 출시할지 대표 결정.
