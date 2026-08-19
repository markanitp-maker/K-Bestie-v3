029-r1-complete-weekly-report-cron-and-backfill.md

# REQUEST 029-R1 — 주간 리포트 미완료 항목 복구 및 Production 자동화 정상화

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
기존 REQUEST 029에서 완료되지 않은 항목만 다시 확인하고 마무리한다.

핵심 미완료 대상:
1. 주간 경계 `토요일~금요일`이 Production 실제 코드/API/UI에서 일치하는지 최종 재검증
2. Production `kbestie-weekly-batch` Cron이 실제로 매주 토요일 06:00 KST에 실행 가능한 상태인지 확인하고 미등록/비활성/오등록이면 정상화
3. 완료 주간의 누락 주간 리포트가 남아 있으면 Production 전체 대상자를 찾아 누락자만 멱등 백필
4. Cron 인증에 필요한 운영 Secret/BATCH_SECRET이 실제로 없다면 임시 하드코딩으로 우회하지 말고 자동 Cron만 BLOCKER로 명확히 남김
5. 다음 자동 실행 시점에 실제 실행 가능한 상태까지 검증

### 대표님 테스트 정상 프로세스
- 기존 정상 주간 리포트는 그대로 유지된다.
- 누락된 완료 주간 리포트는 생성되어 표시된다.
- 현재 진행 중인 주간은 집계 중으로 유지된다.
- Production Scheduler 조회 결과에서 주간 Cron의 실제 존재/active/schedule이 확인된다.
- Secret 부재 시 자동 Cron은 BLOCKER로 정확히 표시되고 수동 생성 경로는 별도로 유지된다.

---

## 1. 기존 REQUEST 029 목표

기존 029의 목표:
1. 주간 집계 정책 `토요일~금요일` 확인/수정
2. 매주 토요일 06:00 KST Production Cron 정상화
3. 완료 주간 누락자 전체 검색 및 백필

이번 029-R1은 처음부터 다시 구현하지 않는다.
현재 Production 상태를 먼저 확인하고 `완료 / 미완료`를 구분한 뒤 미완료 항목만 처리한다.

---

## 2. 현재까지 확인된 상태

최근 진단 결과:
- 2026-08-15 06:00 실행 기준 `week_start=2026-08-08`, `week_end=2026-08-14` 정상 계산
- 입력 데이터 정상
- weekly-batch Edge Function 배포 정상
- 06:00 전후 weekly LLM 호출 0건
- 실제 생성 0건
- 최초 실패 지점: Cron 미실행

따라서 Cron 정상화가 핵심 미완료 항목이다.

---

## 3. PHASE 1 — 완료/미완료 상태표 작성

다음 항목을 먼저 실제 Production 기준으로 판정한다.

| 항목 | 판정 |
|---|---|
| 토~금 주차 계산 | |
| 생성기/API/UI 동일 기준 | |
| Production Cron 실제 존재 | |
| Cron active | |
| Cron schedule | |
| Cron endpoint | |
| Cron auth/secret 준비 | |
| 완료 주간 누락 백필 | |

완료된 항목은 재작업하지 않는다.

---

## 4. PHASE 2 — 주간 정책 최종 검증

정책:
```text
week_start = 토요일
week_end = 금요일
생성 시각 = 다음 토요일 06:00 KST
```

필수 예:
```text
2026-08-15 06:00 → 2026-08-08~2026-08-14
2026-08-22 06:00 → 2026-08-15~2026-08-21
```

현재 코드가 이미 정상이라면 변경하지 않는다.
생성기/API/UI 불일치가 있을 때만 최소 수정한다.

---

## 5. PHASE 3 — Production Cron 실제 확인

migration 파일이나 SQL 파일 존재 여부로 완료 판정하지 않는다.

실제 Production Scheduler에서 확인:
- Job 존재 여부
- jobname
- active
- schedule
- command/endpoint
- auth
- 중복 Job
- 최근 실행 이력
- 다음 실행 예정 시각

기대값:
```text
jobname = kbestie-weekly-batch
schedule = 0 21 * * 5
active = true
UTC = Friday 21:00
KST = Saturday 06:00
```

---

## 6. PHASE 4 — Cron 상태별 조치

A. Job 존재 + inactive
→ 활성화

B. Job 없음
→ 신규 등록

C. schedule 오류
→ `0 21 * * 5`로 수정

D. endpoint/function 오류
→ 실제 배포된 weekly-batch 경로로 수정

E. 중복 Job
→ 정상 Job 1개만 유지

F. BATCH_SECRET/운영 인증 Secret 없음
→ 임시 토큰 생성 금지
→ Service Role Key 하드코딩 금지
→ SQL/스크립트 평문 Secret 금지
→ 자동 Cron만 `BLOCKER: Production weekly-batch 인증 Secret 부재`로 보고

Secret이 없는 상태에서 가짜 완료 처리하지 않는다.

---

## 7. Cron 멱등성

Cron 등록/업데이트를 여러 번 실행해도 중복 Job이 생기지 않아야 한다.

```text
기존 Job 있음 → 필요한 값만 정정
기존 Job 없음 → 신규 생성
```

---

## 8. PHASE 5 — 완료 주간 누락분 전수 재검사

Production 전체 생성 대상자를 검사한다.
특정 4명만 검사하지 않는다.

