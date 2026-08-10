# 073 — Mission v3: 하루 1회 Goal-directed 자유대화형 미션

> 원본: `requests/073-mission-v3-single-daily-dynamic-conversation-master-request.md`
> 확정 스펙: `.omc/specs/deep-interview-073-mission-v3.md` (2라운드, 최종 ambiguity 8%, PASSED)
> 071(K Conversation Engine)이 Production 배포 완료 — 073은 그 위에 Mission 전용 Goal Layer만 얹는다.
> **(2026-08-10 대표님 정정 반영)** Phase 3 시간 게이트에 방학 기간 조건 추가, Phase 5를
> "30일 이벤트 신규 마이그레이션"에서 "기존 60 이벤트 target·progress 보존 + 089와 연동한
> +1 출처 전환"으로 전면 재정의. 상세는 각 Phase 절 참고.

## 실행 원칙 (스펙에서 그대로)

- **071/073 소유권 경계**: Persona·Memory·Action Selector·Safety·Response Generator는 073에
  절대 복제하지 않는다. `lib/k-conversation/`은 import만 한다. 073은 Adapter/Goal Layer
  (parent_questions/Conversation Goals/completion/reward/event/운영)만 소유한다.
- **비파괴적 마이그레이션**: `round1_day`/`round2_night`/`mission_progress`/`chat_sessions`/
  `mission_question_history`/raw·corrected conversations/reports/event progress/reward
  ledger는 UPDATE/DELETE/초기화 금지. additive만.
- **번들 컷오버**: Phase별 부분 Production 배포 금지. 모든 Dev Gate(BLOCKED/HIGH/MEDIUM
  0건) PASS 후 전체를 한 번에 전환.
- **Boredom 완료보상 규칙**: 조기종료 + 3/4 Goal 미달 → complete reward(+1) 미지급, start
  reward(+1)는 유지. 익일 재시작 가능.

## Phase 0 — 071 엔진 완성도 재확인 (읽기 전용)

**개발 주체**: Codex(read-only 감사)

`lib/k-conversation/`의 semanticTopicHistory/boredomDetection/actionSelector/
responseGenerator가 073 착수 시점 기준으로 실제 완성·안정 상태인지 확인. 각 모듈의
export 계약(함수 시그니처)을 정리해 Phase 1 Adapter가 그대로 가져다 쓸 수 있게 문서화.

## Phase 1 — Mission Adapter + Goal Engine 스켈레톤

**개발 주체**: Codex Sol(architecture-sensitive: 신규 핵심 엔티티 + 071 연동 계약)

- Conversation Goal 엔티티(goal_id, semantic_group, priority P0~P3, status
  SATISFIED/PARTIAL/DECLINED/SKIPPED, evidence_source, source_turn_id, confidence,
  satisfied_at, parent_question_id) 스키마 설계 — forward-only migration.
- Mission Session(daily_single) 시작 시 4개 Conversation Goal 생성, parent_questions
  P0을 최우선(출처 비노출)으로 포함하는 우선순위 로직.
- 한 발화가 여러 Goal을 동시 충족할 수 있는 판정 로직.
- Mission Adapter가 `lib/k-conversation/`의 Persona/Memory/Action Selector/Safety/
  Response Generator를 import만 해서 쓰는 얇은 레이어인지 확인(복제 금지).

## Phase 2 — 질문은행 840개 metadata + Semantic Topic History 연동

**개발 주체**: Codex(잡무성 대량 데이터 작업이나 로직 얽혀 있어 Terra 기본, 복잡하면 Sol)

- 기존 840문항에 semantic_group/cooldown_days/weekday_affinity/topic/conversation_style/
  fun_type/memory_usable/sensitivity/answer_mode/periodicity metadata 부여.
- semantic cooldown 동작(K가 먼저 반복 질문 금지, 아이가 먼저 꺼내는 건 제한 없음) —
  071 공통 Semantic Topic History 모듈과 연동, MISSION/FREE_CHAT mode 공유 확인.

## Phase 3 — Time Policy & Daily-Single 운영

**개발 주체**: Codex Sol(DB CHECK 제약 변경 포함)

