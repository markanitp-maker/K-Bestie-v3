071-bugfix-mission-freechat-keyboard-bottom-gap-cross-browser.md

# 미션·자유대화 모바일 키보드 하단 불필요 공백 크로스브라우저 수정

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 미션과 자유대화의 기존 UI를 그대로 유지한다.
- 키보드가 열렸을 때 입력창 하단과 iOS/Android 소프트키보드 상단 사이에 현재 보이는 불필요한 앱 배경 공백이 없어야 한다.
- 말풍선, `대기 중` 상태, 입력창, 전송 버튼, 닫기(X) 버튼의 디자인·크기·기능·배치는 변경하지 않는다.
- iPhone Safari / Chrome / 설치형 PWA, Android Chrome / 설치형 PWA에서 동일한 원칙으로 동작해야 한다.
- 키보드를 닫으면 기존 음성 모드 UI와 safe-area 처리가 정상 복원되어야 한다.
- 이번 작업은 UI 재설계가 아니라 모바일 키보드 하단 공백 버그 수정이다.

### 대표님 테스트 정상 프로세스
1. Dev에서 아이 계정으로 로그인한다.
2. `미션`에 진입한다.
3. 키보드 입력 모드로 전환하여 소프트키보드를 연다.
4. 현재 입력창/전송/X UI가 기존과 동일한지 확인한다.
5. 입력창 하단과 키보드 상단 사이에 불필요한 앱 배경 공백이 보이지 않는지 확인한다.
6. 키보드를 닫았다 다시 열어도 동일한지 확인한다.
7. `자유대화`에서도 3~6번을 동일하게 확인한다.
8. 최소 다음 환경에서 확인한다.
   - iPhone Safari
   - iPhone Chrome
   - iPhone 설치형 PWA
   - Android Chrome
   - Android 설치형 PWA
9. 한글 키보드와 영문 키보드 모두 확인한다.
10. Dev 실화면 PASS 후 동일 Commit을 Production에 반영하고 모바일/PWA에서 최종 회귀 확인한다.

PASS:
- 현재 UI는 그대로다.
- 미션/자유대화 모두 키보드 위 빨간 표시 영역과 같은 불필요한 앱 배경 공백이 사라진다.
- 키보드를 닫으면 기존 음성 모드 레이아웃이 정상 복원된다.
- 화면 흔들림, 가로 스크롤, 입력창 가림, 말풍선 잘림 같은 신규 회귀가 없다.

---

## 1. 목표

같은 모바일 단말에서도 미션/자유대화 및 Safari/Chrome/PWA 환경별로 다르게 나타나는 키보드 상단의 불필요한 하단 공백을 제거한다.

이번 작업의 목표는 `UI 개선`이나 `레이아웃 리디자인`이 아니다.

현재 UI를 그대로 유지한 상태에서 다음 레이아웃 계산 문제만 최소 범위로 수정한다.

- `100dvh`와 실제 Visual Viewport 높이 불일치
- 키보드 열린 상태에서의 `safe-area-inset-bottom` 잔존
- 자유대화의 `DemoFrame` 모바일 스크롤 래퍼와 내부 `100dvh` 중첩
- 현재 계산 중이지만 실제 레이아웃에 반영하지 않는 `viewportHeight`

---

## 2. 요구사항

### 2-1. 공통 원칙
- 미션/자유대화의 현재 사용자 UI를 변경하지 않는다.
- 기존 말풍선, 상태 표시, 입력 UI, 전송 버튼, X 버튼, 마스코트, 음성모드 디자인을 유지한다.
- 브라우저/기기별 고정 px 값을 따로 하드코딩하는 방식으로 해결하지 않는다.
- 단순 negative margin, `translateY`, 임의 위치 보정으로 증상을 덮지 않는다.
- 실제 viewport/safe-area/scroll 원인을 수정한다.

### 2-2. Visual Viewport 적용
현재 `hooks/useKeyboardConversationViewport.ts`는 `window.visualViewport.height`를 읽어 `viewportHeight`를 반환하지만 미션과 자유대화에서 실제 컨테이너 높이에 반영하지 않고 있다.

키보드가 열린 상태에서는 계산된 `viewportHeight`를 현재 대화 화면의 실제 사용 높이에 반영한다.

원칙:
- 키보드 닫힘: 기존 전체 화면 동작 유지
- 키보드 열림: 실제 보이는 Visual Viewport 높이를 레이아웃 기준으로 사용
- iOS Safari/Chrome/PWA 및 Android Chrome/PWA에서 동일한 코드 경로를 우선 사용
- UA별 CSS 분기를 새로 만들지 않는다.

### 2-3. 미션 safe-area 처리
대상:
- `components/MissionConversationLayout.tsx`

현재 하단 입력 wrapper는 키보드가 열린 상태에서도 다음 safe-area를 계속 더한다.

`env(safe-area-inset-bottom)`

수정 원칙:
- 키보드 닫힘: 기존 safe-area 유지
- 키보드 열림: 입력창 아래에 `safe-area-inset-bottom`을 추가하지 않는다.
- 기존 입력 UI의 크기/디자인은 변경하지 않는다.

