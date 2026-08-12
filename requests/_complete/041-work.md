좋습니다. 아래 내용을 그대로 Claude Code에 전달하면 됩니다.  
핵심은 **Dev 구현·E2E는 완료 보고됐지만, 대량 미커밋 변경이 남아 있으므로 Claude Code가 먼저 읽기 전용 감사 후 기준 커밋을 만드는 것**입니다.  
Production·Cron은 그 다음 단계입니다.

# K-Bestie-v3 V3 데이터 파이프라인 Claude Code 인수인계서

작성일: 2026-08-02  
대상 저장소: `/mnt/e/VibeCoding/K-Bestie-v3`  
현재 브랜치: `feat/family-backend`  
현재 확인된 HEAD: `f7445e0`  
HEAD 메시지: `[기능] Daily Report V3 수동 실행 파이프라인 연동 및 pipeline_jobs 외래키 오류 수정`

---

## 1. 인수인계 목적

Codex와 Antigravity가 진행한 Dev V3 데이터 파이프라인 작업을 Claude Code가 인수한다.

현재 Dev 구현과 E2E 검증은 완료됐다고 보고되었으나, HEAD 이후 대량의 tracked/untracked 변경이 남아 있고 아직 기준 커밋·push·Production 배포·Cron 등록은 진행하지 않았다.

Claude Code는 즉시 기능을 다시 구현하지 말고 다음 순서로 진행한다.

1. 저장소 변경사항 읽기 전용 감사
2. Dev 구현과 최종 E2E 증거 재확인
3. 위험 파일과 임시 파일 분리
4. 논리 단위별 커밋 생성
5. Dev 재검증
6. Production 배포 계획 확정
7. Production 마이그레이션·환경변수·Cron 적용
8. Production Smoke Test

---

## 2. 전체 8개 작업 상태

Dev 기준 원래 작업 8개는 다음과 같다.

| 번호 | 작업 | 현재 상태 |
|---|---|---|
| 1 | Collection | 완료 보고 |
| 2 | collected 처리 | 완료 보고 |
| 3 | Cleanup Batch | 구현 및 동적 검증 완료 보고 |
| 4 | Context Correction | 구현 및 실제 Gemini 연동 검증 완료 보고 |
| 5 | Daily Report V3 | 구현 완료 보고 |
| 6 | Raw·Corrected 7일 Retention | 구현 및 동적 검증 완료 보고 |
| 7 | Collection 안정성 | 완료 보고 |
| 8 | Mission 시간 정책 | 완료 보고 |

현재 판단:

> Dev V3 파이프라인 8개 기능은 구현 및 E2E 검증 완료로 보고됐지만, Claude Code가 커밋 전 반드시 실제 diff·DB·테스트 결과를 독립 검증해야 한다.

---

## 3. 최종 파이프라인 구조

정상 자동 흐름:

```text
사용자 대화 저장
    ↓
Collection 1 / Collection 2
    ↓
Raw V3 저장
    ↓
Context Correction
    ↓
Corrected V3 저장
    ↓
Memory Batch
    ↓
Daily Report
    ↓
Cleanup
    ↓
Raw·Corrected 7일 Retention
```

확정된 핵심 원칙:

- Collection은 `chat_messages`와 `chat_sessions`에서 미수집 메시지만 수집한다.
- Raw V3가 일별 원본 데이터의 기준이다.
- Context Correction은 Raw V3만 입력으로 사용한다.
- Context Correction 이후 Corrected V3를 저장한다.
- Memory Batch와 Daily Report는 Corrected V3를 입력으로 사용한다.
- Daily Report는 `chat_messages`나 Raw V3를 직접 다시 조회하지 않는다.
- Cleanup은 안전하게 수집 완료된 원본 메시지만 대상으로 한다.
- Retention은 Raw V3와 Corrected V3만 7일 후 삭제한다.
- 최종 Daily Report와 Memory 데이터는 유지한다.

---

## 4. Collection V3

### 실행 정책

- Collection 1: 17:55 KST
- Collection 2: 23:55 KST
- Cron은 아직 Production에 등록하지 않았다.
- 수동 관리자 실행은 정규 시간 이전에도 현재까지 존재하는 미수집 메시지만 수집할 수 있어야 한다.
- 수동 실행 후 추가된 메시지는 다음 실행에서 중복 없이 누적한다.