최소 확인 주간:
- `2026-08-01~2026-08-07`
- `2026-08-08~2026-08-14`

각 주간별:
- 생성 대상자 수
- 기존 weekly 보유자 수
- 누락자 수

를 산출한다.

---

## 9. 누락 백필 정책

누락자만 기존 주간 생성 core logic으로 생성한다.

멱등 기준:
```text
child_id + week_start + week_end
```

이미 존재 → SKIP
누락 → GENERATE

금지:
- 전체 weekly 삭제 후 재생성
- 정상 리포트 overwrite
- 다른 주차 수정
- 현재 진행 중 주차 선생성

---

## 10. 자동 Cron과 수동 복구 분리

자동:
```text
pg_cron → weekly-batch → 주간 생성 core
```

수동:
```text
명시적 week_start/week_end → 동일 주간 생성 core → 누락자만 생성
```

수동 생성이 된다고 자동 Cron이 정상인 것으로 판정하지 않는다.

---

## 11. Secret이 없어 자동 Cron 완료가 불가능한 경우

다음처럼 상태를 분리한다.

```text
주간 계산: PASS
수동 생성: PASS
자동 Cron: BLOCKED — BATCH_SECRET 부재
```

Secret을 임의 생성하거나 노출하지 않는다.

---

## 12. 보안

- Service Role Key 하드코딩 금지
- BATCH_SECRET 평문 하드코딩 금지
- 토큰 로그 출력 금지
- 임시 파일 Secret 저장 금지
- 기존 Production Secret/환경변수만 사용
- 실제 아이 대화 원문 출력 금지
- ID 마스킹

---

## 13. 기존 정상 데이터 보호

수정하지 않는다.
- 기존 정상 weekly_summaries
- daily_reports
- raw/corrected conversations
- memory
- LLM Wiki
- 완료된 과거 정상 주간 리포트

---

## 14. 필수 테스트

- 8/15 실행 → 8/8~8/14
- 8/22 실행 → 8/15~8/21
- Production Cron 실제 존재/active/schedule 확인
- weekly-batch auth 확인
- Secret 없음이면 BLOCKER 판정
- 기존 존재자는 SKIP
- 누락자만 생성
- 중복 0
- 기존 weekly 유지
- daily 영향 없음
- 부모 주간 UI 정상
- 타입체크 PASS
- 빌드 PASS

---

## 15. 완료 기준

- [ ] 기존 029 완료/미완료 구분
- [ ] 토~금 boundary Production 기준 확인
- [ ] 생성기/API/UI 동일 기준 확인
- [ ] Production Cron 실제 존재 여부 확인
- [ ] Cron active 확인
- [ ] schedule `0 21 * * 5` 확인
- [ ] endpoint 확인
- [ ] 인증 Secret 상태 확인
- [ ] Secret 있으면 Cron 정상화
- [ ] Secret 없으면 자동 Cron BLOCKER 명확화
- [ ] 완료 주간 누락자 전체 재검사
- [ ] 누락자만 멱등 백필
- [ ] 기존 정상 weekly 미변경
- [ ] 중복 0건
- [ ] 타입체크 PASS
- [ ] 빌드 PASS

---

## 16. 실행 순서

1. Production 주간 코드 상태 확인
2. Dev boundary 테스트
3. 필요한 경우에만 코드 수정
4. 타입체크
5. 빌드
6. Production 배포
7. Production pg_cron 실제 조회
8. Secret dependency 확인
9. 가능한 경우 Cron 등록/활성화
10. 실제 등록값 재조회
11. 완료 주간 누락자 전체 검사
12. 누락자만 백필
13. DB 재검증
14. 부모 UI smoke test

---

## 17. 완료 보고

### 최종 판정
`PASS / PARTIAL / FAIL / BLOCKED`

### 029 상태 비교
| 항목 | 기존 목표 | 현재 상태 | 조치 | 최종 |
|---|---|---|---|---|
| 토~금 정책 | | | | |
| 생성기/API/UI 통일 | | | | |
| Production Cron 존재 | | | | |
| Cron active | | | | |
| Cron schedule | | | | |
| Cron auth | | | | |
| 누락 백필 | | | | |

### Cron
- Production project ref:
- Job 존재:
- active:
- schedule:
- endpoint:
- auth 준비:
- 최근 실행:
- 다음 실행:
- BLOCKER:

### 누락 검사
| 주간 | 생성 대상 | 기존 보유 | 누락 | 백필 성공 | 최종 누락 |
|---|---:|---:|---:|---:|---:|
| 2026-08-01~2026-08-07 | | | | | |
| 2026-08-08~2026-08-14 | | | | | |

### 최종 확인
- Production 주간 정책은 토요일~금요일인가?
- 생성기/API/UI 기준은 동일한가?
- `kbestie-weekly-batch` Job은 실제 존재하는가?
- Job은 active인가?
- schedule은 토요일 06:00 KST인가?
- Cron 인증 Secret이 준비돼 있는가?
- 자동 Cron은 실제 실행 가능한 상태인가?
- 완료 주간 누락자를 전체 검사했는가?
- 누락자는 모두 백필됐는가?
- 기존 정상 주간 리포트는 유지됐는가?
- 최종 중복은 0건인가?
- REQUEST 029 미완료 항목이 모두 해소됐는가?
