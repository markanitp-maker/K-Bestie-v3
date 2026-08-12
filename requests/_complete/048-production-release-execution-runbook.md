# Production 전체 전환 실행 Runbook

작성일: 2026-07-29  
실행 주체: Claude Code  
목적: 현재 개발 완료분을 오늘 Production에 안전하게 일괄 반영  
우선순위: 긴급 Production 배포  
작업 유형: Migration 적용 → 메인 앱 Production 배포 → 핵심 검증 → 완료 보고

---

## 1. 작업 목적

현재 Development에서 개발·검증이 완료된 변경사항을 Production에 일괄 반영한다.

Claude Code의 남은 토큰은 조사나 배포 계획 수립에 사용하지 않는다. 기존에 Antigravity가 작성한 배포 문서를 기준으로 정해진 절차만 순서대로 실행한다.

정본 문서의 우선순위는 다음과 같다.

1. `reports/production-release-final-preflight-addendum-2026-07-29.md`
2. `reports/production-release-execution-pack-2026-07-29.md`
3. `reports/full-dev-to-production-release-plan-2026-07-29.md`

내용이 충돌하면 `production-release-final-preflight-addendum-2026-07-29.md`를 최우선으로 적용한다.

---

## 2. 확정된 Release 범위

### Release 기준 Commit

```text
edeb4a4
```

현재 Production 배포는 반드시 위 Commit을 기준으로 수행한다.

Release 기준 Commit 이후의 미커밋 변경사항이나 진행 중인 작업은 Production에 포함하지 않는다.

### 포함 대상

현재 `edeb4a4`까지 커밋된 완료 작업을 포함한다.

특히 다음 작업을 포함한다.

- 025 완료 기능
- 031 부모 주간 리포트 목록 개선
- 036 완료·기배포 기능의 최신 통합 코드
- 037 미션 중단·이어하기 및 세션 처리 개선
- 040 PWA 새 버전 업데이트 알림
- 041 부모 홈 인사이트 요약
- 042 미션·놀이 Device Frame 유지·복원
- 043 모바일 PWA 아이 홈 반응형 개선
- 044 부모 플랜 자율 변경 및 Care Premium 환경별 차단
- 045 미션 텍스트 입력 닫기 버튼 Overflow 수정
  - Commit: `584b645`
- 046 놀이 페이지 모바일 Compact Layout 개선
  - Commit: `edeb4a4`
- 위 작업 이후 `edeb4a4`까지 포함된 통합 버그 수정

### 제외 대상

다음 진행 중 작업은 이번 Production 배포에서 제외한다.

- 047 자유대화 UI 미션 화면 통일
- `app/chat/page.tsx`의 047 관련 미커밋 변경
- `047-free-chat-ui-parity-with-mission.md`
- Release 기준 Commit 이후 생성된 미완료 Request
- Debug 코드
- 임시 E2E 파일
- QA 계정 정보
- Production 환경변수 Pull 파일
- Trace·Screenshot·Video 등 테스트 산출물

047 관련 변경을 삭제하거나 유실하지 않는다. 현재 작업트리에 보존하되, 이번 Production 배포 대상에서만 분리한다.

---

## 3. 확정된 Production 정본

### 메인 앱

```text
Development Vercel: k-bestie-v3-dev
Production Vercel: k-bestie-v3
Production URL: https://app.k-bestie.com
Repository: /mnt/e/VibeCoding/K-Bestie-v3
Dev Supabase Ref: mkrsaaedxqrcrktapaus
Production Supabase Ref: fetvnhhjicndmxvhrffk
```

### MBTI

```text
Development Vercel: k-bestie-mbti-dev
Production Vercel: k-bestie-mbti
```

### 퀴즈마스터

```text
Development Vercel: k-bestie-quiz-dev
Production Vercel: k-bestie-quiz
```

삭제된 `k-bestie-quiz-prod`는 다시 생성하거나 참조하지 않는다.

---

## 4. 이번 배포 대상 시스템

### 배포 대상

```text
k-bestie-v3 메인 앱
Production Supabase Migration 2개
```

### 재배포하지 않는 대상

