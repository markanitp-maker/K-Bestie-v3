# 부모·아이 홈 PWA 설치 환경별 통합 흐름

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

부모 홈과 아이 홈의 하단 **`PWA 설치` / `앱 설치하기` 버튼은 동일한 공통 설치 로직**을 사용한다.

사용자는 자신의 기기·브라우저 종류를 알 필요가 없다.

`앱 설치하기`를 누르면 현재 실행 환경을 자동 판별해 다음과 같이 동작한다.

```text
앱 설치하기
    ↓
현재 실행 환경 자동 판별
    │
    ├─ 이미 설치된 PWA
    │    └─ 설치 UI 미노출
    │
    ├─ Android / Chromium + 설치 가능
    │    └─ 브라우저 Native PWA 설치창 즉시 실행
    │
    ├─ iPhone/iPad Safari
    │    └─ 내친구 케이 디자인의 상세 설치 가이드 Modal
    │
    ├─ Kakao / Naver / Instagram / Facebook 등 In-App Browser
    │    └─ 외부 브라우저 이동 상세 가이드 Modal
    │         ↓
    │       Safari / Chrome
    │         ↓
    │       정상 PWA 설치
    │
    └─ 식별하지 못한 WebView / 설치 미지원 환경
         └─ 공통 안내 Modal + 주소 복사 fallback
```

현재 발생하는 다음 UX는 제거한다.

- 상단 PWA 설치 안내
- 하단 PWA 설치 배너
- 클릭 후 브라우저 기본 `alert()`

이 세 가지가 동시에 보이는 구조를 제거하고 **하단 설치 버튼 → 필요한 경우 하나의 전용 Modal** 구조로 통일한다.

Push Notification 기능 자체는 변경하지 않는다.

---

### 대표님 테스트 정상 프로세스

#### CASE 1 — Android Chrome

1. Android Chrome에서 부모 계정으로 로그인한다.
2. `/parent/home` 하단의 `앱 설치하기`를 누른다.
3. 별도의 사용법 설명 Modal을 거치지 않는다.
4. Chrome의 PWA 설치 UI가 바로 열린다.
5. 설치한다.
6. 설치된 내친구 케이를 홈 화면에서 실행한다.
7. PWA 상태에서는 설치 배너가 다시 나타나지 않는지 확인한다.
8. 아이 계정 `/child/home`에서도 동일하게 확인한다.

**PASS**
- 설치 버튼 1회 클릭 → Native 설치 UI
- 부모/아이 동작 동일
- 설치 완료 후 설치 UI 미노출

Chrome은 설치 가능한 웹 앱에 대한 설치 흐름을 제공한다. citeturn136776view4turn242515search0

---

#### CASE 2 — iPhone Safari

1. Safari에서 부모 또는 아이 홈을 연다.
2. 하단 `앱 설치하기`를 누른다.
3. 브라우저 기본 `alert()`가 아닌 **내친구 케이 설치 안내 Modal**이 열린다.
4. Modal에 표시된 설명만 보고 설치할 수 있어야 한다.
5. Safari에서 실제 홈 화면 설치를 진행한다.
6. 홈 화면의 내친구 케이 아이콘을 실행한다.
7. 설치 후 하단 설치 UI가 다시 나타나지 않는지 확인한다.

**PASS**
- 별도의 검색 없이 Modal만 보고 설치 가능
- native `alert()` 0건
- 부모/아이 Modal 및 동작 동일

---

#### CASE 3 — 카카오톡 인앱 브라우저

1. 카카오톡에서 내친구 케이 링크를 연다.
2. 로그인 후 부모 또는 아이 홈의 `앱 설치하기`를 누른다.
3. 설치를 직접 시도하지 않고 **외부 브라우저 이동 가이드 Modal**이 열린다.
4. 사용자가 Modal을 보고 Safari/Chrome 등 외부 브라우저로 이동한다.
5. 외부 브라우저에서 다시 `앱 설치하기`를 누른다.
6. 해당 환경에 맞는 설치 절차가 이어진다.