- **시간 게이트(2026-08-10 대표님 정정)**: 평소엔 13:00~23:00 KST, **방학 기간에는
  10:00~23:00 KST**로 시작 가능 시각을 앞당긴다. 방학 판정은 `lib/plan/vacationSchoolContext.ts`의
  `getActiveVacationContext(child_id)`(테이블 `child_temporal_context`, status
  `VACATION_CONFIRMED`)를 그대로 재사용한다 — 073 전용 별도 방학 판정 로직을 새로
  만들지 않는다. `VACATION_CONFIRMED`가 아니면(SEMESTER/미확정 포함) 13:00 게이트를
  그대로 적용한다.
  - **BLOCKER 해소 완료(2026-08-10)**: Production에 `child_temporal_context` 테이블이
    아예 없어(`PGRST205`) 방학 판정이 항상 실패(fail-open으로 SEMESTER 폴백)하던
    상태였음을 확인. 관련 마이그레이션 3건(`20260806115500` 생성,
    `20260806043500` source_message_id 타입 수정, `20260806183000` anon/authenticated
    권한 회수 보안강화)을 Dev 최종 스키마와 대조해 의존성 순서(생성→타입수정→보안강화,
    파일명 시각순과 다름— 043500이 115500보다 나중에 적용된 이력)대로 Production에
    적용 완료. 컬럼/권한/정책 전부 Dev와 일치 확인됨. 이제 `getActiveVacationContext`가
    Production에서 정상 동작한다.
- `mission_progress.round_type` CHECK에 `daily_single` additive 추가(기존 값 유지).
- `mission_policy_version`(v2_dual/v3_single_daily) + `effective_at` — policy 이후만
  daily_single 생성, 이전 round1_day/round2_night 데이터는 그대로 보존.
- 당일 2번째 신규 미션 생성 차단, resume은 정상 허용.

## Phase 4 — Reward Idempotency + Boredom 보상 규칙 (2026-08-10 정정)

> **정정 사유**: 이전 버전이 "start reward(+1)/complete reward(+1), 하루 최대 2개"로
> 기술해 마스터 지시서(`requests/073-...-master-request.md` §16, 439~465행)와
> 충돌했다. 마스터 지시서가 단일 출처다 — **미션 시작 보상은 없다.** 하루 최대
> 2개는 "Mission +1 / Free Chat +1의 합계"이지 Mission 내부에서 2개가 아니다.
> claude-review-073-phase4(게이트①)가 실제 구현 대조로 이 drift를 발견했다.

**개발 주체**: Codex Sol(금전성 로직 — 089와 동일 신중도)

- **미션 시작 보상 없음.** Mission 정상 완료(Goal 4개 중 3개 이상 충족) 시에만 황금열쇠 +1.
- reward_type은 마스터 §16.3 정의를 그대로 따른다 — `MISSION_COMPLETE`(또는 기존
  코드베이스 네이밍과 정렬되는 동등 표현) 단일 종류만 Mission v3에 사용한다.
  Phase 1 초안이 만든 `mission_v3_start`/`mission_v3_complete` 2종 분리는 폐기한다.
- idempotency key: child_id+business_date+reward_type — retry/reopen 어떤 경로로도
  중복 지급 0건. **DB 레벨 검증(실제 유일 인덱스/RPC 실행)으로 증명할 것** — in-process
  mock만으로는 불충분(claude-review R5).
- **레거시 `mission_complete`(`finalize_mission_turn_v1`이 이미 지급)와 v3 `MISSION_COMPLETE`가
  같은 완료 이벤트에서 동시에 지급되지 않도록 상호 배제를 명시적으로 설계할 것**
  (claude-review R2 — 현재 두 경로가 서로의 quota를 모르는 상태로 이중지급 가능).
  073 Phase 5(Event 60 Compatibility)의 `effective_at` 컷오버 개념을 재사용해 전환
  시점 이전/이후를 가르는 방안을 우선 검토한다.
- Boredom 조기종료 + Goal 3/4 미달 → complete reward 미지급. (start reward가 없으므로
  "start reward만 유지" 개념 자체가 소멸한다.)
