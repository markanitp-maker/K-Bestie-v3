# 095 보호자 회원가입·온보딩 최종 통합 — Claude Code 인수인계

> 인계 시각: 2026-08-09 07:37 KST  
> 상태: **구현 완료 / Dev 핵심 E2E PASS / iPhone WebKit 재검증 중 사용자 지시로 중단 / Production 미배포**

## 1. 작업 위치와 Git 상태

- 전용 worktree: `C:\Users\Home\.codex\.chatgpt-projects\g-p-6a3797cec4008191a030ae107d274aed\worktrees\req-095-onboarding`
- 브랜치: `codex/095-parent-signup-onboarding-final-consolidation`
- 현재 HEAD: `9d4187adcaf910046af142a9f5ab2742cf5abf15`
- 기준 main: 인계 시점 로컬 기준 `origin/main`의 `1bab903`
- `9d4187a`는 기존 1회용 가족 초대 구현 `514f3dc`를 통합한 커밋이다.
- 095 후속 수정은 아직 커밋하지 않았다. 이 worktree의 수정/신규 파일을 그대로 리뷰·검증한 뒤 의도적으로 커밋해야 한다.
- `git reset --hard`, force push, 최신 main 변경 되돌리기 금지. 커밋 전 `git fetch` 후 최신 `origin/main` 위로 안전하게 rebase/merge한다.

## 2. 구현된 내용

### 회원가입 1~4단계

- 1/4: 필수 동의 유지, `← 이전`은 명시적으로 `/login` 이동.
- 2/4: 보호자 이름·관계만 유지. 전화번호와 중복 법정대리인 체크박스 제거.
- 서버는 1/4의 `guardian_u14`, `guardian_authority` 동의 원장을 확인하고 `guardian_authority.agreed_at`을 `legal_guardian_confirmed_at`으로 재사용한다.
- 3/4: 일반 가입은 `가족 만들기`만 표시. 이메일/코드 기반 가족 참여 UI 및 호출 제거.
- 4/4: 관심사 UI·필수 validation·필수 payload 제거. DB에는 빈 배열을 정상 저장하며 기존 데이터/컬럼은 보존.
- 2→1, 3→2, 4→3 왕복 시 입력값을 상위 메모리 draft로 유지한다. 비밀번호는 브라우저 저장소에 기록하지 않는다.
- 가족 생성 API의 기존 멱등 경로를 유지해 왕복·중복 클릭에도 동일 family를 재사용한다.

### 1회용 가족 초대 링크

- 일반 회원가입과 분리된 전용 `/family/invite/[token]` 흐름만 사용한다.
- 초대받은 사용자의 실제 `auth.user.id`를 기존 family의 parent로 원자 연결한다.
- 소비와 동시에 명시적 `consumed`, 취소는 `revoked` 상태로 전환한다.
- consumed/revoked/expired 링크는 전용 화면에서 차단하고 일반 가족 만들기로 보내지 않는다.
- 신규 초대 참여자는 동의·프로필 완료 후 초대 continue로 복귀하여 3/4·4/4를 건너뛰고 부모 홈으로 이동한다.
- 초대 링크/QR만 노출하고 이메일·8자리 코드 UI는 노출하지 않는다.
- 전용 `FAMILY_INVITE_SIGNING_SECRET` 없이는 서버가 시작되지 않도록 했으며 다른 서비스 키 fallback을 제거했다.

### 아이 시작 Handoff 및 보안

- 기존 공통 `ChildStartGuide`를 온보딩 완료, 부모 홈 상시 카드, 설정의 아이별 `로그인 방법`에서 재사용한다.
- QR은 `/login?role=child&login_id=...`만 포함한다. 비밀번호·부모 세션·토큰은 포함하지 않는다.
- 같은 기기 시작 시 부모 sign-out 오류를 확인하고, 성공한 경우에만 아이 로그인 화면으로 이동한다.
- `role=child` 로그인은 보호자 OAuth 영역을 숨기고 아이 로그인 ID를 prefill/focus한다.
- 자녀 account 조회 API에 활성 부모 계정 확인과 soft-deleted membership 제외를 추가했다.
- 부모 홈·설정의 구형 이메일 pending 초대 UI는 제거했으나 legacy DB 데이터/API는 삭제하지 않았다.

