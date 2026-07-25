---
name: naechingu-k-design-legacy-v1-green-coral
description: "[보관용 — 더 이상 사용하지 않음] 내친구 케이 브랜드 디자인 시스템 v1(딥그린/라이트그린/코랄, Tailwind v3 기준). 2026-07-25 Navy/Orange 기반 naechingu-k-design v2.0으로 교체되어 폐기됐다. 되돌리기 참고용으로만 보관하며, 이 스킬은 트리거되어서는 안 된다 — 새 작업은 반드시 naechingu-k-design(v2.0)을 사용한다."
license: Proprietary — 내친구 케이 internal use
---

> ⚠️ **보관용 백업 — 사용 금지.** 2026-07-25부로 Navy/Orange 기반 `naechingu-k-design`
> v2.0으로 교체됐다. 이 문서는 되돌리기(rollback)가 필요할 때 참고하는 백업일 뿐이며,
> 새로운 작업에는 절대 이 스킬을 쓰지 않는다 — `.claude/skills/naechingu-k-design/`
> (v2.0)을 사용한다.

# 내친구 케이 디자인 시스템 (Naechingu-K Design System)

부모–자녀 소통 서비스 "내친구 케이"의 브랜드 디자인 시스템. 이 스킬을 쓸 때는
**따뜻하고 신뢰감 있는 톤**을 최우선으로 한다. 아동·AI·개인정보를 다루는 서비스이므로
가볍거나 장난스럽게 보이면 안 되고, 그렇다고 차갑거나 사무적이어도 안 된다.
"부모가 안심하는 따뜻함" — 이 한 문장이 모든 디자인 판단의 기준이다.

## 언제 이 스킬을 쓰나

앱 화면, 관리자/사용자 대시보드, 랜딩페이지, 마케팅 웹, UI 컴포넌트, 이메일 템플릿,
슬라이드 등 **내친구 케이 브랜드로 보여야 하는 모든 시각 산출물**을 만들 때. 기본 스택은
React + Vite + TypeScript + **Tailwind v3**.

## 핵심 원칙 (항상 지킬 것)

1. **색은 지배-보조-포인트 구조로.** 딥그린이 화면의 60–70%를 이끌고, 라이트그린이 보조,
   코랄은 "지금 눌러야 할 것 / 가장 중요한 것"에만 아껴 쓴다. 코랄을 남발하면 신뢰감이 깨진다.
2. **모서리는 둥글게.** 버튼 12px, 카드 16px, 큰 패널 20–24px, 배지/알약형 999px(완전 라운드).
3. **여백을 충분히.** 답답하게 채우지 않는다. 섹션 간 최소 24px, 카드 내부 패딩 최소 20px.
4. **그림자는 은은하게.** 딥그린 계열의 낮은 투명도 그림자로 카드를 살짝 띄운다. 진한 검정 그림자 금지.
5. **텍스트 대비 확보.** 제목은 차콜, 본문은 다크그레이. 라이트 배경에 밝은 텍스트 금지.
6. **경계선보다 배경 틴트.** 카드를 구분할 때 테두리선·색 스트라이프 대신 은은한 그린 틴트 배경을 쓴다.
7. **폰트 역할 고정.** 제목·본문은 Pretendard, 브랜드 문구/포인트 강조는 Gaegu(손글씨 느낌). Gaegu는 짧은 문구에만.

## 컬러 토큰

| 역할 | 이름 | HEX | 용도 |
|------|------|-----|------|
| Primary | deep-green | `#1A6B5A` | 주색. 헤더, 주요 버튼, 강조 배경, 지배색 |
| Secondary | light-green | `#2D9F8F` | 보조. 서브 버튼, 아이콘, 차트, 링크 |
| Accent | coral | `#E8845A` | 포인트. CTA, 핵심 강조 1곳, 배지 |
| Background | warm-white | `#FAFAF8` | 기본 배경(따뜻한 화이트). 순백보다 부드럽다 |
| Surface | white | `#FFFFFF` | 카드/패널 표면 |
| Text-title | charcoal | `#1E1E2D` | 제목 텍스트 |
| Text-body | dark-gray | `#3A3A4A` | 본문 텍스트 |
| Text-muted | muted | `#8A8A97` | 캡션, 보조 텍스트 |
| Tint-green | tint | `#ECF5F2` | 그린 틴트 배경(강조 박스, 선택 상태) |
| Tint-coral | coral-tint | `#FBECE3` | 코랄 틴트 배경(경고 아닌 포인트 박스) |
| Border | hairline | `#E7ECEA` | 아주 옅은 구분선(꼭 필요할 때만) |