**PASS**
- 인앱에서 죽은 설치 버튼이 발생하지 않음
- 사용자가 다음 행동을 명확하게 알 수 있음
- 외부 브라우저 이동 실패 시 주소 복사 fallback 제공

카카오톡 인앱 브라우저는 User-Agent의 `KAKAOTALK` 식별값으로 공식 판별할 수 있다. citeturn555313search11

---

#### CASE 4 — 네이버 / Instagram / Facebook 인앱 브라우저

각 앱에서 동일하게 링크를 열고 `앱 설치하기`를 누른다.

**PASS**
- 인앱 환경으로 판별
- 해당 앱명이 표시된 외부 브라우저 안내 Modal 노출
- 외부 브라우저 이동 또는 주소 복사 fallback 제공
- 외부 브라우저 이동 후 정상 PWA 설치 가능

네이버 앱은 공식적으로 User-Agent의 `NAVER (inapp; ...)`, `NAVER (higgs; ...)` 계열 값으로 웹뷰를 구분할 수 있다. citeturn136776view2

Facebook과 Instagram은 자체 인앱 브라우저를 사용하며 외부 브라우저로 여는 기능을 제공한다. citeturn898165search0turn898165search5

---

# 1. 상태 / 우선순위 / 대상

- **상태:** 신규
- **우선순위:** P1
- **대상:** Parent / Child 공통
- **주요 Route**
  - `/parent/home`
  - `/child/home`
- **관련 영역**
  - PWA Install
  - Browser Context Detection
  - In-App Browser Detection
  - Modal UX
- **DB Migration:** 없음
- **Service Worker 구조 변경:** 원칙적으로 없음
- **Manifest 구조 변경:** 원칙적으로 없음

---

# 2. 목표

PWA 설치 UX의 기준을 **화면별 구현이 아니라 실행환경 기반의 단일 설치 Controller**로 통합한다.

핵심 원칙:

> 사용자가 어떤 브라우저에서 접속했는지 알 필요 없이 `앱 설치하기` 하나만 누르면 다음 행동이 자동으로 결정되어야 한다.

부모 홈과 아이 홈에 각각 설치 로직을 구현하지 않는다.

공통 로직을 한 번 구현하고 두 화면에서 재사용한다.

---

# 3. 확정 요구사항

## 3.1 설치 환경 판별 우선순위

환경 판별 순서는 반드시 다음 우선순위를 따른다.

```text
1. Standalone/PWA 여부
2. In-App Browser 여부
3. beforeinstallprompt 사용 가능 여부
4. iOS/iPadOS Safari 여부
5. 일반 브라우저 fallback
```

**In-App Browser 판정을 Safari/Chrome 판정보다 먼저 해야 한다.**

인앱 WebView의 User-Agent가 Safari 또는 Chromium과 유사하더라도 일반 브라우저로 잘못 분류하면 안 된다.

---

## 3.2 공통 Browser Context

기존 다음 구조를 우선 재사용·정리한다.

- `lib/pwa/standalone.ts`
- `hooks/useInstallPrompt.ts`
- 기존 `getBrowserContext()`
- 기존 `isKakaoInAppBrowser()`

최종적으로 최소 다음 상태를 구분할 수 있어야 한다.

```text
standalone
installable-browser
ios-safari
in-app-browser
regular-browser-unsupported
```

`in-app-browser`는 필요할 경우 세부 식별값을 가진다.

```text
kakao
naver
instagram
facebook
other
```

앱별 설치 엔진을 따로 만들지 않는다.

---

# 4. Android / Chromium 설치 정책

## 4.1 `beforeinstallprompt`가 확보된 경우

사용자가 `앱 설치하기`를 직접 클릭했을 때 저장해 둔 install event의 `prompt()`를 호출한다.

다음 흐름이어야 한다.

```text
앱 설치하기
→ Native Install Prompt
→ 사용자 설치/취소
```

중간 설명 Modal은 표시하지 않는다.

`beforeinstallprompt`는 모든 브라우저의 공통 표준 기능으로 전제하지 말고 **feature detection 결과가 있을 때만 사용한다.** 이 이벤트는 브라우저 지원 범위가 제한되어 있다. citeturn242515search5turn242515search8

