## 결론

Antigravity 분석 결과는 **구현 착수 가능(PASS WITH CONDITIONS)** 판단이 맞습니다.

다만 바로 Claude Code에게 전체 변경을 시키면 안 되고, 아래 순서로 진행하는 것이 안전합니다.

현재 가장 중요한 결정은:

**"브랜드 컬러 변경" → "내친구 케이 Design System v2 구축"으로 승격**

입니다.

이번 변경 범위는 단순 CSS 작업이 아니라:

- PWA 아이콘
- 로고/마스코트 자산
- 글로벌 토큰
- 공통 컴포넌트
- 전체 화면 UX
- 미션 대화 화면
- 놀이 화면
- 관리자 화면

까지 영향을 주는 앱 리브랜딩 작업입니다.

---

# 대표님 의사결정 항목 검토

## 1. Neutral 컬러 정책

### 추천안: Warm Neutral 도입

현재 Tailwind Gray를 그대로 쓰는 것은 내친구 케이 브랜드와 맞지 않습니다.

서비스 성격:

- 아이
- 부모
- 대화
- 친근함
- 따뜻함

이기 때문에 차가운 Gray보다 Warm Gray가 적합합니다.

추천:

```css
--neutral-50: #FFF9F2;
--neutral-100: #FFF4E8;
--neutral-200: #F5EBDD;
--neutral-300: #E6D8C8;
--neutral-500: #8A7F73;
--neutral-700: #4A4038;
--neutral-900: #1E1915;
```

용도:

|영역|사용|
|-|-|
|페이지 배경|neutral-50|
|카드|white|
|구분선|neutral-200|
|보조 글자|neutral-500|
|본문|K-Navy|

판단:
**채택 권장**

---

# 2. K-Orange CTA 정책

현재 분석:

> K-Orange + 흰색 텍스트 대비 부족

맞습니다.

따라서 버튼 정책을 변경해야 합니다.

## 기존 위험

```text
주황 버튼
+
흰색 글자
```

↓

작은 화면에서 가독성 저하


## 추천 정책

### Primary CTA

```text
K-Orange 배경
+
K-Navy 글자
```

예:

```
[ 미션 시작하기 ]
```

---

### 강조 CTA

예:

- 결제
- 완료
- 보상 받기

경우:

```
K-Navy 배경
+
White 글자
```

---

### K-Orange 활용

버튼 전체보다:

- 테두리
- 아이콘
- 진행 표시
- 선택 상태
- 강조 영역

중심으로 사용

판단:
**K-Orange 유지 + 흰색 텍스트 금지 정책 권장**

---

# 3. 관리자 화면 브랜딩 수준

추천:

## 앱 화면

"친근한 브랜드"

적용:

- K-Orange
- K-Mascot Orange
- 둥근 카드
- 마스코트


## 관리자 화면

"운영 도구"

적용:

- K-Navy 중심
- White Background
- K-Sky Blue 상태 표시
- 최소한의 장식

이유:

관리자는 하루 종일 보는 화면입니다.

귀여운 UI보다:

- 정보 밀도
- 빠른 판단
- 오류 확인

이 중요합니다.

판단:
**관리자는 브랜드 컬러만 적용, 앱 UX 스타일은 분리**

---

# 4. 미션 대화 화면 통합

이 부분은 반드시 같이 진행해야 합니다.

현재:

```
브랜드 토큰 작업
+
025 미션 UX 개편
```

따로 하면:

```
globals.css 변경
        ↓
미션 화면 깨짐
        ↓
재수정
```

가능성이 높습니다.

추천:

## Phase 5에서 통합

미션 화면 기준:

|요소|컬러|
|-|-|
|질문 말풍선 테두리|K-Orange|
|마이크 버튼|K-Orange|
|듣는 중|K-Sky Blue|
|생각 중|K-Mascot Orange 점 애니메이션|
|말하는 중|K-Orange|
|텍스트|K-Navy|
|배경|Warm Neutral|

---

# 최종 구현 순서 승인안

## Phase 0 (선행)

브랜드 자산 정리

대상:

```
public/
 ├ logo
 ├ mascot
 ├ favicon
 ├ app icon
```

확정:

- 운영 PWA → K 마스코트
- 개발 PWA → 말풍선 심볼


---

## Phase 1

Design Token 구축

수정:

```
globals.css
tailwind.config
theme
```

생성:

```
Primitive Token

brand-k-navy
brand-k-orange
brand-k-mascot-orange
brand-k-sky-blue


Semantic Token

action-primary
text-primary
background-page
voice-listening
voice-speaking
reward
error
success
```


---

## Phase 2

공통 컴포넌트

순서:

1. Button
2. Card
3. Input
4. Modal
5. Toast
6. Badge
7. Navigation


---

## Phase 3

일반 화면

순서:

1. 로그인
2. 회원가입
3. 홈
4. 부모 리포트
5. 설정


---

## Phase 4

놀이 화면

- MBTI
- 퀴즈
- 준비중
- 보상


---

## Phase 5

미션 대화

025-mission-change.md 통합


---

## Phase 6

PWA

- manifest
- favicon
- apple-touch-icon
- theme-color


---

# Claude Code 다음 지침

[Claude Code]

```text
Antigravity 브랜드 갭 분석 결과를 기준으로 내친구 케이 Design System v2 구축 작업을 진행하라. 이번 작업은 단순 색상 치환이 아니라 브랜드 토큰 기반 UI 시스템 전환이다. 먼저 public 브랜드 자산 구조를 확인하고 운영 PWA는 K 마스코트 아이콘, 개발 PWA는 말풍선 심볼 아이콘을 사용하는 정책을 반영할 준비를 하라. 구현 순서는 반드시 Phase 1 Design Token 구축부터 시작한다. globals.css와 Tailwind 설정에 Primitive Token(brand-k-navy #10315B, brand-k-orange #E25B12, brand-k-mascot-orange #F19122, brand-k-sky-blue #4298D3)과 Semantic Token(action-primary, action-secondary, text-primary, background-page, reward, voice-listening, voice-speaking, state-error, state-success)을 추가하라. Neutral 컬러는 기존 차가운 gray를 그대로 유지하지 말고 내친구 케이 서비스 특성에 맞는 Warm Neutral 계열을 별도 정의하되 기존 상태 의미를 깨뜨리지 않는 범위에서 적용하라. K-Orange와 K-Sky Blue 배경 위 흰색 작은 텍스트 사용은 접근성 문제 때문에 금지하고 K-Navy 텍스트 또는 다른 대비 가능한 조합을 사용하라. 오류·경고·성공·삭제 상태색은 브랜드 컬러로 강제 변경하지 말고 semantic state token으로 분리하라. 공통 Button, Card, Input, Modal, Toast, Badge, Navigation 컴포넌트를 먼저 token 기반으로 변경하고 화면별 하드코딩 색상 제거는 의미 확인 후 단계적으로 진행하라. 025-mission-change.md 미션 대화 화면은 별도 리뉴얼 중이므로 기존 작업을 덮어쓰지 말고 브랜드 토큰 적용 가능한 부분만 통합 준비하라. 미션 화면의 질문 말풍선 K-Orange, 음성 상태 K-Sky Blue/K-Orange, 텍스트 K-Navy, Warm Neutral 배경 정책을 반영할 수 있도록 구조를 준비하라. 구현 전 현재 변경 파일 목록과 충돌 예상 파일을 보고하고, 기존 미커밋 변경은 절대 롤백하지 말라. 전체 HEX 자동 치환, Tailwind 색상 일괄 변경, DB/API/음성 세션 로직 변경은 금지한다.
```