- 신규 CHECK 제약은 기존 FK(`gold_key_ledger_source_session_fk`, `ON DELETE SET NULL`)와
  충돌해 아이 계정 삭제를 깨뜨리지 않아야 한다(claude-review R3 — 089의 freechat CHECK가
  이미 이 문제를 피해 간 선례를 따를 것).
- `INSERT ... ON CONFLICT DO NOTHING RETURNING true INTO v_inserted` 패턴은 0행일 때
  plpgsql이 `false`가 아니라 `NULL`을 대입하므로 `IF NOT v_inserted THEN`이 아니라
  `IF NOT FOUND THEN`(또는 `IF v_inserted IS NOT TRUE THEN`)으로 판정할 것(claude-review R4).

## Phase 5 — Event 60 Compatibility / Existing Progress Preservation (2026-08-10 전면 재정의)

**개발 주체**: Codex Sol(금전성/이벤트 로직 — 089와 동일 신중도)

> **이전 버전 폐기**: "30일 이벤트 신규 마이그레이션", "신규 target=30", "기존
> 참여자 target=30+d(34/35 등 동적 계산)" 개념은 전부 폐기한다. 구현하지 않는다.
> **089(`089-mission-event-manual-adjustments.md`, 이미 Production 배포 완료,
> `dpl_9gP3sQwxLg1cCBctCvHSSzkfM7j9`)와 "별개 이벤트"가 아니라 그 연장선이다.**
> 089가 만든 `MISSION_COMPLETE`/`FREE_CHAT_DAILY_ENGAGEMENT` 하루 2회 구조를 Mission
> v3가 그대로 이어받는다.

**핵심 원칙**: 이벤트 Target은 기존과 동일하게 **60**을 유지한다. 기존 참여자의
현재 progress를 재계산·감소·초기화하지 않는다. Phase 5는 이벤트 목표값을 바꾸는
데이터 마이그레이션이 아니라, `effective_at` 시점을 기준으로 **+1의 출처만
"미션 I/II"에서 "Mission v3 + Free Chat v2"로 안전하게 교체**하는 작업이다.

### 정책

- `effective_at` **이전**: 기존 정책 그대로 인정 — `MISSION_I 완료 = 이벤트 +1`,
  `MISSION_II 완료 = 이벤트 +1`. 이미 쌓인 값은 그대로 보존(재작성 금지).
- `effective_at` **이후**: `MISSION_COMPLETE = 이벤트 +1/일 최대 1회`,
  `FREE_CHAT_DAILY_ENGAGEMENT = 이벤트 +1/일 최대 1회` — 하루 최대 이벤트 활동
  2개 구조를 그대로 유지(089와 동일 정책, 089 RPC/idempotency 로직 재사용 우선
  검토).
- 예: 전환 직전 `17/60`인 기존 참여자는 그대로 `17/60` 유지. 이후 Mission v3
  완료 시 `18/60`, 같은 날 Free Chat 유효대화 조건 충족 시 `19/60`.
- 신규 참여자도 Target은 동일하게 60이며, 30일 동안 `Mission 하루 최대 +1 +
  Free Chat 하루 최대 +1`로 최대 60 달성 구조를 유지한다(30일 윈도 개념 자체는
  유지 — 폐기 대상은 "동적 target 재계산"뿐).

### 지급 조건

- **Mission 이벤트 +1**: Goal 4개 중 의미 있는 Goal **3개 이상** 확보한 정상
  완료에서만 인정. 미션 시작 시점이나 Goal 2개 이하 Boredom 조기종료에는
  지급하지 않는다(Phase 4의 reward 3/4 기준과 동일 게이트 재사용).
- **Free Chat 이벤트 +1**: 황금열쇠 조건과 완전히 동일 — 의미 있는 아이 발화
  최소 3턴 + 세션 60초 이상 + spam/반복/reward farming 검증 통과. 단순 화면
  진입, 시간만 경과, 동일 문구 반복, 같은 날 두 번째 eligible Free Chat에는
  추가 이벤트를 지급하지 않는다.

