073-responsive-ui-cross-device-preview-alignment.md

# 아이 화면 반응형 UI 크로스디바이스·Preview 정합성 개선

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- PC 일반 웹, PC 스마트폰 Preview, PC 태블릿 Preview, 실제 스마트폰, 실제 태블릿에서 아이 화면이 동일한 반응형 규칙으로 동작한다.
- PC Preview가 프레임만 작아지는 것이 아니라 내부 UI도 Preview 컨테이너 크기에 맞춰 실제 스마트폰/태블릿과 같은 기준으로 반응한다.
- 실제 스마트폰과 PC 스마트폰 Preview 사이의 말풍선, 마스코트, 버튼, 헤더, 하단 컨트롤의 크기·정렬·간격 차이를 제거한다.
- 실제 태블릿과 PC 태블릿 Preview에서 콘텐츠가 스마트폰 폭 430~480px의 좁은 띠로 고정되지 않고, 기존 UI 구조를 유지한 채 태블릿 가용 폭에 자연스럽게 맞는다.
- 잘림, 겹침, 과도한 여백, 가로 스크롤, 비정상 세로 스크롤이 없어야 한다.
- 새로운 UI를 만들지 않는다. 이번 작업은 기존 UI의 responsive rule / viewport / wrapper 정합성 수정이다.

### 대표님 테스트 정상 프로세스
1. Dev PC 웹에서 아이 홈으로 진입한다.
2. PC 일반 웹 상태를 확인한다.
3. PC의 스마트폰 Preview로 전환한다.
4. 실제 iPhone/Android 화면과 비교하여 주요 요소의 상대적 크기·정렬·간격이 같은 responsive rule로 보이는지 확인한다.
5. PC의 태블릿 Preview로 전환한다.
6. 실제 iPad/Android 태블릿과 비교하여 태블릿이 스마트폰 폭의 좁은 중앙 띠로 표시되지 않고 기존 UI가 자연스럽게 확장되는지 확인한다.
7. 아이 홈, 미션, 자유대화, 놀이 홈, 대표 놀이 화면을 각각 확인한다.
8. 실제 iPhone Safari / iPhone PWA / Android Chrome / Android PWA / 실제 태블릿에서 잘림·겹침·가로 overflow가 없는지 확인한다.
9. Dev 전체 QA PASS 후 동일 Commit을 Production에 배포한다.

PASS:
- Preview와 실제 기기가 동일한 responsive rule을 사용한다.
- 스마트폰에서 UI가 잘리지 않는다.
- 태블릿에서 스마트폰용 좁은 띠로 고정되지 않는다.
- 기존 디자인과 기능은 유지된다.
- 환경별로 임의의 px 보정을 따로 넣지 않아도 안정적으로 동작한다.

---

## 1. 작업 목적

현재 아이 화면은 PC DemoFrame Preview와 실제 스마트폰/태블릿이 서로 다른 기준으로 레이아웃을 계산하고 있어 같은 화면이 환경별로 다르게 보인다.

Antigravity READ-ONLY 전수조사에서 다음 핵심 원인이 확인되었다.

1. PC Preview는 외부 프레임만 스마트폰/태블릿 크기로 줄지만 내부 CSS의 `vw`, Tailwind `sm/md` 등은 여전히 PC 브라우저 window 크기 기준으로 계산된다.
2. 주요 화면의 `max-w-[430px]`, `max-w-[480px]`가 혼재되어 헤더·본문 폭과 화면별 정렬 기준이 다르다.
3. 실제 태블릿에서도 모바일용 max-width에 묶여 중앙에 좁은 스마트폰형 콘텐츠만 표시된다.
4. `DemoFrame`, 개별 페이지, `100dvh`, inline patch가 혼재하여 높이와 overflow 계산이 일관되지 않다.
5. `(pointer: fine) and (min-width: 900px)` 기반 PC 판정은 마우스/트랙패드가 연결된 태블릿을 PC로 오인할 위험이 있다.

이번 작업은 위 문제를 공통 기반부터 수정하여 전체 아이 화면의 반응형 동작을 일관되게 만드는 것이 목적이다.

---

## 2. 작업 범위

### 대상 화면
최소 다음 아이 화면 전체를 포함한다.
- 아이 홈
- 미션
- 자유대화
- 놀이 홈
- MBTI
- 퀴즈마스터
- 알림 센터
- 미션 완료
- 위 화면들이 공유하는 공통 헤더 / DemoFrame / PlayFrame / 챗봇 위젯

