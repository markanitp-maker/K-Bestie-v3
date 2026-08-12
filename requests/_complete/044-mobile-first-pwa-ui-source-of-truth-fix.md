# 044 — 실제 모바일 PWA 최우선 UI 기준 확립 및 반응형 전면 교정

## 1. 작업 배경

내친구 케이의 실제 사용 환경은 모바일이 약 99%다.

그런데 최근 아이 홈과 케이와 놀이 화면을 수정하면서 다음 문제가 반복되고 있다.

- PC 설치형 PWA의 스마트폰 프레임에서는 요청한 UI가 표시됨
- 실제 모바일 설치형 PWA에서는 카드 크기·배치·여백이 전혀 다르게 표시됨
- PC 화면만 보고 작업을 완료 처리함
- 모바일에서는 2열이어야 할 카드가 1열 대형 카드로 표시됨
- 모바일 카드·폰트·여백이 과도하게 커짐
- 케이 마스코트와 하단 CTA가 화면 아래로 밀림
- 새 버전 배포 후 모바일 PWA가 이전 CSS·JS를 사용할 가능성도 있음
- 같은 서버인데 PC PWA와 모바일 PWA가 서로 다른 제품처럼 보임

이 문제는 개별 화면의 미세한 CSS 오류가 아니라 다음 두 가지가 복합적으로 발생한 것으로 본다.

1. 실제 모바일 PWA를 최종 검증 환경으로 사용하지 않은 개발·QA 절차 문제
2. PC 디바이스 프레임 전용 레이아웃과 실제 모바일 레이아웃이 분리된 코드 구조 또는 캐시 문제

이번 작업에서는 실제 모바일 PWA를 유일한 1차 기준으로 삼아 원인을 확인하고 아이용 핵심 화면의 반응형 구조를 교정한다.

---

# 2. 최우선 원칙

## 절대 기준

```text
실제 모바일 설치형 PWA
>
실제 모바일 브라우저
>
태블릿
>
PC 스마트폰 프레임 미리보기
>
일반 PC 화면
```

PC 스마트폰 프레임은 개발 편의를 위한 미리보기일 뿐 최종 기준이 아니다.

PC 프레임에서 정상으로 보여도 실제 모바일 PWA에서 다르면 해당 작업은 실패다.

## 완료 판정 금지 조건

다음 중 하나라도 해당하면 완료 처리하지 않는다.

- 실제 모바일 PWA를 확인하지 않음
- PC DevTools 모바일 에뮬레이션만 확인함
- PC 스마트폰 프레임만 확인함
- 모바일 브라우저만 확인하고 설치형 PWA를 확인하지 않음
- 화면 캡처 없이 육안으로만 PASS 처리함
- 모바일 PWA가 최신 Build인지 확인하지 않음
- iOS 또는 Android 중 한 환경도 확인하지 않음
- 모바일에서 가로 스크롤·과도한 스크롤·카드 확대가 남아 있음

---

# 3. 이번 작업의 대상

우선 다음 아이용 핵심 화면을 감사하고 교정한다.

1. 아이 홈
2. 케이와 놀이
3. 미션 진입 화면
4. 미션 대화 화면
5. 퀴즈마스터
6. 오늘의 나·MBTI

이번 캡처에서 즉시 수정할 최우선 화면은 다음이다.

```text
아이 홈
케이와 놀이
```

다른 화면에도 동일한 구조적 원인이 존재하는지 함께 감사한다.

---

# 4. 선행 원인 감사

코드를 변경하기 전에 실제 모바일 PWA와 PC PWA에서 다음 정보를 수집한다.

```text
현재 URL
App Build ID
Deployment ID 또는 Commit SHA
Active Service Worker Version
Waiting Service Worker Version
CSS Chunk Hash
Cache Storage Name
window.innerWidth
window.innerHeight
visualViewport.width
visualViewport.height
devicePixelRatio
display-mode
navigator.standalone
document.documentElement class
body class
상위 Layout의 data-* 속성
```

개발 환경에서 구조화된 로그로 한 번에 비교 가능하게 한다.

민감한 환경변수나 인증 정보는 출력하지 않는다.

---

# 5. 원인 판정

## A. 모바일과 PC의 Build ID가 다른 경우

모바일 PWA가 이전 Service Worker 또는 Cache를 사용하는 문제다.

이 경우 다음을 먼저 해결한다.

