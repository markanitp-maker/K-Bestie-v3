# 자유대화 초성게임 (PLAYFUL_GAME:CHOSUNG) — 설계

> 근거: `requests/request-free-chat-chosung-adaptive-game.md`
> Phase 0 AS-IS 감사: Codex Terra 위임 세션 결과 반영 (2026-08-11)
> 작성: 메인 Claude (Opus, xhigh) — 아키텍처 전환 판단(하드룰 1 예외, 071과 동일 근거)

---

## Phase 0. AS-IS 감사 결과 (Codex 위임, 읽기 전용)

### K Conversation Engine 현재 구조

- `lib/k-conversation/index.ts`의 `respond()`: Safety → 결정론 처리 → 4-tier Memory/Persona → Boredom → Action Selector → Gemini Response → Topic History 기록 순서. **stateless per-turn 호출** — Engine 자체는 세션 간 상태를 들고 있지 않는다.
- `ConversationAction`은 `lib/k-conversation/types.ts`의 **flat union** (`EMPATHY | CURIOSITY | JOKE | MEMORY_RECALL | OWN_OPINION | PLAYFUL_TEASING | IMAGINATION | CELEBRATION | COMFORT | FOLLOW_UP | TOPIC_SHIFT | JUST_LISTEN`). 중첩 구조 없음.
- `GradePersona`(`gradePersonas.ts`)는 23개 필드를 가진 평면 객체, 1~6학년 각각 독립 선언. 신규 필드 추가는 인터페이스 + 6개 객체 + `buildGradePersonaFragment()` 3곳 수정으로 끝남.
- `actionSelector.ts`의 `selectAction()`은 아이 발화 신호에만 반응하는 **수동(reactive) 구조** — K가 자발적으로 뭔가를 먼저 제안하는 능동 선택 지점이 현재 없음.
- Memory: `child_profiles.interests` 컬럼은 Engine이 **현재 조회하지 않음**. 관심사 데이터는 `memory_facts.fact_type='interest'` 및 `child_memory.category='interest'` 경로로 이미 4-tier Memory에 흘러들어간다.
- `conversation_topics`(20260809110000 마이그레이션): `semantic_group`/`last_used_at`/`frequency`/`cooldown_until`/`last_initiated_by` — K가 마지막 발화자일 때만 cooldown 적용하는 `isTopicOnCooldownForK()` 존재. **재사용 가능**하나 라운드별 게임 세부 상태(난이도/힌트/결과)는 저장 안 됨.
- `chat_messages`에 게임 telemetry 필드 없음. `behavior_events.play_type` CHECK에 `chosung` 없음.
- 한글 초성 추출 유틸 **코드베이스에 없음** (`lib/utils/koreanName.ts`, `koreanParticle.ts`는 있으나 자모 분해 없음) — 신규 구현 필요.
- 자유대화는 현재 K 응답을 TTS로 읽지 않음(`useVoiceChat.ts`의 `respondText()`는 텍스트 전용) — 초성 발음 문제는 현재 발생하지 않음.

---

## 설계 결정 (Phase 0가 남긴 質문에 대한 확정)

