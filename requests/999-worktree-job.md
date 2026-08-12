# K-Bestie-v3 프로젝트 폴더·Worktree 최종 정상화

## 1. 목적

현재 `E:\VibeCoding\K-Bestie-v3`는 다수 Request를 병렬 처리하기 위해 Claude Code 세션별 Git worktree와 `node_modules`, `.next` 빌드 데이터가 생성되고 있다.

2026-08-12 사전 감사에서는 약 40.96GB 중 약 39.5GB가 과거 병렬 작업용 worktree 및 중복 dependency/build 데이터로 확인됐으나, **현재도 여러 Request가 병렬 실행 중이므로 이 감사 결과를 그대로 사용하여 지금 삭제해서는 안 된다.**

이 Request의 목적은 **모든 다른 Request 작업이 완전히 종료된 이후**, K-Bestie 프로젝트를 다시 전수 점검하여:

- `E:\VibeCoding\K-Bestie-v3`를 유일한 PRIMARY repository로 유지
- 종료된 병렬 작업용 worktree 제거
- worktree별 중복 `node_modules` 제거
- worktree별 중복 `.next`/빌드 캐시 제거
- stale Git worktree metadata 정리
- 불필요한 release/candidate/temp/scratch 잔재 정리
- Secret 복제 Surface 축소
- source / requests / migrations / Git history 보존
- 최종적으로 정상적인 단일 프로젝트 개발환경으로 복원

하는 것이다.

---

# 2. 절대 실행 게이트 — 가장 중요

## 2.1 다른 Request가 1개라도 존재하면 실행 금지

이 Request 실행 시작 시 가장 먼저 `E:\VibeCoding\K-Bestie-v3\requests`를 검사한다.

`requests/_done/` 하위는 완료 이력으로 간주하여 제외한다.

`requests/_dashboard.md` 등 Request 관리용 메타 문서는 실제 작업 Request로 계산하지 않는다.

**현재 이 프로젝트 폴더 정상화 Request 자신을 제외하고 `requests/` 활성 영역에 다른 작업 Request `.md`가 단 1개라도 존재하면 이후 작업을 절대 진행하지 않는다.**

조건:

```text
ACTIVE OTHER REQUEST COUNT == 0
```

일 때만 다음 단계로 진행한다.

다음과 같은 경우 모두 실행 금지다.

- 다른 Request 1개 존재
- 다른 Request 여러 개 존재
- 다른 Request 상태가 진행 중
- 다른 Request 상태가 대기 중
- 다른 Request가 아직 `_done`으로 이동되지 않음
- 다른 Request가 구현 완료됐지만 최종 처리되지 않음
- 다른 Request의 상태를 확실히 판단할 수 없음

이 경우 결과는 반드시:

```text
BLOCKED — OTHER REQUESTS EXIST
```

로 종료한다.

어떤 파일도 삭제하거나 Git worktree를 변경하지 않는다.

---

## 2.2 Request 파일 개수만 보고 우회하지 말 것

다른 Request가 존재하지만:

- 코드 구현이 끝났음
- commit이 끝났음
- 테스트가 끝났음
- 다른 Claude Code 세션이 거의 끝났음
- 해당 worktree가 Clean임

등의 이유로 본 정상화 작업을 선행해서는 안 된다.

**다른 활성 Request 파일 존재 여부가 절대적인 실행 게이트다.**

---

# 3. 병렬 개발 종료 상태 재확인

다른 Request가 0개로 확인된 이후에도 바로 삭제하지 않는다.

다음 상태를 READ-ONLY로 다시 점검한다.

- 현재 branch
- HEAD
- remote
- `git status`
- staged 변경
- unstaged 변경
- untracked 파일
- stash
- 등록된 전체 Git worktree
- worktree별 branch
- worktree별 HEAD
- worktree별 Dirty 여부
- worktree별 unique commit
- worktree별 unique source
- worktree별 untracked human-created 파일

PRIMARY:

```text
E:\VibeCoding\K-Bestie-v3
```

가 여전히 유일한 기준 repository인지 확인한다.

다음도 반드시 확인한다.

