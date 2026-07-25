# v1(딥그린/라이트그린/코랄) → v2.0(K-Navy/K-Orange) 전환 계획

## 배경

v1 스킬(`.claude/skills/naechingu-k-design-legacy-v1-green-coral/`)은 Tailwind v3
`tailwind.config.js` 기반, 딥그린/라이트그린/코랄 팔레트를 썼다. v2.0은 Tailwind v4
`app/globals.css`의 `@theme { }` 블록 기반, K-Navy/K-Orange/K-Mascot-Orange/K-Sky-Blue
팔레트로 전환한다. `reference/tokens.css`가 토큰 정의의 단일 출처다.

## 원칙

- v1 `--color-*` 토큰은 즉시 삭제하지 않는다 — 전체 화면이 v2.0으로 전환 완료된
  뒤에만 `app/globals.css`에서 제거한다(되돌리기 대비).
- 역할 매핑은 화면이 부모용인지 아이용인지에 따라 갈린다: `primary`는 부모 화면에서
  `k-navy`, 아이 화면에서 `k-orange`로 매핑한다(§7 AI 서비스 UI 규칙 — 케이 말풍선은
  K-Orange 계열).
- `--hb-*` 네임스페이스(HeartBloom 부모 신규 디자인 변수, admin/auth/onboarding 등에서
  사용)도 같은 원칙으로 `--color-k-*` 토큰에 매핑해 전환한다.

## 진행 상태

### 1차 검증 화면 (수동 검증 완료, 스킬 문서 배포 시점 기준)

- `/child/home` (`app/child/home/page.tsx`)
- `/parent/home` (`app/parent/home/page.tsx`)
- 공용 내비게이션: `components/RealChildNav.tsx`, `components/RealParentNav.tsx`

### 2차 일괄 전환 (스크립트 기반, 이번 라운드에서 완료)

`app/globals.css`를 포함해 v1 `--color-*` 토큰과 `--hb-*` 토큰을 참조하던 나머지
전체 화면을 스크립트로 일괄 치환했다. 부모/아이/중립 3개 역할군으로 파일을 분류해
역할별 매핑(primary → k-navy vs k-orange)을 적용했고, `--hb-*` 파일군은 별도
매핑 테이블로 처리했다.

- 부모 역할군: `app/admin/**`, `app/parent/**`, `app/demo/parent/**`,
  `components/ParentHeader.tsx`, `components/RealParentNav.tsx`,
  `app/demo/components/ParentNav.tsx`
- 아이 역할군: `app/chat/page.tsx`, `app/child/**`, `app/demo/child/**`,
  `components/ChildTabBar.tsx`, `components/MissionConversationLayout.tsx`,
  `components/RealChildNav.tsx`, `components/TestModeABRunner.tsx`,
  `components/TestModeCDRunner.tsx`, `components/TestModeERunner.tsx`,
  `components/VoiceInputModeSwitch.tsx`, `hooks/useTestSessionExit.tsx`
- 중립 역할군: `app/layout.tsx`, `app/login/page.tsx`, `app/offline/page.tsx`,
  `app/demo/page.tsx`, `app/demo/lib/theme.ts`, `app/demo/components/ViewToggle.tsx`,
  `components/PwaServiceWorker.tsx`
- `--hb-*` 전용 파일군(부모/관리자/인증 성격, 아이 화면 아님 확인됨):
  `app/page.tsx`, `app/admin/**`, `app/auth/setup-password/page.tsx`,
  `app/child/missions/page.tsx`(1건, 실사용처는 재확인 필요), `app/invite/accept/page.tsx`,
  `app/login/page.tsx`, `app/onboarding/page.tsx`, `app/parent/**`, `app/signup/page.tsx`,
  `components/ParentTabBar.tsx`

`app/globals.css`의 `.k-typing` 타이핑 점 애니메이션(케이 AI 대화 UI)도 v1
`--color-primary`에서 `--color-k-orange`로 전환했고, 인라인 style 버튼 전역 호버
선택자도 `--hb-primary` 패턴에서 `--color-k-navy` 패턴으로 갱신했다.

### 남은 작업

- **회귀 검증 미실시**: 이번 라운드 일괄 전환은 문자열 치환 스크립트 기반이라, 부모
  화면 다수 + 관리자 화면 전체에 대해 실제 브라우저 육안 검증이 아직 없다. 색상
  대비, hover 상태, 카드/버튼 radius가 의도대로 렌더링되는지 화면별로 확인 필요.
- **`app/child/missions/page.tsx`의 `--hb-*` 1건**: 아이 화면인데 `--hb-*`(부모
  네임스페이스) 참조가 있었던 항목 — 안전하게 `k-navy`로 매핑해뒀으나, 실제 그
  요소가 부모 성격 UI(예: 부모 승인 배지)인지 재확인 필요.
- **파비콘 경로 통합**: SKILL.md §2에 기록된 대로 `/public/icons/favicon-*.png`와
  `/public/Images/logo/favicon.png`가 중복 존재 — 실사용 위치 확인 후 정리 필요
  (임의 삭제 금지).
- **폰트 확정**: `design-system.md`의 Gaegu 유지 여부 미확정 — 대표 화면 재검증
  단계에서 결정.
- **v1 토큰 삭제 시점**: 위 회귀 검증이 끝나고 대표 승인 이후에만
  `app/globals.css`에서 v1 `--color-*`/`--hb-*` 블록을 제거한다.
