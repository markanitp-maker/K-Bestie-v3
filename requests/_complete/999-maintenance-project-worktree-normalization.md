999-maintenance-project-worktree-normalization.md

# REQUEST #999 — K-Bestie-v3 프로젝트 폴더·Worktree 최종 정상화

- 상태: TODO
- 유형: 개발환경 정상화 / Worktree 정리
- 우선순위: 조건부 실행 가능 (아래 실행 게이트 충족 시)
- 대상: `E:\VibeCoding\K-Bestie-v3`
- PRIMARY: `E:\VibeCoding\K-Bestie-v3`
- 핵심 방향: 진행 중이던 작업이 PRIMARY 반영·Production 배포까지 끝난 뒤, 안전이 검증된 파생 Worktree와 생성 데이터만 제거
- 절대 원칙: PRIMARY(`origin/main`)에 아직 반영되지 않은 작업을 담고 있는 Worktree가 1개라도 있으면 실행 금지
- 개정: 2026-08-16 — 실행 조건을 "다른 활성 Request 0"에서 "미반영 작업 0"으로 대체(대표 지시). 삭제 안전조건은 축소하지 않는다.


---

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

모든 개발 Request가 끝난 뒤 프로젝트 폴더가 다음 상태로 정상화된다.

```text
E:\VibeCoding\K-Bestie-v3
→ 유일한 PRIMARY 개발 Repository

종료된 병렬 Worktree
→ 제거

Worktree별 중복 node_modules / .next / build cache
→ 제거

stale Git worktree metadata
→ 정리

source / requests / migrations / Git history / PRIMARY 개발환경
→ 그대로 보존
```

정상 완료 후:

- 종료된 불필요 Worktree가 남아 있지 않는다.
- 중복 dependency/build 데이터가 제거된다.
- PRIMARY source는 그대로 유지된다.
- 모든 Request 기록과 migration이 유지된다.
- Git history가 유지된다.
- PRIMARY `node_modules`와 정상 개발환경도 유지된다.
- Secret 값은 어떤 보고에도 노출되지 않는다.

### 대표님 테스트 정상 프로세스

이 작업은 일반 UI 기능이 아니므로 대표님은 최종 보고와 프로젝트 상태를 기준으로 확인한다.

1. 작업 시작 보고에서 `미반영 작업을 담은 Worktree 수 = 0`이고 `진행 중이던 작업의 Production 반영 완료`인지 확인한다.
2. 정상화 전 전체 용량과 Worktree 개수를 확인한다.
3. 정리 완료 후 제거된 Worktree 목록과 회수 용량을 확인한다.
4. 최종 Worktree 수를 확인한다.
5. PRIMARY Repository가 `E:\VibeCoding\K-Bestie-v3`인지 확인한다.
6. `requests`와 `supabase/migrations`가 그대로 존재하는지 확인한다.
7. 현재 application source와 Git history가 유지됐는지 확인한다.
8. PRIMARY `node_modules`가 유지됐는지 확인한다.
9. 정상화 전/후 디스크 사용량 차이를 확인한다.
10. 최종 판정이 `PROJECT FOLDER NORMALIZATION COMPLETE`인지 확인한다.

정상이라면:

- 미반영 작업을 담은 Worktree 0
- 불필요 Worktree 0
- UNKNOWN Worktree 0
- Source Loss 0
- Migration Loss 0
- Request Loss 0
- Git History Loss 0
- Secret 노출 0
- PRIMARY 개발환경 정상

---

## 1. 목표

진행 중이던 작업이 PRIMARY(`origin/main`)에 반영되고 Production 배포까지 끝난 후, `E:\VibeCoding\K-Bestie-v3`의 실제 최신 상태를 다시 감사하고 안전이 증명된 병렬 개발 잔재만 제거한다.

활성 Request가 남아 있어도 실행할 수 있다. 다만 그 Request의 작업 결과가 아직 어느 Worktree에만 존재하고 PRIMARY에 반영되지 않았다면, 그 Worktree는 제거 대상이 아니라 `ACTIVE_OR_REQUIRED`로 보존한다.

정리 대상 후보:

- 종료된 Git Worktree
- Worktree 내부 중복 `node_modules`
- Worktree 내부 `.next` 및 build/cache 데이터
- stale Git worktree metadata
- orphan worktree directory
- 종료된 `.claude/worktrees/`
- 불필요한 candidate/release/temp/scratch/audit 잔재
- 삭제되는 Worktree 내부 Secret 복제 Surface

보존 대상:

- PRIMARY source
- Request 전체
- Supabase migrations
- Git history
- PRIMARY 개발환경
- PRIMARY Secret/configuration

이전 감사 결과는 참고자료로만 사용하며 **실제 삭제 대상은 실행 시점의 재감사 결과로만 결정**한다.

