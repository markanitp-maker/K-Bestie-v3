`076-fix-mission-keyboard-ios-viewport-safe-area.md`

# REQUEST #076 — Mission Keyboard Mode iOS Viewport / Safe-Area Layout 수정

- 상태: TODO
- 유형: UI/UX 버그 수정
- 우선순위: HIGH
- 대상: Mission Keyboard Mode / iPhone Safari·PWA
- 환경: DEV 전용 구현·검증
- 핵심 방향: keyboard visible 상태의 viewport·safe-area·conversation layout만 수정
- 비범위: Mission 대화 로직 / keyboard 입력 로직 / 세션 구조 재설계

---

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

iPhone에서 Mission Keyboard Mode를 사용할 때 software keyboard가 올라와도 화면이 위로 밀리거나 K 응답이 Dynamic Island 뒤로 잘리지 않는다.

정상 화면 구조:

```text
Safe Area Top
→ K 응답 말풍선
→ K 상태
→ Text Input
→ iPhone Keyboard
```

Keyboard 상태에 따른 `채팅창 닫기` 정책:

```text
Keyboard visible
→ `채팅창 닫기` 숨김

Keyboard dismissed + Text Mode 유지
→ `채팅창 닫기` 표시

Input refocus
→ Keyboard visible
→ 다시 숨김
```

긴 K 응답은 잘리지 않고 conversation 영역 안에서 scroll하여 전체 내용을 확인할 수 있어야 한다.

### 대표님 테스트 정상 프로세스

1. Dev 아이 계정으로 Mission에 들어간다.
2. 바로 keyboard를 연다.
3. `✕ 채팅창 닫기` 버튼이 사라지는지 확인한다.
4. K의 여러 줄 응답을 발생시킨다.
5. 응답 첫 부분이 Dynamic Island/status bar 뒤로 들어가지 않는지 확인한다.
6. 긴 응답 전체를 conversation 영역에서 scroll해 읽을 수 있는지 확인한다.
7. 입력창과 전송 버튼이 keyboard 바로 위에 계속 보이는지 확인한다.
8. keyboard를 내린다.
9. Text Mode가 유지되면서 `✕ 채팅창 닫기` 버튼이 나타나는지 확인한다.
10. 입력창을 다시 눌러 keyboard를 연다.
11. `채팅창 닫기`가 다시 사라지는지 확인한다.
12. 한글 → 영문 → 숫자 → 특수문자 keyboard로 전환해본다.
13. 화면이 크게 튀거나 K 말풍선/입력창이 잘리지 않는지 확인한다.

정상이라면:

- keyboard visible → close button 없음
- keyboard dismissed → close button 표시
- Dynamic Island/status bar 침범 없음
- 긴 K 응답 전체 접근 가능
- 입력창이 keyboard 위에 유지
- keyboard 종류 변경 시 layout 안정
- Mission session 및 기존 keyboard 동작 그대로 유지

---

## 1. 목표

Mission Keyboard Mode에서 iPhone software keyboard 사용 시 발생하는 다음 레이아웃 문제만 수정한다.

### Issue A — Close Button

Keyboard가 올라와 있는데도 중앙의 큰:

`✕ 채팅창 닫기`

버튼이 계속 표시되는 문제.

### Issue B — K Bubble Clipping

긴 K 응답 말풍선이 상단으로 밀려:

- status bar
- Dynamic Island
- safe-area

뒤로 들어가 일부 내용이 잘리는 문제.

### Issue C — Viewport Layout

Keyboard 등장 시 전체 페이지가 단순히 위로 밀리면서 대화 내용이 visible viewport 밖으로 사라지는 문제.

최종 우선순위:

```text
1. K 응답 말풍선
2. K 상태
3. 입력창
4. 채팅창 닫기 CTA
```

---

## 2. 요구사항

### Keyboard Visible

표시:

- K 질문/응답
- K 상태
- text input
- send button
- software keyboard

숨김:

- `✕ 채팅창 닫기`

K 말풍선은 safe-area 아래의 visible viewport 안에서 접근 가능해야 한다.