| 질문 | 결정 | 근거 |
|---|---|---|
| Action을 어떻게 표현할지 | 기존 flat union에 `PLAYFUL_GAME_CHOSUNG` 1개 값을 추가 (중첩 타입 신설 안 함) | 기존 `ConversationAction`이 전부 flat이라 여기만 중첩을 넣으면 Action Selector·Response Generator 양쪽에 특수 분기가 생긴다. 지시서 §1의 "PLAYFUL_GAME > CHOSUNG"은 개념적 분류일 뿐, 실제 구현 타입까지 중첩을 요구하지 않는다(§5 "실제 타입과 파일명은 구조 감사 후 확정"). |
| 게임 상태는 어디가 소유하나 | **DB(신규 테이블 `chosung_game_sessions`)** — Engine은 여전히 stateless per-turn 유지, 매 턴 DB에서 현재 게임 상태를 읽고 갱신 | Engine을 stateful로 바꾸면 071 아키텍처(요청-응답 단발 함수)를 깨뜨린다. 미션 v3도 같은 이유로 DB(`mission_progress`)에 상태를 둔다 — 기존 패턴과 일관. |
| K-initiated cooldown을 어디서 관리하나 | 기존 `conversation_topics`에 `semantic_group='PLAYFUL_GAME_CHOSUNG'` row를 그대로 사용 (신규 cooldown 메커니즘 만들지 않음) | `isTopicOnCooldownForK()`가 이미 "K가 마지막 발화자 + cooldown 남음"을 정확히 표현한다. child-initiated는 이 테이블을 거치지 않고 항상 허용(§4 원칙과 일치). |
| 단어 pool을 어디에 두나 | **코드 내 정적 데이터 파일** `lib/k-conversation/chosungGame/wordPool.ts` (DB 아님) | 결정론·안전검수·unit test 용이성이 최우선(§8,§9,§23). 매 배포마다 사람이 리뷰하는 코드 리뷰 게이트를 그대로 통과시키는 게 DB CRUD 신설보다 안전하다. 개인화(관심사 기반)는 pool 안에서 category로 필터링. |
| 정답 판정 | `normalize()` 결정론 함수 + `accepted_answers` 배열, LLM 미사용 | 지시서 §9 명시 요구사항 그대로. |
| 관심사 개인화 데이터 소스 | `memory_facts` (`fact_type='interest'`, `status='active'`)만 사용. `child_memory.category='interest'`나 `child_profiles.interests`는 사용 안 함 | Engine이 이미 Long-term Memory tier에서 `memory_facts`를 조회하므로 별도 조회 경로를 늘리지 않는다. `child_profiles.interests`는 최근 온보딩에서 입력 UI가 제거된 레거시 컬럼이라 신뢰도가 낮다. |
| Adaptive Difficulty 계산 위치 | 서버, 라운드 종료 시점에 결정론 함수로 계산해 `chosung_game_sessions.current_difficulty`에 즉시 반영(캐시) | "게임 상태" 자체가 상태 머신(§14)이므로 매 조회마다 히스토리를 재계산하는 대신 라운드 종료 시 한 번 갱신하는 편이 단순하고 §7 학년별 min/max 클램프를 한 곳에서 강제하기 쉽다. |
| Telemetry 테이블 | 신규 `chosung_game_rounds` (라운드 단위) — `chat_messages`/`behavior_events` 재사용 안 함 | 지시서 §21이 요구하는 필드(session_id/child_id/game_type/difficulty/result/hint_used/initiated_by/created_at)가 기존 테이블 스키마와 맞지 않고, §21이 "대화 원문을 게임 로그에 복제 저장하지 않는다"고 명시해 `chat_messages`와 목적이 다르다. |
| 음성 출력 | 이번 범위는 **텍스트 표시 전용** (기존 자유대화와 동일하게 TTS 미사용) | AS-IS 감사에서 자유대화가 이미 TTS를 쓰지 않는다고 확인됨 — 초성게임만 예외로 TTS를 켜는 것은 범위 확대이며 지시서에 명시 요구 없음. 화면 텍스트 표시(§22 요구사항)로 충분. |

---

## 신규 DB 스키마 (제안, Phase 3에서 마이그레이션 작성)

