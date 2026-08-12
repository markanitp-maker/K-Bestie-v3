# 052 — Galaxy·Android 케이 발화 말풍선 내부 스크롤 제거 및 Dev·Production 반영

## 1. 작업 목적

미션 대화와 자유대화의 케이 발화 3단계 타임라인이 iPhone에서는 정상적으로 표시되지만, Galaxy·Android PWA에서는 말풍선 내부에 세로 스크롤바가 생기고 문장 일부가 잘리는 문제가 발생한다.

문제 대상은 다음 세 영역 전체다.

```text
1번: 케이의 현재 또는 가장 최근 발화
2번: 케이의 바로 이전 발화
3번: 케이의 두 단계 이전 발화
```

Android에서는 글자 폭·줄 수·시스템 글자 크기·화면 확대·실제 Viewport 차이 때문에 동일 문장이 iPhone보다 한 줄 이상 더 차지할 수 있다.

현재 말풍선에 고정 높이, 최대 높이 또는 내부 스크롤이 적용되어 있어 Galaxy에서 내용이 전부 표시되지 않는 것으로 판단한다.

이번 작업에서는 iPhone용·Android용 UI를 별도로 만들지 않는다.

미션과 자유대화의 세 케이 발화 영역을 모두 콘텐츠 기반 자동 높이로 교정하고, 내용이 길어질 때 말풍선 내부가 아니라 대화 콘텐츠 영역 전체가 자연스럽게 스크롤되도록 수정한다.

---

# 2. 작업 우선순위

이 요청은 실제 사용자 기기에서 대화 내용을 확인할 수 없게 만드는 사용자 노출 버그다.

다음 순서로 처리한다.

1. 실제 원인 감사
2. 미션·자유대화 공통 수정
3. 자동 검증
4. Dev 배포
5. iPhone·Galaxy 실제 기기 Dev QA
6. Dev PASS 후 동일 Commit을 Production 배포
7. Production PWA 업데이트 적용
8. iPhone·Galaxy Production Smoke Test

Dev 검증에서 문제가 발견되면 Production 배포를 진행하지 않는다.

---

# 3. 현재 문제 현상

## iPhone

- 케이 발화가 말풍선 안에 모두 표시됨
- 별도의 내부 스크롤바 없음
- 문장 잘림 없음
- 현재 화면 크기와 배치가 적절함

## Galaxy·Android

- 1번 큰 K-Orange 테두리 말풍선에 내부 스크롤바 발생
- 2번 흰색 보조 말풍선에도 내용 잘림 발생
- 3번 상단 보조 발화 영역에도 내용 잘림 또는 말줄임 발생
- 전체 문장을 읽으려면 각 말풍선 안에서 별도로 스크롤해야 함
- 일부 발화는 아래 문장이 보이지 않음
- 미션과 자유대화에서 동일하게 발생
- 같은 데이터임에도 iOS와 Android의 표시 결과가 다름

말풍선마다 개별 스크롤이 생기는 현재 동작은 정상 UX가 아니다.

---

# 4. 최종 확정 정책

다음 정책을 미션과 자유대화에 동일하게 적용한다.

```text
케이 발화 말풍선 내부 스크롤 금지
케이 발화 전체 내용 표시
글자 수에 따라 말풍선 높이 자동 확장
화면 높이가 부족하면 대화 콘텐츠 영역 전체만 스크롤
상단 컨트롤과 하단 입력 컨트롤은 계속 접근 가능
```

iPhone과 Android에 별도의 DOM·컴포넌트·문구·레이아웃을 만들지 않는다.

동일 컴포넌트와 동일 CSS가 기기·글자 크기에 따라 자연스럽게 확장되어야 한다.

---

# 5. 적용 대상

## 미션 대화

- 시작하기
- 이어하기
- 진행 중
- 자동 모드
- 수동 모드
- 텍스트 입력
- 케이 말하는 중
- 케이 생각 중
- 아이 답변 대기
- 완료 직전
- 완료 인사

## 자유대화

- 신규 자유대화
- 자동 모드
- 수동 모드
- 음성 입력
- 텍스트 입력
- 케이 재질문
- 연결 복구
- 종료 직전

## 케이 발화 영역

- 1번 현재·최근 케이 발화
- 2번 바로 이전 케이 발화
- 3번 두 단계 이전 케이 발화