### 주요 대상 파일
- `app/globals.css`
- `app/demo/components/DemoFrame.tsx`
- `app/demo/components/DemoViewContext.tsx`
- `components/AppTopHeader.tsx`
- `components/MissionConversationLayout.tsx`
- `components/play/PlayFrame.tsx`
- `components/KChatbotWidget.tsx`
- `app/child/home/page.tsx`
- `app/chat/page.tsx`
- `app/child/play/page.tsx`
- `app/child/missions/page.tsx`
- `app/child/finish/page.tsx`
- `app/child/notifications/page.tsx`

Codex는 실제 현재 브랜치 코드를 먼저 확인하고, 감사 결과와 다르면 현재 코드 기준으로 진행한다.

---

## 3. 최우선 원칙

이번 작업은 UI 리디자인이 아니다.

### 반드시 유지
- 현재 색상
- 현재 카드 형태
- 현재 말풍선
- 현재 마스코트
- 현재 버튼 디자인
- 현재 헤더
- 현재 하단 컨트롤
- 현재 미션/자유대화 기능
- 현재 놀이 기능
- 현재 정보 구조

### 금지
- 태블릿용 신규 2열 UI 설계
- 태블릿용 신규 3~4열 카드 UI 임의 추가
- 화면별 새로운 디자인 제작
- 마스코트 크기/위치 임의 재설계
- PC/iPhone/Android별 하드코딩 CSS 분기
- UA sniffing으로 화면별 CSS를 따로 만드는 방식
- `transform: scale(...)`, `zoom`, negative margin으로 증상 덮기
- 기능/DB/API/대화 로직 변경

태블릿은 우선 기존 UI 구조를 그대로 유지하면서 가용 폭에 맞게 자연스럽게 확장시키는 것이 목표다.

---

## 4. P0 — 공통 Responsive Foundation 수정

### 4-1. Width 기준 단일화
현재 `430px`, `480px`가 화면별로 혼재하고 있다.

Codex는 전체 사용 위치를 확인한 뒤 공통 layout token을 정의하고 화면별 하드코딩 값을 공통 기준으로 통일한다.

원칙:
- 스마트폰용 기본 content width
- 태블릿에서 사용할 수 있는 확장 content width
- PC DemoFrame 내부 content width
를 공통 token/utility 기준으로 관리한다.

주의:
- 감사 보고의 예시 값 `440px`, `720px`, `860px`를 무조건 적용하지 않는다.
- 현재 UI와 실제 기기 QA 기준으로 최소 적정값을 확정한다.
- 동일 화면의 Header와 Body가 서로 다른 max-width를 사용하지 않도록 정리한다.

### 4-2. PC Preview의 기준을 Window가 아닌 Preview Container로 전환
현재 문제:
- PC 브라우저 `window.innerWidth = 1920px`
- 스마트폰 Preview 내부 실제 폭 ≈ 424px
- 내부 `vw`, `sm:`, `md:` 등이 1920px 기준으로 계산됨

PC Preview 내부에서는 UI가 브라우저 전체 window가 아니라 Preview의 실제 inner container 크기를 기준으로 반응해야 한다.

권장 방향:
- 필요한 화면에서 container query 또는 container 기준 CSS 변수/utility 사용
- Preview 내부 `vw` 의존 값을 container 기반 비율로 교체
- Preview에서 viewport breakpoint가 실제 스마트폰/태블릿 크기를 잘못 판정하는 부분을 container 기반 규칙으로 변경

주의:
- 전체 프로젝트의 모든 `sm/md`를 무조건 제거하지 않는다.
- Preview와 실제 device 간 결과를 다르게 만드는 위치만 최소 수정한다.

### 4-3. Device 판정 안정화
현재 `(pointer: fine) and (min-width: 900px)` 조건만으로 PC를 판정하여 태블릿이 PC로 오인될 수 있다.

PASS:
- 실제 iPad/Android tablet에서 mouse/trackpad가 연결되어도 PC 목업 프레임이 기기 안에 중첩되어 나오지 않는다.
- 일반 PC에서는 기존 DemoFrame Preview 기능이 유지된다.

브라우저 UA 문자열에 의존하는 단순 하드코딩은 금지한다.

---

## 5. P1 — DemoFrame / 공통 Wrapper 정합성

### 5-1. DemoFrame
수정 목표:
- 스마트폰 Preview 내부 UI는 스마트폰 container 크기 기준으로 렌더
- 태블릿 Preview 내부 UI는 태블릿 container 크기 기준으로 렌더
- 실제 smartphone/tablet과 동일 responsive rule 사용
- Preview를 위한 별도 가짜 UI CSS를 만들지 않는다.

목업 프레임의 베젤, 상태바, 다이나믹 아일랜드/카메라, 홈 인디케이터는 기존 디자인을 유지한다.