```sql
-- 게임 세션 상태 (child당 진행 중 게임은 최대 1개)
CREATE TABLE chosung_game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  chat_session_id UUID NOT NULL, -- chat_sessions.id
  state TEXT NOT NULL CHECK (state IN ('OFFERED','PLAYING_K_ASKS','PLAYING_CHILD_ASKS','WAITING_FOR_ANSWER','HINT','ROUND_RESULT','ENDED')),
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('CHILD','K')),
  current_word TEXT,               -- 정답 (K가 낸 문제일 때만)
  current_chosung TEXT,            -- 화면 표시용
  current_category TEXT,
  current_difficulty INT NOT NULL,
  hint_level INT NOT NULL DEFAULT 0,
  recent_words TEXT[] NOT NULL DEFAULT '{}', -- 동일 세션 반복 방지
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX idx_chosung_sessions_child_active ON chosung_game_sessions(child_id) WHERE ended_at IS NULL;

-- 라운드별 telemetry (§21)
CREATE TABLE chosung_game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chosung_game_sessions(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL DEFAULT 'CHOSUNG',
  difficulty INT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('correct','skip','revealed','child_asked')),
  hint_used INT NOT NULL DEFAULT 0,
  initiated_by TEXT NOT NULL CHECK (initiated_by IN ('CHILD','K')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chosung_rounds_child ON chosung_game_rounds(child_id, created_at);

-- RLS: 기존 child_memory와 동일 패턴 (service_role 전용 행 접근 + anon/authenticated GRANT)
```

두 테이블 모두 신규 생성(기존 13개 보호 테이블 변경 아님)이지만 DB 스키마 변경이므로 CLAUDE.md §2 예외(즉시 게이트 대상)를 적용한다.

**2026-08-11 게이트① 3라운드 후 설계 판단 (하드룰 1 예외, Claude 직접 결정):** Sol 리뷰가 `chosung_game_sessions.chat_session_id`와 `child_id`의 동일-아이 불변식을 `chat_sessions(id, child_id)` 복합 UNIQUE + 복합 FK로 DB에서까지 강제할 것을 3회차에 걸쳐 제안했다. 이 제안 자체는 타당하지만 `chat_sessions`는 보호 대상 핵심 테이블이라 이 기능 하나를 위해 스키마를 확장하지 않기로 했다. 대신 마이그레이션 파일에 규약을 주석으로 명시했다: **Phase 5 서버 로직은 `child_id`를 클라이언트 입력으로 받지 않고 반드시 조회한 `chat_sessions.child_id`에서 파생시켜야 한다.** Phase 5 구현·리뷰 시 이 규약 준수 여부를 반드시 확인한다.

---

## 구현 단계 (지시서 §24 Phase 번호를 그대로 유지)

```
Phase 0 — AS-IS 감사                         [완료, Codex 위임]
Phase 1 — Chosung Core                       [Codex 위임 — 계약은 본 문서로 확정됨]
  - lib/k-conversation/chosungGame/chosungUtil.ts   (초성 추출, 완성형 한글 정확 처리)
  - lib/k-conversation/chosungGame/answerNormalize.ts
  - lib/k-conversation/chosungGame/wordPool.ts       (카테고리/난이도/accepted_answers 포함 정적 데이터)
  - unit tests 3개 파일
Phase 2 — Grade Difficulty                   [Codex 위임]
  - GradePersona에 chosungGame 필드 추가 (baseDifficulty/minDifficulty/maxDifficulty 등, §5/§7 표 반영)
Phase 3 — Game State (DB)                    [Codex 위임 — 위 스키마로 마이그레이션 작성 + 즉시 게이트]
Phase 4 — Adaptive Difficulty                [Codex 위임 — 결정론 계산 함수 + unit test]
Phase 5 — Conversation Action 통합            [복잡도 높음 — Claude 직접 검토 후 Codex 위임 여부 결정]
  - types.ts에 PLAYFUL_GAME_CHOSUNG 추가, actionSelector.ts에 능동 제안 판단 추가(§3 조건)
Phase 6 — Memory Personalization              [Codex 위임]
Phase 7 — Semantic History/Cooldown           [Codex 위임 — conversation_topics 재사용]
Phase 8 — Dev QA                              [agy]
```

Phase 1부터 순차 위임한다. 각 Phase 완료 시 CLAUDE.md §2 기능 단위 게이트(정적 리뷰, 필요시 QA)를 거친다. Phase 3(DB 스키마)은 예외 규칙에 따라 별도 즉시 게이트.

Production 배포는 지시서 §24 Phase 8(Dev QA 전체 PASS) 이후, 073/STT와 마찬가지로 전체 번들 단위로만 진행한다.
