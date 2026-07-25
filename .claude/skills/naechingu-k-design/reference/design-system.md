# 내친구 케이 Design System v2.0

## Brand Color

| 역할 | 이름 | HEX | 용도 |
|------|------|-----|------|
| Primary | K-Navy | `#10315B` | 부모 화면 기본 컬러, Header, Navigation, 공식 영역, Primary Text — 신뢰·안정·전문성 |
| CTA | K-Orange | `#E25B12` | CTA, Button, Highlight, Reward — 친근함·활력·행동 유도 |
| Character | K-Mascot-Orange | `#F19122` | 캐릭터, 아이 경험, 감성 요소 |
| Secondary Accent | K-Sky-Blue | `#4298D3` | Secondary Accent, Progress, Information |

## Typography

- **Korean Primary**: Pretendard (기존 프로젝트에 이미 CDN으로 로드돼 있음 — 새로 추가하지 않는다)
- **English Heading**: Fredoka One / Quicksand
- **English Body**: Montserrat / Inter

> 참고: 기존 프로젝트는 브랜드 포인트 문구에 Gaegu(손글씨체)도 함께 쓰고 있었다(v1
> 스킬 유산). v2.0에서 Gaegu를 유지할지, Fredoka One/Quicksand로 완전히 대체할지는
> 대표 화면 검증 단계에서 결정한다 — 이 문서 배포 시점에는 미확정이며 임의로 삭제하지
> 않는다.

## Radius

| 이름 | 값 |
|------|-----|
| Small | 8px |
| Medium | 16px |
| Large | 24px |
| XL | 32px |

## Shadow

| 이름 | 값 |
|------|-----|
| Card | `0 4px 16px rgba(0,0,0,0.08)` |
| Floating | `0 8px 24px rgba(0,0,0,0.12)` |

## Spacing

4px 기반 시스템: xs 4 / sm 8 / md 16 / lg 24 / xl 32 / xxl 48.
Tailwind 기본 spacing 스케일과 호환되므로 커스텀 유틸리티 없이 `p-1`(4px)~`p-12`(48px)를 그대로 사용한다.
