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

### 2차 후속 정리 (완료)

토큰 이름 기반 스크립트가 못 잡은 항목들 — 대표 회귀 확인(2개 대표 화면, 회귀
없음) 이후 마저 처리했다.

- **`#fafaf8` 하드코딩 리터럴**: v1 warm-white 배경색이 CSS 변수 이름이 아니라
  raw hex 문자열(`style={{ background: "#fafaf8" }}`, `bg-[#fafaf8]`)로 33개
  파일에 남아있었다 — 마이그레이션 스크립트의 `HEX_TO_VAR` 매핑이 실제 코드베이스
  값(`#fafaf8`)이 아니라 다른 추정값(`#fff8e7`)을 기준으로 작성돼 있었던 게
  원인. 이미 `var(--color-k-surface, #fafaf8)` 형태로 fallback까지 정확히 처리된
  8곳(admin/retention 계열)은 그대로 두고, 나머지 29개 파일의 단독 리터럴만
  `var(--color-k-surface)`(관리자 화면 배경색 매핑과 동일 원칙)로 치환했다.
- **`app/child/missions/page.tsx`의 `--hb-*` → `k-navy` 매핑 오류**: 재확인
  결과 이 파일은 아이용 실시간 미션 대화 화면(`useVoiceChat`/`useGeminiLive`
  기반 실제 프로덕션 화면)이 맞았고, 문제의 11곳 전부 홈으로 돌아가기/다시 시도
  버튼, 케이 음성 on/off 토글, 진행률 게이지, 로딩 스피너 등 아이용 상호작용
  요소였다 — 부모 승인 배지 같은 예외는 없었다. 다른 아이 화면들과 일관되게
  `k-navy` → `k-orange`로 재수정.
- **파비콘 실제 참조 버그 발견 및 수정**: SKILL.md §2 조사 당시 발견 못 했던
  더 근본적인 문제 — `app/layout.tsx`의 `metadata.icons.icon`이
  `/favicon.ico`를 가리키는데 `public/favicon.ico` 자체가 존재하지 않아
  **파비콘이 아예 깨져 있었다**. 반면 실제 존재하는 `public/icons/favicon-16.png`
  /`favicon-32.png`는 메타데이터 어디에도 연결이 안 돼 있었음. `icons.icon`을
  이 두 파일(16x16/32x32 PNG)로 교체해 연결. `public/Images/logo/favicon.png`는
  여전히 미사용 상태로 남아있으나 임의 삭제하지 않고 보존(대표 확인 후 정리).

### 남은 작업

- **파비콘 중복 정리**: `public/Images/logo/favicon.png`(미사용 확인됨)를
  삭제할지 보존할지 대표 결정 필요.
- **폰트 확정**: `design-system.md`의 Gaegu 유지 여부 미확정 — 대표 화면 재검증
  단계에서 결정.
- **v1 토큰 삭제 시점**: 전체 화면 회귀 검증(이번 2차 정리분 포함) + 대표
  승인 이후에만 `app/globals.css`에서 v1 `--color-*`/`--hb-*` 블록을 제거한다.