- `requests/_dashboard.md`
- `supabase/migrations`
- 현재 application source
- `package.json`
- lockfile
- `.git` history

---

# 4. 이전 감사 결과를 삭제 근거로 직접 사용 금지

2026-08-12 감사에서는 다음이 확인됐다.

- K-Bestie-v3 약 40.96GB
- 약 31개 파생 worktree
- 약 39.5GB 중복/생성 데이터
- PRIMARY 정상 개발환경 약 1.17GB

그러나 현재 병렬 작업이 계속되고 있으므로 **이 숫자와 worktree 목록은 참고자료일 뿐 실행 시점 삭제 대상 목록으로 사용하지 않는다.**

반드시 실행 시점에 다시 전수 조사한다.

새로운 worktree가 추가됐을 수도 있고, 기존 worktree가 이미 제거됐을 수도 있으며, 특정 worktree에 아직 필요한 변경이 남아 있을 수도 있다.

---

# 5. 실행 직전 Worktree 전수 감사

다음을 실행 시점 기준으로 전수 조사한다.

```text
git worktree list --porcelain
```

PRIMARY를 제외한 모든 worktree에 대해:

- path
- branch
- HEAD
- Dirty
- staged
- unstaged
- untracked
- stash
- local-only commit
- PRIMARY에 없는 unique tracked source
- PRIMARY에 없는 migration
- PRIMARY에 없는 Request 관련 산출물
- 사람이 만든 unique 파일
- node_modules 크기
- .next 크기
- 전체 크기

를 확인한다.

각 worktree는 다음 중 하나로 분류한다.

```text
SAFE_TO_REMOVE
ACTIVE_OR_REQUIRED
UNKNOWN
```

### SAFE_TO_REMOVE

다음 조건을 모두 만족해야 한다.

- 다른 활성 Request와 연결되지 않음
- 필요한 source가 PRIMARY에 반영됨
- unique commit 없음
- unique migration 없음
- unique Request 결과 없음
- unique human-created 파일 없음
- 필요한 stash 없음
- Dirty가 없거나 generated-only임이 증명됨

### ACTIVE_OR_REQUIRED

필요한 데이터가 하나라도 남아 있으면 제거 금지.

### UNKNOWN

판단할 수 없는 내용이 하나라도 있으면 제거 금지.

---

# 6. 안전 중단 조건

다음 중 하나라도 발견되면 정상화 전체 작업을 중단한다.

- 다른 활성 Request 존재
- PRIMARY 불확실
- unique source 존재
- unique migration 존재
- unique commit 존재
- 필요한 stash 존재
- human-created untracked 파일 존재
- worktree 용도 UNKNOWN
- 현재 작업 중일 가능성을 배제할 수 없는 worktree 존재
- Git 상태와 filesystem 상태 불일치
- 삭제 대상 판단에 불확실성 존재

결과:

```text
NORMALIZATION BLOCKED
```

로 보고하고 삭제하지 않는다.

---

# 7. 정상화 실행 조건

아래 조건이 **모두 PASS**인 경우에만 실제 정리를 시작한다.

- [ ] 이 Request 외 활성 Request = 0
- [ ] `K-Bestie-v3` PRIMARY 확인
- [ ] 모든 worktree 관계 확인
- [ ] 삭제 대상 unique source = 0
- [ ] 삭제 대상 unique migration = 0
- [ ] 삭제 대상 unique commit = 0
- [ ] 삭제 대상 필요한 stash = 0
- [ ] 삭제 대상 human-created unique 파일 = 0
- [ ] UNKNOWN worktree = 0
- [ ] requests/migrations/Git history 보존 확인

모든 조건 PASS 시:

```text
NORMALIZATION EXECUTION READY
```

로 선언한 후 정리한다.

---

# 8. Worktree 제거 원칙

Git에 등록된 worktree를 Windows Explorer, `rmdir`, `Remove-Item` 등으로 먼저 직접 삭제하지 않는다.

반드시 PRIMARY repository 기준 Git worktree 절차를 사용한다.

```text
E:\VibeCoding\K-Bestie-v3
```

에서 각 `SAFE_TO_REMOVE` worktree를 정상 제거한다.

필요한 경우 force 옵션은:

- Dirty 내용이 generated-only임이 증명됨
- unique source 0
- unique migration 0
- unique commit 0
- 필요한 stash 0

인 경우에만 허용한다.

---

# 9. Stale Worktree Metadata

실제 filesystem에는 존재하지 않지만 Git metadata에만 남은 worktree가 있는지 확인한다.

정상 worktree 제거 완료 후에만 stale metadata를 판정한다.

실제 경로가 없고 더 이상 유효하지 않은 metadata에 한해서만 prune을 수행한다.

활성 또는 판단 불가 metadata는 건드리지 않는다.

---

# 10. `worktrees/` 내부 정리

기존 감사에서:

```text
E:\VibeCoding\K-Bestie-v3\worktrees
```

내부에 대량의 파생 worktree가 존재했다.

실행 시점에 다시 조사하여 Git worktree로 등록된 항목은 Git 절차로 제거한다.

Git 등록이 이미 해제됐고:

- source unique 0
- secret unique 0
- 사람이 만든 파일 0
- generated/cache만 존재

하는 orphan 디렉터리는 최종 검증 후 일반 삭제할 수 있다.

---

# 11. `.claude/worktrees/` 정리

기존 감사에서:

```text
E:\VibeCoding\K-Bestie-v3\.claude\worktrees
```

에도 에이전트 병렬 작업용 worktree가 존재했다.

`.claude` 전체를 삭제하지 않는다.

Claude 설정, 메모리, 정상 configuration은 유지한다.

오직 실행 시점에 종료된 것으로 검증된 `.claude/worktrees/` 파생 작업 디렉터리만 제거한다.

---

# 12. 중복 Dependency / Build 데이터

종료된 worktree가 제거되면서 해당 worktree 내부:

- `node_modules`
- `.next`
- `.cache`
- coverage
- test-results
- playwright-report
- build
- dist

등은 함께 제거한다.

개별 `node_modules`나 `.next`를 먼저 지우는 방식보다 **worktree 자체를 정상 제거하는 것을 우선**한다.

PRIMARY의 다음 항목은 유지한다.

```text
E:\VibeCoding\K-Bestie-v3\node_modules
E:\VibeCoding\K-Bestie-v3\.next
```

이번 정상화의 목적은 현재 정상 개발환경까지 초기화하는 것이 아니다.

---

# 13. candidate/release/temp 잔재

다음과 같은 디렉터리가 실행 시점에 존재할 경우 개별 검증한다.

- candidate-release
- release
- prod-release
- dev-release
- temp
- tmp
- scratch_*
- audit_*
- 기타 과거 배포/진단/임시 폴더

이름만 보고 삭제하지 않는다.

다음을 모두 만족할 때만 제거한다.

- Git tracked source 아님
- PRIMARY에 없는 source 없음
- migration 없음
- Request 원본 없음
- Secret 원본 없음
- 현재 코드에서 참조 안 됨
- 사람이 만든 unique 데이터 없음
- generated/cache/diagnostic 잔재임이 증명됨

불확실하면 유지하고 보고한다.

---

# 14. Secret 처리

다음 내용을 절대 출력하지 않는다.

- `.env` 값
- `.env.local` 값
- service-role key
- API key
- JWT
- access token
- refresh token
- password
- private key
- 인증서 내용

경로와 개수만 확인한다.

삭제되는 worktree의 Secret 복제본은 worktree 제거와 함께 정리한다.

PRIMARY Secret은 절대 삭제하지 않는다.

---

# 15. 절대 보존 대상

다음은 이번 정상화 작업에서 삭제 금지다.

```text
E:\VibeCoding\K-Bestie-v3\.git
E:\VibeCoding\K-Bestie-v3\app
E:\VibeCoding\K-Bestie-v3\components
E:\VibeCoding\K-Bestie-v3\lib
E:\VibeCoding\K-Bestie-v3\services
E:\VibeCoding\K-Bestie-v3\public
E:\VibeCoding\K-Bestie-v3\requests
E:\VibeCoding\K-Bestie-v3\supabase
E:\VibeCoding\K-Bestie-v3\docs
E:\VibeCoding\K-Bestie-v3\scripts
E:\VibeCoding\K-Bestie-v3\package.json
E:\VibeCoding\K-Bestie-v3\package-lock.json
E:\VibeCoding\K-Bestie-v3\node_modules
```