한 영역만 수정하거나 미션만 수정하면 완료가 아니다.

---

# 6. 선행 원인 감사

수정 전에 iPhone과 Galaxy에서 각 케이 발화 영역의 Computed Style을 비교한다.

반드시 확인할 속성:

```text
width
height
min-height
max-height
overflow
overflow-x
overflow-y
display
position
font-family
font-size
font-weight
line-height
letter-spacing
word-break
overflow-wrap
white-space
-webkit-line-clamp
text-overflow
box-sizing
```

상위 컨테이너도 함께 확인한다.

```text
미션·자유대화 Root
대화 콘텐츠 Wrapper
3단계 발화 Wrapper
각 말풍선 Wrapper
마스코트 영역
하단 입력 영역
Device Viewport
PWA Root
```

검색 대상:

```text
overflow-y-auto
overflow-auto
overflow-scroll
max-h-
h-
line-clamp
-webkit-line-clamp
text-overflow
height:
max-height:
min-height:
scrollbar
```

작업 완료 보고에 실제 문제를 일으킨 파일·클래스·CSS Selector를 명시한다.

---

# 7. Android에서만 문제가 발생할 수 있는 원인 확인

다음 원인을 각각 확인한다.

## 7-1. 시스템 글자 크기

Galaxy 설정의 글자 크기가 기본값보다 큰지 확인한다.

다음 상태에서 테스트한다.

```text
100%
120% 또는 중간 확대
150% 또는 큰 글자
```

글자 확대 상태에서도 말풍선 내용이 잘리면 안 된다.

사용자의 접근성 글자 설정을 강제로 무효화해 해결하지 않는다.

## 7-2. 화면 확대·디스플레이 크기

Samsung One UI의 화면 크기 또는 화면 확대 설정이 실제 CSS Viewport 폭을 줄이는지 확인한다.

비교 정보:

```javascript
console.table({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  viewportWidth: window.visualViewport?.width,
  viewportHeight: window.visualViewport?.height,
  viewportOffsetTop: window.visualViewport?.offsetTop,
  devicePixelRatio: window.devicePixelRatio,
});
```

## 7-3. 실제 사용 글꼴

Galaxy에서 Pretendard가 정상 로딩되는지 확인한다.

```javascript
document.fonts.check('16px Pretendard')
```

Computed `font-family`도 기록한다.

Pretendard가 로딩되지 않아 더 넓은 대체 글꼴이 사용되는 경우 폰트 로딩 문제도 교정한다.

단, 폰트가 실패하더라도 UI는 내용 기반 높이로 정상 표시되어야 한다.

## 7-4. Android 브라우저의 Text Autosizing

Chrome·Samsung Internet·설치형 PWA에서 텍스트 자동 확대가 적용되는지 확인한다.

전역 기본값은 기존 정책을 확인한 뒤 다음과 동등하게 정리한다.

```css
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
```

단, 이 속성을 사용자의 접근성 글자 설정을 무력화하는 해결책으로 사용하지 않는다.

핵심 해결책은 자동 높이와 전체 콘텐츠 스크롤이다.

---

# 8. 말풍선 내부 스크롤 제거

세 케이 발화 영역에서 다음 속성을 제거한다.

```css
height: 고정값;
max-height: 고정값;
overflow-y: auto;
overflow-y: scroll;
overflow: auto;
overflow: scroll;
```

Tailwind에서는 다음과 같은 클래스가 대상일 수 있다.

```text
h-*
max-h-*
overflow-y-auto
overflow-auto
overflow-scroll
line-clamp-*
```

최종 기본 기준:

```css
.k-utterance-content {
  width: 100%;
  height: auto;
  min-height: 0;
  max-height: none;
  overflow: visible;
  box-sizing: border-box;
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
  hyphens: none;
}
```

`min-height: 0`은 상위 Flex/Grid 축소 문제를 해결하기 위한 것으로, 고정 높이를 만드는 용도로 사용하지 않는다.

---

# 9. 1번 현재 케이 발화 말풍선

1번은 가장 큰 K-Orange 테두리 말풍선이다.

필수 기준:

- 전체 문장 표시
- 내부 세로 스크롤 없음
- 글자 수에 따라 높이 자동 확장
- K-Orange 테두리와 꼬리 유지
- iPhone의 현재 디자인 유지
- Galaxy에서도 같은 문장 전체 표시
- 최대 줄 수 제한 없음
- `line-clamp` 사용 금지
- 말줄임표 사용 금지

권장 구조:

```css
.k-utterance-current {
  width: min(90%, 720px);
  height: auto;
  max-height: none;
  overflow: visible;
  padding: clamp(16px, 4vw, 22px);
  line-height: 1.45;
  word-break: keep-all;
  overflow-wrap: break-word;
}
```

정확한 너비와 글자 크기는 현재 iPhone 정상 화면의 정본 값을 유지한다.

말풍선을 Android에서만 임의로 더 크게 고정하지 않는다.

---

# 10. 2번 이전 케이 발화 말풍선

2번 흰색 보조 말풍선도 내부 스크롤과 고정 높이를 제거한다.

필수 기준:

- 전체 발화 표시
- 내용 기반 자동 높이
- 최대 2줄 또는 3줄로 강제 절단하지 않음
- `line-clamp` 제거
- 내부 스크롤 없음
- iPhone의 시각적 우선순위 유지
- 1번보다 작은 글자·약한 강조 유지

권장:

```css
.k-utterance-previous {
  height: auto;
  max-height: none;
  overflow: visible;
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
}
```

---

# 11. 3번 두 단계 이전 케이 발화

3번 상단 보조 텍스트도 문장 일부가 강제로 잘리지 않게 한다.

기존에 말줄임표 또는 Clamp가 적용되어 있다면 제거한다.

필수 기준:

- 케이가 두 단계 전에 말한 내용을 전체 표시
- 내부 스크롤 없음
- 필요하면 여러 줄 표시
- 가독성을 위해 가장 약한 색상과 작은 글자 유지
- 고정 한 줄·두 줄 Clamp 금지
- 데이터가 없으면 영역 미렌더링
- 긴 문장 때문에 가로 스크롤이 생기지 않음

단, 3번까지 모두 길어 한 화면을 넘어가는 경우 화면 전체 콘텐츠 영역을 스크롤한다.

---

# 12. 대화 콘텐츠 영역 전체 스크롤

말풍선마다 개별 스크롤을 두지 않고, 대화 콘텐츠 영역 전체를 단일 스크롤 컨테이너로 구성한다.

권장 구조:

```text
ConversationScreen
├─ TopControls
│  ├─ 문의
│  ├─ 진행률 또는 자유대화 상단 영역
│  └─ 종료
├─ ConversationScrollArea
│  ├─ 3번 케이 발화
│  ├─ 2번 케이 발화
│  ├─ 1번 케이 발화
│  ├─ 마스코트·상태
│  └─ 자동·수동
└─ BottomInputControls
   ├─ 키보드
   ├─ 마이크
   └─ 텍스트 Composer
```

권장 개념:

```css
.conversation-screen {
  height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.conversation-scroll-area {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}
```

현재 레이아웃에서 상단과 하단을 고정하지 않는 구조라면, 전체 앱 Viewport 하나만 스크롤되도록 구현해도 된다.

중요한 것은 중첩 스크롤을 제거하는 것이다.

---

# 13. 스크롤 정책

허용:

- 세 발화와 마스코트 영역이 화면 높이를 초과할 때 대화 콘텐츠 전체가 세로 스크롤
- 글자 확대 상태에서 전체 콘텐츠 스크롤
- 작은 Android 화면에서 자연스러운 페이지 스크롤

금지:

- 각 말풍선 내부 스크롤
- 1번·2번·3번에 각각 별도 스크롤바
- 말풍선 안의 문장을 손가락으로 별도 스크롤
- Body와 내부 콘텐츠의 이중 스크롤
- 가로 스크롤
- 마이크·키보드 컨트롤에 접근할 수 없는 상태

---

# 14. 발화가 추가될 때 스크롤 위치

새로운 케이 발화가 추가될 때 현재 대화의 핵심인 1번 말풍선과 마스코트가 사용자가 볼 수 있는 위치에 있어야 한다.

다만 다음을 금지한다.

- 스트리밍 Chunk마다 강제 스크롤
- 사용자가 위쪽 이전 발화를 읽고 있는데 계속 아래로 끌어내림
- 키보드 입력 중 불필요한 스크롤 이동
- 문의 Modal을 닫았을 때 위치 초기화