```text
k-bestie-mbti
k-bestie-quiz
Supabase Edge Function
Cron
Cloud Run Live Relay
```

MBTI와 퀴즈마스터 독립 앱에는 이번 Release에 포함되는 코드 변경이 없으므로 재배포하지 않는다.

Edge Function과 Cron에도 마지막 Production 배포 이후 변경사항이 없으므로 재배포하거나 수정하지 않는다.

---

## 5. Production Migration

다음 두 Migration만 Production에 적용한다.

### Migration 75

```text
supabase/migrations/20260775000000_plan_change_requests.sql
```

목적:

- 부모 플랜 변경 이력 저장
- Care Start와 Care Insight 간 자율 변경 기록
- 변경 결과를 `approved` 상태의 감사 로그로 저장
- 관리자 추가 승인을 요구하는 흐름이 아님

현재 확정된 플랜 정책과 충돌하지 않는다.

### Migration 76

```text
supabase/migrations/20260776000000_parent_questions_kchat.sql
```

목적:

- 부모 K-Chat 기능에 필요한 데이터 구조 추가
- `parent_id`
- `original_question_text`
- 관련 K-Chat 런타임 코드 지원

### Migration 정책

- 두 Migration은 기존 데이터를 삭제하거나 덮어쓰지 않는 추가형 Migration이다.
- Dev 사용자·자녀·대화·QA Row 데이터를 Production으로 복사하지 않는다.
- Production 운영 사용자 Row를 수정하지 않는다.
- 다음 명령은 사용하지 않는다.

```text
supabase db reset
무조건적인 supabase db push
근거 없는 supabase migration repair
```

Production에는 위 두 Migration만 순서대로 적용한다.

---

## 6. 부모 플랜 정책

이번 배포 후 다음 정책이 Production에서 동작해야 한다.

### 기본 플랜

- 신규 승인 사용자의 기본 플랜은 `Care Insight`
- 기존 사용자의 현재 플랜은 강제로 변경하지 않음

### 부모 자율 변경

승인된 부모는 관리자 추가 승인 없이 직접 변경할 수 있다.

```text
Care Start → Care Insight
Care Insight → Care Start
```

변경 결과는 DB에 즉시 저장되고 새로고침과 재로그인 후에도 유지되어야 한다.

### Care Premium

Production:

- `준비 중` 상태로 표시
- 선택 버튼 비활성화
- 직접 API 요청도 서버에서 차단
- 관리자 화면에서도 Production 사용자를 Premium으로 변경할 수 없음

Development·Preview:

- Care Premium 선택 가능
- Dev Supabase에만 저장
- Production DB에 영향 없음

### 감사 로그

`plan_change_requests`는 관리자 승인 대기용이 아니라 플랜 변경 결과를 기록하는 Audit Trail로 사용한다.

---

## 7. 배포 전 절대 원칙

1. 추가적인 전체 코드 분석을 하지 않는다.
2. 배포 범위를 다시 설계하지 않는다.
3. 오래된 Commit을 선택적으로 Cherry-pick하지 않는다.
4. 최종 Release 기준은 `edeb4a4`다.
5. 미커밋 047 변경을 Production에 포함하지 않는다.
6. Dirty Working Tree에서 `vercel --prod`를 실행하지 않는다.
7. Production Secret을 출력하거나 Commit하지 않는다.
8. `.env.local`을 삭제·이동·Commit하지 않는다.
9. Production 환경변수를 새로 설정하지 않는다.
10. MBTI·퀴즈·Edge Function·Cron을 재배포하지 않는다.
11. 실제 오류가 발생했을 때만 STOP한다.
12. 경고나 과거 보고서 누락만으로 배포를 중단하지 않는다.

---

## 8. 진행 중 작업 분리

현재 작업트리에서 047 관련 변경을 확인한다.

예상 대상:

```text
app/chat/page.tsx
requests/047-free-chat-ui-parity-with-mission.md
```

047 변경만 선택적으로 보존한다.

전체 작업트리를 무조건 Stash하지 않는다. 이미 완료된 다른 변경을 빠뜨리지 않는다.

예시 절차:

