073-1-responsive-tablet-residual-fixes.md

# 073 보완 — 태블릿 반응형 잔여 오류 4건 수정

## 상태 / 우선순위
- 상태: 073 후속 보완
- 우선순위: P0
- 작업 성격: 기존 반응형 구현 누락/잔여 오류 수정
- 담당: Codex
- 원칙: 새 UI 제작 금지, 기존 디자인 유지, 태블릿 정합성만 수정

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
073 반응형 UI 작업 이후 남아 있는 아래 4개 태블릿 문제를 모두 해결한다.

1. 부모 > 리포트가 태블릿에서도 480px 스마트폰 폭으로 좁게 고정되는 문제
2. 아이 > 미션 / 자유대화가 태블릿 가로 화면에서 지나치게 좁게 표시되는 문제
3. 아이 > 게임 참여 > 퀴즈마스터가 태블릿에서도 스마트폰 프레임/폭으로 강제되는 문제
4. 아이 > MBTI에서 질문 이미지가 태블릿에서 과도하게 커져 질문/선택지가 아래로 밀리는 문제

이번 작업은 073의 미완료 보완이다. 새 화면, 새 카드 구조, 새 태블릿 전용 UI를 만들지 않는다.

### 대표님 테스트 정상 프로세스

#### A. 부모 > 리포트
1. Dev에서 부모 계정으로 로그인한다.
2. PC에서 태블릿 Preview를 선택한다.
3. 부모 > 리포트 > 일간으로 이동한다.
4. 화면이 480px 좁은 중앙 띠가 아니라 태블릿 가용 폭에 맞게 자연스럽게 확장되는지 확인한다.
5. 주간 탭도 동일하게 확인한다.
6. 실제 iPad/태블릿에서도 같은 결과인지 확인한다.

PASS:
- 일간/주간/기간 탭/캘린더가 동일한 태블릿 폭 기준을 사용한다.
- 스마트폰 폭 480px로 고정되지 않는다.
- 기존 카드 디자인/문구/구조는 바뀌지 않는다.

#### B. 아이 > 미션 / 자유대화
1. 태블릿 Preview에서 미션에 진입한다.
2. 현재 1열 세로 UI 구조가 그대로 유지되는지 확인한다.
3. 태블릿 가로에서 중앙 대화 영역이 지나치게 좁지 않고 적정 폭까지 자연스럽게 확장되는지 확인한다.
4. 자유대화도 동일하게 확인한다.
5. 실제 태블릿 세로/가로에서도 확인한다.

PASS:
- 말풍선, 마스코트, 시작/이어하기 버튼, 상태 영역, 마이크 UI 구조는 그대로다.
- 태블릿 가로 화면에서 양쪽 여백이 과도하게 크지 않다.
- 가로 스크롤/잘림/겹침이 없다.

#### C. 아이 > 게임 참여 > 퀴즈마스터
1. 태블릿 Preview에서 게임 참여로 이동한다.
2. 퀴즈마스터를 연다.
3. 게임 내부가 430px 스마트폰형 좁은 프레임으로 강제되지 않는지 확인한다.
4. iframe이 태블릿 가용 폭을 정상 사용하고 있는지 확인한다.
5. 스마트폰에서는 기존 스마트폰 레이아웃이 정상 유지되는지 확인한다.

PASS:
- 태블릿에서 스마트폰 외곽/좁은 폭 강제가 사라진다.
- 스마트폰은 기존 UI가 깨지지 않는다.
- 게임 기능/문제 진행/버튼 동작은 그대로다.

#### D. 아이 > MBTI
1. 태블릿 Preview에서 MBTI를 연다.
2. 질문 이미지가 화면 가로 폭에 따라 과도하게 확대되지 않는지 확인한다.
3. 질문 텍스트와 선택지가 아래로 과도하게 밀리지 않는지 확인한다.
4. 실제 태블릿 세로/가로에서 확인한다.
5. 스마트폰에서도 이미지가 기존처럼 정상 표시되는지 확인한다.

PASS:
- 태블릿에서 이미지가 비정상적으로 커지지 않는다.
- 질문과 선택지 영역이 정상적으로 이어진다.
- 이미지 비율이 깨지지 않는다.
- 스마트폰 레이아웃 회귀가 없다.

## 1. 배경 / 확인된 원인

Antigravity READ-ONLY 감사 결과를 근거로 한다.

### 1-1. 부모 리포트
073에서 `--content-max-width` 태블릿 토큰이 추가됐지만 부모 리포트 화면은 여전히 기존 `--max-width-app: 480px`를 참조하고 있다.

확인된 파일:
- `app/parent/report/page.tsx`
- `app/parent/report/weekly/page.tsx`
- `components/parent/report/ReportPeriodTabs.tsx`
- `app/parent/report/components/ReportHistoryCalendarSheet.tsx`