---

## 4.2 Install Prompt가 없는 Android 브라우저

버튼 클릭을 무반응으로 끝내지 않는다.

설치 Event가 확보되지 않았지만 일반 Android 브라우저라면:

1. 브라우저 설치 방법 Modal
2. 또는 외부 Chrome에서 열기
3. 또는 명확한 fallback

중 하나로 연결한다.

Chrome 공식 메뉴 기준으로는 Android에서 웹 앱 설치가 브라우저 메뉴의 설치 기능을 통해 제공된다. citeturn136776view4

---

# 5. iPhone / iPad Safari 설치 Modal

## 5.1 기본 원칙

기존 다음 코드를 사용하지 않는다.

```text
alert("공유 버튼을 누른 뒤 '홈 화면에 추가'를 선택해 주세요.")
```

브라우저 기본 `alert()` 사용 금지.

내친구 케이 디자인 시스템을 사용한 **전용 Modal**로 교체한다.

---

## 5.2 Modal 제목

**아이폰에 내친구 케이 설치하기**

iPad일 경우:

**아이패드에 내친구 케이 설치하기**

---

## 5.3 안내 문구

> 아래 순서대로 하면 홈 화면에서 내친구 케이를 앱처럼 바로 사용할 수 있어요.

---

## 5.4 설치 단계

Apple의 현재 Safari 공식 흐름을 기준으로 아래 순서를 안내한다. citeturn136776view3

### STEP 1
**Safari의 공유 버튼을 눌러주세요.**

공유 아이콘을 시각적으로 함께 표시한다.

Safari 화면 구성에 따라 공유 버튼 위치가 달라질 수 있으므로 특정 좌표만 가리키지 않는다.

### STEP 2
**`홈 화면에 추가`를 선택해주세요.**

스크롤이 필요한 메뉴임을 사용자가 알 수 있게 한다.

### STEP 3
**`웹 앱으로 열기`를 켜주세요.**

해당 옵션이 표시되는 현재 iOS 환경에서는 활성화하도록 안내한다.

### STEP 4
**오른쪽 위 `추가`를 누르면 완료됩니다.**

홈 화면에서 내친구 케이 아이콘을 눌러 실행할 수 있음을 알려준다.

---

## 5.5 `홈 화면에 추가`가 안 보일 때

Modal 하단에 별도 도움말을 제공한다.

> **`홈 화면에 추가`가 보이지 않나요?**  
> 공유 메뉴 아래쪽의 `동작 편집`에서 `홈 화면에 추가`를 추가한 뒤 다시 선택해주세요.

Apple 공식 가이드 역시 해당 메뉴가 보이지 않을 경우 Action 편집을 통해 추가하는 절차를 안내한다. citeturn136776view3

---

## 5.6 Modal 디자인

단순 장문 텍스트 박스로 만들지 않는다.

각 단계를 다음 형태의 **Step Card**로 표시한다.

```text
① 공유 버튼
   Safari의 공유 버튼을 눌러주세요.

② 홈 화면에 추가
   메뉴에서 "홈 화면에 추가"를 선택해주세요.

③ 웹 앱으로 열기
   옵션을 켜주세요.

④ 추가
   오른쪽 위 "추가"를 누르면 완료됩니다.
```

요구사항:

- 모바일 화면 기준
- 한 손 스크롤 가능
- 큰 단계 번호
- 핵심 버튼명 Bold
- 공유 아이콘 등 단순 UI 아이콘 사용
- 과도한 설명 금지
- Apple UI 전체 스크린샷을 코드에 고정하지 말 것
- 화면 크기가 작은 기기에서도 하단 버튼 접근 가능
- Modal 내부만 스크롤되고 배경 화면은 고정

---

# 6. In-App Browser 정책

## 6.1 대상

최소 다음 주요 인앱 브라우저를 포함한다.

- KakaoTalk
- NAVER
- Instagram
- Facebook

그리고 특정 앱명을 식별하지 못하는 WebView도:

- `other in-app browser`

로 처리한다.

즉, 특정 4개 앱만 대응하고 끝내지 않는다.

---