### 2-4. 자유대화 DemoFrame / 스크롤 중첩 처리
대상:
- `app/chat/page.tsx`
- `app/demo/components/DemoFrame.tsx` 관련 호출 구조

현재 감사 결과:
- 자유대화는 모바일에서 `DemoFrame`의 `h-dvh w-full overflow-y-auto` 래퍼 안에 다시 `h-[100dvh]` 컨테이너가 중첩되어 있다.
- 키보드 포커스 시 브라우저 자동 스크롤과 겹치면서 미션보다 더 큰 하단 공백을 만들 가능성이 확인되었다.

수정 원칙:
- DemoFrame 자체를 새 UI로 교체하지 않는다.
- PC/데모 프레임 기존 동작을 깨지 않는다.
- 자유대화 키보드 입력 상태에서 불필요한 이중 viewport/scroll 계산만 제거 또는 차단한다.
- 필요한 경우 모바일 런타임에서만 부모 `overflow-y-auto`가 키보드 포커스 위치를 이중 이동시키지 않도록 최소 수정한다.
- 기존 자유대화 레이아웃 구조를 대규모 리팩터링하지 않는다.

### 2-5. 현재 자유대화 keyboard padding 보정 유지/정리
현재 자유대화에는 텍스트 모드 + 키보드 열린 상태에서 safe-area를 제외하도록 inline `paddingBottom` 분기가 이미 존재한다.

해당 로직이 실제 최종 해결에 필요한 경우 유지한다.

단:
- 기존 증상을 가리는 중복 padding 값이 생기지 않게 정리한다.
- 미션/자유대화 사이에서 같은 조건을 서로 다른 임의 숫자로 맞추지 않는다.
- `18px`, `24px`, `54px`, `66px` 자체를 문제의 근본 해결책으로 취급하지 않는다.

### 2-6. viewport metadata
감사에서 다음 항목이 현재 누락된 것으로 확인되었다.
- `viewport-fit=cover`
- `interactive-widget=resizes-content`

이번 작업에서는 전역 영향이 있으므로 무조건 추가하지 않는다.

먼저 위의 Visual Viewport / safe-area / DemoFrame 최소 수정으로 문제를 해결한다.

정말 필요하다고 판단될 경우:
- 왜 필요한지
- 어떤 환경에 영향을 주는지
- 전체 앱 회귀 범위가 무엇인지

를 완료 보고 전에 근거와 함께 제시하고, 전역 변경은 별도 판단 대상으로 남긴다.

---

## 3. 기존 구조 확인

Antigravity READ-ONLY 감사 결과를 시작점으로 사용하되, Codex가 실제 현재 브랜치 코드와 Dev 배포 상태를 다시 확인한 후 수정한다.

### 확인된 주요 파일
- `hooks/useKeyboardConversationViewport.ts`
- `components/MissionConversationLayout.tsx`
- `app/chat/page.tsx`
- `app/demo/components/DemoFrame.tsx`
- `app/layout.tsx`
- `app/globals.css`
- PWA manifest / service worker 관련 코드

### 감사에서 확인된 핵심 사실
1. `useKeyboardConversationViewport.ts`
   - `visualViewport.height`를 읽어 `viewportHeight`를 계산한다.
   - 미션과 자유대화에서 `viewportHeight`는 실제 레이아웃 높이에 반영되지 않는다.
   - `isKeyboardOpen` 판정에만 실질적으로 사용되고 있다.

2. 미션
   - 최상위 `h-[100dvh]`
   - 키보드가 열려도 하단 입력 wrapper에 `env(safe-area-inset-bottom)`을 계속 더한다.

3. 자유대화
   - 모바일 `DemoFrame`의 `h-dvh overflow-y-auto`
   - 그 안에 다시 `h-[100dvh]` 대화 컨테이너가 존재한다.
   - 텍스트 모드 키보드 열린 상태에서는 safe-area 제외 inline padding 분기가 이미 존재한다.

4. 미션과 자유대화 모두
   - 현재 Visual Viewport 높이를 직접 컨테이너 높이에 사용하지 않는다.

Codex는 위 내용을 무조건 정답으로 가정하지 말고 현재 코드가 동일한지 먼저 확인한다.

---

## 4. 금지

다음 작업은 이번 Request 범위에서 금지한다.

- 새로운 UI 제작
- 말풍선 디자인 변경
- 상태 표시 `대기 중` 제거 또는 위치 변경
- 입력창 디자인/크기 변경
- 전송 버튼 디자인/크기 변경
- X 버튼 디자인/크기 변경
- 마스코트 디자인/크기/위치 변경
- 미션 진행률 UI 변경
- 자유대화/미션 전체 Grid를 새 구조로 재설계
- 신규 공통 Keyboard-Aware UI 컴포넌트 제작
- 5-Row → 4-Row 같은 대규모 JSX 레이아웃 리팩터링
- 브라우저별 UA sniffing
- iPhone/Android별 임의 px 하드코딩
- negative margin / transform으로 강제 이동
- Production부터 직접 수정
- DB/API/LLM/STT/TTS/대화 로직 변경
- 음성 상태 머신 변경
- PWA 기능 자체 변경
- 문제 해결 근거 없이 전역 viewport metadata 변경

