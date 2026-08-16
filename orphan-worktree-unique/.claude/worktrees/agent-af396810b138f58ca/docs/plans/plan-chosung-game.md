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

---

## Phase 3 재확인 (2026-08-13, 재개 세션)

`node scripts/apply-migration.js supabase/migrations/20260811000000_chosung_game_state.sql`를 Dev(mkrsaaedxqrcrktapaus)에 재실행 시도 결과, **2026-08-11에 이미 적용된 기록**이 있고(`checksum` 불일치는 파일 내 주석 변경분으로 추정), Dev DB의 `information_schema.columns`를 직접 조회해 `chosung_game_sessions`/`chosung_game_rounds` 두 테이블 모두 마이그레이션 파일과 동일한 컬럼 구성으로 **이미 존재함을 확인**했다. Phase 3는 완료 상태이며 재적용 불필요.

---

## Phase 5~7 설계 (2026-08-13, 하드룰 1 예외 — 아키텍처 전환 판단, Claude 직접 설계)

### 통합 지점

Free Chat Adapter는 `app/api/voice/respond/route.ts` 하나뿐이다(mode: "FREE_CHAT"으로 `lib/k-conversation`의 `respond()`를 호출하는 유일한 경로 — Parent K-Chat(`app/api/parent/k-chat/route.ts`)은 별개 기능이라 무관). `respond()`(`lib/k-conversation/index.ts`)는 턴마다 상태 없이 호출되는 구조를 유지해야 하므로(071 계약), 게임 상태 머신은 `respond()` 본문에 직접 풀어쓰지 않고 신규 모듈 `lib/k-conversation/chosungGame/gameEngine.ts`의 단일 진입점 `handleChosungTurn()`으로 캡슐화한다.

```ts
// lib/k-conversation/chosungGame/gameEngine.ts
export async function handleChosungTurn(
  db: SupabaseClient,
  input: { childId: string; sessionId: string; currentUtterance: string },
  ctx: {
    gradePersona: GradePersona; // resolveGradePersona() 결과, chosungGame 필드 사용
    signals: UtteranceSignals;
    boredom: BoredomAssessment;
    generate: (args: { instruction: string; currentUtterance: string }) => Promise<{ text: string; tokenIn: number; tokenOut: number }>;
    // generate는 index.ts가 이미 만든 generateResponse 호출을 그대로 감싸 전달한다.
    // gameEngine은 Gemini를 직접 부르지 않고 이 콜백만 사용한다(단일 호출 지점 유지).
  },
): Promise<{ text: string; action: "PLAYFUL_GAME_CHOSUNG"; tokenIn: number; tokenOut: number } | null>
```

`null`을 반환하면 이번 턴은 게임과 무관 — `index.ts`는 지금 하던 대로 `selectAction()`부터 이어간다. non-null이면 그 값을 그대로 `EngineOutput`으로 반환한다(`category: "generated"`).

`index.ts` 수정은 아래 한 지점뿐이다 — Boredom 판정(4번) 직후, Action 선택(6번) 이전에 삽입:

```ts
const chosungResult = await handleChosungTurn(deps.db, { childId: input.childId, sessionId: input.sessionId, currentUtterance: input.currentUtterance }, {
  gradePersona, signals, boredom,
  generate: (args) => generateResponse({ ai: deps.ai, modelId: deps.modelId, input: { mode: input.mode, action: "PLAYFUL_GAME_CHOSUNG", corePersonaFragment, gradePersonaFragment, memoryFragment, currentUtterance: input.currentUtterance, recentHistory, adapterInstruction: args.instruction, isGeneralKnowledgeQuestion: false } }),
});
if (chosungResult) {
  // 8번 Semantic Topic History 기록 로직은 그대로 재사용해도 되고 gameEngine 내부에서
  // 이미 recordTopicUsage를 호출했다면 index.ts에서 중복 기록하지 않는다(구현 시 확정).
  return { text: chosungResult.text, action: chosungResult.action, category: "generated", boredom, memoryTiersUsed: memorySnapshot.tiersUsed, tokenIn: chosungResult.tokenIn, tokenOut: chosungResult.tokenOut };
}
```