### 섹션

```text
mission_1
free_chat_1
mission_2
free_chat_2
```

### 정렬

`raw_daily_conversation_messages_v3.display_sequence`를 사용한다.

정렬 원칙:

1. `mission_1`
2. `free_chat_1`
3. `mission_2`
4. `free_chat_2`
5. 동일 section 안에서 `created_at`
6. `source_message_id`
7. `id`

### Collection 2 자동 연결

Collection 2가 완료되면 다음 RPC로 Context Correction Job을 enqueue하도록 연결됐다.

```text
enqueue_context_correction_job_v3(
  child_id,
  business_date,
  execution_id
)
```

확정 원칙:

- Collection 1에서는 Correction Job을 생성하지 않는다.
- Collection 2 완료 이후에만 생성한다.
- 동일 child/date는 1건만 유지한다.
- enqueue 실패가 이미 완료된 Collection 데이터를 롤백하지 않는다.

---

## 5. Context Correction V3

주요 파일 후보:

```text
lib/batch/contextCorrectionV3.ts
app/api/batch/v3/context-correction/worker/route.ts
```

관련 RPC:

```text
claim_context_correction_jobs_v3
complete_context_correction_job_v3
enqueue_context_correction_job_v3
```

입력 테이블:

```text
raw_daily_conversations_v3
raw_daily_conversation_messages_v3
```

금지 입력:

```text
chat_messages
child_memory
daily_reports
Legacy Raw
Legacy Corrected
```

보정 원칙:

- STT 오인식 수정
- 문맥상 명백한 단어 복원
- 문장 자연스러움 보정
- 새로운 사건·감정·사실 추가 금지
- 부모 리포트 분석 금지
- 확신이 없으면 원문 유지

보존 필드:

```text
source_message_id
session_id
role
created_at
section
display_sequence
```

Gemini가 변경 가능한 값:

```text
content
correction_metadata
```

---

## 6. Memory Batch 연결

주요 파일 후보:

```text
lib/batch/memoryV3.ts
supabase/functions/memory-batch/index.ts
supabase/functions/_shared/batch.ts
```

관련 마이그레이션 후보:

```text
supabase/migrations/20260801370000_v3_correction_memory_report_pipeline.sql
supabase/migrations/20260801400000_v3_pipeline_forward_fixes.sql
```

확정 실행 흐름:

### 즉시 리포트 생성

```text
Corrected V3 확인
    ↓
Memory Batch
    ↓
Daily Report
```

### 수집 후 리포트 즉시 생성

```text
Collection
    ↓
Context Correction
    ↓
Corrected V3 저장
    ↓
Memory Batch
    ↓
Daily Report
```

핵심 원칙:

- 별도 Memory Batch 버튼을 만들지 않는다.
- Memory Batch 실패 시에도 Daily Report는 계속 실행한다.
- Memory Batch 결과와 Daily Report 결과는 독립적으로 기록한다.
- 성공한 Memory Batch는 재처리하지 않는다.
- 실패한 아이만 재시도할 수 있어야 한다.
- 동일 child/date에 Memory 데이터 중복 저장을 금지한다.
- 현재 Memory Batch 내부 로직 자체의 재설계는 범위가 아니다.
- 기존 호출 연결 지점만 사용한다.

관리자 화면 결과 예시:

```text
[Memory Batch]
- 성공: 2명
- 건너뜀: 0명
- 실패: 0명

[리포트 생성]
- 생성/갱신: 2건
- 건너뜀(대화 없음): 0건
- 에러: 0건
```

---

## 7. Daily Report V3

주요 파일 후보:

```text
lib/batch/dailyReportV3.ts
lib/batch/generateDailyReports.ts
app/api/admin/reporting/run/route.ts
app/api/admin/reporting/status/route.ts
app/api/admin/reporting/pulse/
```

입력:

```text
corrected_daily_conversations_v3
corrected_daily_conversation_messages_v3
```

필수 조건:

- Corrected 상태 completed
- corrected message count와 실제 메시지 수 일치
- 메시지 1건 이상
- source_message_id 중복·누락 없음
- 동일 child/date 리포트 1건

리포트 필수 항목:

```text
기분
친구
학교
관심사
사건 키워드
변화 신호
오늘의 대화거리
전달 메시지
```

