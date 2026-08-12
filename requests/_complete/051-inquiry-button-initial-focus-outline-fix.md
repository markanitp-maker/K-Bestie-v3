# 051 — 문의 버튼 최초 진입 시 하늘색 직사각형 표시 제거

## 1. 작업 우선순위

현재 진행 중인 작업을 중단하지 않는다.

이 요청은 `requests/` 작업 큐에 추가하고, 현재 처리 중인 요청이 완료된 뒤 파일명 순서에 따라 진행한다.

긴급 작업으로 끼워 넣거나 진행 중인 다른 소스 수정을 덮어쓰지 않는다.

---

## 2. 문제 현상

미션 대화 또는 자유대화 화면에 최초 진입하면 좌측 상단의 플로팅 `문의` 버튼 주변에 하늘색 직사각형 테두리가 자동으로 표시된다.

현재 현상:

- 화면 최초 진입 직후 문의 버튼 주위에 큰 하늘색 사각형 표시
- 문의 버튼 자체의 둥근 모양과 일치하지 않는 외곽선
- 버튼을 클릭하거나 위치를 이동하면 사각형 표시가 사라짐
- 기능에는 문제가 없지만 처음 화면이 미완성 또는 선택된 상태처럼 보임
- 실제 모바일 PWA에서 시각적으로 어색함

이 하늘색 직사각형은 문의 버튼의 정상 디자인 요소가 아니므로 최초 화면 진입 시 표시되지 않도록 수정한다.

---

## 3. 적용 대상

공통 플로팅 문의 버튼이 표시되는 모든 화면을 확인한다.

최소 적용 대상:

- 아이 홈
- 미션 대화
- 자유대화
- 케이와 놀이
- 퀴즈마스터
- 오늘의 나·MBTI
- 부모 홈
- 부모 리포트
- 부모와 케이 대화
- 부모 설정

공통 문의 버튼 컴포넌트가 있다면 해당 컴포넌트에서 한 번만 수정한다.

화면별로 임시 CSS를 반복 추가하지 않는다.

---

## 4. 선행 원인 확인

CSS를 바로 덮어쓰지 말고, 최초 진입 시 하늘색 직사각형이 생기는 실제 원인을 먼저 판별한다.

확인 항목:

1. 문의 버튼이 Mount 직후 자동 Focus되는지
2. `autoFocus` 속성이 있는지
3. `ref.current.focus()`가 실행되는지
4. 이전 페이지의 Focus를 복원하는 로직이 있는지
5. `document.activeElement`가 문의 버튼인지
6. 문의 버튼 자체의 `outline`인지
7. 문의 버튼을 감싸는 드래그 Wrapper의 `outline`인지
8. `box-shadow` 또는 `ring` 스타일인지
9. Tailwind `focus:ring-*` 클래스인지
10. `focus-visible`이 아닌 일반 `focus`에 Ring이 적용됐는지
11. 드래그 라이브러리의 `selected`, `active`, `dragging` 초기 상태인지
12. 모바일 Touch 후 Focus가 남아 있는지
13. 브라우저 또는 PWA의 기본 Focus 표시인지
14. 문의 버튼 위치 복원 과정에서 Wrapper가 선택되는지

개발자 도구에서 다음을 확인한다.

```text
document.activeElement
outline
outline-color
outline-width
box-shadow
border
data-state
aria-pressed
className
```

작업 완료 보고에 정확한 원인을 명시한다.

---

## 5. 최종 동작 기준

### 화면 최초 진입

- 문의 버튼 주변에 하늘색 직사각형이 표시되지 않음
- 문의 버튼의 원래 K-Navy 둥근 디자인만 표시
- 문의 버튼이 자동으로 Focus되지 않음
- 화면의 첫 Focus를 문의 버튼에 강제로 이동하지 않음

### 터치 또는 마우스 클릭

- 문의 버튼을 일반적으로 터치하거나 클릭한 뒤 불필요한 사각형이 남지 않음
- 문의 Modal은 기존대로 정상적으로 열림
- Modal 종료 후 문의 버튼에 큰 직사각형이 남지 않음

### 드래그

- 문의 버튼 이동 기능은 유지
- 드래그 전에는 선택 테두리 없음
- 드래그 중 필요한 시각적 피드백만 표시 가능
- 드래그가 끝나면 선택·이동 상태 즉시 해제
- 드래그 종료 후 하늘색 직사각형이 남지 않음

### 키보드 접근