`types.ts`에는 `ConversationAction` union에 `"PLAYFUL_GAME_CHOSUNG"` 한 값만 추가한다(다른 필드 변경 없음).

### gameEngine.ts 상태 머신 (결정론)

매 턴 `chosung_game_sessions`에서 `child_id` 기준 `ended_at IS NULL` 행을 조회한다(`getActiveSession`, 신규 `lib/k-conversation/chosungGame/gameSession.ts`에 DB 접근 함수 모음).

**A. 활성 세션 없음** — 아래 순서로 시작 조건만 확인, 전부 해당 없으면 `null` 반환(게임과 무관한 일반 턴):

1. **아이 시작 요청** — 명시적 문구("초성게임 하자"/"초성퀴즈 해"/"초성 게임 할래" 등, `gameIntent.ts`에 결정론 키워드 매칭 함수로 구현) 또는 아이가 스스로 초성을 낸 경우(`/^[ㄱ-ㅎ]{2,6}$/`로 자모만으로 이루어진 2~6자 발화 — `extractChosung`으로 만들 수 있는 형태이자 일반 문장이 아님). 후자는 §10 "아이가 문제를 내는 것" 분기로 바로 `PLAYING_CHILD_ASKS` 세션을 만든다(아래 C). 전자는 cooldown 없이 항상 허용(§4 원칙) — `initiated_by='CHILD'`, `state='OFFERED'` 세션을 만들고 K가 자연스럽게 "좋아! 그럼 내가 먼저 낼게" 식으로 수락하며 바로 첫 문제를 낸다(같은 턴에 `OFFERED`→`PLAYING_K_ASKS`→`WAITING_FOR_ANSWER`까지 전이해도 된다 — 아이가 먼저 요청했으니 K의 확인 왕복을 넣을 필요 없음).
2. **K 선제안** — 아래를 **전부** 만족할 때만: (a) `boredom.level`이 `"rising"` 또는 `"high"`, 또는 `signals`에 "심심해" 계열 신호가 있음(`isVeryShortLowEffort`+반복, 또는 `hasPlayfulSilly`) (b) `!signals.hasConflict && !signals.hasNegativeEmotion && !signals.hasPhysicalNeed` (c) `!signals.hasGeneralKnowledgeQuestion && !signals.hasMemoryRecallQuery`(아이가 몰입한 질의 중이 아님) (d) `!(await isTopicOnCooldownForK(db, childId, "PLAYFUL_GAME_CHOSUNG"))`. 전부 만족하면 `initiated_by='K'`, `state='OFFERED'` 세션을 만들고 `recordTopicUsage(db, childId, "PLAYFUL_GAME_CHOSUNG", "free_chat", "k")`로 cooldown을 즉시 갱신(제안 시점에 갱신 — 승낙 여부와 무관하게 "K가 방금 제안했다"는 사실 자체가 cooldown 대상)한 뒤, Gemini에게 자연스러운 제안 문장만 생성시키고 반환(아직 문제는 내지 않음, 다음 턴에 아이 반응을 봄).
3. 위 두 조건 모두 아니면 `null`.

**B. 활성 세션, `state==='OFFERED'`** (K가 방금 제안한 경우만 — 아이가 요청한 OFFERED는 A-1에서 즉시 다음 상태로 넘어가므로 이 분기에 남지 않음):
- 긍정 응답("좋아"/"하자"/"응"/"콜" 등) → `state='PLAYING_K_ASKS'`로 전이, 첫 단어 선택(아래 "단어 선택 로직") 후 `WAITING_FOR_ANSWER`로 저장, 초성 문제를 화면 표시용 텍스트와 함께 자연스럽게 제시.
- 거절("싫어"/"안 할래"/"안해"/"지금 말고") 또는 다른 화제 → 세션을 `ended_at=now()`로 종료(라운드 기록 없음), `null` 반환(일반 흐름으로 폴백 — 거절을 K가 다시 언급하지 않는다).

