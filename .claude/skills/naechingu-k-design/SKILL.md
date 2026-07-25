---
name: naechingu-k-design
description: "내친구 케이(K-Bestie) 브랜드 디자인 시스템 v2.0. 앱 화면, 부모 대시보드, 아이 화면, AI 대화 UI, 놀이 콘텐츠, 마케팅 페이지 등 무엇이든 '내친구 케이' 브랜드 톤으로 만들 때 사용한다. 색상(K-Navy/K-Orange/K-Mascot-Orange/K-Sky-Blue), Tailwind v4 @theme 토큰, 둥근 모서리, 아동 서비스에 맞는 신뢰감+친근함 톤을 일관되게 적용한다. Next.js + TypeScript + Tailwind v4 스택 기준. 'brand', '디자인', '색상', '톤', '내친구 케이' 스타일로 만들라는 요청 시 트리거."
license: Proprietary — 내친구 케이 internal use
---

# 내친구 케이 Design Skill v2.0

## 역할

이 Skill은 내친구 케이(K-Bestie) 서비스의 모든 디지털 제품 화면 개발 시 브랜드
아이덴티티와 UX/UI 일관성을 유지하기 위한 디자인 시스템 규칙이다.

적용 대상: Web App · Mobile Web · Child Experience · Parent Dashboard ·
AI Conversation UI · 놀이 콘텐츠(MBTI 등) · 마케팅 페이지 · 향후 K-Bestie 계열 서비스
(재사용 가능하도록 설계됨).

> **v1(딥그린/라이트그린/코랄, Tailwind v3)에서 전환.** 이전 버전은
> `.claude/skills/naechingu-k-design-legacy-v1-green-coral/`에 되돌리기 참고용으로
> 보관돼 있다 — 새 작업에는 사용하지 않는다. 이 문서 배포 시점 기준 `/child/home`,
> `/parent/home`, 공용 내비게이션(`RealChildNav`, `RealParentNav`) 2개 화면만 v2.0이
> 적용된 상태이고, 나머지 화면은 아직 v1 하드코딩 색상이 남아 있다 — 전체 전환 계획은
> `reference/migration-plan.md` 참고.

## 1. 기본 원칙

내친구 케이는 "아이에게는 따뜻한 AI 친구", "부모에게는 믿을 수 있는 연결"이라는 두
경험을 동시에 제공한다.

- **아이 화면**: 친근함 · 재미 · 호기심 · 따뜻함
- **부모 화면**: 신뢰 · 안정감 · 명확한 정보 전달

## 2. 절대 변경 금지 — 브랜드 자산

다음 파일은 임의로 변경하지 않는다: 색상 변경, 비율 변경, 재조합, AI 재생성, 임의
효과 추가, 폰트 변경 전부 금지.

- 로고: `/public/Images/logo/Logo.png`
- 마스코트: `/public/Images/mascot/mascot-standing.png`
- 파비콘: `/public/icons/favicon-16.png`, `/public/icons/favicon-32.png`
  (`/public/Images/logo/favicon.png`도 별도 존재 — 실제 사용 위치 확인 후 참조를
  통합할 것, 임의로 하나를 삭제하지 말 것)

> ⚠️ 실제 파일 경로는 위와 같다(2026-07-25 코드베이스 직접 확인). 일반적으로
> "Logo.png"/"mascot.png"/"favicon.png"처럼 평면 경로로 단순 추정하지 말 것 — 이
> 프로젝트는 `/public/Images/`(대문자 I) 하위에 자산을 두는 관례를 쓴다. 자세한
> 사용 규칙은 `reference/assets.md` 참고.

## 3. 개발 적용 원칙 — Tailwind v4

이 프로젝트는 Tailwind v4를 쓰며, `tailwind.config.js` JS 설정이 아니라
**`app/globals.css`의 `@theme { }` CSS 블록**이 토큰의 단일 정의처다(v1 스킬의
`reference/tailwind.config.js` 방식은 이 프로젝트의 실제 Tailwind 버전과 맞지 않아
쓰지 않는다).

```css
@theme {
  --color-k-navy: #10315B;
  /* ... reference/tokens.css 전체 참고 */
}
```

금지: 페이지별 색상 직접 입력, HEX 하드코딩, 컴포넌트별 독립 스타일 생성.

## 4. 디자인 토큰 사용

모든 UI는 `reference/tokens.css`의 변수를 Tailwind 유틸리티(`bg-k-navy`,
`text-k-navy` 등, `@theme`에 등록된 `--color-*` 토큰은 자동으로 `bg-*`/`text-*`
유틸리티로 노출됨) 또는 `var(--color-k-navy)`로 사용한다.

좋음: `background: var(--color-k-navy);` / `className="bg-k-orange"`
나쁨: `background:#10315B;`

## 5. 컴포넌트 개발 규칙

모든 공통 컴포넌트는 다음 상태를 정의한다: default, hover, active, focus,
disabled, loading, error. 자세한 레시피는 `reference/components.md`.

## 6. 화면 개발 우선순위

1. Design Token → 2. Common Component → 3. Parent Screen → 4. Child Screen →
5. Content Screen → 6. Marketing Screen

## 7. AI 서비스 UI 규칙

AI 대화 UI는 일반 채팅 UI와 다르게 설계한다 — 친구 같은 느낌, 기다림 최소화, 감정
표현, 캐릭터 연결성이 중요하다.

- **케이(AI) 말풍선**: K-Orange 계열, 둥근 말풍선, 친근한 radius
- **아이 말풍선**: 밝은 Surface, 높은 가독성, 편안한 대비

## 8. 반응형 기준

Mobile First. 검증 폭: 320px / 375px / 390px / Tablet / Desktop.

## 9. 접근성

충분한 대비, 명확한 Focus, 터치 영역 최소 44px, 색상만으로 상태 표현 금지.

## 10. 작업 방식

디자인 변경 시: 1) 기존 구조 분석 → 2) 영향 범위 확인 → 3) Token 변경 →
4) Component 변경 → 5) Screen 적용 → 6) Regression Test. **기능 변경 금지.**

## 참고 문서

- `reference/design-system.md` — 컬러/타이포그래피/radius/shadow/spacing 전체 스펙
- `reference/tokens.css` — 그대로 `app/globals.css`에 병합해 쓰는 `@theme` 블록
- `reference/components.md` — 버튼/카드/말풍선/Voice Button 레시피
- `reference/screens.md` — 부모/아이/AI 대화 화면별 규칙
- `reference/assets.md` — 브랜드 자산 실제 경로와 사용 규칙(검증됨)
- `reference/migration-plan.md` — v1→v2 전체 화면 전환 계획(2개 대표 화면 검증 후 작성)
