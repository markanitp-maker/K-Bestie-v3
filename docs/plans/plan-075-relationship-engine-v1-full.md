# 075 Relationship Engine V1 — 전체 구현 계획 (Phase 0 이후)

> 원본 요구사항: `requests/075-relationship-engine-v1-stage-grade-scenario-memory-events.md`
> 이 계획서는 그 문서의 요약이 아니라 실행 순서 재배치다. 각 Phase 착수 전 반드시 원문 해당 절을 다시 읽는다.

---

## Phase 0 — 완료 (커밋 9253836, Dev+Production 배포됨)

- `relationship_started_at` / `relationship_started_at_is_fallback` 컬럼 + 트리거 3종 + 백필 (`supabase/migrations/20260811270000_relationship_started_at.sql`)
- `lib/relationship/calendarStage.ts` — `calculateRelationshipCalendarStage()`: KST 기준 D-day → W1~W4 계산만. **§6~8의 `effective_stage`는 아직 없음** — 지금 존재하는 건 후보 상한선(calendar_stage) 계산뿐이다.
- 문서: `docs/plans/075-relationship-start-date.md`

### 이미 존재하는 인접 베이스라인 (075 요청서보다 먼저 있던 것, 075가 대체하지 않고 소비해야 함)

- `lib/relationship/relationshipContext.ts` (+test) — 커밋 `03c258d`. Profile + 최근 세션 턴 + Memory V3(`lib/memory/vectorRetrieval.ts`) fact를 합쳐 프롬프트 fragment 문자열 하나를 만드는 **단순 포매터**다. Stage/Scenario 개념이 전혀 없다 — 요청서 §15의 "Relationship Context Builder"가 요구하는 것의 극히 일부(Memory Pack 조립 부분)만 이미 구현돼 있다고 보면 된다. Phase 5는 이 파일을 **대체하지 말고 확장**한다.
- `lib/persona/gradeAdaptivePersona.ts` (+test) — 커밋 `d617a2a`. 학년별 어휘/문장 스타일 프래그먼트. §11 "Grade Strategy"의 상당 부분과 겹친다. Phase 2/3에서 이걸 그대로 재사용할지, `grade_strategies` 테이블로 옮길지 결정 필요(아래 Phase 2 참고).
- `lib/memory/vectorRetrieval.ts` — 071에서 만든 Memory V3 retrieval. §12 "새 memory DB 금지" 원칙의 유일한 source of truth.
- ⚠️ **선행 위험**: 메인 저장소 워킹트리에 073 연속작업으로 보이는 미커밋 코드(`lib/k-conversation/index.ts`의 `SafetyPreflightOptions`/`currentUtterancePersisted` 메커니즘, `app/api/mission/v3/*`, `lib/mission-v3/*`)가 아직 커밋도 폐기도 안 된 채 남아있다. Phase 5(세션 컨텍스트 빌더를 미션 세션 생성 경로에 배선)가 바로 이 파일들을 건드린다. **Phase 5 착수 전에 이 미결정 사항부터 해결(채택/폐기/재작성 판단)하거나, 최소한 격리 워크트리를 HEAD 기준으로 새로 파서 그 미커밋 코드와 섞이지 않게 해야 한다.**

---

## Phase 1 — DB 스키마: 관계 테이블 6종 (§9.1~9.7 중 나머지)

**하드룰 2 대상(DB 스키마 변경) — 이 Phase 단독으로 게이트①②를 받는다.** 개발 주체: Codex Sol(`gpt-5.6-sol`, high) — 여러 테이블이 얽힌 스키마 설계라 아키텍처 민감.

- 신규 migration 1개: `supabase/migrations/<timestamp>_relationship_engine_v1_schema.sql`
- 테이블: `relationship_stages`, `grade_strategies`, `relationship_stage_rules`, `relationship_scenarios`, `child_relationship_state`, `relationship_session_context`, `relationship_events` (필드는 원문 §9.1~9.7 그대로, 임의로 컬럼 추가/생략 금지)
- 제약: `relationship_scenarios`는 `(grade, stage_key)` 조합당 active 버전 1개만 허용하는 unique partial index(`WHERE active`). `relationship_events.event_key`에 idempotency unique constraint. `relationship_session_context`는 `session_id` 유니크.
- 모든 테이블 RLS enable + anon/authenticated GRANT ALL(프로젝트 컨벤션, AGENTS.md 기준 재확인).
- 완료조건: `supabase db push --linked --dry-run --include-all`로 충돌 없음 확인, 로컬에서 `migration list --linked` 0 pending까지는 아니어도 SQL 문법/제약 자체는 검증.

## Phase 2 — Seed: Grade Strategy 6 + Stage Rule threshold + Scenario Card 24개 (§10, §11, §9.3 seed)

