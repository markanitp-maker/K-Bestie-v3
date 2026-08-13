# 075 Relationship Engine V1 — 최소 스키마 재설계

> 상태: 최소 스키마 방향 대표 승인, 구현 전 3조건 반영 설계안. 이 문서는 SQL 실행·마이그레이션 생성·제품 코드 수정을 수행하지 않는다.
> 기준 원 지시서: `requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md`
> 전제 교정: 원 지시서의 7개 항목은 **개념적으로 필요한 저장 구조**이며 테이블 7개 생성 지시가 아니다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:538-578`).
> 핵심 결론: **개념 구조 7개를 기존 config/테이블에 모두 흡수해 신규 테이블은 0개로 한다.** 기존 테이블 3개에 최소 컬럼만 추가하고 Memory V3를 그대로 재사용한다.

## 1. 7개 개념 구조 흡수 심사표 (대표 제출용)

원 지시서는 DB 추가 전 기존 역할과의 중복을 확인하고, 실제 테이블명·필드를 Repository convention 기준으로 최소 설계하라고 한다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:538-582`). 신규 Memory System과 중복 테이블도 금지한다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:586-641`). 따라서 아래 이름은 확정 테이블명이 아니라 **신규 테이블 후보로 가정해 반증하는 심사 대상**이다.

### 기존 config·스키마 흡수 근거

- 정적 등록부 + 서버 환경변수 override 패턴이 이미 있다. `lib/llm/modelRouter.ts`는 readonly 역할별 기본값과 환경변수 키를 함께 정의하고 환경변수를 우선 적용한다(`lib/llm/modelRouter.ts:1-75`). 단일 기능 flag도 서버 환경변수로 관리한다(`lib/questions/feature-flags.ts:1-17`). 배포 시 불변 version을 올리는 TS config 패턴도 있다(`lib/events/announcementConfig.ts:1-4`).
- 기존 DB 설정 테이블 `provider_switch_settings`는 A/B/C provider와 model 전환만을 위한 좁은 스키마다(`supabase/migrations/20260714000000_provider_switch_settings.sql:4-16`). 여기에 stage threshold를 넣으려면 필수 `provider/model_id` 의미를 깨뜨리므로 흡수 대상이 아니다.
- 동적 상태는 자연스러운 기존 소유자가 있다. 아이 1:1 상태는 `child_profiles`, 세션 1:1 freeze는 `chat_sessions`, append-only 행동 사실은 `behavior_events`가 이미 같은 식별자·증가율·조회·RLS 패턴을 가진다.

| 신규 테이블명 | 저장 목적 | 읽기 주체 | 쓰기 주체 | 기존 구조로 대체 불가한 이유 |
|---|---|---|---|---|
| `relationship_stages` 후보 | W1~W4 키·순서·의미 정의 | calendar/effective-stage 계산기, Scenario resolver | 릴리스 시 config 관리자 | **대체 불가 사유 없음.** 단계 집합은 이미 `RelationshipCalendarStage`와 W1~W4 계산으로 고정돼 있다(`lib/relationship/calendarStage.ts:1-44`). readonly `STAGE_DEFINITIONS`로 흡수하면 행 증가·RLS·운영 CRUD가 모두 불필요하다 |
| `grade_strategies` 후보 | G1~G6별 어휘·문장·질문·감정·기억 사용 전략 | K Conversation persona/context builder | 학년 전략 릴리스 담당자 | **대체 불가 사유 없음.** G1~G6 다필드 전략과 resolver/formatter가 이미 있다(`lib/k-conversation/gradePersonas.ts:10-47`, `lib/k-conversation/gradePersonas.ts:254-302`). DB 복제를 금지한 기존 의도도 명시돼 있다(`lib/persona/gradeAdaptivePersona.ts:18-21`) |
| `relationship_stage_rules` 후보 | 단계별 숫자 threshold, active, version | effective-stage 계산기, session initializer | 대표 승인값을 운영 환경변수에 반영하는 배포 주체 | **대체 불가 사유 없음.** 원 지시서는 DB/config를 모두 허용하며 숫자 rule만 요구한다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:229-252`). 기존 env override 패턴에 맞춘 server-only JSON config + 엄격한 parser로 migration·앱 코드 수정 없이 값/version을 바꿀 수 있다. 미승인 숫자는 설정하지 않는다 |
| `relationship_scenarios` 후보 | 4 stage × 6 grade의 실제 24개 목표·전략 카드와 version | Scenario resolver, Relationship Context Builder | Scenario config 릴리스 담당자 | **대체 불가 사유 없음.** 24개는 유한한 전략 config이며 대본이 아니다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:275-318`). 승인된 24개 객체를 immutable TS registry에 명시하고 기존 `GRADE_PERSONAS` 의도를 카드 문구에 반영하되, runtime 합성으로 카드를 대신하지 않는다 |
| `child_relationship_state` 후보 | 아이별 effective stage floor와 적용 rule version | session initializer, effective-stage 계산기 | service-role 관계 상태 adapter(실제 stage 상승 때만) | **대체 불가 사유 없음.** `child_profiles`와 정확히 1:1이고 관계 시작일도 이미 그 테이블이 소유한다(`supabase/migrations/20260811270000_relationship_started_at.sql:4-17`). 기존 count를 복제하지 말라는 원칙(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:573-577`)에 따라 3개 상태 컬럼만 확장한다 |
| `relationship_session_context` 후보 | 세션 동안 stage/scenario/grade version/Memory reference freeze | Mission·Free Chat·Gemini Live context builder, QA/admin 추적 | service-role session initializer(세션당 최초 1회) | **대체 불가 사유 없음.** `chat_sessions`와 정확히 1:1이고 항상 session PK로 읽는다. 기존 세션은 이미 child FK와 수명주기를 소유한다(`supabase/migrations/20260609400000_family_clean_slate.sql:106-114`). `relationship_context JSONB` write-once 컬럼으로 흡수한다 |
| `relationship_events` 후보 | 관계 행동 사실과 logical event idempotency | effective-stage 집계기, QA/admin 분석 | 확실한 entry route와 runtime/tool metadata producer | **대체 불가 사유 없음.** `behavior_events`가 이미 event name, child/session, 시각, JSONB metadata와 service-role RLS를 갖는다(`supabase/migrations/20260736000000_behavior_events.sql:4-44`). 기존 `freechat_start`도 이미 기록된다(`app/api/chat/session/route.ts:63-73`). `event_key`와 index만 확장하고 의미가 같은 행은 중복 생성하지 않는다 |

표의 5개 컬럼을 유지하면서 원 심사 기준의 판정을 분리해 적으면 다음과 같다.

- **JSONB·config 파일로 대체:** `relationship_stages`, `grade_strategies`, `relationship_stage_rules`, `relationship_scenarios`
- **기존 테이블 확장:** `child_relationship_state` → `child_profiles`, `relationship_session_context` → `chat_sessions`, `relationship_events` → `behavior_events`
- **독립 테이블 필수:** 없음
- **불필요(삭제):** 개념 자체를 삭제할 항목은 없음. 다만 위 7개 이름의 **신규 독립 테이블 생성안**은 전부 삭제한다