### 5-2. 실제 Device Wrapper
실제 모바일/태블릿의 `w-full h-dvh overflow-y-auto` 구조와 내부 page의 height/overflow 충돌을 점검하고 필요한 최소 수정만 한다.

목표:
- root scroll container 명확화
- 불필요한 nested scroll 제거
- 화면 height 계산 중복 제거
- 잘림 없는 전체 화면 표시

### 5-3. AppTopHeader
현재 헤더 `max-w-[430px]`와 일부 본문 `max-w-[480px]` 불일치를 해소한다.

목표:
- Header가 현재 화면 content container와 동일한 폭 계약 사용
- 스마트폰/태블릿/Preview에서 좌우 경계 일치
- 헤더 디자인 자체는 변경하지 않음

### 5-4. PlayFrame / iframe
MBTI / 퀴즈마스터 등 iframe 화면에서 모바일/태블릿 가용 폭, height, overflow, aspect ratio가 wrapper 때문에 잘리지 않는지 확인한다.

iframe 내부 서비스 자체를 재설계하지 않는다.
이번 범위는 K-Bestie wrapper 정합성까지만이다.

---

## 6. P2 — 화면별 잔여 Responsive 오류 수정

P0/P1 수정 후에도 남는 차이만 화면별로 수정한다.

### 6-1. 아이 홈
- PC smartphone Preview vs 실제 smartphone
- PC tablet Preview vs 실제 tablet
- `max-w-[430px]`
- 카드/마스코트/CTA 잘림
- horizontal overflow

새로운 tablet UI를 만들지 않고 기존 카드 구조를 자연스럽게 확장한다.

### 6-2. 미션
확인:
- Header와 대화 container 폭 불일치
- `max-w-[480px]`
- viewport/container 기준이 잘못된 `vw`
- 진행률
- 말풍선
- 시작/이어하기 버튼
- 마스코트
- 받침대
- 하단 control

기존 미션 UI 디자인은 유지한다.

### 6-3. 자유대화
확인:
- `clamp(...vw...)` 사용 부분
- 마스코트/말풍선 크기가 PC Preview와 실제 device에서 달라지는 부분
- DemoFrame wrapper
- height / scroll
- keyboard mode

기존 자유대화 UI 디자인은 유지한다.

### 6-4. 놀이 홈
현재 카드 layout을 유지한다.
이번 작업에서 임의로 tablet 3열/4열 구조를 새로 만들지 않는다.
기존 UI가 태블릿에서 잘리지 않고 자연스럽게 표시되도록 width/spacing만 정합화한다.

### 6-5. 완료/알림 등 기타 화면
DemoFrame 사용 여부 차이 때문에 다른 아이 화면과 동작이 달라지는지 확인하고 동일 responsive foundation을 적용한다.

---

## 7. Viewport / Height / Overflow 원칙

전체 대상 화면에서 다음을 점검한다.
- `100vh`
- `100dvh`
- `100svh`
- `100lvh`
- `h-screen`
- `w-screen`
- fixed px height
- nested `overflow-y-auto`
- `overflow-hidden`
- `safe-area-inset-*`
- `visualViewport`

원칙:
1. 같은 화면에서 viewport height와 parent percentage height를 섞어 중복 계산하지 않는다.
2. 실제 device와 DemoFrame Preview에서 가능한 한 동일한 component/layout rule을 사용한다.
3. keyboard가 필요한 미션/자유대화는 기존 keyboard viewport 개선 로직을 훼손하지 않는다.
4. safe-area는 실제 device에서만 필요한 OS 영역을 올바르게 보호한다.
5. PC Preview의 인공 status bar padding과 실제 safe-area를 동일 값이라고 가정하지 않는다.

---

## 8. Visual QA 자동화

이번 작업은 코드 테스트만으로 완료 처리하지 않는다.

Playwright 기반 screenshot/regression 검증을 추가하거나 기존 QA를 확장한다.

### 최소 대표 viewport
PC:
- Desktop 1920×1080
- DemoFrame smartphone
- DemoFrame tablet

Smartphone:
- 390×844
- 412×915

Tablet:
- 810×1080
- 1080×810

### 검증 화면
- 아이 홈
- 미션
- 자유대화
- 놀이 홈
- MBTI 또는 퀴즈마스터 대표 1개

### 자동 QA 확인
- `scrollWidth <= clientWidth`
- 주요 CTA가 viewport 안에 존재
- Header가 container 밖으로 벗어나지 않음
- 마스코트/말풍선/하단 control overlap 없음
- screenshot baseline 대비 의도하지 않은 대규모 UI 이동 없음

Playwright Device Mode 결과를 실제 기기 QA의 대체로 사용하지 않는다.