## 3. 수정 파일

수정:

- `.env.local.example`
- `app/api/child/[id]/account/route.ts`
- `app/api/families/[id]/children/route.ts`
- `app/api/families/[id]/one-time-invites/[inviteId]/revoke/route.ts`
- `app/api/families/[id]/one-time-invites/route.ts`
- `app/api/signup/profile/route.ts`
- `app/login/page.tsx`
- `app/parent/home/page.tsx`
- `app/parent/settings/page.tsx`
- `app/signup/page.tsx`
- `components/family/FamilyInviteContinue.tsx`
- `components/family/FamilyInviteJoin.tsx`
- `components/family/FamilyInviteManager.tsx`
- `components/parent/ChildStartGuide.tsx`
- `e2e/qa-086-signup-phone-removal.spec.ts`
- `lib/familyInvites/oneTimeInvite.ts`
- `lib/familyInvites/resolveInvite.ts`
- `playwright.config.ts`

신규:

- `e2e/qa-095-parent-onboarding-final.spec.ts`
- `supabase/migrations/20260809103000_one_time_invite_terminal_statuses.sql`

기존 `9d4187a`에 포함된 핵심 선행 migration:

- `supabase/migrations/20260808231500_one_time_family_invite_links.sql`

## 4. Dev 반영 및 검증 결과

### Dev DB

- Dev Supabase ref: `mkrsaaedxqrcrktapaus`
- 아래 두 migration을 Dev에 적용하고 migration history도 확인했다.
  1. `20260808231500_one_time_family_invite_links.sql`
  2. `20260809103000_one_time_invite_terminal_statuses.sql`
- 최종 확인: 두 migration history 존재, RPC 존재, one-time invite의 stale approved/cancelled 0건.
- 중단 시점 Dev 임시 QA 정리 결과: `qa095*` 부모 0, `q95c*` 아이 0, 임시 활성 membership 0, one-time invite 원장 0.

### Dev Preview

- URL: `https://k-bestie-v3-5otoz0sfa-markanitp.vercel.app`
- Deployment: `dpl_ESzR5mmRvgZpGMWHUGYoa8VQhi9Y`
- 상태: READY
- Preview 환경에 전용 `FAMILY_INVITE_SIGNING_SECRET`을 설정했다. 값은 문서에 기록하지 않는다.

### 완료된 게이트

- `tsc --noEmit`: PASS
- 전체 단위 테스트: 415개 중 411 PASS, 0 FAIL, credential 필요 4 SKIP
- `npm run build`: PASS, 219 pages, client secrets check PASS
- `git diff --check`: PASS
- 실제 Dev 모바일 Chromium 390×844 전체 095 E2E: PASS (22.9초)
- Android Chrome/Pixel 5 계열 412×915 전체 095 E2E: PASS (20.9초)

E2E에서 실제 확인한 항목:

- 신규 보호자 1→2→3→4→Handoff→부모 홈
- 4→3→2→1 역방향 후 다시 진행 시 입력 유지
- 전화번호·2/4 중복 법정대리인 체크·3/4 참여 UI·4/4 관심사 UI 없음
- 가족/아이 중복 0, interests 빈 배열 저장
- Handoff QR 안전성, 주소/아이디 복사, 홈·설정 재호출
- 초대 링크 생성, 신규 보호자의 동의·프로필 후 기존 가족 parent 연결
- 초대 참여로 신규 family 0, 신규 child 0, 동일 family/child 공유
- 상태 `consumed`, 동일 링크 다른 사용자 재사용 차단
- 같은 기기 아이 시작 시 부모 로그아웃 후 아이 ID prefill
- 테스트 후 임시 Dev 계정·가족·초대 정리 0건

## 5. 중단 지점과 남은 작업

사용자가 Claude Code 위임을 지시해 아래 상태에서 멈췄다.