권장:

- 새로운 케이 Turn이 시작되거나 최종 완료된 시점에만 필요한 경우 Scroll Into View
- 현재 사용자가 하단 근처에 있는 경우에만 자동 이동
- 스트리밍 Partial에서는 같은 말풍선 높이만 자연스럽게 확장
- 스크롤 애니메이션 중복 금지

---

# 15. 마스코트·상태 영역

말풍선 높이가 늘어나도 마스코트와 상태 카드가 서로 겹치거나 잘리면 안 된다.

확인:

- 마스코트 영역이 고정 절대좌표로 말풍선과 겹치지 않는지
- 긴 말풍선 아래에서 자연스럽게 Flow Layout으로 배치되는지
- 단상과 자동·수동 버튼이 말풍선에 가려지지 않는지
- Android 화면 높이가 작을 때 전체 콘텐츠 스크롤로 접근 가능한지

말풍선 높이를 늘리면서 마스코트를 무조건 화면 아래 고정하여 콘텐츠를 겹치게 하지 않는다.

---

# 16. 하단 키보드·마이크 영역

다음 기능은 계속 접근 가능해야 한다.

- 키보드 버튼
- 마이크 버튼
- 자동·수동 버튼
- 텍스트 입력 Composer
- 전송 버튼
- Composer 닫기 X

대화 콘텐츠가 길 때 하단 입력 컨트롤은 다음 중 현재 구조에 맞는 방식으로 유지한다.

1. 앱 하단 고정
2. 전체 콘텐츠 마지막에 배치하되 정상 스크롤로 접근 가능

iOS와 Android에서 서로 다른 구조를 만들지 않는다.

Safe Area:

```css
padding-bottom: max(12px, env(safe-area-inset-bottom));
```

---

# 17. 소프트 키보드 대응

텍스트 입력 모드에서 iOS와 Android 소프트 키보드가 열릴 때도 말풍선과 Composer가 정상 동작해야 한다.

확인:

```text
visualViewport.height
visualViewport.offsetTop
window.innerHeight
safe-area-inset-bottom
```

필수:

- Composer가 키보드 뒤로 가려지지 않음
- 말풍선 내부 스크롤이 다시 생기지 않음
- 대화 콘텐츠 전체 스크롤 유지
- 키보드가 열린 상태에서도 가로 스크롤 없음
- Composer 닫기 X가 화면 안에 표시
- 키보드 종료 후 높이 정상 복원

Visual Viewport Listener를 추가하면 중복 등록을 방지하고 Cleanup한다.

---

# 18. 케이 발화 3단계 정책 유지

이번 수정은 레이아웃·스크롤 문제 해결에 한정한다.

기존 확정 정책을 유지한다.

```text
1번 = 케이의 현재 또는 가장 최근 발화
2번 = 바로 이전 케이 발화
3번 = 두 단계 이전 케이 발화
```

아이 발화는 화면에 표시하지 않는다.

아이 발화는 기존대로 다음에 사용한다.

- STT
- 대화 문맥
- 케이 응답 생성
- 미션 진행률
- 저장
- 리포트
- 문맥 보정

이번 수정에서 화자 필터링 또는 대화 데이터 로직을 변경하지 않는다.

---

# 19. 공통 컴포넌트 적용

미션과 자유대화에서 같은 케이 발화 말풍선 컴포넌트·스타일을 사용하도록 확인한다.

권장 구조:

```text
KUtteranceTimeline
├─ OlderKUtterance
├─ PreviousKUtterance
└─ CurrentKUtterance
```

공통 스타일:

```text
KUtteranceTimeline.module.css
conversation-timeline.css
또는 현재 공통 스타일 시스템
```

미션과 자유대화에 서로 다른 임시 Android CSS를 추가하지 않는다.

---

# 20. 플랫폼별 별도 UI 금지

다음과 같은 분기를 만들지 않는다.

```text
isAndroid ? AndroidBubble : IOSBubble
isIOS ? IOSConversation : AndroidConversation
Samsung User-Agent 전용 DOM
```

Android 브라우저 자체의 명확한 엔진 버그가 확인된 경우에만 최소 CSS 보정이 허용된다.

그 경우에도 동일 DOM·동일 기능 구조를 유지하고 작업 완료 보고에 근거를 명시한다.