- 새 버전 업데이트 감지
- Waiting Worker 감지
- 업데이트 안내 표시
- 사용자 승인 후 `SKIP_WAITING`
- `controllerchange` 후 1회 Reload
- 최신 CSS·JS Chunk 적용
- 이전 Precache 제거
- PWA 삭제·재설치 없이 최신 버전 전환

`040-pwa-new-version-update-notification-fix.md` 구현 여부와 실제 동작을 확인한다.

모바일 PWA가 이전 Build를 사용하는 상태에서는 CSS 수정 결과를 판단하지 않는다.

## B. Build ID가 같은데 UI가 다른 경우

동일 코드 안에 PC 프레임 전용 레이아웃과 실제 모바일 레이아웃이 별도로 존재하는 문제다.

다음 항목을 전수 확인한다.

- `isDevicePreview`
- `deviceMode`
- `isMobile`
- `isDesktop`
- `isPwa`
- `navigator.standalone`
- `display-mode: standalone`
- User-Agent 기반 조건부 렌더링
- `data-device`
- `data-preview`
- `.phone-preview`
- `.device-frame`
- `.device-viewport`
- 스마트폰 프레임 전용 CSS
- `@media` 분기
- `@container` 분기
- Container Query 부모의 `container-type`
- Tailwind `sm:`, `md:`, `lg:` 클래스
- `transform: scale()`
- `zoom`
- `vw` 기반 폰트·패딩·높이
- 모바일 전용 CSS override
- PC 프레임 전용 DOM

정확히 어떤 Selector와 컴포넌트 분기가 실제 모바일과 PC 프레임을 다르게 만드는지 작업 완료 보고서에 명시한다.

---

# 6. 구조 교정 원칙

외곽 디바이스 프레임과 앱 내부 콘텐츠를 완전히 분리한다.

```text
DesktopDevicePreview
└─ DeviceFrame
   └─ ChildAppContent

ActualMobilePWA
└─ ChildAppContent
```

핵심 원칙:

- `ChildAppContent`는 실제 모바일과 PC 프레임에서 같은 컴포넌트를 사용
- 같은 DOM 구조 사용
- 같은 CSS Token 사용
- 같은 Grid 규칙 사용
- 같은 글자 크기 사용
- 같은 카드 높이 사용
- 같은 간격 사용
- 외곽 Device Frame만 PC에서 추가
- 실제 모바일에는 스마트폰 외곽 목업을 추가하지 않음

Device Frame이 내부 카드 Grid·폰트·여백을 바꾸면 안 된다.

---

# 7. 모바일 우선 CSS 기준

모든 아이용 화면의 기본 CSS는 모바일을 기준으로 작성한다.

기본값이 모바일이며, 큰 화면에서 필요한 부분만 확장한다.

잘못된 방식:

```css
/* PC 대형 UI가 기본이고 모바일에서 일부만 축소 */
.card {
  min-height: 260px;
  padding: 32px;
}

@media (max-width: 430px) {
  /* 일부 값만 수정 */
}
```

권장 방식:

```css
/* 실제 모바일이 기본 */
.card {
  min-height: 112px;
  padding: 14px;
}

@media (min-width: 768px) {
  /* 태블릿에서 필요한 경우만 확장 */
}
```

모바일 스타일이 별도 Override에 의존하지 않도록 한다.

---

# 8. 실제 모바일 Viewport 설정

Root Layout의 Viewport 설정을 확인한다.

필수:

```text
width=device-width
initial-scale=1
viewport-fit=cover
```

Next.js Metadata API를 사용한다면 프로젝트 정본 방식으로 적용한다.

다음을 확인한다.

- 실제 모바일 CSS Viewport가 기기 너비와 일치
- PWA Standalone에서도 같은 Viewport 사용
- 980px 가상 Viewport로 렌더링되지 않음
- 확대·축소 때문에 Breakpoint가 바뀌지 않음
- iOS Safe Area 정상 적용

---

# 9. 케이와 놀이 화면 최종 모바일 구조

실제 모바일 PWA에서 다음 구조를 사용한다.

```text
[뒤로]       케이와 놀이       [로그아웃]

[열쇠 11개]                [더 모으기]

열쇠로 열어요

[퀴즈마스터] [오늘의 나]

곧 만나요

[만화책 읽기] [헤어스타일]

[케이 마스코트] [미션 하면 열쇠를 줄게!]
                 [미션하러 가기]
```

## 핵심 기준