**최소 신규 테이블 제안: 0개.** 설정성 4개는 기존 TS/env config 패턴, 동적 3개는 `child_profiles`·`chat_sessions`·`behavior_events` 확장으로 대체한다. 위 5열 심사표에서 “대체 불가한 이유”가 성립하는 후보가 하나도 없으므로 새 테이블을 제안하지 않는다.

정적 설정을 테이블로 승격하는 조건은 명확히 제한한다. 대표/운영자가 **배포 없이** 수시로 편집해야 하거나, 동시에 둘 이상의 active variant를 운영하거나, DB 수준 변경자·변경시각 감사가 필요해질 때다. 현재는 어느 요구도 확인되지 않았고 `gradePersonas.ts`가 이미 같은 유형의 승인 전략을 TS 상수로 운영한다.

실제 runtime 흐름은 `세션 시작 → child_profiles의 관계 시작일/저장 floor와 config를 읽음 → 기존 Memory V3·chat_sessions·behavior_events에서 필요한 사실을 읽음 → 순수 함수로 calendar/effective stage와 Scenario를 1회 resolve → chat_sessions.relationship_context를 최초 1회 씀 → 기존 Relationship Context Builder가 snapshot과 Memory 참조를 읽음`이다. 세션 중에는 확실한 행동 사실만 `behavior_events`에 append하고, 다음 세션 시작 시 집계해 stage가 실제 상승한 경우에만 `child_profiles` floor를 갱신한다. 정적 config에는 runtime row write가 없고, Memory 본문 write는 끝까지 기존 Memory V3만 담당한다.

## 2. 최소 스키마 확정안

**확정 결과: 개념 저장 구조 7개 → 신규 테이블 0개, 기존 3개 테이블 확장 + 기존 패턴을 따르는 TS/env config.**

### 2.1 config 계약(비DB)

향후 `lib/relationship/relationshipConfig.ts`가 schema/default를 소유하고, 운영 threshold만 server-only 환경변수로 override한다. 이는 readonly 기본 등록부 + env override를 결합한 기존 `modelRouter` 패턴(`lib/llm/modelRouter.ts:1-75`)을 관계 도메인에 적용하는 것이다.

- `STAGE_DEFINITIONS`: W1~W4 순서, 의미, stage config version.
- `RELATIONSHIP_ENGINE_CONFIG_JSON` + `RELATIONSHIP_ENGINE_CONFIG_ACTIVE_VERSION`: server-only 환경변수다. JSON은 `{versions}` registry이고 별도 active-version 값이 그중 하나를 선택한다. W1은 무조건적인 baseline이라 숫자 rule을 두지 않는다. W2~W4 rule은 `{active:false}` 또는 `{active:true, minConversationCount, minConversationDays, minUsableMemoryCount, minSharedMemoryCount, minRelationshipEventCount}`의 discriminated schema이고, version 공통으로 `memoryPackLimit`과 nullable `returnedAfterGapDays`를 둔다. 엄격한 parser는 unknown key를 거부하고 active rule의 threshold는 non-negative integer, Memory limit은 positive integer, version key/본문 일치와 active version 존재를 검증한다. 환경변수가 없거나 invalid면 기존 Memory loader의 상한 5 동작(`lib/relationship/relationshipContext.ts:67-67`, `lib/k-conversation/memory/longTerm.ts:14-14`)을 그대로 사용하고, 코드에 대체 수치를 넣지 않은 채 W2~W4와 `returned_after_gap`을 비활성화하며 오류를 남긴다.
- threshold 변경 시 기존 version을 덮어쓰거나 삭제하지 않고 registry에 새 version을 추가한 뒤 active 포인터만 바꾼다. session의 `stage_rule_version`으로 당시 값을 재현할 수 있도록, 이미 snapshot에서 참조된 version은 환경 config에도 보존한다. 이 방식이면 migration이나 application code 수정 없이 승인된 숫자/version을 전환할 수 있다.
- `SCENARIO_CARDS`: [승인 Scenario Card 24종](./plan-075-relationship-scenario-cards.md)의 G1~G6 × 4 Stage 객체를 **24개 모두 명시적으로** 소유하는 immutable TS registry다. 각 객체는 `primaryGoal`, `secondaryGoal`, `strategy`, `recommendedMemoryTypes`, `forbiddenPatterns`, `responseStyle`, `expectedEvents`, `version`을 빠짐없이 가진다. `GRADE_PERSONAS`는 승인 문구의 근거와 공통 formatter 재사용 대상일 뿐, runtime에서 4개 Stage template과 조합해 카드 본문을 생성하지 않는다.
- `GRADE_STRATEGY_VERSION`: 기존 `GRADE_PERSONAS` 내용의 배포 version 표식이다. 학년 전략 내용을 바꾸는 배포는 이 값을 함께 올리며, 전략 본문 자체는 별도 config/table에 복제하지 않는다.
- `RELATIONSHIP_SCENARIO_ACTIVE_VERSION`: server-only 환경변수로 bundled immutable scenario version 중 하나만 가리킨다. 새 내용은 새 TS version 추가가 필요하지만, 이미 배포된 version 간 active 전환에는 DB 변경이 없다.
- `resolveScenario(grade, stage)`: `{grade, effectiveStage, activeVersion}`으로 이미 명시된 카드 중 정확히 하나를 조회할 뿐 콘텐츠를 합성하지 않는다. 반환값에 `scenarioId`, `scenarioVersion`, `grade`, `gradeStrategyVersion`과 승인된 8필드를 포함한다. active version이 없거나 조합이 정확히 하나가 아니면 기존 대화 builder로 fail-open하되 Relationship Engine의 snapshot/event/state 쓰기는 시작하지 않고 오류를 남긴다.
- version이 배포된 뒤 같은 version 객체를 제자리 수정하지 않는다. 변경은 새 version 추가 + active 포인터 변경으로만 한다.
- `provider_switch_settings`는 provider/model 전용이므로 수정하지 않는다(`supabase/migrations/20260714000000_provider_switch_settings.sql:4-16`). 관계 설정을 넣기 위한 generic settings table도 새로 만들지 않는다.

이 방식은 24개 대본이나 신규 엔진을 만들지 않으면서도 **실제 24개 승인 카드**와 정확히 1개 lookup, 세션 version freeze를 충족한다. 기존 builder도 이미 profile·검증된 session·Memory 조회를 한 번에 조합하므로(`lib/relationship/relationshipContext.ts:150-184`) 이를 확장하고 새 Conversation Engine은 만들지 않는다.

### 2.2 Stage threshold 하드코딩 0건 검증 계약