현재 문제:
`max-w-[var(--max-width-app)]`

073에서 만든 태블릿 대응 토큰:
`--content-max-width`

### 1-2. 미션 / 자유대화
현재 두 화면은 `--content-max-width-wide`를 사용하지만 태블릿 breakpoint에서 768px 상한으로 제한되어 있다.

확인된 파일:
- `app/globals.css`
- `components/MissionConversationLayout.tsx`
- `app/chat/page.tsx`

태블릿 세로에서는 큰 문제가 없으나, 1024~1100px 가로/4:3 화면에서는 768px 중앙 영역 때문에 양쪽 여백이 과도하다.

### 1-3. 퀴즈마스터
`PlayFrame.tsx` 외부 iframe은 이미 `w-full h-full`로 태블릿 가용 영역을 전달하고 있다.

따라서 좁은 스마트폰형 프레임의 직접 원인은 iframe 내부 퀴즈 앱의 root/container max-width 제약이다.

관련:
- `components/play/PlayFrame.tsx`
- `/play/quiz` 프록시 경로
- iframe 내부 퀴즈마스터 DOM/CSS

### 1-4. MBTI
태블릿에서 이미지가 `width: 100%; height: auto` 방식으로 가로 폭 전체를 따라 확대되어 세로 높이까지 과도하게 증가한다.

관련:
- `components/play/PlayFrame.tsx`
- `/play/mbti` iframe 내부 DOM/CSS

## 2. 작업 원칙

### 반드시 유지
- 현재 부모 리포트 카드 디자인
- 현재 미션 UI
- 현재 자유대화 UI
- 현재 게임 참여 화면
- 현재 퀴즈마스터 디자인
- 현재 MBTI 디자인
- 현재 헤더
- 현재 마스코트
- 현재 버튼
- 현재 색상
- 현재 기능/데이터/대화 로직

### 절대 금지
- 태블릿용 신규 2열/3열 UI 제작
- 부모 리포트 카드 재설계
- 미션/자유대화 구조 재배치
- 말풍선/마스코트/마이크 재디자인
- 퀴즈마스터 전체 UI 재작성
- MBTI 선택지/질문 구조 재설계
- 브라우저/기기별 임의 px 하드코딩
- UA sniffing 기반 CSS 분기
- `transform: scale`, `zoom`, negative margin으로 증상 덮기
- 모든 iframe에 광범위 CSS 강제 주입
- 모든 `img`, `main`, `#root > div`, `[class*="image"]` 등에 전역 `!important` 적용
- DB/API/LLM/STT/TTS 수정

## 3. 작업 1 — 부모 리포트 태블릿 폭 누락 수정

### 대상
- `app/parent/report/page.tsx`
- `app/parent/report/weekly/page.tsx`
- `components/parent/report/ReportPeriodTabs.tsx`
- `app/parent/report/components/ReportHistoryCalendarSheet.tsx`

### 요구사항
1. 부모 리포트에 남아 있는 `max-w-[var(--max-width-app)]` 사용 위치를 전수 확인한다.
2. 073에서 만든 `--content-max-width` responsive token 계약으로 변경한다.
3. 일간/주간/탭/달력 시트의 좌우 폭 기준을 동일하게 맞춘다.
4. 스마트폰에서는 기존 최대 폭과 레이아웃을 유지한다.
5. 태블릿에서는 가용 폭에 맞춰 073 responsive token 범위까지 자연스럽게 확장한다.
6. 부모 홈/전문가 페이지와 충돌하지 않는다.

### 완료 기준
- 태블릿에서 리포트가 480px 좁은 중앙 띠로 보이지 않는다.
- 탭과 카드 좌우 경계가 일치한다.
- 스마트폰에서는 기존 UI와 동일하다.

## 4. 작업 2 — 미션 / 자유대화 태블릿 가로 폭 보완

### 대상
- `app/globals.css`
- `components/MissionConversationLayout.tsx`
- `app/chat/page.tsx`

### 요구사항
1. 현재 `--content-max-width-wide`의 태블릿 상한이 실제 4:3/가로 태블릿에서 왜 과도한 여백을 만드는지 현재 코드 기준으로 재확인한다.
2. 1열 세로 대화 UI의 가독성을 유지하면서 태블릿 가로에서 사용할 수 있는 적정 상한폭으로 조정한다.
3. Antigravity가 제시한 `768~840px` 범위는 참고값일 뿐이며 무조건 하드코딩하지 않는다.
4. 실제 태블릿 Preview와 810×1080 / 1080×810 기준 QA를 보고 최종 폭을 정한다.
5. 배경은 현재처럼 전체 사용 가능 영역을 유지한다.
6. 내부 대화 UI만 적정 폭으로 중앙 정렬한다.
7. 미션/자유대화가 동일한 wide token 계약을 사용하도록 유지한다.