---

## 2. 요구사항

### 절대 실행 게이트

활성 Request가 남아 있어도 실행할 수 있다. 대신 **작업 결과가 유실될 수 있는 상태인지**를 게이트로 삼는다.

작업 시작 시 가장 먼저 다음 두 가지를 확인한다.

**(1) 진행 중이던 작업의 Production 반영 확인**

직전까지 진행하던 작업이 PRIMARY(`origin/main`)에 commit·push되고 Production 배포까지 끝났는지 확인한다.
Production 배포가 진행 중이거나 실패 상태면 실행하지 않는다.

**(2) 미반영 작업 0 확인**

`git worktree list --porcelain` 의 모든 Worktree에 대해 다음을 확인한다.

- PRIMARY에 없는 commit이 있는가
- PRIMARY에 없는 source/migration이 있는가
- 필요한 stash가 있는가
- generated/cache가 아닌 사람이 만든 untracked 파일이 있는가

조건:

```text
UNMERGED WORK WORKTREE COUNT == 0
PRODUCTION DEPLOY OF IN-FLIGHT WORK == DONE
```

이 아니면:

```text
BLOCKED — UNMERGED WORK EXISTS
```

로 종료한다.

이 상태에서는:

- 파일 삭제 금지
- Worktree 제거 금지
- prune 금지
- metadata 변경 금지

활성 Request가 남아 있다는 사실 자체는 차단 사유가 아니다. 다만 그 Request의 작업 결과가 어느 Worktree에만 존재하고 PRIMARY에 반영되지 않았다면, 해당 Worktree는 제거 대상이 아니라 `ACTIVE_OR_REQUIRED`로 보존한다.

판단이 서지 않는 Worktree는 `UNKNOWN`이며, `UNKNOWN`이 1개라도 있으면 전체 정상화를 중단한다(§5).

### 실행 전 Read-only 감사

게이트 통과 후에도 바로 삭제하지 않는다.

PRIMARY에서 최소 다음을 확인한다.

- branch / HEAD / remote
- `git status`
- staged / unstaged / untracked
- stash
- 전체 Git Worktree
- Worktree별 branch / HEAD / Dirty 여부
- local-only / unique commit
- PRIMARY에 없는 source
- PRIMARY에 없는 migration
- unique Request 산출물
- human-created untracked 파일
- `requests/_dashboard.md`
- `supabase/migrations`
- application source
- `package.json`
- lockfile
- `.git` history

Worktree 목록은 실행 시점의 실제:

`git worktree list --porcelain`

을 Source of Truth로 사용한다.

### Worktree 분류

PRIMARY 외 모든 Worktree를 다음 셋 중 하나로 분류한다.

```text
SAFE_TO_REMOVE
ACTIVE_OR_REQUIRED
UNKNOWN
```

`SAFE_TO_REMOVE`는 최소 다음이 모두 증명된 경우에만 가능하다.

- PRIMARY에 반영되지 않은 작업과 연결되지 않음 (활성 Request라도 결과가 PRIMARY에 이미 반영됐으면 무방)
- 필요한 source가 PRIMARY에 반영됨
- unique commit 없음
- unique migration 없음
- unique Request 결과 없음
- unique human-created 파일 없음
- 필요한 stash 없음
- Dirty가 없거나 generated-only임이 확인됨

하나라도 필요한 데이터가 남으면 `ACTIVE_OR_REQUIRED`.

판단할 수 없는 항목이 하나라도 있으면 `UNKNOWN`.

### 정상화 실행 게이트

실제 삭제는 다음이 전부 PASS일 때만 허용한다.

```text
진행 중이던 작업의 Production 반영 = 완료
미반영 작업을 담은 Worktree = 0
PRIMARY 확정
unique source = 0
unique migration = 0
unique commit = 0
필요한 stash = 0
unique human-created file = 0
UNKNOWN worktree = 0
requests/migrations/Git history 보존 확인
```

모두 PASS하면:

`NORMALIZATION EXECUTION READY`

상태에서만 정리를 시작한다.

### Worktree 제거

Git에 등록된 Worktree는 filesystem에서 먼저 직접 삭제하지 않는다.

PRIMARY Repository에서 정상 Git Worktree 제거 절차를 사용한다.

Force 제거는 다음이 모두 증명된 경우에만 허용한다.

- Dirty 내용이 generated-only
- unique source 0
- unique migration 0
- unique commit 0
- 필요한 stash 0

### Stale Metadata / Orphan Directory

정상 Worktree 제거 후에만 stale metadata를 확인한다.

실제 filesystem에 존재하지 않고 더 이상 유효하지 않은 Worktree metadata만 prune한다.

다음 경로의 잔재도 개별 검증한다.

- `worktrees/`
- `.claude/worktrees/`