- 다섯 Stage threshold와 `returnedAfterGapDays`의 **실제 숫자는 오직** server-only `RELATIONSHIP_ENGINE_CONFIG_JSON`에만 존재한다. `lib/relationship/**`, `app/**`, `services/**`의 production code에는 이 필드들의 numeric default·fallback·상수를 두지 않는다.
- safe default는 숫자 `0`을 넣어 조건을 우회하지 않고 W2~W4를 `{active:false}`로 만든다. `returnedAfterGapDays`도 값이 없으면 event를 비활성화한다. 기존 Memory pack limit 5는 Stage 진입 수치가 아니며 기존 loader 동작을 그대로 재사용한다.
- config parser는 JSON 구조·정수 범위·active version만 검증한다. 값 변경은 환경변수 registry에 immutable version 추가 → `RELATIONSHIP_ENGINE_CONFIG_ACTIVE_VERSION` 전환으로 끝나며 application code와 migration을 수정하지 않는다.
- 구현 정적 리뷰에서는 아래 검색 결과가 production code 기준 **0건**이어야 한다. 테스트 fixture의 경계값은 `*.test.ts`에만 허용한다.

```bash
rg -n --glob '!*.test.ts' \
  '(minConversationCount|minConversationDays|minUsableMemoryCount|minSharedMemoryCount|minRelationshipEventCount|returnedAfterGapDays)\s*:\s*[0-9]+' \
  lib/relationship app services
```

- 검색 우회도 금지한다. 배열 위치값, 별도 이름의 상수, `?? 0`, `Number(env) || <숫자>`처럼 같은 threshold를 다른 문법으로 넣는 행위는 정적 리뷰에서 동일한 하드코딩으로 판정한다.
- 실제 Stage threshold와 `returnedAfterGapDays` 값은 아직 미승인이다. 따라서 설계상 구조는 충족하지만 승인 JSON이 공급되기 전 runtime은 safe default를 유지한다.

### 2.3 DDL 초안(문서용, 실행 금지)

아래는 승인 후 단일 additive migration으로 옮길 초안이다. 이번 작업에서는 실행하거나 migration 파일로 만들지 않는다.

```sql
BEGIN;

-- 1) child_relationship_state -> child_profiles 1:1 확장
ALTER TABLE public.child_profiles
  ADD COLUMN IF NOT EXISTS relationship_effective_stage text,
  ADD COLUMN IF NOT EXISTS relationship_effective_stage_rule_version text,
  ADD COLUMN IF NOT EXISTS relationship_stage_advanced_at timestamptz;

ALTER TABLE public.child_profiles
  ADD CONSTRAINT child_profiles_relationship_effective_stage_check
  CHECK (
    relationship_effective_stage IS NULL
    OR relationship_effective_stage IN ('W1', 'W2', 'W3', 'W4')
  ),
  ADD CONSTRAINT child_profiles_relationship_state_completeness_check
  CHECK (
    (relationship_effective_stage IS NULL
      AND relationship_effective_stage_rule_version IS NULL
      AND relationship_stage_advanced_at IS NULL)
    OR
    (relationship_effective_stage IS NOT NULL
      AND relationship_effective_stage_rule_version IS NOT NULL
      AND relationship_stage_advanced_at IS NOT NULL)
  );

-- child_id PK 조회에 함께 읽으므로 새 index 불필요.
-- count/memory/event 집계값은 이 테이블에 저장하지 않는다.

-- 2) relationship_session_context -> chat_sessions 1:1 JSONB 확장
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS relationship_context jsonb;

ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_relationship_context_check
  CHECK (
    relationship_context IS NULL
    OR (
      jsonb_typeof(relationship_context) = 'object'
      AND relationship_context ?& ARRAY[
        'schema_version', 'calendar_stage', 'calendar_stage_source', 'effective_stage',
        'stage_rule_version', 'scenario_id', 'scenario_version',
        'grade', 'grade_strategy_version', 'memory_refs', 'entry_source', 'frozen_at'
      ]
      AND COALESCE(
        relationship_context->>'schema_version' = '1'
        AND relationship_context->>'calendar_stage' IN ('W1', 'W2', 'W3', 'W4')
        AND relationship_context->>'calendar_stage_source' IN (
          'relationship_started_at', 'provisional_null', 'provisional_fallback'
        )
        AND relationship_context->>'effective_stage' IN ('W1', 'W2', 'W3', 'W4')
        AND array_position(
          ARRAY['W1', 'W2', 'W3', 'W4'],
          relationship_context->>'effective_stage'
        ) <= array_position(
          ARRAY['W1', 'W2', 'W3', 'W4'],
          relationship_context->>'calendar_stage'
        )
        AND jsonb_typeof(relationship_context->'grade') = 'number'
        AND relationship_context->>'grade' IN ('1', '2', '3', '4', '5', '6')
        AND jsonb_typeof(relationship_context->'stage_rule_version') = 'string'
        AND length(relationship_context->>'stage_rule_version') > 0
        AND jsonb_typeof(relationship_context->'scenario_id') = 'string'
        AND length(relationship_context->>'scenario_id') > 0
        AND relationship_context->>'scenario_id' =
          'G' || relationship_context->>'grade' || '_' ||
          CASE relationship_context->>'effective_stage'
            WHEN 'W1' THEN 'MEET'
            WHEN 'W2' THEN 'REMEMBER'
            WHEN 'W3' THEN 'SHARED_HISTORY'
            WHEN 'W4' THEN 'VOLUNTARY_RETURN'
          END
        AND jsonb_typeof(relationship_context->'scenario_version') = 'string'
        AND length(relationship_context->>'scenario_version') > 0
        AND relationship_context->>'scenario_version' ~ '^v[1-9][0-9]*$'
        AND jsonb_typeof(relationship_context->'grade_strategy_version') = 'string'
        AND length(relationship_context->>'grade_strategy_version') > 0
        AND jsonb_typeof(relationship_context->'frozen_at') = 'string'
        AND length(relationship_context->>'frozen_at') > 0
        AND jsonb_typeof(relationship_context->'memory_refs') = 'array'
        AND relationship_context->>'entry_source' IN (
          'direct_open', 'notification', 'reward', 'play', 'parent_trigger', 'unknown'
        )
        AND (
          relationship_context->>'calendar_stage_source' = 'relationship_started_at'
          OR (
            relationship_context->>'calendar_stage' = 'W1'
            AND relationship_context->>'effective_stage' = 'W1'
          )
        ),
        false
      )
    )
  );

CREATE OR REPLACE FUNCTION public.protect_chat_session_relationship_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.relationship_context IS NOT NULL
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'relationship_context_service_role_only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 같은 JSONB 재시도는 no-op으로 허용한다.
  IF NEW.relationship_context IS NOT DISTINCT FROM OLD.relationship_context THEN
    RETURN NEW;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'relationship_context_service_role_only' USING ERRCODE = '42501';
  END IF;

  -- NULL -> snapshot 최초 1회 외 수정/삭제는 service_role도 금지한다.
  IF OLD.relationship_context IS NOT NULL THEN
    RAISE EXCEPTION 'relationship_context_is_write_once' USING ERRCODE = '22000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_chat_session_relationship_context()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_chat_session_relationship_context
  ON public.chat_sessions;
CREATE TRIGGER trg_protect_chat_session_relationship_context
BEFORE UPDATE OF relationship_context ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_chat_session_relationship_context();

DROP TRIGGER IF EXISTS trg_protect_chat_session_relationship_context_on_insert
  ON public.chat_sessions;
CREATE TRIGGER trg_protect_chat_session_relationship_context_on_insert
BEFORE INSERT ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_chat_session_relationship_context();

-- 세션 PK로만 조회하고 세션당 최대 1개이므로 JSONB GIN/expression index 불필요.
-- calendar_stage_source가 provisional_*이면 calendar_stage/effective_stage는 W1만 허용.
-- memory_refs 원소 계약: {"source":"memory_facts"|"child_memory","id":"uuid"}
-- Memory content/evidence/prompt 원문은 relationship_context에 저장 금지.

-- 3) relationship_events -> behavior_events 확장
ALTER TABLE public.behavior_events
  ADD COLUMN IF NOT EXISTS event_key text;

ALTER TABLE public.behavior_events
  DROP CONSTRAINT IF EXISTS behavior_events_feature_check;

ALTER TABLE public.behavior_events
  ADD CONSTRAINT behavior_events_feature_check CHECK (feature IN (
    'auth', 'home', 'mission', 'freechat', 'play', 'daily_report',
    'weekly_report', 'monthly_report', 'conversation_topic',
    'child_management', 'guardian_settings', 'subscription', 'app_session',
    'relationship'
  )),
  ADD CONSTRAINT behavior_events_relationship_contract_check CHECK (
    feature <> 'relationship'
    OR (
      child_id IS NOT NULL
      AND event_key IS NOT NULL
      AND event_name IN (
        'memory_used', 'memory_acknowledged', 'child_referenced_past',
        'direct_open', 'notification_entry',
        'reward_entry', 'play_to_chat', 'returned_after_gap'
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS behavior_events_event_key_uq
  ON public.behavior_events(event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS behavior_events_idempotent_child_name_time_idx
  ON public.behavior_events(child_id, event_name, occurred_at DESC)
  WHERE event_key IS NOT NULL;

-- 기존 RLS 유지 + 프로젝트 GRANT 규약 재확인.
GRANT ALL ON public.child_profiles TO anon, authenticated;
GRANT ALL ON public.chat_sessions TO anon, authenticated;
GRANT ALL ON public.behavior_events TO anon, authenticated;
GRANT ALL ON public.behavior_events TO service_role;

COMMIT;
```