- 키보드 `Tab`으로 문의 버튼에 접근했을 때는 접근성 Focus 표시를 유지
- Focus 표시는 버튼의 둥근 외형을 따라 자연스럽게 표시
- Focus 표시를 전역에서 제거하지 않음

---

## 6. Focus 처리 원칙

전역 `outline: none`을 사용하지 않는다.

금지:

```css
*:focus {
  outline: none;
}
```

금지:

```css
button:focus {
  outline: none;
}
```

터치·마우스 Focus와 키보드 Focus를 구분한다.

권장 개념:

```css
.inquiry-button:focus:not(:focus-visible) {
  outline: none;
  box-shadow: none;
}

.inquiry-button:focus-visible {
  outline: 3px solid var(--brand-k-sky-blue);
  outline-offset: 3px;
}
```

Tailwind를 사용한다면 동등하게 적용한다.

예시 개념:

```text
focus:outline-none
focus-visible:outline
focus-visible:outline-2
focus-visible:outline-offset-2
```

단, 실제 문의 버튼에 이미 적용된 공통 디자인 토큰을 우선 사용한다.

---

## 7. 자동 Focus 제거

다음 구현이 있다면 제거하거나 올바르게 수정한다.

```text
autoFocus
element.focus()
requestAnimationFrame(() => element.focus())
setTimeout(() => element.focus())
Focus 복원 시 문의 버튼 강제 선택
```

문의 버튼은 화면 최초 진입 시 자동 Focus 대상이 아니다.

단, 문의 Modal 내부의 접근성 Focus Trap과 첫 입력 필드 Focus는 기존 정책을 유지한다.

문의 Modal 내부 Focus 처리와 플로팅 문의 버튼 최초 Focus를 혼동하지 않는다.

---

## 8. 드래그 Wrapper 처리

문의 버튼이 드래그 가능한 Wrapper 안에 있다면 Wrapper의 Focus·선택 스타일도 확인한다.

다음 요소가 하늘색 사각형을 만드는지 확인한다.

```text
tabIndex
role="button"
aria-selected
data-selected
data-dragging
focus:ring
focus-within:ring
selected class
active class
```

원칙:

- Wrapper에 불필요한 `tabIndex`가 있다면 제거 검토
- 실제 인터랙티브 버튼 한 개만 키보드 Focus를 받도록 구성
- Wrapper Focus와 내부 Button Focus가 중복되지 않도록 함
- `focus-within` 때문에 Wrapper 전체에 사각형이 생기지 않도록 함
- 드래그 상태는 Pointer Down부터 Drag End까지만 유지
- 초기 상태를 `selected=true` 또는 `dragging=true`로 두지 않음

---

## 9. 문의 버튼 디자인 유지

다음 기존 디자인은 유지한다.

- K-Navy 배경
- 흰색 말풍선 아이콘
- 흰색 `문의` 문구
- Pill 형태
- 기존 그림자
- 기존 크기
- 기존 위치
- 드래그 이동
- 저장된 위치 복원
- Safe Area Clamp

이번 작업에서 버튼 크기·문구·색상·기능을 임의 변경하지 않는다.

---

## 10. 위치 저장 및 복원

문의 버튼 위치를 `localStorage` 또는 동등한 저장소에서 복원할 때 Focus까지 복원하지 않는다.

위치 복원 시 처리:

```text
좌표 복원
→ Viewport 안으로 Clamp
→ 문의 버튼 위치 적용
→ Focus하지 않음
→ Selected 상태로 만들지 않음
```

레이아웃 버전 변경으로 저장 좌표를 초기화하는 기존 정책이 있다면 유지한다.

---

## 11. 접근성 기준

다음을 유지한다.

- 문의 버튼의 실제 `button` 역할
- 적절한 접근성 이름
- 키보드 `Enter` 및 `Space` 동작
- 키보드 `Tab` Focus 표시
- 최소 터치 영역 44×44px
- Screen Reader 접근
- 문의 Modal Focus Trap
- Modal 종료 후 합리적인 Focus 복귀

다음은 금지한다.

- 접근성 Focus 표시 전체 제거
- `tabIndex="-1"`로 키보드 접근 차단
- Button을 일반 `div`로 변경
- Screen Reader Label 제거

---

## 12. 실제 모바일 우선 QA

완료 판정 우선순위:

```text
실제 모바일 설치형 PWA
>
실제 모바일 브라우저
>
태블릿
>
PC 스마트폰 프레임
>
일반 PC
```