### 스키마·idempotency

- 이벤트 activity source를 최소 `LEGACY_MISSION_ROUND_COMPLETE` /
  `MISSION_COMPLETE` / `FREE_CHAT_DAILY_ENGAGEMENT`로 구분 가능하게 설계한다.
  **기존 스키마와 089가 만든 ledger를 먼저 조사**해 additive/backward-compatible
  방식으로만 확장한다(신규 activity type으로 과거 기록을 재작성하는 UPDATE/DELETE
  금지).
- idempotency key 최소 `child_id + business_date + activity_type` —
  retry/refresh/resume/concurrent request에도 중복 카운트 0건.
- 황금열쇠와 이벤트는 같은 eligibility에서 각각 독립적으로 +1 처리하되, 한쪽
  성공·한쪽 실패 시 재시도로 일관성을 회복할 수 있도록 현재 transaction/RPC
  구조(089의 `record_mission_event_completion`/`complete_freechat_daily_engagement`
  계열)를 먼저 조사하고 가능한 한 원자적 또는 retry-safe하게 구현한다.

### UX (황금열쇠 팝업)

- Free Chat eligibility 충족 시 "황금열쇠를 받았습니다" 팝업은 **정확히 1회**
  표시. 현재 Free Chat `session_id`와 대화 맥락은 유지 — 세션 종료·홈 이동·
  이벤트 화면 이동 없이 팝업을 닫으면 같은 자유대화를 계속 이어갈 수 있어야
  한다.
- 같은 날 이미 Free Chat 보상/이벤트를 받은 이후에도 자유대화 자체는 계속
  가능하되, 추가 황금열쇠·추가 이벤트·추가 팝업은 발생하지 않는다.

### 관리자·Analytics

- legacy mission / Mission v3 / Free Chat activity source를 구분해 조회 가능하게
  한다.
- 누적 progress는 항상 `/60` 기준으로 표시. 100%를 초과하는 경우 **UI percentage만**
  100% cap 처리하고, 원본 count는 삭제·감소하지 않는다.

### Dev Gate (전부 PASS해야 Production 배포)

- 기존 progress 보존(재계산·감소·초기화 0건)
- Target 60 유지
- Mission +1/day, Free Chat +1/day 정확 동작
- 하루 총 event activity 최대 2 초과 0건
- retry/concurrency 중복 카운트 0건
- Free Chat farming(spam/반복/시간만 경과) 이벤트 지급 0건
- legacy 기간 데이터 조회 정상(과거 기록 훼손 없음)
- 관리자 화면에서 activity source 구분 표시 정상
- 기존 이벤트 보상 중복 지급 0건

하나라도 실패하면 Production 배포하지 않는다.

## Phase 6 — Cron/Data/Report/Admin 호환

**개발 주체**: Codex Sol(다수 파일 얽힌 통합 작업)

- Cron 하루 2회→1회 전환(미션 종료 후, 04:00 리포트 입력 전, retry-safe/idempotent).
- 관리자 페이지가 신규 daily_single과 과거 round1/round2를 모두 정상 조회.
- Daily/Weekly/Monthly/Detail Report가 round2 부재를 오류로 해석하지 않음.
- Analytics/KPI를 policy version 기준으로 분리 집계(인위적 2배/절반 왜곡 없음).

## Phase 7 — Dev 전체 E2E → 번들 컷오버 Production 배포

- TypeScript/unit/integration/production build PASS, DB/RLS/constraints PASS.
- 실제 사용자 흐름 + 회귀 테스트 PASS.
- **BLOCKED/HIGH/MEDIUM 0건 확인 후에만** 전체를 한 번에 Production 전환(부분 배포 금지).
- 완료 보고: 원본 지시서 형식 그대로(Mission/Reward/Event/Data-Report-Admin/Quality Gate
  Acceptance Criteria 전항목 체크).

## 진행 상태

- [x] Phase 0 — 071 엔진 읽기 전용 감사 및 Adapter 계약 문서화 완료 (2026-08-10)
- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5
- [ ] Phase 6
- [ ] Phase 7