### 2.4 FK·RLS·쓰기 보호

- `child_profiles`: 새 FK는 없다. 아이 자체의 1:1 상태이며 기존 PK로 읽는다. 기존 family membership RLS가 있다(`supabase/migrations/20260609400000_family_clean_slate.sql:264-299`). 075가 이미 추가한 `relationship_started_at`과 `relationship_started_at_is_fallback`을 그대로 Source of Truth로 재사용한다(`supabase/migrations/20260811270000_relationship_started_at.sql:4-17`). source는 별도 중복 컬럼을 추가하지 않고 `NULL=pending`, `fallback=true=created_at 임시값`, `non-null + fallback=false=최초 정상 왕복 실제값`으로 해석한다. 기존 보호 trigger가 실제값의 불변성과 fallback→실제값 전환만 허용한다(`supabase/migrations/20260811270000_relationship_started_at.sql:377-439`). 새 관계 상태 3개 컬럼도 같은 방식의 service-role-only trigger로 보호한다.
- `chat_sessions`: 기존 `child_id → child_profiles(id) ON DELETE CASCADE` FK(`supabase/migrations/20260609400000_family_clean_slate.sql:106-114`)와 family RLS(`supabase/migrations/20260609400000_family_clean_slate.sql:367-387`)를 재사용한다. `relationship_context.calendar_stage_source`가 `relationship_started_at | provisional_null | provisional_fallback` 중 실제 세션 시작 source를 동결한다. §2.3의 trigger는 service-role의 `NULL → JSONB` 최초 1회와 동일 JSONB no-op retry만 허용하고, 이후 수정·삭제는 service-role에도 거부한다.
- `behavior_events`: 기존 `child_id → child_profiles(id) ON DELETE SET NULL` FK를 유지한다(`supabase/migrations/20260736000000_behavior_events.sql:8-11`). `session_id`는 여러 종류의 세션을 가리키는 기존 polymorphic 컬럼이라 FK를 새로 강제하지 않는다. 기존 service-role-only RLS를 유지하고 anon/authenticated에는 정책을 추가하지 않는다. `event_key`는 `relationship:<event_name>:<child_id>:<logical-source-id>`처럼 namespace를 포함해야 하며, 새 관계 이벤트뿐 아니라 동일한 기존 `freechat_start` writer에도 부여해 중복 row 없이 retry를 막는다.
- 원 `behavior_events`에는 UNIQUE constraint/index가 없고 기존 5개 index가 모두 일반 index다(`supabase/migrations/20260736000000_behavior_events.sql:29-33`). 따라서 §2.3의 `behavior_events_event_key_uq ... WHERE event_key IS NOT NULL`이 logical key에 DB-level uniqueness를 부여하는 유일한 장치다. `feature='relationship'` 행은 CHECK로 non-null `event_key`를 강제하므로 동일 key의 동시 insert/retry 중 하나만 성공하고 나머지는 unique violation이 된다. writer는 이 충돌을 “이미 기록됨”으로 처리해야 하며 timestamp를 새 key로 만들어 우회하면 안 된다.
- **feature 선택은 혼합 방식으로 확정한다.** 최신 allow-list에도 `relationship`은 없으므로(`supabase/migrations/20260810120000_app_sessions.sql:11-16`) CHECK에 `relationship`을 추가해 `memory_used`, `direct_open` 등 관계 전용 신규 사실에 사용한다. 반면 이미 존재하는 `freechat_start`와 mission 사실은 각각 `feature='freechat'`, `feature='mission'`을 유지하며 관계 집계기가 읽는다. 기존 행을 `relationship`으로 복제하거나 feature를 다시 쓰지 않는다.
- 원 요청의 개념 이벤트 `child_started_free_chat`은 새 `feature='relationship'` 행을 만들지 않는다. 기존 writer가 새 chat session에만 `feature='freechat', event_name='freechat_start', session_id`를 기록하므로(`app/api/chat/session/route.ts:54-73`), 관계 집계기는 이를 같은 사실의 canonical source로 매핑한다. writer에는 `event_key='freechat:freechat_start:<child_id>:<session_id>'`만 보강해 재시도 중복을 막는다.
- JSONB의 `memory_refs`에는 FK를 걸 수 없다는 제약을 받아들인다. 세션 생성 시 Memory V3 조회 결과의 UUID 형식과 child 소유권을 서버에서 검증하고, 본문은 저장하지 않는다. DB FK가 반드시 필요해지는 감사 요구가 생길 때만 별도 세션 컨텍스트 테이블 승격을 검토한다.
- `effective_stage` 갱신은 `W1 < W2 < W3 < W4` rank를 비교하는 조건부 UPDATE/RPC로만 수행해 downgrade를 거부한다. 평가 시각을 매번 쓰지 않고 실제 stage 상승 때만 세 컬럼을 갱신해 `child_profiles` hot-row를 피한다.