```bash
cd /mnt/e/VibeCoding/K-Bestie-v3

git status --short

git stash push -u \
  -m "exclude-047-from-production-release-20260729" \
  -- app/chat/page.tsx requests/047-free-chat-ui-parity-with-mission.md
```

실제 경로가 다르면 `production-release-final-preflight-addendum-2026-07-29.md`에 확정된 경로를 사용한다.

Stash 후 다음을 확인한다.

```bash
git status --short
git rev-parse HEAD
```

PASS 기준:

```text
HEAD = edeb4a4
Production에 포함할 미커밋 코드 없음
047 변경은 Stash에 안전하게 보존됨
```

---

## 9. 민감 파일 및 임시 파일 격리

`.env.local`은 이동하거나 삭제하지 않는다.

다음 생성 파일만 저장소 밖으로 격리한다.

- `env_prod*`
- `env_prod_real*`
- Vercel 환경변수 Pull 파일
- `qa_session_info.json`
- QA 비밀번호 파일
- 임시 QA 스크립트
- `e2e/debug_*`
- `clear_testmode_*`
- Playwright Trace
- Screenshot
- Video
- 임시 `.mjs`
- Production 인증정보가 포함된 Scratch 파일

저장 위치:

```text
/tmp/kbestie-release-private-20260729
```

실행 예시:

```bash
mkdir -p /tmp/kbestie-release-private-20260729
```

파일은 존재하는 것만 이동한다. 존재하지 않는 파일 때문에 작업을 중단하지 않는다.

격리 후 확인한다.

```bash
git status --short
git ls-files | grep -Ei 'env_prod|qa_session|password|debug_|clear_testmode|trace|video' || true
```

Production Secret이나 QA 비밀번호가 Git 추적 파일에 포함된 것이 확인될 때만 STOP한다.

---

## 10. Clean Release Worktree 생성

Production Build와 Vercel 배포는 현재 작업 디렉터리에서 직접 실행하지 않는다.

Release 기준 Commit으로 저장소 밖에 깨끗한 Worktree를 생성한다.

권장 경로:

```text
/tmp/kbestie-release-worktree-20260729
```

실행:

```bash
cd /mnt/e/VibeCoding/K-Bestie-v3

rm -rf /tmp/kbestie-release-worktree-20260729

git worktree add \
  --detach \
  /tmp/kbestie-release-worktree-20260729 \
  edeb4a4

cd /tmp/kbestie-release-worktree-20260729

git status --short
git rev-parse HEAD
```

PASS 기준:

```text
git status 출력 없음
HEAD = edeb4a4
```

`git archive`보다 `git worktree`를 우선 사용한다.

---

## 11. 환경변수 사용 정책

`.env.local`은 원본 저장소에 그대로 둔다.

Clean Worktree의 로컬 테스트나 Build가 환경변수를 필요로 할 경우:

- Secret을 Commit하지 않는다.
- 저장소 밖에서 환경변수를 주입한다.
- 필요할 경우 원본 `.env.local`을 임시 심볼릭 링크로만 사용한다.
- Vercel Production 배포는 Vercel에 등록된 Production 환경변수를 사용한다.

예시:

```bash
ln -s /mnt/e/VibeCoding/K-Bestie-v3/.env.local \
  /tmp/kbestie-release-worktree-20260729/.env.local
```

이 링크는 Git에 포함하지 않는다.

Vercel Production 환경변수는 이번 배포에서 변경하지 않는다.

---

## 12. 배포 전 필수 테스트

Clean Worktree에서 실행한다.

```bash
cd /tmp/kbestie-release-worktree-20260729
```

### 12.1 의존성 설치

```bash
npm ci
```

PASS 기준:

```text
Exit Code 0
```

### 12.2 TypeScript

`package.json`에 정의된 실제 명령을 사용한다.

예시:

```bash
npx tsc --noEmit
```

PASS 기준:

```text
TypeScript Error 0건
Exit Code 0
```

### 12.3 Lint

`package.json`에 정의된 실제 Lint 명령이 있을 때만 실행한다.

```bash
npm run lint
```