현재 정상 PRIMARY 환경설정도 유지한다.

---

# 16. Git History 최적화 제외

이번 작업에서는 다음을 수행하지 않는다.

```text
git gc
git repack
git reflog expire
Git object 강제 삭제
LFS cleanup
```

현재 Git history 자체는 이전 감사에서 약 58MB로 정상이며 용량 문제의 원인이 아니었다.

---

# 17. 정상화 후 재검증

정리 후 반드시 다시 측정한다.

- K-Bestie-v3 전체 logical size
- 파일 수
- 디렉터리 수
- 남은 worktree 수
- `git worktree list --porcelain`
- `git status`
- branch
- HEAD
- remote
- requests 존재
- migrations 존재
- source 존재
- PRIMARY node_modules 존재

그리고 다음을 확인한다.

```text
PRIMARY 외 불필요 Worktree = 0
UNKNOWN Worktree = 0
Source Loss = 0
Migration Loss = 0
Request Loss = 0
Git History Loss = 0
```

---

# 18. 다른 독립 프로젝트 보호

이 작업은 `E:\VibeCoding\K-Bestie-v3` 정상화 작업이다.

다음과 같은 독립 프로젝트는 수정하거나 삭제하지 않는다.

- `K-Bestie-Beta-Site`
- `k-bestie_Homepage-v2`
- `K-Bestie_BlogUI`
- 기타 E:\VibeCoding 독립 프로젝트

별도 요청 없이는 범위를 확장하지 않는다.

---

# 19. 완료 기준

다음을 모두 만족해야 완료다.

- [ ] 실행 시작 시 다른 활성 Request 0개 확인
- [ ] 병렬 작업용 종료 worktree 제거
- [ ] stale worktree metadata 정리
- [ ] worktree 중복 node_modules 제거
- [ ] worktree 중복 .next/build 제거
- [ ] 불필요 release/candidate/temp 잔재 정리
- [ ] PRIMARY source 유지
- [ ] requests 전체 유지
- [ ] migrations 전체 유지
- [ ] Git history 유지
- [ ] PRIMARY 개발환경 유지
- [ ] Secret 값 노출 0
- [ ] 최종 Git 상태 정상
- [ ] 최종 디스크 용량 재측정

---

# 20. 최종 보고 형식

작업 완료 시 다음 형식으로 보고한다.

## 실행 게이트

- 다른 활성 Request 수:
- 실행 가능 여부:

## 정리 전

- K-Bestie-v3 용량:
- 파일 수:
- 디렉터리 수:
- 등록 Worktree 수:

## 제거 내역

| 경로 | 유형 | 제거 이유 | 회수 용량 |
|---|---|---|---|

## 유지/차단 내역

| 경로 | 이유 |
|---|---|

## 정리 후

- K-Bestie-v3 용량:
- 파일 수:
- 디렉터리 수:
- Worktree 수:
- 총 회수 용량:

## PRIMARY 검증

- Branch:
- HEAD:
- Remote:
- Git status:
- Requests:
- Migrations:
- Source:
- Git history:

## 최종 판정

모두 정상이면:

```text
PROJECT FOLDER NORMALIZATION COMPLETE
```

하나라도 이상하면:

```text
PROJECT FOLDER NORMALIZATION INCOMPLETE
```

---

# 절대 규칙

**이 Request 자신을 제외한 다른 활성 Request가 `requests/`에 단 1개라도 존재하면 이 작업은 절대 시작하지 않는다.**

다른 Request가 모두 완료되어 활성 Request 수가 정확히 0이 된 이후에만 전수 재검증과 프로젝트 폴더 정상화를 수행한다.

이렇게 해두면 현재 병렬 작업이 몇 개가 더 생기더라도 상관없습니다. **큐가 완전히 비워지기 전에는 이 Request 자체가 실행되지 않도록 막고**, 마지막 작업이 끝난 시점의 실제 worktree 상태를 다시 기준으로 정리하게 됩니다.