`.claude` 자체는 삭제하지 않는다.

Git 등록이 이미 해제된 orphan directory는:

- unique source 없음
- unique secret 원본 없음
- human-created file 없음
- generated/cache 잔재임이 확인됨

인 경우에만 삭제한다.

### Dependency / Build Data

종료된 Worktree가 제거되면서 그 내부의:

- `node_modules`
- `.next`
- `.cache`
- coverage
- test-results
- playwright-report
- build
- dist

등도 함께 제거한다.

개별 cache를 먼저 삭제하기보다 Worktree 정상 제거를 우선한다.

PRIMARY의:

- `node_modules`
- `.next`

는 유지한다.

### Candidate / Release / Temp

다음과 같은 폴더가 존재하면 이름만 보고 삭제하지 않는다.

- candidate-release
- release
- prod-release
- dev-release
- temp / tmp
- scratch_*
- audit_*
- 기타 임시/진단/배포 잔재

다음이 모두 확인된 경우에만 제거한다.

- tracked source 아님
- PRIMARY에 없는 source 없음
- migration 없음
- Request 원본 없음
- Secret 원본 없음
- 현재 코드에서 참조하지 않음
- human-created unique data 없음
- generated/cache/diagnostic 잔재임이 확인됨

### Secret

Secret의 **경로와 존재 여부만** 확인한다.

절대 출력하지 않는다.

- `.env` 값
- `.env.local` 값
- API/service-role key
- JWT
- access/refresh token
- password
- private key
- certificate 내용

Worktree 제거에 따라 사라지는 Secret 복제본은 함께 정리할 수 있다.

PRIMARY Secret은 삭제하지 않는다.

### 정상화 후 재검증

정리 후 다시 확인한다.

- 전체 logical size
- 파일 수
- 디렉터리 수
- 남은 Worktree 수
- `git worktree list --porcelain`
- Git status / branch / HEAD / remote
- Requests 존재
- migrations 존재
- application source 존재
- PRIMARY `node_modules` 존재

최종 보장:

```text
PRIMARY 외 불필요 Worktree = 0
UNKNOWN Worktree = 0
Source Loss = 0
Migration Loss = 0
Request Loss = 0
Git History Loss = 0
```

---

## 3. 기존 구조 확인

실행 시점의 실제 상태만 사용한다.

확인 대상:

- `E:\VibeCoding\K-Bestie-v3`
- `requests/`
- `requests/_done/`
- `requests/_dashboard.md`
- 전체 Git Worktree registry
- `worktrees/`
- `.claude/worktrees/`
- 현재 source tree
- `supabase/migrations`
- package/lockfile
- Git history
- stash
- candidate/release/temp 계열 directory
- PRIMARY dependency/build 환경

2026-08-12 감사에서 확인된:

- 약 40.96GB
- 약 31개 Worktree
- 약 39.5GB 중복/생성 데이터

등의 수치는 **참고자료일 뿐 현재 삭제 목록으로 사용하지 않는다.**

실행 시점의 실제 filesystem/Git 상태를 다시 감사한다.

---

## 4. 금지

### 실행 금지

- 진행 중이던 작업이 Production까지 반영되지 않은 상태에서 실행
- PRIMARY에 반영되지 않은 작업을 담은 Worktree가 하나라도 있는 상태에서 실행
- 어떤 Worktree의 미반영 작업 보유 여부가 불확실한 상태에서 실행
- UNKNOWN Worktree가 존재하는 상태에서 일부라도 선제 삭제

### 데이터 삭제 금지

- unique source가 있는 Worktree 삭제
- unique migration이 있는 Worktree 삭제
- unique commit이 있는 Worktree 삭제
- 필요한 stash가 있는 Worktree 삭제
- human-created unique file 삭제
- Request 원본 삭제
- PRIMARY source 삭제
- PRIMARY Secret 삭제
- Git history 삭제

### Worktree 처리 금지

- 등록 Worktree를 Explorer/`rmdir`/`Remove-Item`으로 먼저 삭제
- 이름만 보고 candidate/release/temp 삭제
- 불확실한 Worktree 강제 제거
- 활성 metadata prune

### PRIMARY 절대 보존

최소 다음은 삭제하지 않는다.

```text
.git
app
components
lib
services
public
requests
supabase
docs
scripts
package.json
package-lock.json
node_modules
```

및 현재 정상 PRIMARY configuration.

### Git History 최적화 제외

이번 작업에서 수행하지 않는다.

```text
git gc
git repack
git reflog expire
Git object 강제 삭제
LFS cleanup
```

### 다른 프로젝트 보호

`E:\VibeCoding\K-Bestie-v3` 밖의 독립 프로젝트는 수정하지 않는다.

예:

- `K-Bestie-Beta-Site`
- `k-bestie_Homepage-v2`
- `K-Bestie_BlogUI`
- 기타 `E:\VibeCoding` 프로젝트

---

## 5. 모호성 처리

이 작업은 **삭제보다 보존을 우선**한다.

다음 중 하나라도 발생하면 임의 판단하지 않고 전체 정상화를 중단한다.

- PRIMARY가 불명확
- Worktree 용도 불명확
- unique source 여부 불명확
- unique migration 여부 불명확
- local-only commit 판단 불가
- 필요한 stash 여부 불명확
- untracked 파일이 generated인지 사람이 만든 것인지 불명확
- Git metadata와 filesystem 상태 불일치
- 현재 작업 중인 Worktree 가능성을 배제할 수 없음
- candidate/release/temp 폴더 용도 불명확

결과:

`NORMALIZATION BLOCKED`

로 보고하고 삭제하지 않는다.

이 경우 다음만 보고한다.

1. 차단된 경로/대상
2. 무엇이 불명확한지
3. 삭제 시 발생 가능한 위험
4. 안전하게 정상화하려면 무엇이 먼저 확정되어야 하는지

---

## 6. QA

`qa-scope` Skill을 적용한다.

이번 Request는 **파일/Worktree 삭제를 포함하는 고위험 작업**이므로 다음 Gate는 필수다.

### 실행 전 Gate

- 진행 중이던 작업의 Production 반영 = 완료
- 미반영 작업을 담은 Worktree = 0
- PRIMARY 정확히 확인
- UNKNOWN Worktree = 0
- 제거 대상 unique source = 0
- unique migration = 0
- unique commit = 0
- 필요한 stash = 0
- unique human-created file = 0

### 실행 후 Gate

- Git Worktree registry 정상
- PRIMARY source 존재
- Requests 전체 보존
- migrations 전체 보존
- Git history 보존
- PRIMARY dependency 환경 유지
- Git status 확인
- Secret 값 노출 0
- 독립 프로젝트 변경 0
- 삭제 대상 외 손실 0

전체 application E2E나 Production build는 이 정상화 작업의 직접 검증 근거가 아니므로 실제 diff/환경 영향상 필요하지 않으면 수행하지 않는다.

---

## 7. 완료 조건

다음이 모두 충족되면 정상화 완료다.

- 시작 시 진행 중이던 작업의 Production 반영 완료 확인
- 시작 시 미반영 작업을 담은 Worktree 0개 확인
- 종료된 불필요 Worktree 제거
- stale Worktree metadata 정리
- Worktree별 중복 dependency/build data 제거
- 안전이 확인된 orphan/temp/release 잔재 정리
- PRIMARY Repository 유지
- PRIMARY source 유지
- Requests 전체 유지
- migrations 전체 유지
- Git history 유지
- PRIMARY 개발환경 유지
- Secret 값 노출 없음
- UNKNOWN Worktree 없음
- 최종 Git 상태 확인
- 최종 디스크 용량 재측정
- 다른 독립 프로젝트 변경 없음

하나라도 안전 조건을 충족하지 못하면 부분 성공으로 완료 처리하지 않는다.

최종 판정:

`PROJECT FOLDER NORMALIZATION COMPLETE`

또는

`PROJECT FOLDER NORMALIZATION INCOMPLETE`

---

## 8. 완료 보고

아래만 간단히 보고한다.

1. 진행 중이던 작업의 Production 반영 여부 / 미반영 작업 보유 Worktree 수 / 실행 게이트 결과
2. 정상화 전 용량 / 파일 수 / 디렉터리 수 / Worktree 수
3. 제거한 Worktree 및 기타 경로
4. 경로별 제거 이유와 회수 용량
5. 유지 또는 차단한 대상과 이유
6. 정상화 후 용량 / 파일 수 / 디렉터리 수 / Worktree 수
7. 총 회수 용량
8. PRIMARY branch / HEAD / remote / Git status
9. Requests / migrations / source / Git history 보존 결과
10. PRIMARY `node_modules` 등 개발환경 보존 결과
11. Secret 노출 여부
12. QA Level 및 필수 Gate 결과
13. Commit SHA (해당 시)
14. 남은 위험이 있는 경우만 해당 내용

### 절대 실행 규칙

> **직전까지 진행하던 작업이 PRIMARY(`origin/main`)에 반영되고 Production 배포까지 끝난 뒤에만 정상화 작업을 시작한다. 활성 Request가 남아 있다는 사실 자체는 차단 사유가 아니지만, PRIMARY에 반영되지 않은 작업을 담은 Worktree가 단 하나라도 있으면 시작하지 않는다. 실행 시점의 실제 Git/Filesystem 상태를 다시 전수 감사한 뒤에만 안전이 증명된 항목을 제거한다.**