### Keyboard Dismissed

Text Mode가 유지 중이면:

`✕ 채팅창 닫기`

버튼을 표시할 수 있다.

이 버튼은 keyboard dismiss가 아니라 **Text Mode를 종료하고 Mission Voice 화면으로 복귀하는 기능**이다.

### Keyboard Visibility

기존 keyboard visibility hook/util이 있으면 재사용한다.

없다면 iOS Safari/PWA에서 실제 visible 영역을 판단할 수 있는 기존 프로젝트 convention을 우선 사용한다.

필요 시 다음 실제 viewport/focus 신호를 조합한다.

- `window.visualViewport`
- viewport height / offset
- input focus / blur
- `window.innerHeight`
- safe-area

목표는 하나의 일관된:

`isKeyboardVisible`

Source of Truth를 사용하는 것이다.

고정 timer만으로 keyboard 상태를 추측하지 않는다.

### Visual Viewport / Safe Area

Keyboard가 열렸을 때 실제 visible viewport 기준으로 conversation 영역을 재배치한다.

보장:

- 상단 safe-area 침범 없음
- Dynamic Island 뒤 clipping 없음
- 입력창이 keyboard 뒤로 숨지 않음
- 전체 page를 단순 translate하여 콘텐츠를 화면 밖으로 밀지 않음

기존 safe-area utility가 있으면 재사용한다.

### Conversation Area

긴 K 응답을 잘라내지 않는다.

- conversation 영역 내부 scroll 허용
- 긴 응답 전체 접근 가능
- 최신 응답이 가능한 범위에서 visible 영역에 위치
- header/status bar 아래로 침범하지 않음
- 불필요한 `overflow:hidden`으로 content clipping 금지

### K 상태 UI

현재 상태 UI는 유지한다.

- 대기 중
- 생각 중
- 말하는 중
- 연결 중

다만 keyboard visible 상태에서 대화 영역을 과도하게 차지하지 않도록 기존 디자인 범위에서 compact하게 유지한다.

### Input

Keyboard visible:

- input 항상 visible
- send button 항상 visible
- keyboard 바로 위에 위치

Keyboard dismissed:

- Text Mode 유지 가능
- input refocus 가능
- close button 표시

한글/영문/숫자/특수문자 keyboard 전환으로 심한 layout jump가 발생하지 않아야 한다.

---

## 3. 기존 구조 확인

이번 레이아웃 문제 해결에 직접 필요한 범위만 확인한다.

확인 대상:

- Mission Keyboard/Text Mode layout
- `채팅창 닫기` 현재 render 조건
- 기존 keyboard visibility hook/util
- input focus/blur 처리
- 현재 viewport 처리 방식
- 현재 safe-area utility/CSS
- conversation area scroll/overflow
- input bar positioning
- K bubble positioning
- K status positioning

현재 구조가 이미 `visualViewport` 또는 safe-area를 처리하고 있다면 해당 방식을 우선 재사용한다.

코드에서 확인 가능한 내용을 추측하지 않는다.

Mission Conversation Engine, TTS, Goal, Reward 등 **레이아웃 문제와 관계없는 영역으로 조사를 확대하지 않는다.**

---

## 4. 금지

- Mission Keyboard 기능 전체 재설계
- text submit/response 로직 변경
- Mission Conversation Engine 변경
- Mission session 구조 변경
- manual/auto mic 정책 변경
- Goal Progress 변경
- Memory 변경
- Reward 변경
- Mission 시간 정책 변경
- keyboard open/close를 이유로 session reconnect
- `이어하기` modal 유발
- disconnect popup 유발
- fake timer 기반 keyboard 판정
- 고정 pixel margin만 추가해서 증상을 임시로 숨기는 방식
- 긴 K 응답 clipping
- 전체 page를 강제로 translate하여 상단 콘텐츠를 밀어내는 방식
- 관련 없는 UI 리팩터링
- Production deploy
- Production DB/config 변경

다음 기존 동작을 보호한다.