### 2.5 session scenario 추적 조회 예시(문서용, 실행 금지)

`relationship_context` CHECK가 non-empty `scenario_id`와 `scenario_version`을 요구하고 write-once trigger가 이를 동결하므로, 다음 조회만으로 “이 세션은 어떤 카드의 어떤 version으로 동작했는가”를 확인할 수 있다.

```sql
SELECT
  id AS session_id,
  relationship_context->>'scenario_id' AS scenario_id,
  relationship_context->>'scenario_version' AS scenario_version,
  relationship_context->>'grade' AS grade,
  relationship_context->>'effective_stage' AS effective_stage,
  relationship_context->>'grade_strategy_version' AS grade_strategy_version,
  relationship_context->>'frozen_at' AS frozen_at
FROM public.chat_sessions
WHERE id = $1
  AND child_id = $2;
```

예를 들어 결과의 `scenario_id='G3_REMEMBER'`, `scenario_version='v1'`은 [카드 문서 §4](./plan-075-relationship-scenario-cards.md#4-g3-카드)의 `G3_REMEMBER_V1` immutable 객체를 가리킨다. snapshot에는 카드 본문을 복제하지 않고 이 두 키만 저장한다.

## 3. Memory V3 경계선

### 읽기 지점

1. **세션 시작 preload 1회**: 기존 `searchMemoryFactsDetailed()`/`search_memory_facts` RPC가 child 범위 vector retrieval을 수행한다(`lib/memory/vectorRetrieval.ts:64-102`). K Conversation 쪽은 이미 Memory V3 우선, `child_memory` fallback을 구현한다(`lib/k-conversation/memory/longTerm.ts:16-75`). Relationship Engine은 이 API의 소비자일 뿐 ranking/embedding/schema를 소유하지 않는다.
2. **현재 세션/당일/장기 기억 합성**: 기존 4-tier loader가 `Promise.allSettled`로 각 tier를 fail-open 조회하고(`lib/k-conversation/memory/index.ts:32-78`), 현재 발화를 Memory보다 우선하라는 프롬프트 규칙도 이미 가진다(`lib/k-conversation/memory/index.ts:113-121`). Relationship Engine은 Scenario의 `recommended_memory_types`와 pack limit을 입력으로 전달할 수 있지만 새 ranking은 만들지 않는다.
3. **명시적 on-demand recall**: 기존 경로가 아이 질문으로 Memory V3를 먼저 검색하고 fallback을 유지한다(`lib/freechat/memoryRecallResponder.ts:5-42`). 미션 호출부도 명시적 recall trigger를 이미 사용한다(`app/api/mission/respond-lean/route.ts:343-365`). Relationship Engine은 이 성공 여부를 event metadata로 받을 뿐 별도 retrieval store/tool DB를 만들지 않는다.
4. **세션 freeze**: preload 결과 중 `{source,id}`만 `chat_sessions.relationship_context.memory_refs`에 저장한다. 프롬프트에 사용한 본문은 그 턴에 Memory V3에서 읽되 세션 스냅샷에 복제하지 않는다. 원 요청도 Memory 본문 복제를 금지하고 Fact ID만 참조하라고 한다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:573-578`).

### 쓰기 지점

- Memory fact 추출·보강·stale/supersede·embedding/evidence 기록은 기존 Memory V3 pipeline만 수행한다. `memory_facts`는 child, fact type, confidence, importance, status, source/version을 이미 소유한다(`supabase/migrations/20260768000000_llm_wiki_memory_schema.sql:22-48`). Evidence와 embedding도 기존 FK 구조가 있다(`supabase/migrations/20260768000000_llm_wiki_memory_schema.sql:62-93`).
- Relationship Engine은 Memory 내용이나 embedding을 **쓰지 않는다**. 쓰는 것은 세션의 Memory reference 목록과, runtime metadata로 확실한 경우의 `memory_used`/`memory_acknowledged`/`child_referenced_past` 행동 이벤트뿐이다.
- 주제 반복/쿨다운도 관계 기억으로 복제하지 않는다. 기존 `conversation_topics`가 child + semantic group 1행을 원자적으로 upsert한다(`supabase/migrations/20260809110000_k_conversation_topic_history.sql:7-29`, `supabase/migrations/20260809110000_k_conversation_topic_history.sql:44-86`).
- `safety_events`는 안전 사건과 제한된 원문을 가진 별도 보안 도메인이다. 관계 이벤트나 기억 저장소로 재사용하지 않는다.

**경계 결론:** Memory V3가 Fact/Evidence/Embedding/legacy fallback의 유일한 Source of Truth이고 Relationship Engine은 조회 조건·선택된 ID·사용 사실만 다룬다. 따라서 신규 memory 저장소가 필요한 지점은 없다.

## 4. 074 설계 수정: calendar_stage 기준 변경

### 4.1 AS-IS 불일치와 수정 대상

- **074 서술은 가입일 기준이다.** 기대 결과와 QA가 “가입 경과일/가입일 기준”이라고 쓰고(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:55-73`), 본문도 `가입 경과일 기준 calendar_stage`와 `가입일 Source of Truth`를 요구한다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:179-192`). 기존 구조 확인 항목도 `child 가입일 Source of Truth`라고 적혀 있다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:538-555`).
- **074 원문에는 `child_profiles.created_at`이라는 리터럴은 없다.** 다만 당시 child profile의 생성 시각 필드는 `created_at`이므로(`supabase/migrations/20260609400000_family_clean_slate.sql:57-67`), 위 “가입일” 서술을 그대로 구현하면 `child_profiles.created_at`으로 해석될 여지가 있었다. 수정 대상은 이 가입일 의미다.
- **현행 코드는 이미 교정 후 상태다.** `lib/relationship/calendarStage.ts`에는 `created_at` 참조가 0곳이며 입력 타입부터 `relationship_started_at`이다(`lib/relationship/calendarStage.ts:3-5`). 계산도 그 값만 읽는다(`lib/relationship/calendarStage.ts:22-31`). 호출부도 0곳이라 현재 제품 runtime에는 stage 계산 자체가 아직 연결되지 않았다. 따라서 “현행 코드가 created_at 기준”이라고 지목할 줄은 없고, 실제 수정 대상은 074 서술과 향후 호출부 계약이다. 경계 테스트도 이미 `relationship_started_at` 기준이다(`lib/relationship/calendarStage.test.ts:13-21`).
- Phase 0 설계도 이미 “W1~W4 계산은 relationship_started_at만 입력”으로 확정했다(`docs/plans/075-relationship-start-date.md:10-20`). 실제 migration은 최초 정상 CHILD→K 왕복의 K 저장 시각을 관계 시작일로 정의하며, 정상 턴이 없던 과거 프로필만 `created_at`을 임시 fallback으로 표시한다(`supabase/migrations/20260811270000_relationship_started_at.sql:1-17`, `supabase/migrations/20260811270000_relationship_started_at.sql:120-123`).

074에서 의미를 바꿔 읽어야 할 문구는 다음과 같다.