## 6.2 식별 원칙

가능한 공식 User-Agent 식별값을 우선 사용한다.

KakaoTalk:

```text
KAKAOTALK
```

카카오는 이를 인앱 브라우저 판별 방법으로 공식 안내한다. citeturn555313search11

NAVER:

```text
NAVER (inapp; ...)
NAVER (higgs; ...)
```

네이버 역시 공식 개발자 문서에서 User-Agent 기반 판별을 안내한다. citeturn136776view2

Facebook / Instagram 및 기타 WebView는 현재 브라우저 Context와 검증된 UA signature를 사용하되 **특정 문자열 하나에 전체 기능을 의존하지 않는다.**

앱명을 정확히 식별하지 못해도 `other in-app browser` fallback으로 빠질 수 있어야 한다.

---

# 7. In-App Browser Modal

## 7.1 목적

인앱 브라우저 안에서 PWA 설치를 억지로 진행시키는 것이 목적이 아니다.

목적은:

> 사용자를 PWA 설치가 가능한 일반 Safari/Chrome 환경까지 안전하고 쉽게 안내하는 것

이다.

---

## 7.2 Modal 제목

앱 식별에 성공했을 경우:

**카카오톡에서 열려 있어요**  
**네이버 앱에서 열려 있어요**  
**Instagram에서 열려 있어요**  
**Facebook에서 열려 있어요**

식별 실패 시:

**앱 안의 브라우저에서 열려 있어요**

---

## 7.3 기본 설명

> 내친구 케이 앱 설치는 Safari 또는 Chrome 같은 일반 브라우저에서 진행할 수 있어요.  
> 아래 방법으로 외부 브라우저에서 다시 열어주세요.

---

# 8. 외부 브라우저 이동 UX

## 8.1 직접 실행 가능한 환경

기술적으로 검증된 환경에서만 사용자 클릭을 통해 외부 브라우저 실행을 시도한다.

Android에서는 사용자 제스처로 Android Intent를 호출해 외부 앱을 여는 방식이 공식적으로 지원되며, 대상 앱을 열 수 없을 경우 fallback을 설계할 수 있다. citeturn850869search0

단:

- 자동 redirect 금지
- 페이지 로드와 동시에 외부 앱 실행 금지
- 반드시 사용자가 버튼을 직접 클릭한 경우만 시도
- 검증되지 않은 custom scheme 추측 금지
- Chrome 설치를 무조건 가정하지 말 것

---

## 8.2 외부 브라우저 직접 실행이 보장되지 않는 환경

강제 실행을 시도하다 실패시키지 않는다.

Modal에서:

1. 실제 앱의 외부 브라우저 메뉴 안내
2. 현재 URL 복사
3. 사용자가 Safari/Chrome에 붙여넣을 수 있는 fallback

을 제공한다.

버튼 예:

**외부 브라우저에서 열기**

가능한 경우에만 활성화한다.

보조 버튼:

**주소 복사하기**

주소 복사 성공 시:

> 주소를 복사했어요. Safari 또는 Chrome 주소창에 붙여넣어 주세요.

Toast를 표시한다.

---

# 9. Facebook / Instagram 가이드

Facebook 공식 Help는 인앱 브라우저에서 우측 상단 Options를 통해 `Open in external browser` 기능을 제공한다고 안내한다. citeturn898165search0

Instagram 역시 인앱 브라우저에서 외부 브라우저로 여는 기능을 제공한다. citeturn898165search5

따라서 해당 앱이 명확하게 식별될 경우 Modal의 단계형 안내를 제공한다.

예:

```text
① 오른쪽 위 옵션 메뉴를 눌러주세요.
② "외부 브라우저에서 열기"를 선택해주세요.
③ Safari 또는 Chrome에서 내친구 케이가 열립니다.
④ 다시 "앱 설치하기"를 눌러주세요.
```

앱 버전에 따라 메뉴 표시 방식이 달라질 수 있으므로 아이콘의 정확한 좌표에 의존하지 않는다.

---

# 10. Kakao / NAVER 가이드