---

## 5. 모호성 처리

- 현재 코드가 감사 보고와 다르면 현재 코드가 기준이다.
- 실제 공백을 만드는 DOM/CSS가 예상과 다르면 먼저 computed style / bounding rect / viewport 값을 확인한 후 최소 수정한다.
- 키보드 실제 상단 좌표를 브라우저 API로 얻을 수 없는 환경에서 임의 숫자를 만들어 PASS 판정하지 않는다.
- `100dvh`, safe-area, DemoFrame 중 무엇이 실제 원인인지 확인 없이 여러 항목을 한 번에 크게 변경하지 않는다.
- 한 수정으로 원인이 검증 가능하도록 변경 범위를 작게 유지한다.
- 새로운 UI/레이아웃 설계가 필요해 보이면 구현하지 말고 중단하여 보고한다.

---

## 6. QA

### 6-1. 자동 검증
기존 테스트를 유지하고 필요한 경우 이번 버그에 대한 회귀 테스트만 추가한다.

최소:
- TypeScript type check
- 관련 free chat 테스트
- 관련 mission layout 테스트
- PWA/standalone 관련 기존 테스트
- build

단, 소스 문자열을 읽어 특정 CSS 문자열이 존재하는지만 확인하는 테스트를 실화면 QA의 대체로 사용하지 않는다.

### 6-2. 런타임 검증
Dev에서 키보드 열림 전/후 다음을 실측한다.

미션 / 자유대화 각각:
- `window.innerHeight`
- `document.documentElement.clientHeight`
- `visualViewport.height`
- `visualViewport.offsetTop`
- 최상위 대화 container rect
- 입력 wrapper rect
- 실제 input row rect
- 입력 wrapper computed `padding-bottom`
- 부모 스크롤 컨테이너 `scrollTop`
- body/document scroll position

목적:
- 입력창 아래 빈 공간이 어느 element 또는 viewport 차이에서 발생하는지 최종 확인
- 수정 후 해당 공간이 제거되었는지 확인

### 6-3. 실기기/브라우저 매트릭스

#### iOS
- Safari
- Chrome
- 설치형 PWA

#### Android
- Chrome
- 설치형 PWA

각 환경에서:
- 미션
- 자유대화
- 한글 키보드
- 영문 키보드
- 키보드 닫기 → 다시 열기

가능한 실제 단말을 우선 사용한다.

### 6-4. 화면 회귀
각 환경에서 다음도 확인한다.
- 최신 케이 말풍선이 정상 표시
- 상태 표시 정상
- 입력 가능
- 전송 정상
- X 닫기 정상
- 키보드 닫은 후 음성모드 정상 복원
- 마스코트 정상
- 가로 스크롤 없음
- 화면 점프/Jitter 없음
- 입력창이 키보드에 가려지지 않음

---

## 7. 완료 조건

아래를 모두 만족해야 완료다.

1. 미션 키보드 입력 화면에서 기존 UI를 유지한 채 입력창 아래 불필요한 앱 배경 공백이 제거됨.
2. 자유대화 키보드 입력 화면에서도 동일하게 제거됨.
3. 같은 iPhone에서 미션/자유대화 간 불필요한 공백 차이가 없어짐.
4. iOS Safari / Chrome / PWA에서 정상.
5. Android Chrome / PWA에서 정상.
6. 한글/영문 키보드 모두 정상.
7. 키보드 닫기/재오픈 정상.
8. 음성 모드 원복 정상.
9. 기존 UI 디자인 변경 없음.
10. 자동 테스트/typecheck/build 통과.
11. Dev 실제 화면 QA 통과.
12. 코드 테스트만 통과한 상태를 완료로 판단하지 않음.
13. Dev PASS 후 동일 Commit을 Production에 배포.
14. Production 모바일/PWA 최종 회귀 확인.

---

## 8. 완료 보고

완료 보고에는 반드시 다음을 포함한다.

1. 최종 원인
   - 미션
   - 자유대화
   - 크로스브라우저 차이

2. 변경 파일 목록

3. 파일별 실제 변경 내용

4. 변경 전 → 후 핵심 차이

5. UI가 변경되지 않았음을 확인한 항목

6. 자동 검증 결과
   - typecheck
   - 테스트
   - build

7. Dev 배포 정보
   - Commit
   - Dev URL
   - 실제 확인 환경

8. 실기기 QA 표
   - iPhone Safari
   - iPhone Chrome
   - iPhone PWA
   - Android Chrome
   - Android PWA
   - 미션/자유대화
   - 한글/영문 키보드

9. 각 환경의 PASS/FAIL 및 남은 공백 유무

10. Production 배포 정보
    - Dev PASS 후 동일 Commit인지 확인
    - Production 최종 모바일/PWA 검증 결과

11. 미해결 사항이 하나라도 있으면 `완료`로 보고하지 말고 원인과 다음 확인 지점을 명시한다.