| 074 위치 | 기존 의미 | 수정 의미 |
|---|---|---|
| `requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:55-73` | 가입 경과일/가입일 기준으로 stage 확인 | **관계 시작 경과일** 기준. 관리자 확인값도 `relationship_started_at`과 fallback 여부를 함께 표시 |
| `requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:179-192` | 가입일 Source of Truth를 기존 child 필드에서 선택 | `child_profiles.relationship_started_at`이 유일한 calendar 기준. `created_at`은 `_is_fallback=true`인 과거 데이터의 임시 값일 뿐 확정 기준이 아님 |
| `requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:538-555` | child 가입일 Source of Truth 조사 | 관계 시작일과 `_is_fallback` 상태, 최초 정상 왕복 capture 상태 조사 |
| `requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:684-693` | D1/D7~D22 경계를 가입일에서 계산 | 날짜 경계 숫자는 유지하되 D1을 관계 시작 KST 날짜로 정의 |

### 4.2 계산 계약과 경계조건

확정 Source of Truth는 `child_profiles.relationship_started_at`과 `relationship_started_at_is_fallback`의 쌍이다. 단순 timestamp 하나만 읽어 fallback을 확정 관계 시작일처럼 취급하면 안 된다.

1. **확정값:** `relationship_started_at IS NOT NULL AND relationship_started_at_is_fallback = false`일 때만 현재 순수 함수로 KST 달력 일수 차이를 계산한다. 동일 KST 날짜가 D1, elapsed 0~6이 W1, 7~13이 W2, 14~20이 W3, 21 이상이 W4다. KST serial 계산과 W4 cap은 현재 코드 그대로다(`lib/relationship/calendarStage.ts:7-20`, `lib/relationship/calendarStage.ts:38-44`).
2. **신규 아이의 null:** 첫 정상 왕복 전 `relationship_started_at IS NULL`이면 확정 `calendar_stage`는 아직 없다. 첫 세션은 대화를 막지 않도록 **provisional W1** context만 사용하고 W2 이상 승격이나 영구 effective-stage 갱신은 금지한다. 최초 정상 왕복이 저장된 뒤 capture trigger가 확정 시각을 기록한다(`supabase/migrations/20260811270000_relationship_started_at.sql:237-284`, `supabase/migrations/20260811270000_relationship_started_at.sql:299-353`).
3. **fallback 과거 아이:** `_is_fallback = true`이면 저장된 timestamp가 `created_at`이어도 경과 주수 계산에 사용하지 않고 **provisional W1**로 제한한다. 그래야 가입 후 오래 대화하지 않은 아이가 첫 만남부터 W4가 되는 오류를 막는다. 최초 실제 정상 턴이 발견되면 migration 계약에 따라 timestamp를 실제값으로 바꾸고 flag를 false로 전환한다(`supabase/migrations/20260811270000_relationship_started_at.sql:203-223`, `supabase/migrations/20260811270000_relationship_started_at.sql:266-284`).
4. **세션 freeze:** null/fallback 상태로 시작한 현재 세션은 W1 provisional을 끝까지 유지한다. 정상 턴 capture가 세션 도중 발생해도 재계산하지 않고 **다음 세션부터** 확정 `relationship_started_at` 기준을 적용한다. 이로써 session version freeze와 모순되지 않는다.
5. **가입일과 관계 시작일이 다른 아동:** 예를 들어 가입 30일 뒤 첫 정상 대화를 한 아이는 기존 가입일 해석이면 W4였지만, 수정 후 첫 관계 세션은 W1이고 8번째 KST 관계일에 W2 후보가 된다. 가입 후 무대화 기간은 관계 경과일에 포함하지 않는다.
6. **fallback 교체와 no-downgrade:** fallback timestamp로 W2~W4를 계산하지 않으므로 실제 관계 시작일로 교체될 때 calendar stage가 뒤로 떨어지는 현상이 생기지 않는다. Phase 1~6 미구현 상태라 기존 저장 effective stage도 없으며, 향후 adapter는 provisional 상태에서 W1 초과를 저장하지 않아 `effective_stage <= calendar_stage`를 보장한다.
7. **오류값:** invalid timestamp, 미래 timestamp는 현재 함수처럼 null을 반환한다(`lib/relationship/calendarStage.ts:33-41`). session initializer는 이를 데이터 오류로 기록하고 provisional W1으로 fail-open하되 stage 승격은 하지 않는다.

향후 구현 계약은 기존 순수 함수의 날짜 계산을 유지하고, 그 앞에 `{ relationship_started_at, relationship_started_at_is_fallback }`을 판정하는 resolver를 둔다. 필요한 테스트는 (a) 가입일=관계시작일, (b) 가입 후 30일 뒤 첫 대화, (c) null 첫 세션, (d) fallback 오래된 가입일, (e) fallback→실제값 전환 중 현재 세션 freeze, (f) KST D1/D7/D8/D14/D15/D21/D22 경계다. 이번 설계 작업에서는 코드나 테스트를 수정하지 않는다.

## 5. Phase 재정의

아래 Phase 1~6은 실제 위임 단위를 A/B로 나눈 것을 포함해 **agy 단일 세션 10분 이내인 10개 작업 단위**다. 모든 코딩 브리프에는 “작업 전 루트 `AGENTS.md` §6~§10을 읽을 것”을 포함한다. 앞 단계 산출물이 필요한 항목은 병렬화하지 않는다. Scenario 내용은 승인 카드 문서를 그대로 사용하고, 승인되지 않은 threshold 숫자는 어떤 Phase에서도 발명하지 않는다.