---

# 21. 기존 iPhone UI 회귀 금지

현재 iPhone 화면은 정상으로 평가됐다.

따라서 수정 후에도 다음을 유지한다.

- 기존 말풍선 너비
- 기존 글자 크기
- 기존 K-Orange 테두리
- 기존 말풍선 꼬리
- 기존 마스코트 크기
- 기존 자동·수동 버튼
- 기존 하단 입력 배치
- 내부 스크롤바 없음
- 문장 전체 표시

Android 문제를 해결하기 위해 iPhone 글자를 과도하게 줄이거나 전체 화면을 축소하지 않는다.

---

# 22. 기존 기능 변경 금지

## 미션

- 시작
- 이어하기
- 유효 답변 판정
- 진행률
- 질문 순환
- 완료
- 황금열쇠 보상
- 완료 인사

## 자유대화

- 세션 시작
- 이용 시간
- 이용 횟수
- 저장
- 종료

## 공통

- Gemini Live
- STT
- TTS
- VAD
- Barge-in
- 자동·수동
- 음성 입력
- 텍스트 입력
- 문의
- 연결 복구
- 인증
- DB
- API
- 리포트
- 데이터 보존 정책

---

# 23. Dev 적용 절차

1. 현재 Branch와 미커밋 변경 확인
2. 현재 진행 중인 작업과 충돌 여부 확인
3. 말풍선 공통 컴포넌트·스타일 경로 확인
4. iPhone·Galaxy Computed Style 비교
5. 고정 높이·최대 높이·내부 Overflow 제거
6. 대화 콘텐츠 전체 스크롤 구조 적용
7. 미션·자유대화 공통 적용
8. 자동 테스트 추가 또는 수정
9. lint 실행
10. typecheck 실행
11. 관련 test 실행
12. production build 실행
13. Dev Vercel 프로젝트 배포
14. Dev Build ID 기록
15. 모바일 Dev PWA 업데이트 적용
16. iPhone Dev QA
17. Galaxy Dev QA
18. Dev PASS 여부 보고

---

# 24. Dev 실제 기기 QA

## iPhone

최소 확인:

- Safari
- 홈 화면 PWA
- 기본 글자 크기
- 확대된 글자 크기

검증:

- 세 발화 전체 표시
- 내부 스크롤바 없음
- 기존 배치 유지
- 전체 대화 스크롤 정상

## Galaxy·Android

최소 확인:

- Chrome
- 설치형 PWA
- 가능하면 Samsung Internet 추가 확인

글자 크기:

```text
기본 100%
중간 약 120%
큰 글자 약 150%
```

화면 크기 또는 화면 확대:

```text
기본
한 단계 확대
```

검증:

- 1번 전체 문장 표시
- 2번 전체 문장 표시
- 3번 전체 문장 표시
- 말풍선 내부 스크롤바 없음
- 대화 콘텐츠 전체 스크롤 정상
- 마스코트·입력 컨트롤 접근 가능
- 가로 스크롤 없음

---

# 25. Production 배포 절차

Dev의 iPhone·Galaxy QA가 모두 PASS하면 Dev에서 검증한 동일 Commit을 Production에 배포한다.

1. Dev 검증 Commit 고정
2. 변경 Diff 재확인
3. Production 대상 프로젝트 확인
4. Dev와 동일 Commit인지 검증
5. Production 배포
6. Production Deployment ID 기록
7. Production Build ID 기록
8. 운영 Domain 정상 확인
9. 기존 Production PWA에서 업데이트 안내 확인
10. PWA 새로고침 적용
11. iPhone Production Smoke Test
12. Galaxy Production Smoke Test
13. 미션·자유대화 모두 확인
14. 내부 스크롤바 제거 확인
15. 기존 음성·진행률·저장·보상 기능 확인

Dev와 Production에서 코드를 별도로 수정하지 않는다.

---

# 26. PWA 업데이트 검증

Dev와 Production 모두 기존 설치형 PWA에서 수정이 적용돼야 한다.

절차:

1. 이전 Build가 설치된 PWA 준비
2. 새 Build 배포
3. 앱 삭제 금지
4. 사이트 데이터 수동 삭제 금지
5. PWA 실행 또는 Foreground 복귀
6. 새 버전 안내 확인
7. 새로고침 선택
8. Active Service Worker 변경 확인
9. Build ID 변경 확인
10. 최신 CSS Chunk 확인
11. 말풍선 내부 스크롤 제거 확인