금지:

- 아이 대화 원문을 부모 화면에 노출
- 진단·의학·심리 확정 표현
- Raw V3 또는 chat_messages를 직접 조회해 우회 생성

---

## 8. 관리자 수동 실행

주요 화면:

```text
app/admin/ManualReportingTab.tsx
```

관리자 버튼 3개:

### 1) 즉시 대화 수집

```text
특정 아이 또는 전체 아이
    ↓
현재까지 미수집 메시지 Collection V3
    ↓
Collection 상태 표시
```

### 2) 즉시 리포트 생성

```text
Corrected V3 확인
    ↓
Memory Batch
    ↓
Daily Report
```

### 3) 수집 후 리포트 즉시 생성

```text
Collection
    ↓
Context Correction
    ↓
Memory Batch
    ↓
Daily Report
```

전체 아이 실행:

- 하나의 HTTP 요청에서 모든 LLM 처리를 끝내지 않는다.
- execution_id를 반환한다.
- 관리자 화면이 상태 API를 polling한다.
- 아이별로 상태를 독립 표시한다.
- 한 아이 실패가 다른 아이 처리를 중단하지 않는다.

상태 표시:

```text
대기
처리 중
완료
실패
```

단계별 표시:

```text
Collection
Context Correction
Memory Batch
Daily Report
```

---

## 9. Cleanup V3

주요 파일 후보:

```text
lib/batch/cleanupV3.ts
app/api/batch/cleanup/
supabase/migrations/20260801380000_cleanup_retention_v3.sql
```

관련 RPC:

```text
cleanup_chat_messages_v3
```

정책:

- `collected_at`이 존재하는 메시지만 대상
- 안전 cutoff 이전 데이터만 대상
- 미수집 메시지 유지
- Collection 실패 메시지 유지
- cutoff 이후 메시지 유지
- 재실행 멱등성

Antigravity 최종 보고:

```text
삭제 대상 collected 메시지: 2건 삭제
collected_at NULL 메시지: 유지
cutoff 이후 메시지: 유지
2차 실행: 0건 삭제
```

---

## 10. Raw·Corrected 7일 Retention

주요 파일 후보:

```text
lib/batch/retentionV3.ts
supabase/migrations/20260801380000_cleanup_retention_v3.sql
```

관련 RPC:

```text
purge_v3_retention_batch
```

정책:

- Raw V3와 Corrected V3만 7일 보관 후 삭제
- 기준은 리포트 생성 완료 정책과 일치하도록 확인 필요
- 7일 이내 데이터 유지
- Daily Report 유지
- Memory 데이터 유지
- 부모 행 삭제 시 자식 메시지 FK/Cascade 정상 처리
- 재실행 멱등성

Antigravity 최종 보고:

```text
7일 초과 Raw V3 부모 1건 삭제
7일 초과 Corrected V3 부모 1건 삭제
7일 이내 Raw/Corrected 유지
2차 실행 시 추가 삭제 없음
```

---

## 11. Antigravity 최종 E2E 보고

Antigravity는 최종적으로 다음을 보고했다.

### 관리자 단일 아이

```text
collect: HTTP 200
generate: HTTP 200
collect_and_generate: HTTP 200
Pulse polling 확인
중복 Raw 생성 없음
```

### 관리자 전체 아이

```text
collect_and_generate: HTTP 200
target count 기반 polling 완료
summary 반환
```

### Memory Batch

```text
성공/실패/건너뜀 지표 표시 확인
대화 없음 건너뜀 확인
Memory Batch 실패 후에도 Daily Report enqueue/진행 확인
```

### Cleanup

```text
삭제 2건
보존 2건
재실행 삭제 0건
```

### Retention

```text
기준일 이전 Raw 1건 삭제
기준일 이전 Corrected 1건 삭제
기준일 이후 Raw/Corrected 유지
```

### 종료 상태

```text
fixture 잔여 0건
pipeline_v3_control.enabled=false
pipeline_v3_control.cutover_at=NULL
```

주의:

> 위 내용은 Antigravity의 최종 보고다. Claude Code는 이를 그대로 신뢰하지 말고 실행 로그·스크립트·DB 상태를 독립 확인해야 한다.

---

## 12. 현재 Git 상태 주의

HEAD 이후 대량 변경이 남아 있었다.

과거 확인 기준:

```text
tracked 변경 약 41개 이상
untracked 파일 다수
대규모 insert/delete diff
```

주요 변경 후보:

```text
app/admin/ManualReportingTab.tsx
app/api/admin/reporting/children/route.ts
app/api/admin/reporting/run/route.ts
app/api/admin/reporting/status/route.ts
app/api/admin/reporting/pulse/
app/api/batch/cleanup/
app/api/batch/correction/
app/api/batch/v3/
lib/batch/collection.ts
lib/batch/contextCorrectionV3.ts
lib/batch/memoryV3.ts
lib/batch/dailyReportV3.ts
lib/batch/cleanupV3.ts
lib/batch/retentionV3.ts
supabase/functions/memory-batch/index.ts
supabase/functions/_shared/batch.ts
```

환경·임시 파일 후보:

```text
supabase/.temp/*
scratch_*.js
extract_*.mjs
test_vertex*.mjs
qa-*.mjs
db_diff_*.txt
status.txt
diff_name_status.txt
procs.txt
untracked.txt
recent.txt
reports/
vercel_env_check/
```

Claude Code는 임의로 삭제하지 말고 파일별 역할을 확인한 뒤 정리한다.

---

## 13. Migration 상태와 주의점

기존 삭제 상태였던 다음 두 파일은 Antigravity가 HEAD 기준으로 복원했다.

```text
supabase/migrations/20260721300000_daily_reports_viewed_at.sql
supabase/migrations/20260725100000_safety_events_alpha_allowlist.sql
```

대체 파일 후보도 존재한다.

```text
supabase/migrations/20260721300001_daily_reports_viewed_at.sql
supabase/migrations/20260725100001_safety_events_alpha_allowlist.sql
```

Antigravity 보고상 Dev DB에는 000과 001이 모두 적용된 것으로 확인됐다.

Claude Code 확인사항:

1. 로컬 000·001 파일 존재 여부
2. Dev migration list
3. `supabase_migrations.schema_migrations` 실제 기록
4. 각 파일 SQL 내용이 동일한지
5. Production에 어느 버전이 적용돼 있는지
6. Production 적용 시 중복 SQL이 안전한지

금지:

- 기존 적용 migration 수정
- migration 파일 timestamp 변경
- `schema_migrations` 직접 INSERT·UPDATE·DELETE
- migration repair/reset/include-all
- 이유 없는 `db push`

---

## 14. pipeline_v3_control 현재 상태

Antigravity 최종 보고:

```text
enabled=false
cutover_at=NULL
```

Claude Code는 작업 시작 직후 읽기 전용으로 다시 확인한다.

Dev 테스트 중에만 임시 활성화할 수 있으며, 종료 시 반드시 다음으로 복구한다.

```text
enabled=false
cutover_at=NULL
```

Production 활성화는 별도 승인 전 금지한다.

---

## 15. Claude Code가 가장 먼저 할 작업

아래 순서로 읽기 전용 감사부터 시작한다.

```bash
cd /mnt/e/VibeCoding/K-Bestie-v3

export GIT_PAGER=cat

git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --name-status
git diff --name-status f7445e0
git diff --stat f7445e0
git worktree list
git stash list
git log -10 --oneline --decorate
```

그다음 확인:

```bash
npx tsc --noEmit
npx supabase migration list --linked
```

DB 읽기 전용 확인:

```text
pipeline_v3_control
pipeline_jobs
pipeline_execution_items
raw_daily_conversations_v3
raw_daily_conversation_messages_v3
corrected_daily_conversations_v3
corrected_daily_conversation_messages_v3
```

코드 감사 우선순위:

1. `20260801360000` 이후 migration
2. Collection → Correction 연결
3. Correction → Memory 연결
4. Memory 성공·실패 → Report 연결
5. 관리자 run/status/pulse API
6. Cleanup RPC
7. Retention RPC
8. 테스트 스크립트의 실제 안전성
9. fixture cleanup
10. Production 관련 변경 유무

---

## 16. 커밋 분리 권장안

대량 변경을 한 번에 커밋하지 않는다.

### 커밋 1: Migration 정합성

```text
V3 pipeline migrations
RPC
enum
index
constraint
migration 복원
```

### 커밋 2: Collection·Correction

```text
collection.ts
contextCorrectionV3.ts
Collection/Correction API
관련 테스트
```

