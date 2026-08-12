# 고아 worktree·브랜치·임시 스크립트 안전 정리

## 작업 정보

- 우선순위: 보통
- 선행 작업: `001`부터 `005`까지 모두 완료
- 병렬 처리: 불가
- 활성 작업이 하나라도 있으면 착수하지 않는다.

## 범위

작업 전 `docs/conventions.md`를 먼저 읽고 따른다.

정리 대상:

- Git worktree
- 작업용 로컬 브랜치
- 종료된 tmux 세션 로그
- 프로젝트 루트의 임시 `.mjs`·smoke·check 스크립트
- `/tmp/agy-*`, `/tmp/claude-review-*` 중 종료 작업 로그
- Git 미추적 파일

보존 대상:

- `paused/voice-session-resumption-ab`
- A·B·C·E 중단·보존 관련 stash·브랜치
- 아직 병합되지 않은 유효 변경
- requests 큐와 처리 기록
- Dev 재현에 필요한 정식 테스트 파일

## 현재 상태

감사에서 다음 worktree가 잔존한다고 보고됐다.

- `track-connquality`
- `track-layout`
- `track-retention`
- `track-retention-v2`
- `worktree-agent-a02483848f7980174`
- `worktree-agent-abff341a4bcc86362`

과거 `goldkey-topup.mjs`, 여러 smoke·check 스크립트가 생성된 이력이 있다.

## 요구사항

1. 각 worktree에 대해 다음을 확인한다.
   - 브랜치
   - HEAD SHA
   - 미커밋 변경
   - 기준 브랜치 포함 여부
   - 현재 큐 작업에서 사용 중인지

2. 병합되지 않은 변경이 있으면 삭제하지 않는다.

3. 이미 병합됐고 미커밋 변경이 없는 고아 worktree만 제거한다.

4. A·B·C·E 보존 브랜치와 stash는 절대 삭제하지 않는다.

5. 임시 스크립트에서 다음을 검색한다.
   - 비밀번호
   - 서비스 키
   - 토큰
   - 실제 계정 식별정보

6. 정식 테스트에 사용되지 않는 임시 스크립트만 삭제한다.

7. `git worktree prune`은 제거 대상 확인 후 실행한다.

8. 정리 전후 `git status`, `git worktree list`, `git branch`를 기록한다.

## 데이터·환경변수·배포

- DB 변경: 없음
- 환경변수 변경: 없음
- Dev 배포: 불필요
- Production 접근: 금지
- 삭제 전 커밋 포함 여부 확인 필수

## 완료조건

- 활성 작업 worktree 삭제 0건
- 미병합 변경 유실 0건
- A·B·C·E 보존 자료 유지
- 고아 worktree 정리
- 불필요한 임시 스크립트 정리
- 평문 인증정보 잔존 0건
- 메인 워킹트리 상태 명확화
- 정리 전후 목록 보고

## 검증 시나리오

1. 각 worktree merge-base 확인
2. 미커밋 diff 확인
3. 제거 대상 목록 작성
4. 제거 실행
5. prune 실행
6. 보존 브랜치와 stash 재확인
7. 저장소 전체 비밀정보 문자열 검색

## 공유파일 수정

공유 애플리케이션 파일 수정 없음.

Git 메타데이터와 불필요한 임시 파일만 정리한다.

## 작업 및 리뷰 방식

- 조사·판정·정리: 메인 Claude Code
- 파일 내용 수정 개발 없음
- 삭제 판단이 불명확하면 `_blocked.md` 기록 후 보존

## 최종 보고 형식

- 제거한 worktree
- 보존한 worktree와 이유
- 제거한 임시 파일
- 보존 브랜치·stash 상태
- 인증정보 검색 결과
- 최종 git status