| Phase | 예상 | 대상 파일 | 작업·완료 조건 | 의존관계 |
|---|---:|---|---|---|
| **1A — profile 상태 DDL 초안** | 8~10분 | `supabase/migrations/<timestamp>_relationship_engine_v1_minimal.sql` | §2.3의 `child_profiles` 3개 nullable 컬럼·CHECK·GRANT와 service-role-only 보호 trigger를 작성. 기존 relationship start 두 컬럼·보호 trigger는 재생성하지 않고 재사용. SQL 적용·원격 push는 별도 승인 전 금지 | §7의 3조건 설계 게이트 확인 후 시작. DB 고위험 변경이므로 작성 직후 개별 정적 리뷰 대상 |
| **1B — session/event DDL 초안** | 8~10분 | 1A와 같은 migration 파일 | `chat_sessions.relationship_context`/CHECK/write-once trigger, `behavior_events.event_key`/최신 feature CHECK/index/GRANT를 이어서 작성. 기존 RLS·FK 재사용을 주석으로 명시하고 transaction을 닫음. SQL 적용 금지 | 1A 이후 순차. 개별 정적 리뷰 대상 |
| **2A — versioned 운영 config** | 8~10분 | `lib/relationship/relationshipConfig.ts`, `lib/relationship/relationshipConfig.test.ts` | `RELATIONSHIP_ENGINE_CONFIG_JSON` registry/active version 엄격 parser, 숫자 없는 W2~W4·`returned_after_gap` 비활성 safe default, immutable version 테스트. §2.2 검색과 수동 alias 검토로 production threshold 하드코딩 0건 확인. 승인 숫자는 env 입력으로만 받고 발명 금지 | 1A/B와 파일 비중복이라 병렬 가능 |
| **2B — 명시적 24카드 registry/resolver** | 8~10분 | `lib/relationship/scenarioCards.ts`, `lib/relationship/scenarioResolver.ts`, `lib/relationship/scenarioResolver.test.ts` | 승인 카드 문서의 24개 8필드 객체를 그대로 선언하고 resolver는 lookup만 수행. 24 unique ID, grade별 4개, stage별 6개, 조합당 active 1개, Memory type allow-list, version freeze payload, invalid active version fail-open 테스트. runtime Stage×Grade 콘텐츠 합성 금지 | 2A의 version/type 계약 이후; Scenario 콘텐츠 승인 완료 |
| **3 — calendar/effective stage 순수 계산** | 8~10분 | `lib/relationship/calendarStage.ts`, `lib/relationship/calendarStage.test.ts`, `lib/relationship/effectiveStage.ts`, `lib/relationship/effectiveStage.test.ts` | 기존 KST 계산을 유지하며 null/fallback→provisional W1 resolver와 `{calendarStage, source, previous, counts, rules}` effective 계산 추가. 가입일≠관계일, D1/D7/D8/D14/D15/D21/D22, provisional cap, confirmed cap, no-downgrade, inactive rule을 표 기반 테스트로 완료 | 2A의 rule type 이후. DB 접근 없음 |
| **4A — state read/aggregate adapter** | 8~10분 | `lib/relationship/relationshipState.ts`, `lib/relationship/relationshipState.test.ts` | `relationship_started_at`+fallback flag와 기존 `chat_sessions`/`memory_facts`/`behavior_events`를 child 범위로 읽고 count input을 만든다. `child_started_free_chat`은 기존 `freechat_start`로 매핑하고 중복 집계하지 않음. 조회 실패 fail-open 테스트 | Phase 1 schema + Phase 3 이후. DB 적용 전 mock 테스트만 |
| **4B — state/snapshot 조건부 쓰기** | 8~10분 | 4A와 같은 두 파일 | confirmed stage가 실제 상승할 때만 `child_profiles` 조건부 update. active Scenario가 있을 때 session 최초 1회 JSONB에 calendar source·grade·모든 version·Memory refs를 저장. 같은 session의 동일 retry만 허용하고 provisional/invalid config에서는 영구 쓰기 금지 | 4A 이후 |
| **5 — 기존 Context Builder 결합** | 8~10분 | `lib/relationship/relationshipContext.ts`, `lib/relationship/relationshipContext.test.ts`, `lib/k-conversation/index.ts` | 세션 snapshot의 effective stage/scenario/grade version을 기존 Persona + Memory fragment에 결합하고 “현재 발화 > Safety/Persona > Scenario > Memory > Play/Reward” 순서 고정. 기존 mission 호출부는 builder를 이미 호출하므로(`app/api/mission/respond/route.ts:500-510`) 시그니처 호환 유지. K Conversation의 기존 매-turn Memory 조회는 frozen refs 재사용 경로로 전환 | Phase 4 이후. Mission/Free Chat 동작 영향으로 정적 리뷰 후 agy E2E 필요 |
| **6A — relay 선행 호환** | 8~10분 | `services/vertex-live-relay/src/ticket.ts`, `services/vertex-live-relay/src/server.ts` | optional v2 encrypted context envelope를 검증·복호화해 system instruction에 결합하되 v1 ticket은 기존 고정 prompt로 계속 수용. 평문 Memory/Context 로그 금지. 현재 relay 고정 prompt 지점(`services/vertex-live-relay/src/server.ts:164-180`) 변경 | Phase 5 이후. 먼저 배포·Live 회귀 확인하고 6B로 진행 |
| **6B — 앱의 v2 발급 + event writer 계약** | 8~10분 | `hooks/useGeminiLive.ts`, `app/api/voice/token/route.ts`, `lib/plan/vertexLiveTicket.ts`, `lib/analytics/logBehaviorEvent.ts` | 클라이언트가 현재 DB chat session ID를 보내고 token route가 `session.child_id`를 검증. frozen snapshot을 **Memory 원문이 노출되지 않는 암호화·서명 envelope**로 발급. `feature='relationship'`/`eventKey` 타입 지원과 확실한 runtime metadata event만 기록. token body가 childId만 받는 현재 계약(`app/api/voice/token/route.ts:20-33`)을 v2로 확장하되 relay 임시 UUID(`services/vertex-live-relay/src/server.ts:102-104`)와 혼동 금지 | 6A 배포·검증 뒤 순차. Sol 정적 리뷰 + agy Live E2E 필수 |

Phase 6A가 먼저 v1/v2를 모두 받아야 중간 배포 상태에서도 구버전 앱이 끊기지 않는다. 6A/6B는 병렬 실행하지 않는다.

실행 순서: §7의 3조건 설계 충족 확인 → `1A → 1B`와 `2A → 2B` 두 흐름만 서로 병렬 가능 → `3` → `4A` → `4B` → `5` → `6A` → `6B`. 최소 스키마 방향 승인은 완료됐지만 이번 작업에서는 migration 파일을 만들거나 적용하지 않는다. 이후 migration 작성과 적용·원격 push도 각각 지정된 승인·게이트를 따른다. 모든 Phase는 구현 주체와 다른 세션의 정적 리뷰를 거쳐야 하며, 5~6은 사용자 동작 영향 때문에 agy E2E가 추가로 필요하다.

## 6. 위험·되돌리기

### 스키마 축소로 생기는 제약