Lint Script가 존재하지 않으면 임의 명령을 만들지 않는다.

### 12.4 Unit Test

```bash
npm test
```

또는 `package.json`에 정의된 실제 테스트 명령을 사용한다.

### 12.5 핵심 회귀 테스트

이번 Release와 직접 관련된 기존 테스트만 실행한다.

필수 대상:

- 025 기능
- 037 미션 중단·이어하기
- 완료 세션 처리
- Legacy Session Race
- childId Race
- 시작 전 마이크 Gate
- 042 Device Frame 유지·복원
- 043 모바일 PWA 아이 홈
- 044 부모 플랜 변경
- Production Premium 차단
- 045 텍스트 입력 닫기 버튼 Overflow
- 046 놀이 페이지 모바일 Compact Layout

임시 Debug 테스트 파일을 새로 Commit하지 않는다.

### 12.6 Production Build

```bash
npm run build
```

PASS 기준:

- Exit Code 0
- Build Error 0건
- Production Build 완료
- Dev Server 또는 HMR 결과가 아닌 실제 Build 결과

### STOP 조건

다음 중 하나면 Production 배포를 중단한다.

- TypeScript Error
- 필수 테스트 실패
- Production Build 실패
- Production Secret 누락으로 Build 불가
- Dev Supabase가 Production 대상으로 설정됨
- Release Worktree가 Dirty 상태
- Release HEAD가 `edeb4a4`가 아님
- 047 코드가 Release Worktree에 포함됨

---

## 13. Production 기준점 기록

배포 전에 현재 Production 상태를 기록한다.

대상 프로젝트:

```text
k-bestie-v3
```

기록 항목:

- 현재 Production Deployment ID
- 현재 Deployment URL
- Ready 상태
- 생성 시각
- 현재 Domain 연결
- 이전 정상 Rollback Deployment ID
- 현재 Production 환경변수 이름 목록
- 현재 Release 이전 Commit 또는 배포 기준

실제 최신 값은 Vercel에서 조회한다. 과거 문서의 ID를 무조건 재사용하지 않는다.

환경변수 실제 값은 출력하지 않는다.

---

## 14. Production DB 백업 기준점

Migration 75와 76은 추가형이므로 전체 DB Dump 실패만으로 배포를 중단하지 않는다.

가능하면 다음을 저장소 밖에 확보한다.

- Production Migration History
- 영향받는 테이블의 기존 Schema
- 관련 데이터 Row 수
- 현재 RLS·Policy 정보
- Migration 적용 전 확인 결과

백업 파일은 다음 경로에 저장한다.

```text
/tmp/kbestie-release-private-20260729
```

Production 운영 데이터를 저장소 안에 저장하거나 Commit하지 않는다.

---

## 15. Production Migration 적용

Production Supabase Ref:

```text
fetvnhhjicndmxvhrffk
```

적용 순서:

```text
1. 20260775000000_plan_change_requests.sql
2. 20260776000000_parent_questions_kchat.sql
```

Dev Supabase Ref `mkrsaaedxqrcrktapaus`에 잘못 적용하지 않는다.

Migration 적용 전 다시 확인한다.

```bash
npx supabase migration list --linked
```

Production 프로젝트 링크가 정확한지 확인한다.

필요하면 Production Ref에 명시적으로 Link한다.

Migration 적용 후 다음을 검증한다.

### Migration 75

- `plan_change_requests` 객체 존재
- 필요한 컬럼 존재
- RLS·Policy 존재
- 부모 플랜 변경 API가 Audit Row 삽입 가능
- 기존 사용자 플랜이 일괄 변경되지 않음

### Migration 76

- K-Chat 관련 객체 존재
- `parent_id` 존재
- `original_question_text` 존재
- 관련 API가 참조하는 컬럼과 일치

Migration 적용 실패 시 앱 배포를 진행하지 않는다.

---

## 16. Edge Function 및 Cron

이번 Release에서는 다음을 수행하지 않는다.

```text
Supabase Edge Function 재배포
Cron 생성
Cron 수정
Cron 삭제
daily-batch 재배포
weekly-batch 재배포
memory-batch 재배포
```