- 활성 놀이 2열
- 준비 중 놀이 2열
- 카드가 화면 전체 너비를 한 장씩 차지하지 않음
- 모바일 첫 화면 또는 최소 스크롤 안에 주요 놀이와 미션 CTA 노출
- 마스코트와 CTA가 과도하게 아래로 밀리지 않음
- 카드 안에 의미 없는 큰 빈 공간 없음

---

# 10. 활성 놀이 카드 모바일 기준

대상:

- 퀴즈마스터
- 오늘의 나

일반적인 320px~430px 실제 모바일에서 반드시 2열로 표시한다.

권장 Grid:

```css
grid-template-columns: repeat(2, minmax(0, 1fr));
gap: 8px 10px;
```

권장 카드:

```text
높이: 112px~138px
padding: 12px~14px
radius: 16px~20px
아이콘 영역: 42px~52px
제목: 15px~17px
설명: 11px~13px
열쇠 정보: 11px~13px
```

### 1열 전환 허용

다음 경우에만 1열 전환을 허용한다.

- CSS Viewport 300px 미만
- 접근성 글꼴 200%에서 실제 겹침 발생
- 카드 최소 터치 영역을 유지할 수 없음

360px, 375px, 390px, 414px, 430px에서는 2열 유지가 기본이다.

---

# 11. 준비 중 카드 모바일 기준

대상:

- 만화책 읽기
- 헤어스타일

기준:

- 2열 유지
- 높이 약 82px~105px
- 클릭 불가
- 황금열쇠 차감 없음
- `준비 중` 표시
- 활성 놀이보다 낮은 시각적 우선순위
- 과도한 빈 공간 제거

---

# 12. 열쇠 영역 모바일 기준

현재 모바일의 열쇠 영역은 PC 프레임보다 지나치게 크다.

권장:

```text
높이: 64px~78px
좌우 padding: 16px
아이콘: 24px~30px
열쇠 수량: 17px~20px
더 모으기 버튼 높이: 42px~48px
```

문의 버튼이 열쇠 영역이나 로그아웃 버튼을 가리지 않도록 한다.

---

# 13. 하단 케이 CTA 영역

모바일에서 케이와 미션 CTA가 화면 아래로 과도하게 밀리지 않게 한다.

권장 구조:

```text
[마스코트] [미션 하면 열쇠를 줄게!]
           [미션하러 가기 →]
```

기준:

- 마스코트 크기 약 105px~145px
- 말풍선과 버튼은 우측에 배치
- CTA 버튼 높이 약 44px~52px
- 화면 폭에 맞게 한 묶음으로 배치
- 하단 Safe Area 반영
- PC 프레임 내부와 실제 모바일에서 동일한 내부 구조 사용

---

# 14. 아이 홈 화면 모바일 기준

아이 홈도 같은 원칙을 적용한다.

실제 모바일에서:

- 마스코트가 화면을 과도하게 차지하지 않음
- 인사 문구가 지나치게 크지 않음
- 미션 카드는 전체 너비
- 대화하기·케이와 놀이 카드는 2열
- 주요 메뉴가 최소 스크롤 안에 표시
- PC 프레임 전용 Compact CSS에 의존하지 않음

---

# 15. `vw` 기반 크기 제한

다음을 전수 감사한다.

```text
font-size: ?vw
padding: ?vw
min-height: ?vw
width: ?vw
```

모바일에서 전체 화면 너비에 비례해 카드·글자·여백이 과도하게 확대되는 값을 제거한다.

권장:

- `rem`
- `px`
- 제한된 `clamp()`
- 공통 Design Token

예시:

```css
font-size: clamp(15px, 4vw, 17px);
```

상한 없는 `6vw`, `8vw` 사용을 금지한다.

---

# 16. Container Query 정합성

PC Device Frame 안에서만 Container Query가 작동하고 실제 모바일에서는 작동하지 않는지 확인한다.

Container Query를 사용한다면 실제 모바일의 동일 콘텐츠 루트에도 같은 Container Context를 제공한다.

예시:

```css
.child-content-container {
  container-type: inline-size;
}
```

단, 일반 CSS Media Query로 충분하면 불필요한 Container Query를 제거한다.

---

# 17. PWA 업데이트와 캐시 검증

모바일 UI 수정 배포 후 다음 절차를 반드시 수행한다.