PWA 삭제·재설치가 필요하면 완료가 아니다.

---

# 27. QA용 발화 문장

짧은 문장뿐 아니라 다음 길이의 케이 발화를 테스트한다.

## 짧은 발화

```text
오늘 뭐 하고 놀았어?
```

## 중간 발화

```text
숙제할 때 어려운 부분이 있었구나. 요즘 유튜브나 게임은 무엇을 보고 있어?
```

## 긴 발화

```text
친구가 오지 않아서 많이 속상했겠구나. 케이가 이야기를 잘 들어줄게. 오늘 학교에서 있었던 일 중 가장 기억나는 순간을 천천히 말해줄래?
```

## 매우 긴 발화

현재 운영에서 실제 생성 가능한 최대 수준의 문장을 사용한다.

확인:

- 모든 글자 표시
- 말풍선 높이 자동 증가
- 내부 스크롤 없음
- 전체 콘텐츠 스크롤 가능
- 화면이 깨지지 않음

---

# 28. 해상도 QA

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

확인:

- 모든 발화 전체 표시
- 내부 스크롤 없음
- 전체 대화 스크롤 정상
- 가로 스크롤 없음
- 하단 컨트롤 접근 가능
- Safe Area 정상
- 말풍선 꼬리와 테두리 잘림 없음

---

# 29. 자동화 테스트

가능한 범위에서 다음 테스트를 추가한다.

## 내부 Overflow 금지

세 케이 발화 요소에 다음 스타일이 적용되지 않는지 검증한다.

```text
overflow-y: auto
overflow-y: scroll
line-clamp
고정 max-height
```

## 긴 발화 렌더링

긴 문장을 렌더링한 뒤:

- 전체 텍스트가 DOM에 존재
- 말줄임표 없음
- Clamp 없음
- 부모 대화 영역만 Scrollable
- 말풍선 자체는 Scrollable이 아님

## 발화 개수

- 1개
- 2개
- 3개

각 상태에서 존재하는 발화만 표시하고 빈 고정 영역이 남지 않는지 확인한다.

---

# 30. 롤백 기준

다음 문제가 발생하면 Production 배포를 중단하거나 이전 정상 Deployment로 롤백한다.

- iPhone에서 기존 정상 레이아웃이 깨짐
- Android에서 여전히 내부 스크롤바 발생
- 발화 내용이 화면에 전혀 표시되지 않음
- 화면 전체가 스크롤되지 않아 하단 컨트롤 접근 불가
- 마스코트와 말풍선 겹침
- 가로 스크롤 발생
- 미션 진행률 또는 완료 오류
- 자유대화 저장 오류
- TTS·STT·마이크 동작 오류
- PWA 무한 새로고침
- Production Build 오류

DB 변경 없이 코드 롤백이 가능하도록 작업 범위를 유지한다.

---

# 31. 완료 기준

다음 조건을 모두 만족해야 완료다.

- 미션의 1·2·3 케이 발화 영역에 내부 스크롤바가 없음
- 자유대화의 1·2·3 케이 발화 영역에 내부 스크롤바가 없음
- 케이 발화 전체 문장이 표시됨
- 글자 수에 따라 말풍선 높이가 자동 확장됨
- 고정 `height`와 제한적 `max-height`가 제거됨
- 말풍선의 `overflow-y:auto/scroll`이 제거됨
- `line-clamp` 및 강제 말줄임표가 제거됨
- 화면 높이가 부족하면 대화 콘텐츠 전체가 스크롤됨
- Body와 내부 대화 영역의 이중 스크롤이 없음
- 가로 스크롤이 없음
- iPhone의 기존 정상 UI가 유지됨
- Galaxy 기본 글자 크기에서 정상
- Galaxy 약 120% 글자 크기에서 정상
- Galaxy 약 150% 글자 크기에서 정상
- Galaxy 화면 확대 상태에서 정상
- Pretendard 로딩 실패 시에도 내용이 잘리지 않음
- 미션과 자유대화가 공통 정책을 사용함
- 케이 발화 3단계 정책과 아이 발화 미노출 정책이 유지됨
- 음성·텍스트·진행률·저장·보상 기능에 회귀가 없음
- Dev 배포와 실제 기기 QA 통과
- Dev와 동일 Commit의 Production 배포 완료
- 기존 PWA 삭제·재설치 없이 최신 UI 적용 성공
- Production iPhone Smoke Test 통과
- Production Galaxy Smoke Test 통과
- lint 통과
- typecheck 통과
- 관련 test 통과
- production build 통과