개발 주체: Codex Terra(기본) — 순수 데이터 삽입.

- `grade_strategies` 6행: 기존 `lib/persona/gradeAdaptivePersona.ts`의 학년별 규칙을 1차 소스로 이관(내용을 새로 발명하지 않고 이미 승인된 값을 옮긴다).
- `relationship_stage_rules`: 원문 §9.3 — **승인된 threshold 숫자가 기획 문서에 없으므로 안전한 baseline을 seed하고 완료 보고에 실제값을 명시**(원문 §9.3 지시 그대로). 이 초기값 자체는 나중에 대표님이 config만 바꿔 조정 가능하다는 걸 완료 보고에 반드시 적는다.
- `relationship_scenarios` 24행(G1~G6 × W1~W4): `primary_goal`/`secondary_goal`/`strategy`/`response_style`은 원문 §10의 4단계 공통 목표("얘랑 이야기해도 괜찮네" 등)를 학년 톤에 맞게 조합. **완성 대사 대본 금지** — 목표/전략/금지패턴/기대이벤트 메타데이터만.
- 완료조건: 24 scenario × unique(grade, stage_key, active=true) 검증 쿼리로 중복 0건 확인.

## Phase 3 — effective_stage 엔진 (§6~8)

개발 주체: Codex Terra. 신규 파일: `lib/relationship/effectiveStage.ts` (+test).

- `calculateEffectiveStage(childId, calendarStage, rules)`: `relationship_stage_rules`에서 다음 단계 진입조건(대화횟수/대화일수/usable memory/shared memory/event count)을 조회해 `effective_stage <= calendar_stage`를 보장하며 W1→W4 단방향 진행만 계산(자동 downgrade 없음, 원문 §8).
- 실제 대화횟수/일수는 `chat_sessions`/`chat_messages`에서, memory count는 `lib/memory/vectorRetrieval.ts` 소비, event count는 Phase 1의 `relationship_events`에서 — **이 값들을 `child_relationship_state`에 복제 저장하지 않는다**(원문 §9.5 금지사항 그대로).
- 평가 결과를 `child_relationship_state`에 upsert(계산은 순수 함수, DB 쓰기는 별도 얇은 wrapper로 분리해 유닛테스트 용이하게).
- 완료조건: 유닛테스트로 W1→W2 진입조건 충족/미충족 각각, downgrade 없음, threshold 0건일 때 안전 기본값 케이스 커버.

## Phase 4 — Scenario Resolver (§9.4 연동)

개발 주체: Codex Terra. 신규 파일: `lib/relationship/scenarioResolver.ts` (+test).

- `resolveActiveScenario(grade, effectiveStage)` → `relationship_scenarios`에서 `active=true` 1건 조회. 0건/2건(제약 위반) 발생 시 안전 fallback(대화는 막지 않되 에러 로그) — Phase 1의 unique constraint가 이미 2건을 막지만 방어 코드는 유지.
- 완료조건: 24개 조합 전부 정확히 1건 resolve, active 버전 전환 시나리오(V1→V2) 테스트.

## Phase 5 — Session Context Builder 확장 + 배선 (§13, §15, §16)

**규모가 크고 파일이 겹치므로 5A/5B로 분리한다. 하드룰 2(다른 모듈에 영향 큰 변경) 대상 — 이 Phase는 발생 즉시 게이트.**

### 5A — Context Builder 확장 (모듈 자체)
- `lib/relationship/relationshipContext.ts`를 새 시그니처로 확장(파괴적 변경이면 기존 호출부도 같은 PR에서 갱신): calendar_stage/effective_stage(Phase 3) + Scenario Card(Phase 4) + Grade Strategy(Phase 2) + 기존 Memory Pack 로직 + `relationship_memory_pack_limit` config값 반영.
- 세션 시작 시 1회만 조회, **세션 동안 effective_stage·scenario version 고정**(원문 §4 "세션 도중 안 바뀜") — 조회 결과를 세션 컨텍스트 객체에 캐싱하는 방식으로 구현, 매 턴 재조회 금지.
- `relationship_session_context` 행 기록(session_id 유니크, 중복 생성 방지).
- 우선순위 프롬프트 반영(원문 §16): 현재 발화 > 안전정책/Persona > Scenario > Memory > Play/Reward. 기존 `formatRelationshipContext()`의 "사용 규칙" 블록에 이 우선순위를 명시적으로 추가.

### 5B — 미션/자유대화 세션 생성 경로 배선
- Free Chat: 자유대화 세션 시작 지점(`lib/k-conversation/` 진입부, 071에서 이미 만든 어댑터)에서 5A의 확장 builder 호출로 교체.
- Mission: 미션 세션 시작 지점(073에서 만든 `app/api/mission/v3/start/route.ts` 등)에서 동일 연결. **위 Phase 0 경고 사항(orphaned 073 코드)이 해결된 뒤 착수.**
- 완료조건: 미션+자유대화 각각 실제 세션 1건씩 만들어 `relationship_session_context` 행 생성 확인, 세션 중 두 번째 턴에서 effective_stage/scenario_version이 첫 턴과 동일한지 확인(캐싱 검증).