마지막 Production 배포 이후 관련 소스 변경이 없으므로 기존 운영 상태를 유지한다.

`daily_reports` Row가 없다는 이유만으로 배포를 중단하거나 Cron을 수정하지 않는다.

---

## 17. MBTI·퀴즈마스터

이번 Release에서는 다음을 수행하지 않는다.

```text
k-bestie-mbti 재배포
k-bestie-quiz 재배포
MBTI 환경변수 변경
Quiz 환경변수 변경
MBTI Domain 변경
Quiz Domain 변경
```

메인 앱과 기존 놀이 앱 사이 Proxy 계약이 유지되는지만 Build 및 Smoke Test에서 확인한다.

MBTI와 퀴즈 Vercel 루트 `/`의 404는 Proxy 전용 설계상 정상일 수 있으므로 장애 판정 근거로 사용하지 않는다.

---

## 18. 메인 앱 Production 배포

대상:

```text
Vercel Project: k-bestie-v3
Domain: https://app.k-bestie.com
Release SHA: edeb4a4
```

Clean Worktree가 `k-bestie-v3` Production 프로젝트에 정확히 연결됐는지 확인한다.

잘못 연결된 `.vercel/project.json`을 신뢰하지 않는다.

필요하면 Clean Worktree에서 명시적으로 Link한다.

```bash
cd /tmp/kbestie-release-worktree-20260729
npx vercel link --project k-bestie-v3 --yes
```

연결된 Project ID를 확인한 뒤 Production 배포한다.

```bash
npx vercel --prod
```

배포 완료 후 기록:

- 신규 Deployment ID
- 신규 Deployment URL
- Ready 상태
- 배포 시각
- Alias 상태
- `app.k-bestie.com` 연결 여부

Deployment URL이 Ready여도 `app.k-bestie.com`이 신규 배포를 가리키지 않으면 완료 처리하지 않는다.

---

## 19. 배포 직후 자동 Smoke Test

다음 항목을 우선 확인한다.

### 기본 접속

- `https://app.k-bestie.com` 200 응답
- 로그인 화면 또는 정상 홈 표시
- 정적 자산 404 없음
- JavaScript Chunk Load Error 없음
- 서버 오류 없음

### 계정·승인

- 기존 승인 사용자 로그인 가능
- 부모 홈 진입 가능
- 아이 홈 진입 가능

### 플랜

- 현재 플랜 조회 API 정상
- Care Start ↔ Care Insight 변경 API 정상
- Production Premium 직접 요청 차단
- 기존 사용자의 플랜이 강제로 변경되지 않음

### 미션

- 미션 목록 로드
- 새 미션 시작 가능
- 중단 세션 이어하기 표시
- 완료 세션이 이어하기로 잘못 표시되지 않음
- 시작 전 마이크 비활성화
- 아이 ID 누락으로 진입 실패하지 않음

### 놀이

- 메인 앱에서 MBTI Proxy 진입 가능
- 메인 앱에서 Quiz Proxy 진입 가능
- 외부 실제 Vercel URL이 주소창에 노출되지 않음

---

## 20. 대표님 수동 Production QA

대표님 QA는 15~30분 안에 완료할 수 있는 최소 시나리오로 제한한다.

### QA 1. 부모 플랜

1. 신규 승인 사용자 확인
2. 기본 플랜이 Care Insight인지 확인
3. Care Insight에서 Care Start로 변경
4. 새로고침 후 유지 확인
5. Care Start에서 Care Insight로 변경
6. 새로고침 후 유지 확인
7. Care Premium이 `준비 중`인지 확인
8. Premium 선택 버튼이 비활성화됐는지 확인

PASS 기준:

- 신규 기본 Care Insight
- Start ↔ Insight 즉시 변경
- 관리자 추가 승인 없음
- Premium 선택 불가
- 기존 사용자 플랜 강제 변경 없음

### QA 2. 아이 홈·PWA

1. 모바일 아이 홈 접속
2. 설치형 PWA 접속
3. 레이아웃 깨짐 여부 확인
4. 새 버전 알림 확인
5. 업데이트 후 최신 화면 확인