Kakao와 NAVER는 현재 공식 자료로 인앱 브라우저 식별 방법까지는 확인 가능하다. citeturn555313search11turn136776view2

외부 브라우저 메뉴의 정확한 위치·표현은 앱 버전 및 OS에 따라 달라질 수 있으므로 **검증하지 않은 메뉴명을 추측해서 Production 문구로 고정하지 않는다.**

구현 시:

1. 앱명 식별
2. 외부 브라우저 전환 안내
3. 가능한 직접 전환
4. `주소 복사하기` fallback

을 기본 구조로 한다.

Dev QA에서 실제 최신 KakaoTalk/NAVER iOS·Android UI를 확인하여 현재 메뉴명과 위치를 확정한 뒤 Production 문구를 결정한다.

---

# 11. Unknown In-App Browser

알려진 User-Agent에 해당하지 않더라도 WebView/In-App 환경으로 판정되면 설치 버튼을 무반응 처리하지 않는다.

공통 Modal:

### 제목
**앱 안의 브라우저에서 열려 있어요**

### 설명
> 앱 설치를 위해 Safari 또는 Chrome에서 내친구 케이를 열어주세요.

### 안내
> 현재 앱의 `더보기` 또는 브라우저 메뉴에서 `외부 브라우저에서 열기` 기능을 찾아주세요.

### 버튼
- 외부 브라우저에서 열기 — 실행 가능할 경우
- 주소 복사하기
- 닫기

---

# 12. 부모 / 아이 공통화

현재:

- `app/parent/home/page.tsx`
- `app/child/home/page.tsx`

에 각각 존재하는 PWA 설치 click handler와 UI 분기를 공통화한다.

부모/아이 페이지에서 각각 아래 코드를 구현하지 않는다.

- iOS detection
- Kakao detection
- installPrompt 실행
- alert
- install modal state
- 외부 브라우저 처리

공통 PWA 설치 Controller/Hook과 공통 Modal을 이용한다.

구조 예시:

```text
components/pwa/
  PwaInstallGuideModal
  InAppBrowserGuideModal

hooks/
  usePwaInstall

lib/pwa/
  standalone
  browserContext
```

실제 프로젝트 구조를 확인한 뒤 기존 파일을 최대한 재사용하고 불필요한 신규 파일 증가는 피한다.

---

# 13. 상단 PWA 안내 중복 제거

현재 `NotificationOnboarding.tsx`의 Push Notification 미지원 상태가 PWA 설치 안내 문구까지 출력하면서 하단 설치 배너와 중복된다.

PWA 설치 책임은 하단 `앱 설치하기` 진입점으로 일원화한다.

따라서:

- `NotificationOnboarding`의 PWA 설치 유도 문구 제거
- Push Notification 관련 기능·권한 안내는 그대로 유지

한다.

**Push Notification 로직 자체를 삭제하거나 변경하지 않는다.**

---

# 14. 기존 구조 확인

작업 전 최소 다음 파일을 다시 확인한다.

```text
components/notifications/NotificationOnboarding.tsx
app/parent/home/page.tsx
app/child/home/page.tsx
app/onboarding/page.tsx
app/parent/settings/page.tsx
components/pwa/KakaoInAppBrowserNotice.tsx
hooks/useInstallPrompt.ts
lib/pwa/standalone.ts
components/PwaServiceWorker.tsx
```

기존 조사 결과를 기준으로 작업하되 실제 현재 HEAD와 차이가 있으면 **현재 코드를 우선**한다.

`/onboarding` 및 `/parent/settings`는 이번 작업으로 기능을 대폭 재설계하지 않는다.

다만 공통 PWA Controller와 충돌하는 중복 판정이 있으면 최소 범위에서 정합성을 맞춘다.

---

# 15. 금지사항

다음은 금지한다.