---

## 9. 실기기 QA Matrix

| 환경 | 홈 | 미션 | 자유대화 | 놀이 | PASS 기준 |
|---|---|---|---|---|---|
| PC 일반 웹 | 확인 | 확인 | 확인 | 확인 | DemoFrame 정상 |
| PC 스마트폰 Preview | 확인 | 확인 | 확인 | 확인 | 실제 smartphone와 동일 responsive rule |
| PC 태블릿 Preview | 확인 | 확인 | 확인 | 확인 | 좁은 phone 띠 현상 없음 |
| iPhone Safari | 확인 | 확인 | 확인 | 확인 | 잘림/겹침/overflow 없음 |
| iPhone PWA | 확인 | 확인 | 확인 | 확인 | safe-area/height 정상 |
| Android Chrome | 확인 | 확인 | 확인 | 확인 | 잘림/하단 겹침 없음 |
| Android PWA | 확인 | 확인 | 확인 | 확인 | 전체화면 정상 |
| iPad/Tablet 세로 | 확인 | 확인 | 확인 | 확인 | 전체 가용 폭 자연스럽게 사용 |
| iPad/Tablet 가로 | 확인 | 확인 | 확인 | 확인 | PC 목업 프레임 중첩 없음 |

---

## 10. 완료 조건

1. PC smartphone Preview와 실제 smartphone가 동일 responsive rule을 사용한다.
2. PC tablet Preview와 실제 tablet가 동일 responsive rule을 사용한다.
3. 실제 tablet에서 스마트폰 폭 430~480px의 좁은 중앙 띠로 강제되지 않는다.
4. Header / Body의 폭 기준이 일치한다.
5. Preview 내부 `vw` / breakpoint가 PC window 크기로 잘못 계산되어 UI가 달라지는 핵심 문제가 해소된다.
6. 실제 태블릿이 PC로 오인되어 DemoFrame이 중첩되지 않는다.
7. 홈/미션/자유대화/놀이 대표 화면 잘림 없음.
8. 가로 overflow 없음.
9. 비정상 nested scroll 없음.
10. 주요 CTA/마스코트/말풍선/하단 control 겹침 없음.
11. 기존 UI 디자인 변경 없음.
12. 신규 tablet UI 설계 없음.
13. 기존 기능 회귀 없음.
14. TypeScript typecheck 통과.
15. 관련 자동 테스트 통과.
16. build 통과.
17. Playwright viewport QA 통과.
18. Dev 배포 후 실제 화면 확인 PASS.
19. 실제 smartphone/tablet QA 결과 확인.
20. Dev PASS 후 동일 Commit Production 배포.
21. Production 최종 회귀 확인.

---

## 11. 작업 순서

### Phase 1 — P0 Foundation
1. 현재 responsive token / breakpoint / viewport 의존성 재확인
2. width 계약 단일화
3. Preview 내부를 container 기준으로 반응하도록 수정
4. device 판정 오류 수정

### Phase 2 — P1 Common Wrapper
5. DemoFrame
6. AppTopHeader
7. 실제 device root wrapper
8. PlayFrame / 공통 wrapper

### Phase 3 — P2 Screen Residual
9. 아이 홈
10. 미션
11. 자유대화
12. 놀이
13. 기타 아이 화면

각 Phase마다 Dev QA를 수행하고 다음 Phase로 이동한다.
P0가 해결되지 않은 상태에서 개별 화면 px 조정을 먼저 하지 않는다.

---

## 12. 완료 보고 형식

### A. 확정 원인
- PC smartphone Preview 차이
- PC tablet Preview 차이
- 실제 smartphone 차이
- 실제 tablet 차이

### B. 변경 파일
- 파일명
- 변경 이유
- 변경 핵심

### C. Responsive Foundation 변경
- 기존 breakpoint/width 처리
- 변경 후 단일 기준
- Container 기반 처리 위치

### D. 화면별 결과
- 홈
- 미션
- 자유대화
- 놀이
- 기타

각 화면:
- PC smartphone Preview
- PC tablet Preview
- 실제 smartphone
- 실제 tablet

PASS/FAIL 기록

### E. 자동 검증
- typecheck
- tests
- build
- Playwright

### F. Dev 배포
- Commit
- Dev URL
- QA 결과

### G. 실기기 QA
- iPhone Safari
- iPhone PWA
- Android Chrome
- Android PWA
- Tablet 세로/가로

### H. Production
- Dev PASS 후 동일 Commit 배포 여부
- Production 최종 검증 결과

### I. 미해결
하나라도 남아 있으면 완료로 보고하지 않는다.
원인과 다음 수정 대상만 명확히 보고한다.