---

# 32. 작업 완료 보고

1. 미션 실제 Route
2. 자유대화 실제 Route
3. 케이 발화 공통 컴포넌트 경로
4. 변경 파일 목록
5. Galaxy에서만 내부 스크롤이 생긴 정확한 원인
6. 수정 전 1번 말풍선 Computed Style
7. 수정 전 2번 말풍선 Computed Style
8. 수정 전 3번 발화 영역 Computed Style
9. 제거한 고정 Height
10. 제거한 Max Height
11. 제거한 Overflow 설정
12. 제거한 Line Clamp
13. 변경 후 말풍선 자동 높이 구조
14. 대화 콘텐츠 전체 스크롤 구조
15. 상단·하단 컨트롤 배치 방식
16. iPhone과 Galaxy의 실제 Viewport 비교
17. Galaxy 시스템 글자 크기 영향
18. Galaxy 화면 확대 영향
19. Pretendard 로딩 확인 결과
20. Text Size Adjust 처리 방식
21. 소프트 키보드 대응 방식
22. 긴 발화 QA 결과
23. 매우 긴 발화 QA 결과
24. iPhone Safari Dev QA 결과
25. iPhone PWA Dev QA 결과
26. Galaxy Chrome Dev QA 결과
27. Galaxy PWA Dev QA 결과
28. Galaxy 100% 글자 크기 결과
29. Galaxy 120% 글자 크기 결과
30. Galaxy 150% 글자 크기 결과
31. Dev 배포 Commit
32. Dev Deployment ID
33. Dev Build ID
34. Production 배포 Commit
35. Production Deployment ID
36. Production Build ID
37. Dev·Production 동일 Commit 확인
38. PWA 업데이트 적용 결과
39. Production iPhone Smoke Test
40. Production Galaxy Smoke Test
41. 미션 기능 회귀 검증
42. 자유대화 기능 회귀 검증
43. lint 결과
44. typecheck 결과
45. test 결과
46. production build 결과
47. 롤백 가능 Deployment
48. 남아 있는 위험 요소

# 추가 요구사항 — 미션·자유대화 공통 적용 필수

이번 Android 말풍선 자동 높이 개선은 미션 화면에만 적용하지 않는다.

반드시 아래 두 영역 모두 동일한 공통 컴포넌트 기준으로 수정한다.

## 1. 미션 대화

대상:
- 미션 시작
- 미션 진행 중
- 미션 이어하기
- 미션 완료 전후

적용:
- 케이 현재 발화
- 이전 케이 발화
- 이전 이전 케이 발화

## 2. 자유대화

대상:
- 자유대화 시작
- 음성 대화
- 텍스트 대화
- 자동 모드
- 수동 모드

적용:
- 케이 응답 Bubble
- 이전 대화 Timeline
- 스트리밍 응답 Bubble


# 공통 수정 원칙

미션과 자유대화에서 사용하는 케이 말풍선은 동일한 렌더링 정책을 사용한다.

금지:
- 미션 전용 CSS 수정
- 자유대화 별도 임시 CSS 추가
- Android 전용 Bubble 생성
- iOS/Android User-Agent 분기

필수:
- 공통 K Bubble Component 수정
- 공통 CSS 수정
- 콘텐츠 기반 height:auto 적용
- 내부 overflow 제거
- 전체 Conversation 영역 Scroll 적용

---

# 회귀 테스트 필수

동일한 긴 문장으로 아래 두 화면 모두 검증한다.

1. 미션 K 응답
2. 자유대화 K 응답

검증 기기:

iPhone:
- Safari
- PWA

Android:
- Galaxy Chrome
- Galaxy PWA

완료 조건:

- 두 화면 모두 말풍선 내부 스크롤바 없음
- 긴 문장 전체 표시
- 1·2·3 단계 K Timeline 정상 표시
- 하단 입력 영역 접근 가능
- 기존 음성 기능 영향 없음