- 브라우저 native `alert()` 사용
- 부모/아이 페이지별 설치 로직 복제
- 카카오 전용으로만 In-App 구조 설계
- 모든 In-App Browser가 동일 User-Agent라고 가정
- 모든 Android Browser가 `beforeinstallprompt`를 지원한다고 가정
- iOS에서 검증되지 않은 Safari 강제 실행 scheme 사용
- 사용자 클릭 없이 외부 앱 자동 실행
- 메뉴 위치나 이름을 추측해서 Production에 고정
- 설치 실패 시 아무 반응 없이 종료
- PWA 설치와 Push Notification 책임 혼합
- Service Worker 전체 재작성
- Manifest 불필요 변경
- DB 변경
- Authentication 흐름 변경
- 기존 PWA 사용자에게 onboarding 재노출
- 기존 `k_pwa_intro_seen` 의미 변경
- SW Update 관련 storage key와 install state 통합

---

# 16. 모호성 처리

구현 중 특정 인앱 앱의 외부 브라우저 메뉴 문구가 공식 자료 또는 실제 최신 앱에서 확인되지 않으면 추측해서 구현하지 않는다.

해당 앱은:

```text
앱 식별
→ 공통 외부 브라우저 안내
→ 주소 복사 fallback
```

으로 처리하고 완료보고에 별도 표시한다.

특정 브라우저가 `beforeinstallprompt`를 지원할 것이라고 브라우저명으로 추정하지 않는다.

**기능 존재 여부를 feature detection으로 판단한다.**

---

# 17. QA

다음 Matrix를 반드시 검증한다.

### Parent

- iPhone Safari 일반 브라우저
- iPhone 설치 완료 PWA
- Android Chrome 설치 전
- Android Chrome 설치 후
- KakaoTalk iOS
- KakaoTalk Android
- NAVER iOS
- NAVER Android
- Instagram iOS
- Instagram Android
- Facebook iOS
- Facebook Android

### Child

위와 동일하게 검증한다.

---

## 필수 회귀 QA

- Parent Push Notification 안내 정상
- Child Push Notification 안내 정상
- PWA Service Worker 등록 정상
- 기존 설치 PWA 실행 정상
- 로그인 정상
- 자동 로그인 정상
- Parent Home 정상
- Child Home 정상
- 설치 배너가 본문을 가리지 않음
- Modal 종료 후 기존 페이지 상태 유지
- Browser Back 동작 정상

---

# 18. 완료 조건

다음 조건을 모두 만족해야 완료다.

- [ ] 부모/아이 설치 로직 공통화
- [ ] Android installPrompt 정상
- [ ] iOS Safari 상세 설치 Modal 정상
- [ ] Safari 설치 가이드가 최신 공식 절차 반영
- [ ] Kakao In-App 감지
- [ ] NAVER In-App 감지
- [ ] Instagram In-App 감지
- [ ] Facebook In-App 감지
- [ ] Unknown In-App fallback
- [ ] 외부 브라우저 안내 정상
- [ ] 주소 복사 fallback 정상
- [ ] native `alert()` 0건
- [ ] 상단 PWA 설치 중복 안내 제거
- [ ] Push Notification 기능 회귀 없음
- [ ] 설치된 PWA에서 설치 UI 미노출
- [ ] Parent / Child UX 동일
- [ ] Dev QA 완료
- [ ] 기존 인증/온보딩/SW 회귀 없음

---

# 19. 완료 보고

완료 후 다음 형식으로 보고한다.

```text
1. 변경 파일
2. 공통 PWA 설치 Architecture
3. Browser Context 판별 방식
4. Android 설치 처리
5. iOS Safari Modal 구현 결과
6. In-App Browser별 판별 결과
   - Kakao
   - NAVER
   - Instagram
   - Facebook
   - Other
7. 외부 브라우저 이동 방식 및 fallback
8. 제거한 기존 중복 로직
9. Parent QA 결과
10. Child QA 결과
11. OS/App별 실제 테스트 결과
12. Push Notification 회귀 테스트 결과
13. PWA Service Worker 회귀 테스트 결과
14. 미확인/제약사항
15. Dev 배포 결과
```

**앱별 메뉴를 실제 단말에서 확인하지 못한 항목은 PASS로 처리하지 말고 `미검증`으로 명확하게 보고한다.**

Request 폴더에 `101` 번호가 이미 존재할 경우 기존 파일을 덮어쓰지 말고 다음 사용 가능한 번호로 변경하여 보고한다.