## Phase 6 — on-demand Memory Retrieval (§14)

개발 주체: Codex Terra.

- 기존 Gemini Live tool/function calling 컨벤션 확인 후(추측 금지, 원문 §14) `retrieve_child_memory(query, memory_types)` 형태의 tool 추가.
- 아이가 "전에 말한 거 기억나?" 류의 명시적 요청을 했을 때만 호출, 매 발화 호출 금지.
- retrieval 실패가 Live 세션을 종료시키지 않도록 catch.
- 완료조건: tool 호출 성공/실패(네트워크 에러) 각각 세션이 끊기지 않고 이어지는지 유닛/통합 테스트.

## Phase 7 — Relationship Events 기록 (§17~22)

개발 주체: Codex Terra.

- Deterministic 이벤트(`child_started_free_chat`, `direct_open`, `notification_entry`, `reward_entry`, `play_to_chat`, `returned_after_gap`)를 각 진입 지점(자유대화 시작 route, 알림 클릭 핸들러, 보상 화면 진입 등 기존 코드에서 이미 구분 가능한 지점)에서 기록. `returned_after_gap`의 gap threshold는 config화(하드코딩 금지).
- 의미판단 이벤트(`memory_used`, `memory_acknowledged`, `child_referenced_past`)는 **LLM judge를 매 턴 호출하지 않고** Phase 6의 tool 호출 여부 같은 기존 runtime metadata로 명확히 판단 가능할 때만 기록, 불명확하면 기록 안 함(원문 §20 — false negative가 false positive보다 낫다).
- `event_key` idempotency 실제 동작 확인(같은 논리 이벤트 재시도 시 중복 저장 0건).
- 완료조건: 6종 deterministic 이벤트 각각 실제로 1회 이상 트리거 후 DB 행 생성 확인, 동일 이벤트 재시도 시 중복 없음.

## Phase 8 — QA (원문 QA1~QA18, §1200~1348줄)

게이트②(agy 또는 Codex E2E) 필수 — 아이 대화 경험에 직접 영향. Dev 배포된 실제 URL 대상으로 QA테스트/Dev QA 계정(`qatesti-dev`)으로 실행. §12-F(인프라 제약 시 미검증 명시) 원칙 그대로 적용.

- 원문 QA1~18 항목을 그대로 시나리오로 사용(calendar_stage, effective_stage cap, no downgrade, threshold config, scenario selection/uniqueness, session version freeze, memory preload/no-memory/on-demand, current utterance priority, session context persistence, event idempotency/deterministic/semantic, fail-open, Memory V3 only, 기존 파이프라인 회귀).
- 완료조건: 18개 항목 각각 통과/미검증(사유)/실패 중 하나로 명시적 판정.

## Phase 9 — Dev 검증 종합 + Production 배포 (§10 Production Verification)

- Phase 1~8 전부 게이트 통과 후 Dev 배포(하드룰 7 자동), 1~6학년 × W1~W4 조합 최소 샘플(전부 24개는 아니어도 각 학년 1개 stage 이상) 실사용 시나리오로 회귀 확인.
- Production 배포는 기존 관행대로 대표님 확인 후 진행(또는 이미 부여된 전체 파이프라인 자동 승인 범위 안이면 자동 진행) — `_log.md`/`_dashboard.md` 갱신, `requests/075-*.md` `_done` 이동.

---

## 규모 요약

| Phase | 신규/수정 파일 수(추정) | 예상 시간 |
|---|---|---|
| 1 (DB 스키마) | 1 migration | 30~45분 |
| 2 (Seed) | migration 또는 script 1~2 | 20~30분 |
| 3 (effective_stage) | 2 (+test) | 30~45분 |
| 4 (Scenario Resolver) | 2 (+test) | 20~30분 |
| 5A (Context Builder 확장) | 2 (기존 파일 확장) | 45~60분 |
| 5B (배선) | 3~5 (미션/자유대화 경로) | 45~60분(073 정리 여부에 따라 변동) |
| 6 (on-demand retrieval) | 2~3 | 30~45분 |
| 7 (Events) | 3~5 (여러 진입점) | 45~60분 |
| 8 (QA) | 없음(테스트 실행) | 60~90분 |
| 9 (Dev/Prod 배포) | 없음 | 30분 |

**총 9 Phase, 신규/수정 파일 약 20~25개, 순차 진행 시 총 6~8시간 규모(병렬화 가능 구간: Phase 2/3/4는 서로 독립이라 동시 위임 가능).**