1. 모바일 PWA에 기존 Build A 설치
2. 수정된 Build B 배포
3. PWA 삭제 금지
4. 사이트 데이터 수동 삭제 금지
5. 기존 모바일 PWA 실행
6. 새 버전 업데이트 안내 확인
7. `새로고침` 선택
8. Active Build ID가 B로 변경됐는지 확인
9. 최신 CSS Chunk 적용 확인
10. 수정된 모바일 UI 확인

PWA를 삭제·재설치해야만 최신 UI가 나오면 실패다.

---

# 18. 문의 버튼 처리

문의 버튼 위치는 기기별 저장 좌표 때문에 다를 수 있다.

다음 Metadata 또는 동등한 검증을 사용한다.

```text
layoutVersion
viewportWidth
viewportHeight
displayMode
```

다음 상황에서 기본 위치로 재설정한다.

- Layout Version 변경
- 저장 좌표가 현재 Viewport 밖
- 문의 버튼이 로그아웃을 가림
- 문의 버튼이 핵심 CTA를 가림
- Safe Area 밖
- PC 프레임 좌표를 모바일에서 사용
- 모바일 좌표를 PC 프레임에서 사용

현재 Viewport 내부로 Clamp한다.

---

# 19. 모바일 실기기 QA 필수

다음 중 최소 하나의 iOS 실기기와 하나의 Android 실기기 또는 동등한 실제 설치형 환경을 확인한다.

## iOS

- Safari
- 홈 화면 추가 PWA
- 390×844 또는 유사 기기

## Android

- Chrome
- 설치형 PWA
- 360×800 또는 412×915 계열

PC DevTools 에뮬레이션은 보조 확인으로만 사용한다.

---

# 20. 모바일 스크린샷 증빙

작업 완료 시 반드시 다음 스크린샷을 제출한다.

1. 실제 iOS 또는 iOS 홈 화면 PWA의 아이 홈
2. 실제 iOS 또는 iOS 홈 화면 PWA의 케이와 놀이
3. 실제 Android PWA의 아이 홈
4. 실제 Android PWA의 케이와 놀이
5. 동일 Build ID 진단 화면 또는 로그
6. PC 스마트폰 프레임 내부 비교 화면

스크린샷에 실제 해상도와 Build ID를 함께 기록한다.

PC 화면 캡처만으로 완료 보고하지 않는다.

---

# 21. 해상도별 QA

다음 CSS Viewport를 검사한다.

```text
320×568
360×800
375×667
390×844
393×852
412×915
414×896
430×932
768×1024
```

확인 항목:

- 활성 놀이 2열
- 준비 중 놀이 2열
- 카드 가로 겹침 없음
- 텍스트 잘림 없음
- 가로 스크롤 없음
- 열쇠 카드 과대 표시 없음
- 케이 CTA가 지나치게 아래로 밀리지 않음
- 문의 버튼이 콘텐츠를 가리지 않음
- 하단 Safe Area 정상
- Body와 내부 영역의 이중 스크롤 없음

---

# 22. 모바일 성능 기준

모바일 우선 교정 과정에서 다음도 확인한다.

- 불필요한 중복 DOM 제거
- 레이아웃 변경에 따른 CLS 최소화
- 마스코트 이미지 크기와 실제 렌더 크기 적정화
- 고해상도 이미지를 매번 원본 전체 크기로 Decode하지 않음
- 스크롤 중 과도한 Repaint 없음
- Device Preview용 불필요한 로직이 모바일 Bundle에서 실행되지 않도록 검토

이번 작업의 핵심은 시각적 일치이므로 대규모 성능 리팩터링은 하지 않는다.

---

# 23. 기존 기능 보존

다음 기능은 변경하지 않는다.

- 황금열쇠 수량
- 더 모으기
- 퀴즈마스터 잠금 및 시작
- 오늘의 나 잠금 및 시작
- 만화책 읽기 준비 중
- 헤어스타일 준비 중
- 미션하러 가기
- 문의 버튼
- 로그아웃
- 놀이 차감·환불
- 미션 보상
- PWA 설치
- 인증
- 세션
- DB
- API

이번 작업은 모바일 우선 반응형 UI와 PWA 최신 버전 반영 안정화에 한정한다.

---

# 24. 금지 사항