**C. 활성 세션, `PLAYING_CHILD_ASKS` 또는 진입 직후** — 아이가 낸 초성에 K가 추론해서 답을 시도한다. 정답 여부를 서버가 판정할 근거가 없으므로(§10) `result='child_asked'`로 라운드를 1건만 기록하고(hint_used=0), 세션을 즉시 종료한다(연속 아이 출제는 다음 턴에 A-1이 다시 새 세션을 만들어 자연스럽게 이어진다). K의 답 문장은 `generate()` 콜백에 "아이가 낸 초성은 {chosung}이야. 친구처럼 답을 추측해서 자연스럽게 말해줘. 항상 다 맞히는 완벽한 AI처럼 굴지 말고, 애매하면 힌트를 되물어봐도 돼(§10)."를 `adapterInstruction`으로 실어 생성한다.

**D. 활성 세션, `state`가 `PLAYING_K_ASKS`/`WAITING_FOR_ANSWER`/`HINT`** (K가 낸 문제를 아이가 풀고 있는 중) — 이번 턴 `currentUtterance`를 아래 **우선순위**로 결정론 분류한다:

1. **강한 비-게임 신호** — `signals.hasConflict || signals.hasNegativeEmotion || signals.hasPhysicalNeed` → 세션을 `ended_at=now()`로 즉시 종료(라운드 미기록 — 미해결 라운드는 통계 오염 방지를 위해 기록하지 않는다), `null` 반환. §15 "Topic Shift는 항상 아이 우선"을 그대로 구현하는 지점 — 이후 처리는 index.ts의 일반 Action Selector(EMPATHY/COMFORT 등)가 담당한다.
2. **그만 요청** — "그만"/"그만할래"/"그만하자"/"다른 거 하자"/"다른 얘기 하자" 계열 → `result='skip'`로 라운드 기록(hint_used=현재 hint_level) 후 세션 종료, K가 자연스럽게 수긍하는 문장 반환(게임 강요 금지, §16 "고정 문제 수 없음"과 일치).
3. **포기/정답 공개 요청** — "포기"/"모르겠다 그만"/"정답 알려줘"/"알려줘" 계열 → `result='revealed'` 라운드 기록, `current_word` 그대로 공개하며 다음 라운드로 이어갈지는 세션 유지 + 새 단어 선택(계속 놀고 싶어할 수 있으므로 바로 종료하지 않고 `WAITING_FOR_ANSWER` 유지, 아이가 그만하고 싶으면 다음 턴에 2번으로 빠진다).
4. **힌트 요청** — "힌트"/"모르겠어"/"어려워"/"몰라" 계열 → `hint_level`을 1 증가(최대 4, `gradePersona.chosungGame.hintStyle`을 프롬프트에 실어 학년별 강도 조절). `hint_level`이 4에 도달하면 3번(정답 공개)과 동일하게 처리. 아니면 라운드 미종료, `state='HINT'`로 갱신 후 해당 단계 힌트(1=카테고리, 2=의미, 3=첫 글자/추가단서) 정보를 `adapterInstruction`에 실어 Gemini가 자연 문장으로 생성.
5. **정답 판정** — `isCorrectAnswer(currentUtterance, currentWord, acceptedAnswers)`가 true → `result='correct'` 라운드 기록(hint_used=현재 hint_level), `computeNextDifficulty()`로 다음 난이도 계산(직전 라운드 포함 최근 5건을 `chosung_game_rounds`에서 조회, `child_asked`는 이미 유틸이 필터링), 새 단어 선택 후 `WAITING_FOR_ANSWER` 유지·다음 문제 제시(§16 고정 완료조건 없음 — 아이가 그만할 때까지 계속). 연속 정답 시 문장 표현은 매번 다르게(§20 "같은 칭찬 문구 반복 금지") — 이건 Gemini 프롬프트 지시 사항으로, gameEngine이 최근 사용한 표현을 저장/강제하지는 않는다(과설계 방지).
6. **그 외(오답 재시도)** — 위 어느 것도 아니면 오답 시도로 간주하고 라운드를 종료하지 않는다(재시도 허용, §6 "재시도 횟수" 신호는 이 세션의 hint_level/HINT 상태 전이로 대리 반영). `state` 그대로 유지, K는 "아쉽다"류의 자연스러운 완충 반응만 하고 다시 기다린다(§20 금지 문구 — "틀렸어"/실력평가 등 — 를 Gemini 프롬프트에 명시적으로 금지 지시).