1. **DB 관리자 CRUD가 없다.** threshold/runtime 숫자는 server env registry 변경과 런타임 재시작·재배포가 필요하고, 새 Scenario 본문 version은 코드 배포가 필요하다. 이미 bundled된 Scenario version 사이의 active 포인터만 env로 전환할 수 있다. 운영자가 UI에서 하루에도 여러 번 편집해야 한다면 부적합하다.
2. **DB FK가 없는 JSONB reference다.** `memory_refs`의 ID가 나중에 삭제돼도 snapshot은 메타데이터만 남는다. 세션 생성 시 child 소유권/UUID를 검증하고 조회 실패는 no-memory로 fail-open해야 한다. Memory 본문 재현까지 요구하면 보존정책과 충돌하므로 별도 대표 결정이 필요하다.
3. **`behavior_events`가 분석·관계 이벤트를 함께 가진다.** partial index로 관계 집계를 격리하지만, 관계 이벤트량이 전체 테이블의 주된 부하가 되거나 retention/RLS가 달라지면 분리가 필요하다. 반대로 현재는 같은 append-only/service-role 패턴이라 새 테이블보다 확장이 작다.
4. **`child_profiles`가 stage floor를 소유한다.** 매 세션 평가시각을 쓰면 hot-row가 되므로 실제 상승 때만 갱신해야 한다. W1~W4 이외의 복잡한 상태·분기·수동 override가 생기면 1:1 컬럼 확장이 더는 적절하지 않다.
5. **새 Scenario 내용 version은 배포 경계다.** 이미 bundled된 version 간 active 전환은 env로 가능하지만 새 카드 본문은 코드 배포가 필요하다. 진행 중 세션은 JSONB snapshot의 기존 version을 쓰고 새 세션만 새 active version을 resolve한다. 같은 version 객체를 수정하면 과거 재현이 깨지므로 금지한다.
6. **threshold 운영값은 여전히 미승인이다.** Scenario 24종의 내용 승인은 완료됐지만 Stage threshold와 `returnedAfterGapDays` 숫자 승인은 별개다. 승인 JSON 전까지 W2~W4/`returned_after_gap`은 숫자 없는 safe default로 비활성화한다. 코드에 임시 숫자를 넣어 구현을 앞당기면 안 된다.
7. **Gemini Live는 별도 배포 단위이고 session ID가 이원화돼 있다.** 현재 token 요청은 childId만 받고(`app/api/voice/token/route.ts:20-33`), relay는 DB `chat_sessions.id`와 무관한 임시 UUID를 만든다(`services/vertex-live-relay/src/server.ts:102-104`). ticket도 child/voice만 담고(`lib/plan/vertexLiveTicket.ts:1-33`), relay는 고정 system prompt를 사용한다(`services/vertex-live-relay/src/server.ts:164-180`). 클라이언트가 보낸 DB session ID를 서버에서 child 소유권 검증 없이 신뢰하면 안 되며, 관계 context를 평문 query string에 넣어도 안 된다. 검증된 session ID + 암호화된 단기 envelope 또는 동등한 서버-서버 안전 전달 계약 없이는 배선하지 않는다.

### 되돌리기

- **코드/config:** active version 포인터와 resolver 호출을 직전 배포로 되돌린다. 이미 저장된 session snapshot/event는 읽지 않으면 기존 대화 경로에 영향을 주지 않는다.
- **DB:** 전부 nullable/additive이므로 우선 앱을 rollback하고 컬럼은 보존한다. 즉시 DROP하지 않는다. 새 write가 멈추고 의존 코드·행이 없음을 확인한 후에만 별도 승인된 migration으로 index/constraint/컬럼을 역순 제거한다.
- **event 확장:** `feature='relationship'` writer를 먼저 중단한다. 관계 event 행을 보존할지 삭제할지 대표가 결정한 뒤에만 partial index와 `event_key`를 제거하고 feature CHECK를 이전 allow-list로 복원한다. 데이터 삭제는 자동 rollback에 포함하지 않는다.
- **세션 snapshot:** JSONB가 잘못됐어도 `relationship_context=NULL` 세션과 동일한 fail-open 경로를 유지한다. 이미 생성된 snapshot을 일괄 갱신하거나 Memory 본문으로 backfill하지 않는다.

### 나중에 독립 테이블로 승격하는 경로

| 승격 대상 | 승격 신호 | 무중단 마이그레이션 경로 |
|---|---|---|
| `relationship_stage_rules` / `relationship_scenarios` | 무배포 편집, 동시 active variant/A-B, DB 변경 감사가 실제 요구됨 | 현재 config version을 immutable seed로 INSERT → 서버 resolver를 “DB active 1건, 실패 시 bundled config”로 dual-read → 검증 후 DB 우선 → config는 비상 fallback 유지. `(grade, stage, version)` unique와 active partial unique를 그때 추가 |
| `child_relationship_state` | W4 이후 분기, 수동 override, 여러 엔진 상태, 빈번한 갱신으로 profile contention 발생 | 새 1:1 table 생성 → `child_profiles` 3컬럼 backfill → 일정 기간 dual-write/대조 → read 전환 → 안정화 뒤 기존 컬럼 제거. count/memory/event Source of Truth는 여전히 복제 금지 |
| `relationship_session_context` | JSONB 필드별 FK/감사 쿼리, context retention 분리, session과 다른 삭제주기 필요 | `chat_sessions.relationship_context`를 새 table로 `INSERT ... SELECT` backfill → session_id unique/FK + typed columns/child RLS 추가 → dual-write → 대조 → read 전환. Memory 본문은 여전히 복제하지 않음 |
| `relationship_events` | 관계 이벤트가 대용량이 되거나 `behavior_events`와 retention/RLS/파티셔닝/SLA가 달라짐 | `feature='relationship'` 행을 event_key 유지한 채 새 table로 copy → event_key unique로 dual-write idempotency 보장 → count 대조 → reader 전환 → 기존 행 보존/삭제는 별도 승인. `safety_events`와는 끝까지 합치지 않음 |

이 승격 경로는 현재부터 테이블을 미리 만드는 근거가 아니다. 승격 신호가 실제로 발생할 때 additive → dual-write/read → 대조 → 전환 순서로 분리하면 데이터 손실 없이 확장할 수 있다.

## 7. 구현 전 3조건 충족 확인표

아래의 “충족”은 **설계 계약이 구체화되었다는 뜻**이다. 실제 구현 뒤에는 각 Phase의 정적 리뷰와 DB migration 리뷰로 동일 조건을 다시 확인해야 한다.

| 조건 | 충족 여부 | 근거 (문서 절 번호 / 파일:줄) |
|---|---|---|
| ① 24개 Scenario Card 명시 + session scenario_id/version 추적 | **충족(설계)** | 카드 문서 §2~§7에 24개 × 8필드가 전부 명시돼 있고(`docs/plans/plan-075-relationship-scenario-cards.md:16-290`), §8이 explicit registry/lookup 계약을 고정한다. 본 문서 §2.3 CHECK·write-once trigger와 §2.5 조회 예시가 session의 `scenario_id/version` 추적을 보장한다 |
| ② threshold 하드코딩 0건, 코드 수정 없이 운영 변경 | **충족(설계), 실제 수치 미승인** | 본 문서 §2.1~§2.2가 숫자의 유일한 위치를 server-only env registry로 제한하고 production 검색 0건 gate·숫자 없는 safe default를 정의한다. 원 요구도 DB/config 운영 변경과 미승인 숫자 금지를 함께 요구한다(`requests/074-relationship-engine-v1-stage-grade-scenario-memory-events.md:229-252`) |
| ③ relationship_started_at·fallback/source 반영 / relationship_context write-once / event_key DB-level unique | **충족(설계)** | 본 문서 §2.3~§2.5와 §4. 기존 관계 시작 컬럼/flag·보호 trigger는 `supabase/migrations/20260811270000_relationship_started_at.sql:4-17`, `supabase/migrations/20260811270000_relationship_started_at.sql:377-439`; 원 event index 5개는 모두 비유니크(`supabase/migrations/20260736000000_behavior_events.sql:29-33`)이고 제안 partial UNIQUE가 non-null logical key의 DB 멱등성을 새로 보장한다 |

**Memory 재확인:** ①~③을 충족하기 위해 추가되는 Memory 저장소는 0개다. Scenario는 기존 Memory V3 `fact_type`을 조회 조건으로만 사용하고, session에는 기존 Fact ID 참조만 저장한다.