PASS 기준:

- 모바일 Overflow 없음
- 기존 설치형 PWA가 새 버전으로 전환됨
- Chunk Load Error 없음
- 강제 Cache 삭제 없이 최신 버전 사용 가능

### QA 3. 미션

1. 새 미션 시작
2. 질문 응답
3. 진행률 증가 확인
4. 중간 종료
5. 이어하기 확인
6. 완료 세션 처리 확인
7. 시작 전 마이크 비활성화 확인
8. Device Frame 유지 확인
9. 텍스트 입력 닫기 버튼 Overflow 확인

PASS 기준:

- 진행률 정상
- 중단 위치 복원
- 추가 세션 중복 생성 없음
- 완료 세션 오처리 없음
- childId Race 없음
- 모바일 레이아웃 깨짐 없음

### QA 4. 부모 화면

- 부모 홈 인사이트 요약
- 주간 리포트 목록
- 아이 정보 관리
- 플랜 관리

PASS 기준:

- 화면 진입 정상
- 잘못된 아이 데이터 혼입 없음
- 레이아웃 깨짐 없음

### QA 5. 놀이

- MBTI 진입
- Quiz 진입
- 황금열쇠 1회 차감
- 외부 URL 비노출
- 닫기 후 메인 앱 복귀

이번 메인 앱 변경으로 MBTI·Quiz 내부 엔진이 변경되지 않았으므로 전체 20문항·10문항 완주는 필수 배포 게이트에서 제외한다. 진입·Proxy·차감·복귀 핵심 경로만 확인한다.

---

## 21. 롤백

### Vercel 롤백 조건

다음 중 하나면 즉시 메인 앱을 이전 정상 Deployment로 롤백한다.

- 로그인 불가
- 아이 홈 진입 불가
- 부모 홈 진입 불가
- 미션 전체 진입 불가
- 반복적인 500 오류
- Production Supabase 연결 오류
- JavaScript Chunk 전체 로드 실패
- 플랜 변경으로 기존 사용자 데이터 훼손
- MBTI·Quiz Proxy 전체 실패

### 롤백 방식

배포 직전 기록한 실제 이전 정상 Deployment ID를 사용한다.

현재 CLI에서 지원하는 `rollback` 또는 `promote` 명령을 사용한다.

명령 구문은 설치된 Vercel CLI 도움말로 확인하되, 프로젝트 전체를 다시 분석하지 않는다.

Migration 75·76은 추가형이므로 메인 앱만 이전 버전으로 롤백해도 기존 앱과 호환되는 것을 전제로 한다.

Migration을 자동으로 되돌리지 않는다.

Production DB Rollback이 필요하면:

1. 실패 Migration 식별
2. 영향 객체 확인
3. 사용자 데이터 영향 확인
4. 별도 Rollback SQL 작성
5. 대표님 승인 후 실행

Dev Supabase 또는 Dev URL을 Production에 넣어 장애를 우회하지 않는다.

---

## 22. 배포 후 047 복원

Production 배포와 기본 검증이 완료된 뒤 기존 작업 디렉터리에서 047 Stash를 복원한다.

```bash
cd /mnt/e/VibeCoding/K-Bestie-v3
git stash list
```

이번 배포를 위해 생성한 047 Stash를 확인한 뒤 복원한다.

```bash
git stash pop
```

충돌이 발생하면 자동으로 임의 해결하지 말고 047 작업 파일만 확인한다.

Release Worktree는 배포 기록을 모두 남긴 뒤 제거한다.

```bash
git worktree remove /tmp/kbestie-release-worktree-20260729
```

---

## 23. 최종 완료 조건

다음 조건을 모두 충족해야 이번 Production 배포를 완료 처리한다.