### 단어 선택 로직 (결정론 + 선택적 개인화)

새 문제가 필요할 때(`WAITING_FOR_ANSWER` 진입 시점) `gameSession.ts`의 `pickNextWord(db, childId, gradePersona, session.recentWords)`:
1. `session.current_difficulty`(없으면 `gradePersona.chosungGame.baseDifficulty`)를 `[minDifficulty, maxDifficulty]`로 clamp.
2. 25% 확률로만(`Math.random() < 0.25`, §12 "매 문제를 Memory 기반으로 내기 금지") `interestPersonalization.ts`의 `pickPersonalizedCategory(db, childId)` 호출 — `memory_facts`에서 `fact_type='interest' AND status='active'`를 최대 5건 조회해 사전 정의된 안전 키워드→카테고리 매핑(예: 포켓몬/캐릭터 이름→"캐릭터", 축구/야구→"스포츠", 마인크래프트/게임 이름→"게임")에 일치하는 게 있으면 해당 `ChosungCategory` 반환, 없으면 `undefined`.
3. `getWordsByDifficulty(min, max, category)`로 후보를 뽑고 `session.recent_words`에 있는 단어는 제외(동일 세션 반복 금지, §13). 후보가 0건이면 category 없이 재조회.
4. 무작위 선택 후 `current_word`/`current_chosung`(`extractChosung`)/`current_category`/`recent_words`(append, 최근 10개만 유지)를 세션에 갱신.

### Cooldown/기록 재사용

신규 cooldown 메커니즘을 만들지 않는다 — `semanticTopicHistory.ts`의 `isTopicOnCooldownForK`/`recordTopicUsage`를 `semanticGroup="PLAYFUL_GAME_CHOSUNG"`, `mode="free_chat"`으로 그대로 호출한다(계획서 상단 "설계 결정" 표와 동일). 아이가 먼저 요청하는 A-1 경로는 이 함수들을 호출하지 않는다(§4 "아이 요청은 cooldown으로 막지 않음").

### 안전 (§23)

`wordPool.ts`는 이미 사람이 검수한 고정 목록이라 추가 필터 불필요. `gameIntent.ts`의 시작 트리거 키워드 매칭과 위 D단계 분류는 전부 결정론 문자열/정규식 매칭이며 LLM을 쓰지 않는다(§8·§9 요구사항 그대로). Safety는 `index.ts` 1번 단계에서 이미 `handleChosungTurn` 호출보다 먼저 확인되므로 게임 로직에 안전 위반 발화가 도달하지 않는다.

### 구현 위임 범위 (신규/수정 파일)

- 신규: `lib/k-conversation/chosungGame/gameEngine.ts`, `gameSession.ts`(DB 접근: getActiveSession/createSession/updateSession/endSession/recordRound/getRecentOutcomes/pickNextWord), `gameIntent.ts`(결정론 키워드 분류), `interestPersonalization.ts`
- 수정: `lib/k-conversation/types.ts`(Action 1개 추가), `lib/k-conversation/index.ts`(위 삽입 지점 1곳)
- 각 신규 로직 함수는 순수 함수 단위로 unit test 포함(특히 `gameIntent.ts` 키워드 매칭, 상태 전이 우선순위 분류 함수는 DB 모킹 없이 순수 함수로 분리해 테스트 가능하게 만든다).
- Codex Sol(high)로 위임 — 여러 파일이 얽힌 상태 머신이라 하드룰 3 표에 따라 게이트①은 claude-review(Opus)가 담당한다(Sol 개발분).

Phase 6(Memory Personalization)과 Phase 7(Semantic History/Cooldown)은 위 설계에 이미 흡수되어 있어 별도 Phase로 분리 위임하지 않는다.