- PC 스마트폰 프레임만 보고 PASS 처리
- PC DevTools 모바일 모드만 보고 PASS 처리
- 실제 모바일 확인 없이 완료 보고
- 실제 모바일에 스마트폰 외곽 프레임 추가
- 모바일과 PC 프레임에 서로 다른 콘텐츠 컴포넌트 유지
- User-Agent별 임시 CSS
- 모바일 전체 화면을 `transform: scale()`로 축소
- PWA 삭제·재설치를 정상 업데이트 방식으로 사용
- 카드가 안 맞는다는 이유로 글자만 과도하게 축소
- 활성 놀이를 일반 모바일에서 1열로 유지
- 기존 기능을 UI 교정과 함께 임의 변경

---

# 25. 완료 기준

다음 조건을 모두 충족해야 완료로 판정한다.

- 실제 모바일 PWA를 1차 기준으로 구현함
- 모바일과 PC PWA의 Build ID가 동일함
- 모바일이 이전 CSS·JS Cache를 사용하지 않음
- 실제 모바일과 PC 프레임 내부가 같은 콘텐츠 컴포넌트를 사용함
- 외곽 Device Frame이 내부 Layout을 변경하지 않음
- 실제 모바일 케이와 놀이의 활성 놀이가 2열로 표시됨
- 준비 중 놀이가 2열로 표시됨
- 카드 크기와 여백이 모바일에 맞게 축소됨
- 하단 케이 CTA가 최소 스크롤 안에 노출됨
- 아이 홈의 대화·놀이 카드도 2열로 표시됨
- 모바일에 과도한 마스코트·글자·카드 확대가 없음
- 문의 버튼이 핵심 UI를 가리지 않음
- iOS 홈 화면 PWA QA 통과
- Android 설치형 PWA QA 통과
- PWA 삭제·재설치 없이 새 버전 적용 성공
- 실제 모바일 스크린샷 증빙 완료
- PC 프레임 미리보기와 실제 모바일 내부 UI가 ±5% 범위로 일치함
- 기존 미션·놀이·열쇠·로그아웃·문의 기능에 회귀가 없음
- lint 통과
- typecheck 통과
- 관련 test 통과
- production build 통과

---

# 26. 작업 완료 보고

작업 완료 후 다음을 보고한다.

1. 실제 모바일을 기준으로 사용한 이유와 적용 범위
2. PC PWA와 모바일 PWA의 기존 Build ID
3. Active·Waiting Service Worker 상태
4. 캐시 문제 여부
5. 서로 다른 UI가 나온 정확한 원인
6. 원인 Selector와 컴포넌트 경로
7. 변경 파일 목록
8. 공통 모바일 콘텐츠 컴포넌트 구조
9. Device Frame과 내부 콘텐츠 분리 방식
10. Viewport Meta 설정
11. 실제 모바일 `innerWidth`
12. 실제 모바일 `visualViewport.width`
13. 활성 놀이 Grid 기존값과 변경값
14. 활성 놀이 카드 실제 높이
15. 준비 중 카드 실제 높이
16. 열쇠 영역 실제 높이
17. 케이 CTA 배치 방식
18. 아이 홈 2열 카드 적용 결과
19. `vw` 기반 크기 제거 또는 제한 결과
20. Container Query 감사 결과
21. 문의 버튼 좌표 초기화·Clamp 방식
22. Build A에서 Build B 업데이트 적용 결과
23. iOS Safari QA 결과
24. iOS 홈 화면 PWA QA 결과
25. Android Chrome QA 결과
26. Android 설치형 PWA QA 결과
27. 320×568 QA 결과
28. 360×800 QA 결과
29. 390×844 QA 결과
30. 430×932 QA 결과
31. 태블릿 QA 결과
32. 실제 모바일 스크린샷 경로
33. PC 프레임 비교 스크린샷 경로
34. lint 결과
35. typecheck 결과
36. test 결과
37. production build 결과
38. 기존 기능 미변경 근거
39. 남아 있는 위험 요소

---

# 27. 향후 모든 UI 작업의 고정 규칙

이 요청 완료 이후 모든 아이용 UI 작업에는 다음 절차를 고정 적용한다.

```text
1. 실제 모바일 PWA에서 기존 화면 캡처
2. 모바일 기준으로 구현
3. 360px·390px·430px 확인
4. iOS 또는 Android 설치형 PWA 확인
5. 실제 모바일 스크린샷 비교
6. 태블릿 확인
7. 마지막으로 PC 프레임 미리보기 확인
```

PC 화면부터 맞추고 모바일을 나중에 보정하는 방식은 더 이상 사용하지 않는다.

실제 모바일 PWA가 PASS하지 않으면 해당 Request는 완료되지 않은 것으로 처리한다.