- Release 기준 SHA가 `edeb4a4`
- 047 미완료 변경이 Production에 포함되지 않음
- Clean Worktree에서 테스트 수행
- TypeScript 통과
- 필수 테스트 통과
- Production Build 통과
- Migration 75 적용
- Migration 76 적용
- Migration 검증 통과
- Edge Function 재배포 없음
- Cron 변경 없음
- MBTI 재배포 없음
- Quiz 재배포 없음
- `k-bestie-v3` Production 배포 성공
- `app.k-bestie.com`이 신규 Deployment를 가리킴
- 로그인·부모 홈·아이 홈·미션 기본 Smoke Test 통과
- Care Start ↔ Care Insight 변경 정상
- Production Care Premium 차단 정상
- MBTI·Quiz Proxy 진입 정상
- 대표님 최소 수동 QA 완료
- 신규 Deployment ID와 Rollback ID 기록
- 047 작업 안전하게 복원

---

## 24. STOP 조건

다음 중 하나라도 발생하면 즉시 중단하고 대표님께 보고한다.

- Release HEAD가 `edeb4a4`가 아님
- 047 미완료 코드가 Release에 포함됨
- Clean Worktree가 Dirty 상태
- Production Build 실패
- 필수 테스트 실패
- Production이 Dev Supabase를 참조
- Production Secret 누락
- Production Secret이 Git에 포함됨
- Migration 충돌
- Migration 적용 실패
- 기존 운영 데이터 삭제 가능성 발견
- Vercel 프로젝트 연결 오류
- `k-bestie-v3`가 아닌 프로젝트에 배포될 위험
- Rollback Deployment ID 확보 실패
- 다른 Agent가 Release 기준 파일을 수정 중
- 로그인·아이 홈·부모 홈·미션 핵심 경로 전체 장애

단순 Warning, Docker 부재, MBTI·Quiz 루트 404, 사용하지 않는 커스텀 도메인, 과거 QA 로그 부재는 STOP 조건이 아니다.

---

## 25. Claude Code 토큰 절약 원칙

Claude Code는 다음 작업을 다시 하지 않는다.

- 배포 범위 재분석
- Request 완료 여부 재조사
- Migration 후보 재탐색
- Edge Function 변경 여부 재조사
- Vercel 프로젝트 구조 재설계
- QA 시나리오 재작성
- 기존 Ralph Production 감사 반복
- 선택적 리팩터링
- 배포와 관계없는 코드 개선
- 문서 추가 작성

Claude Code의 역할은 다음으로 제한한다.

```text
047 변경 분리
→ Clean Worktree 생성
→ 테스트
→ Production Build
→ Migration 75·76 적용
→ k-bestie-v3 배포
→ 자동 Smoke Test
→ 대표님 QA 지원
→ 결과 보고
```

---

## 26. 완료 보고 형식

배포 완료 후 다음 형식으로 한 번에 보고한다.

```text
Production 배포 결과: PASS / FAIL

Release SHA:
Release Tag:
포함 Request:
제외 Request:

적용 Migration:
- 20260775000000_plan_change_requests.sql
- 20260776000000_parent_questions_kchat.sql

Edge Function 배포:
Cron 변경:
MBTI 배포:
Quiz 배포:

이전 Production Deployment ID:
신규 Production Deployment ID:
신규 Production URL:
app.k-bestie.com Alias 상태:
Rollback Deployment ID:

자동 테스트:
- TypeScript:
- Unit Test:
- 핵심 회귀 테스트:
- Production Build:
- Production Smoke Test:

대표님 수동 QA:
- 부모 플랜:
- 아이 홈·PWA:
- 미션:
- 부모 화면:
- MBTI·Quiz Proxy:

발견된 문제:
롤백 여부:
047 작업 복원 여부:
최종 판정:
```

---

## 27. Claude Code 실행 지시

이 Request와 아래 두 보고서를 기준으로 즉시 Production 배포를 실행한다.

```text
reports/production-release-execution-pack-2026-07-29.md
reports/production-release-final-preflight-addendum-2026-07-29.md
```

Addendum이 기존 Execution Pack보다 우선한다.

추가 분석 없이 이 문서의 순서대로 진행하고, 실제 STOP 조건이 발생한 경우에만 중단한다.

정상 단계에서는 중간 승인을 반복 요청하지 말고 마지막까지 연속해서 실행한다.

Production 환경이나 사용자 데이터에 영향을 주는 예상 밖의 변경이 필요한 경우에만 즉시 중단하고 대표님께 보고한다.