### 커밋 3: Memory·Daily Report

```text
memoryV3.ts
dailyReportV3.ts
memory-batch Edge Function
공유 batch 로직
관련 API
```

### 커밋 4: 관리자 수동 실행

```text
ManualReportingTab.tsx
run/status/pulse API
children API
관리자 상태 집계
```

### 커밋 5: Cleanup·Retention

```text
cleanupV3.ts
retentionV3.ts
관련 API
동적 테스트
```

### 커밋 6: 테스트·문서·정리

```text
E2E 스크립트
검증 문서
필요한 request 문서
불필요한 scratch 제외
.gitignore
```

각 커밋 전후:

```bash
npx tsc --noEmit
git diff --check
```

migration 관련 커밋 후:

```bash
npx supabase migration list --linked
```

---

## 17. Production 전환 순서

Dev 기준 커밋과 재검증이 완료된 뒤에만 진행한다.

### 1단계: Production 읽기 전용 감사

- Production Supabase project ref
- Production migration list
- 기존 테이블·함수·enum
- Production Vercel 환경변수 존재 여부
- Edge Function 배포 상태
- 기존 Cron 상태
- 현재 사용자 데이터 규모

### 2단계: 배포 계획 확정

- Dev migration과 Production 미적용 migration 목록
- 적용 순서
- 잠금 영향
- 예상 시간
- 롤백 방식
- V3 control 기본 비활성화

### 3단계: Production migration

초기 상태:

```text
pipeline_v3_control.enabled=false
pipeline_v3_control.cutover_at=NULL
```

### 4단계: 앱·Edge Function 배포

- Vercel Production
- Supabase Edge Function
- 환경변수·Secret
- 모델 환경변수
- Cron Secret

### 5단계: Smoke Test

신규 테스트 계정만 사용한다.

```text
대화 저장
Collection
Context Correction
Memory Batch
Daily Report
관리자 수동 실행
Cleanup dry/safe test
Retention safe test
```

### 6단계: Cron 등록

예정:

```text
Collection 1: 17:55 KST
Collection 2: 23:55 KST
Cleanup: 01:00 이후
Retention: 01:00 이후 적절한 시간
```

실제 UTC 변환과 Vercel/Supabase 실행 위치는 배포 전에 다시 확인한다.

### 7단계: V3 활성화

별도 최종 승인 후:

```text
enabled=true
cutover_at=<승인된 시각>
```

---

## 18. 절대 금지사항

- 기존 실제 child ID를 테스트 fixture로 사용하지 않는다.
- 기존 실제 아이 데이터를 DELETE하지 않는다.
- 테스트 전 고정 UUID 존재 여부를 확인한다.
- fixture cleanup은 신규 테스트 UUID에만 한정한다.
- 적용된 migration 파일을 수정하지 않는다.
- migration timestamp를 바꾸지 않는다.
- `schema_migrations`를 직접 수정하지 않는다.
- Production DB를 Dev 검증 목적으로 사용하지 않는다.
- Secret을 로그·파일·응답에 출력하지 않는다.
- `.env.local` 전체 출력 금지
- 서비스 역할 키 하드코딩 금지
- Gemini 원문 응답과 아이 대화 원문 로그 금지
- 검증 없이 “완료”, “완벽”, “전부 PASS”라고 단정하지 않는다.
- 한 에이전트의 자체 보고만으로 최종 PASS 처리하지 않는다.
- `git reset --hard`, `git clean -fd`, 전체 checkout 금지
- unrelated 변경을 함께 커밋하지 않는다.
- Production 배포와 Cron 등록은 명시적 승인 전 금지

---

## 19. Claude Code 최종 보고 형식

Claude Code는 첫 감사 후 다음 형식으로 보고한다.

```text
1. 현재 브랜치·HEAD
2. staged / unstaged / untracked 현황
3. Codex·Antigravity 변경분 분류
4. Dev 8개 작업별 실제 구현 상태
5. E2E 테스트 재실행 결과
6. Migration Local/Dev 정합성
7. 위험 파일 및 임시 파일
8. 보존할 파일
9. 제거 후보 파일
10. 커밋 분리 계획
11. Production 전환 가능 여부
12. 현재 남은 정확한 작업
13. PASS / 조건부 PASS / FAIL