### 변경 금지
- 1열 → 2열 변경 금지
- 마스코트 크기 임의 변경 금지
- 말풍선 크기 규칙 임의 재설계 금지
- 시작/이어하기 CTA 변경 금지
- 마이크/자동수동 위치 재설계 금지

### 완료 기준
- 태블릿 가로에서 지나치게 좁은 느낌이 사라진다.
- 세로 UI의 기존 비율과 가독성이 유지된다.
- 스마트폰 화면은 회귀가 없다.

## 5. 작업 3 — 퀴즈마스터 태블릿 스마트폰 프레임 강제 해제

### 대상
- `components/play/PlayFrame.tsx`
- `/play/quiz` iframe 로드 경로
- 필요 시 Same-Origin iframe 내부 실제 DOM/CSS selector

### 구현 전 필수 확인
Codex는 수정 전에 실제 Dev iframe DOM을 열어 다음을 확인한다.
- 스마트폰 폭을 강제하는 실제 element
- 실제 selector
- computed `width`
- computed `max-width`
- 부모/자식 container 구조
- 스마트폰 외곽 프레임을 만드는 element
- iframe 내부 앱 자체에서 태블릿 breakpoint가 있는지 여부

### 요구사항
1. 실제 원인 selector를 특정한 뒤 그 selector만 제한적으로 보정한다.
2. `/play/quiz`에만 적용되도록 route/game type을 명확히 분기한다.
3. 태블릿에서 iframe 내부 root/content가 사용 가능한 폭을 정상 사용하도록 한다.
4. 스마트폰에서는 현재 폭/프레임이 필요한 경우 기존 동작을 유지한다.
5. 기존 헤더 숨김 처리와 충돌하지 않는다.

### 절대 금지
다음과 같은 광범위한 주입을 그대로 사용하지 않는다.

```css
[class*="container"],
main,
#root > div {
  max-width: 100% !important;
}
```

실제 DOM selector를 확인하지 않은 상태에서 위와 같이 범용 선택자를 강제로 적용하면 안 된다.

### 근본 수정 가능 여부
- 퀴즈마스터 upstream 코드가 현재 저장소/작업 범위에서 안전하게 수정 가능하다면 upstream responsive CSS 수정이 우선이다.
- upstream 수정이 불가능하고 Same-Origin proxy 주입만 가능한 경우에만 `PlayFrame`에서 퀴즈마스터 전용 selector 보정을 사용한다.
- 어떤 방식을 선택했는지 완료 보고에 근거를 남긴다.

### 완료 기준
- 태블릿에서 스마트폰형 좁은 프레임이 사라진다.
- 문제/버튼/점수 영역 기능이 정상이다.
- 스마트폰 회귀가 없다.
- MBTI 등 다른 iframe에는 영향이 없다.

## 6. 작업 4 — MBTI 태블릿 이미지 과대 확대 수정

### 대상
- `components/play/PlayFrame.tsx`
- `/play/mbti` iframe 로드 경로
- 필요 시 MBTI iframe 내부 실제 image wrapper/selector

### 구현 전 필수 확인
실제 MBTI 질문 화면 DOM을 확인한다.

확인:
- 질문 이미지 실제 selector
- image wrapper selector
- `width`
- `height`
- `max-width`
- `max-height`
- `aspect-ratio`
- `object-fit`
- 스마트폰 / 태블릿 computed size

### 요구사항
1. 질문 이미지에만 적용되는 실제 selector를 사용한다.
2. 태블릿에서 가로 폭 전체를 따라 무제한 확대되지 않도록 세로/가로 상한을 설정한다.
3. 원본 aspect ratio는 유지한다.
4. `object-fit: contain` 등으로 이미지가 잘리지 않게 한다.
5. 이미지 중앙 정렬을 유지한다.
6. 스마트폰에서는 기존 적정 크기를 유지한다.
7. 질문/선택지가 이미지 때문에 과도하게 아래로 밀리지 않게 한다.

### 중요
Antigravity가 예시로 제안한 아래 코드를 그대로 전역 적용하지 않는다.

```css
img,
[class*="image"],
[class*="illust"] {
  max-height: min(30dvh, 220px) !important;
}
```

`220px`, `30dvh`도 참고값일 뿐이다.
실제 MBTI DOM과 스마트폰/태블릿 QA를 기준으로 최종 제한값을 결정한다.

### 적용 범위
- MBTI 질문 이미지에만 적용
- 퀴즈마스터/다른 놀이 이미지에는 영향 없음

### 완료 기준
- 태블릿에서 이미지가 과도하게 커지지 않는다.
- 질문과 선택지가 정상적인 흐름으로 표시된다.
- 이미지 찌그러짐/잘림이 없다.
- 스마트폰 회귀가 없다.