1. iPhone WebKit 모바일 전체 E2E를 실행 중 중단했다.
   - 최초 실행은 WebKit이 `clipboard-write` 권한 주입을 지원하지 않아 앱 진입 전 실패했다.
   - 테스트를 수정해 Chromium에서만 클립보드 값을 직접 읽고, WebKit에서는 복사 버튼 동작과 QR 안전값을 검증하도록 분기했다.
   - 수정 후 재실행 중 사용자 지시로 프로세스를 종료했다. **WebKit 최종 결과는 미검증**이다.
   - 물리 iPhone Safari/PWA 검증은 수행하지 않았다.
2. 최신 E2E/Playwright 설정 수정 후 `tsc`, 전체 테스트, build를 한 번 더 실행해야 한다.
3. `git diff` 전체 독립 리뷰가 아직 남아 있다. 특히 `app/parent/home/page.tsx`의 큰 구형 UI 삭제가 활성 홈 기능을 침범하지 않았는지 확인한다.
4. Google/Kakao 공급자 로그인 버튼과 전용 callback 흐름은 구현돼 있으나 실제 공급자 인증을 끝까지 완료하는 E2E는 아직 하지 않았다.
5. 최신 `origin/main`을 fetch하고 충돌 없이 통합한 뒤 095 변경을 커밋·push해야 한다.
6. Production에는 095 코드, DB migration, 환경변수를 아직 적용하지 않았다.
7. Production 완료 후 request `_done`, `_log.md`, `_dashboard.md`, 김비서 Discord 보고가 남아 있다.

## 6. Claude Code 권장 재개 순서

1. 위 worktree와 현재 dirty diff를 그대로 확인한다. 다른 worktree/root의 사용자 변경과 섞지 않는다.
2. `iphone-webkit` 프로젝트로 `e2e/qa-095-parent-onboarding-final.spec.ts`를 재실행한다.
3. 최신 변경 기준 `tsc --noEmit`, 전체 테스트, build, `git diff --check`를 다시 실행한다.
4. 전체 diff를 리뷰하고 BLOCKER/HIGH 0건인지 확인한다.
5. `git fetch` 후 최신 `origin/main` 위로 안전하게 rebase/merge한다. force reset 금지.
6. Production Vercel 프로젝트에 별도 `FAMILY_INVITE_SIGNING_SECRET`이 존재하는지 확인·설정한다. 값을 로그/문서에 남기지 않는다.
7. Production DB에 두 migration을 순서대로 적용하고 history, constraint, RPC를 검증한다.
8. Production을 1회 배포하고 READY/alias를 확인한다.
9. Production smoke는 지정된 기존 QA 가족만 사용한다.
   - 부모: `qa-parent@kbestie.local`
   - 아이: `testa@kbestie.local`(TestA), `testb@kbestie.local`(TestB)
   - 신규 Production Auth/가족/아이 생성 금지.
   - 실제 사용자 및 가입 중 사용자를 수정·삭제하지 않는다.
10. Production에서 로그인 회귀, 부모 홈/설정 Handoff 재호출, 다자녀 선택, 아이 ID prefill, 초대 terminal 화면을 확인한다. 초대 소비 E2E 때문에 Production 임시 계정을 만들지 않는다.
11. 모든 검증이 끝난 경우에만 095를 `_done`으로 이동하고 dashboard/log를 정리한 뒤 김비서 Discord에 `sent`를 확인한다.

## 7. Production 안전 상태

- 095 관련 Production 코드 배포: **0건**
- 095 관련 Production DB migration: **0건**
- 095 관련 Production 계정/가족/아이 변경: **0건**
- Dev 임시 QA 데이터: **정리 완료, 잔여 0건**

## 8. 이후 Request 큐

095 완료 후 `E:\VibeCoding\K-Bestie-v3\requests\_dashboard.md` 기준 다음 큐를 이어서 처리한다.

- 026: 실제 설치형 PWA Push/OS 알림/badge 물리 기기 검증 대기
- 084: 기존 QA 기기의 Push 구독·수신 검증 대기
- 089: Production 현재값과 대표 확정 기대값 불일치로 쓰기 0건, 기준 재확정 필요
- `REQUEST_ONE_TIME_FAMILY_INVITE_LINK.md`: 095에 통합되므로 095 완료 증거와 대조해 중복 완료 처리 여부 판단