- Mission 최초 진입 직후 keyboard 사용
- 음성 1턴 없이 첫 text 입력
- manual mode mic 정상
- recording 중 keyboard 제한
- recording 종료 후 keyboard 정상
- K 상태 UI
- Mission session continuity
- Free Chat
- 현재 DEV/Production Mission 시간 정책 코드

---

## 5. 모호성 처리

Request와 현재 코드만으로 원인이 확인되면 레이아웃 관련 최초 원인만 수정한다.

다음 경우 관련 코드와 필요한 Skill/Reference만 추가 확인한다.

- keyboard visibility Source of Truth가 여러 개 존재
- viewport 높이를 여러 component가 각각 계산
- fixed/sticky layout과 safe-area 처리가 충돌
- conversation area와 input bar가 서로 다른 viewport 기준 사용
- iOS Safari와 PWA에서 현재 구현 방식이 다름

Reference까지 확인해도 다음과 같은 구조 변경이 필요하다면 임의로 확장하지 않는다.

- 공통 Mission Layout 전체 변경
- Free Chat 공통 Layout까지 변경
- session/mode state 구조 변경
- keyboard input lifecycle 변경
- Production UI 동작에 직접 영향

이 경우 해당 지점에서 중단하고 다음만 보고한다.

1. 실제 레이아웃 원인
2. 현재 구조에서 가능한 수정 방법
3. 각 방법의 Mission/Free Chat 영향
4. 최소 변경 기준 권장 방향

---

## 6. QA

`qa-scope` Skill을 적용하여 실제 최종 diff에 필요한 최소 충분 QA만 수행한다.

이번 Request의 필수 Gate:

### Keyboard

- keyboard visible → `채팅창 닫기` hidden
- keyboard dismissed → `채팅창 닫기` visible
- input refocus → hidden
- 한글/영문/숫자/특수문자 전환 중 hidden 유지

### Viewport / Safe Area

- K bubble status bar 침범 0
- Dynamic Island clipping 0
- 긴 K 응답 전체 접근 가능
- conversation area scroll 정상
- input/send button keyboard 위 유지
- 심각한 layout jump 없음

### Regression

- Mission keyboard-first 정상
- 동일 Mission session 유지
- keyboard open/close로 reconnect 없음
- resume modal 없음
- disconnect popup 없음
- K 상태 UI 정상

실제 수정이 Free Chat 공통 UI까지 영향을 준 경우에만 해당 범위를 추가 검증한다.

가능한 경우 실제 iPhone Safari/PWA 환경에서 확인하고 화면 증거를 남긴다.

---

## 7. 완료 조건

다음이 모두 충족되면 완료한다.

- keyboard visible 동안 `채팅창 닫기` 미표시
- keyboard dismissed 상태의 Text Mode에서는 `채팅창 닫기` 표시
- keyboard reopen 시 다시 숨김
- K 응답이 safe-area 아래에 위치
- Dynamic Island/status bar 뒤 clipping 없음
- 긴 K 응답 전체 접근 가능
- conversation area 내부 scroll 정상
- input/send button 항상 접근 가능
- 상태 UI가 대화 영역을 과도하게 침범하지 않음
- keyboard 종류 전환 시 layout 안정
- 기존 Mission session 유지
- 기존 keyboard-first 동작 보존
- 관련 없는 Mission 기능 변경 없음
- Production 미배포

DEV 필수 Gate를 통과하면 작업을 종료한다.

Production 반영은 별도 승인 대상으로 유지한다.

---

## 8. 완료 보고

아래만 간단히 보고한다.

1. 레이아웃 root cause
2. 기존/신규 `채팅창 닫기` 표시 조건
3. keyboard visibility Source of Truth
4. visual viewport 처리 방식
5. safe-area 처리 방식
6. conversation area / 긴 K bubble 처리
7. input bar 위치 처리
8. 주요 수정 파일
9. QA Level 및 필수 Gate 결과
10. 실제 iPhone QA 결과
11. session / keyboard-first 회귀 결과
12. Production 미배포 확인
13. Commit SHA
14. 남은 위험이 있는 경우만 해당 내용

최종 판정:

`PASS` 또는 `BLOCKED`