### 시맨틱 상태색 (대시보드·폼용, 브랜드와 조화되게 조정됨)

| 상태 | HEX | 배경 틴트 |
|------|-----|-----------|
| success | `#1A6B5A` (브랜드 딥그린 재사용) | `#ECF5F2` |
| info | `#2D9F8F` | `#E4F2EF` |
| warning | `#E8A54A` | `#FBF0DD` |
| danger | `#D9534F` | `#FBE9E8` |

상태색은 브랜드 그린 계열과 부딪히지 않도록 채도를 낮춘 값이다. danger도 원색 빨강 대신 벽돌빛 레드를 쓴다.

## 타이포그래피

- **글꼴**: 제목·본문 `Pretendard`, 브랜드/포인트 `Gaegu`. 폴백: `Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`.
- **스케일** (웹 기준):

| 역할 | 크기 | 굵기 |
|------|------|------|
| Display / Hero | 40–56px | 700 |
| H1 | 32px | 700 |
| H2 | 24px | 700 |
| H3 | 20px | 600 |
| Body | 15–16px | 400 |
| Small / Caption | 12–13px | 400–500 |

- 줄간격(line-height): 제목 1.2, 본문 1.5–1.6.
- Gaegu는 태그라인·환영 문구·마스코트 말풍선 등 **짧고 감성적인 곳**에만. 본문·데이터에는 쓰지 않는다.

## 모서리 · 그림자 · 여백

- **radius**: sm 8px, md 12px(버튼), lg 16px(카드), xl 24px(큰 패널), full 999px(배지·아바타).
- **shadow-soft**: `0 6px 24px rgba(26,107,90,0.12)` — 카드 기본.
- **shadow-pop**: `0 10px 32px rgba(26,107,90,0.18)` — 호버/강조.
- **spacing**: 4px 배수 스케일. 컴포넌트 내부 20–24px, 섹션 간 32–48px, 페이지 좌우 여백 최소 24px(데스크톱 40–64px).

## 컴포넌트 규칙 요약

- **버튼(Primary)**: 딥그린 배경 + 흰 텍스트, radius 12px, 패딩 12×20, 호버 시 라이트그린. **CTA 1개**만 코랄.
- **버튼(Secondary)**: 흰 배경 + 딥그린 텍스트 + 옅은 hairline 테두리 또는 그린 틴트 배경.
- **카드**: 흰 표면, radius 16px, shadow-soft, 패딩 24px. 구분이 필요하면 tint 배경.
- **입력창**: 흰 배경, hairline 테두리, radius 12px, 포커스 시 라이트그린 링(`ring-2`).
- **배지/칩**: 알약형(full), 코랄 또는 그린 틴트 배경.
- **아이콘**: 라이트그린 원형 배경 위 흰 아이콘, 또는 딥그린 라인 아이콘.
- **금지**: 제목 밑줄 강조선, 화면 폭 색 바(header/footer stripe), 카드 한 변 색 스트라이프, 진한 검정 그림자, 순백(#FFFFFF) 전면 배경(→ warm-white 사용), 베이지/크림 기본 배경.

자세한 컴포넌트 코드 레시피는 `reference/components.md`,
바로 쓰는 토큰은 `reference/tokens.css`(CSS 변수)와 `reference/tailwind.config.js`(Tailwind v3)를 읽어 적용한다.

## 적용 순서 (Claude가 UI를 만들 때)

1. 프로젝트에 `reference/tailwind.config.js`의 `theme.extend`를 병합하고, `reference/tokens.css`를 전역 스타일로 import 한다.
2. 배경은 `bg-warm-white`, 카드는 `bg-surface rounded-lg shadow-soft`로 시작한다.
3. 색은 딥그린 지배 → 라이트그린 보조 → 코랄 포인트 순서로 배치한다.
4. 폰트 역할(Pretendard/Gaegu)을 지키고, 여백·radius 토큰을 일관 적용한다.
5. 마지막에 "부모가 안심하는 따뜻함" 기준으로 톤을 점검한다(너무 차갑거나 유치하지 않은지).