## 7. QA

### 7-1. 자동 검증
최소:
- TypeScript typecheck
- 관련 unit/component tests
- build
- Playwright 기존 responsive QA
- iframe wrapper 관련 regression test

단, 문자열 검색 테스트만으로 완료 판정하지 않는다.

### 7-2. PC Preview QA

Tablet Preview:
- 부모 > 리포트 > 일간
- 부모 > 리포트 > 주간
- 아이 > 미션
- 아이 > 자유대화
- 아이 > 게임 참여 > 퀴즈마스터
- 아이 > MBTI

Smartphone Preview 회귀:
- 동일 화면을 스마트폰 Preview에서도 확인한다.

### 7-3. 실기기/Viewport QA
최소:
- 390×844 smartphone
- 412×915 Android smartphone
- 810×1080 tablet portrait
- 1080×810 tablet landscape

가능하면:
- iPhone Safari
- iPhone PWA
- Android Chrome
- Android PWA
- iPad/Tablet Safari 또는 Chrome

### 공통 PASS
- 가로 overflow 없음
- 핵심 UI 잘림 없음
- 콘텐츠 겹침 없음
- 기존 버튼 정상 동작
- 기존 기능 정상
- 새 UI가 생기지 않음

## 8. 완료 조건

### 부모 리포트
- [ ] 480px 고정 폭 잔여 제거
- [ ] 일간 정상
- [ ] 주간 정상
- [ ] ReportPeriodTabs 정상
- [ ] CalendarSheet 정상
- [ ] 스마트폰 회귀 없음

### 미션 / 자유대화
- [ ] 태블릿 가로 폭 과도한 제한 개선
- [ ] 미션 정상
- [ ] 자유대화 정상
- [ ] 기존 세로 1열 UI 유지
- [ ] 스마트폰 회귀 없음

### 퀴즈마스터
- [ ] 실제 강제 max-width selector 확인
- [ ] 태블릿 스마트폰 프레임 강제 해제
- [ ] route/game-specific 처리
- [ ] 다른 iframe 영향 없음
- [ ] 스마트폰 회귀 없음

### MBTI
- [ ] 실제 질문 이미지 selector 확인
- [ ] 태블릿 이미지 과대 확대 해소
- [ ] 이미지 비율 유지
- [ ] 질문/선택지 정상
- [ ] 다른 게임 이미지 영향 없음
- [ ] 스마트폰 회귀 없음

### 공통
- [ ] typecheck PASS
- [ ] tests PASS
- [ ] build PASS
- [ ] Playwright QA PASS
- [ ] Dev 배포 완료
- [ ] PC Tablet Preview QA PASS
- [ ] 실제 Tablet QA PASS
- [ ] Smartphone 회귀 QA PASS
- [ ] Dev PASS 후 동일 Commit Production 배포
- [ ] Production 최종 확인

미해결 항목이 하나라도 있으면 `완료`로 보고하지 않는다.

## 9. 작업 순서
1. 현재 073 반영 상태 재확인
2. 부모 리포트 token 누락 수정
3. 미션/자유대화 wide token 보완
4. Dev QA
5. 퀴즈마스터 iframe 실제 DOM selector 확인
6. 퀴즈마스터 전용 최소 수정
7. MBTI 실제 이미지 selector 확인
8. MBTI 전용 최소 수정
9. 전체 Playwright QA
10. Dev Preview/실기기 QA
11. 회귀 수정
12. Dev 전체 PASS
13. 동일 Commit Production 배포
14. Production 최종 QA

## 10. 완료 보고 형식

### A. 변경 파일
파일별:
- 파일명
- 변경 이유
- 변경 내용

### B. 부모 리포트
- 기존 480px 원인
- 적용한 responsive token
- 일간/주간/탭/캘린더 QA 결과

### C. 미션 / 자유대화
- 기존 wide max-width
- 최종 적용 기준
- Tablet Portrait/Landscape 결과
- Smartphone 회귀 결과

### D. 퀴즈마스터
- 실제 원인 element/selector
- upstream 수정인지 PlayFrame 주입인지
- 선택한 이유
- 태블릿/스마트폰 결과
- 다른 게임 영향 여부

### E. MBTI
- 실제 이미지 selector
- 변경 전/후 computed size
- 적용한 max-width/max-height 원칙
- 태블릿/스마트폰 결과

### F. 검증
- typecheck
- tests
- build
- Playwright

### G. 배포
- Commit
- Dev URL
- Dev QA 결과
- Production 배포 여부
- Production 최종 QA 결과

### H. 미해결
하나라도 남으면 완료 처리하지 말고 남은 원인과 다음 수정 지점을 보고한다.