실제 모바일에서 문의 버튼 주변 사각형이 없어야 한다.

PC 화면만 확인하고 완료 처리하지 않는다.

---

## 13. QA 시나리오

### 최초 진입

각 대상 화면에서 다음을 확인한다.

1. 화면 진입
2. 아무 조작도 하지 않음
3. 문의 버튼 주변 하늘색 사각형 없음
4. 문의 버튼 원래 디자인 정상
5. `document.activeElement`가 문의 버튼으로 강제 지정되지 않음

### 터치

1. 문의 버튼 터치
2. 문의 Modal 정상 표시
3. Modal 닫기
4. 문의 버튼에 하늘색 사각형이 남지 않음

### 드래그

1. 문의 버튼 길게 누르기 또는 드래그
2. 원하는 위치로 이동
3. Drag End
4. 위치 저장
5. 선택 사각형 없음
6. 화면 재진입
7. 저장 위치 복원
8. 하늘색 사각형 없음

### 키보드

1. PC에서 `Tab` 이동
2. 문의 버튼에 키보드 Focus
3. `focus-visible` 표시 정상
4. `Enter`로 Modal 열기
5. Focus 순서 정상

### 화면 이동

1. 아이 홈 → 미션
2. 미션 → 아이 홈
3. 아이 홈 → 자유대화
4. 자유대화 → 아이 홈
5. 부모 홈 → 리포트
6. 리포트 → 부모 홈

각 화면 최초 진입에서 사각형이 표시되지 않는지 확인한다.

---

## 14. 검증 환경

해상도:

```text
320×568
360×800
390×844
430×932
768×1024
```

환경:

- iOS Safari
- iOS 홈 화면 PWA
- Android Chrome
- Android 설치형 PWA
- Windows 설치형 PWA
- PC Chrome
- 태블릿 브라우저

---

## 15. 기능 변경 금지

다음 기능은 변경하지 않는다.

- 문의하기
- 건의하기
- 버그 신고하기
- 문의 Modal
- 문의 제출
- 드래그 이동
- 위치 저장
- 화면별 문의 카테고리
- 미션
- 자유대화
- 놀이
- 부모 화면
- 인증
- API
- DB
- PWA 업데이트

이번 작업은 문의 버튼의 최초 Focus·선택 표시 문제 수정에 한정한다.

---

## 16. 완료 기준

다음 조건을 모두 만족해야 완료다.

- 화면 최초 진입 시 문의 버튼 주변 하늘색 직사각형이 표시되지 않음
- 문의 버튼이 Mount 직후 자동 Focus되지 않음
- 일반 터치·마우스 클릭 후 불필요한 사각형이 남지 않음
- 드래그 종료 후 선택 표시가 남지 않음
- 문의 버튼 기능이 정상 작동함
- 드래그·위치 저장 기능이 정상 작동함
- 키보드 `Tab` 사용 시에는 `focus-visible` 표시가 유지됨
- 전역 `outline: none`을 사용하지 않음
- 미션·자유대화·아이 홈·부모 홈의 공통 문의 버튼에 동일하게 적용됨
- 실제 iOS·Android PWA QA 통과
- 가로 스크롤이나 레이아웃 변화가 없음
- lint 통과
- typecheck 통과
- 관련 test 통과
- production build 통과

---

## 17. 작업 완료 보고

1. 공통 문의 버튼 컴포넌트 경로
2. 변경 파일 목록
3. 하늘색 직사각형의 정확한 원인
4. `document.activeElement` 확인 결과
5. 실제 원인 CSS 속성 또는 Tailwind Class
6. `autoFocus` 또는 강제 `focus()` 존재 여부
7. 드래그 Wrapper의 Focus·Selected 상태
8. 일반 Focus 제거 방식
9. `focus-visible` 접근성 표시 유지 방식
10. 최초 진입 QA 결과
11. 터치·클릭 QA 결과
12. 드래그 QA 결과
13. 키보드 Tab QA 결과
14. iOS PWA QA 결과
15. Android PWA QA 결과
16. Windows PWA QA 결과
17. 문의 Modal 기능 유지 결과
18. 위치 저장·복원 기능 유지 결과
19. lint 결과
20. typecheck 결과
21. test 결과
22. production build 결과
23. 기존 작업을 중단하지 않고 요청 큐 순서대로 처리했다는 확인
24. 남아 있는 위험 요소