# 073 Mission v3 — Phase 0: 071 K Conversation Engine 감사 및 Adapter 계약

> 감사일: 2026-08-10 (KST)
> 기준 Production 커밋: `d49b32bdc2e2f29b2e9e0201c248c13186550552`
> 범위: `lib/k-conversation/` 읽기 전용 정적 감사. 신규 런타임 코드·엔진 수정 없음.

## 결론

**Phase 1 Mission Adapter가 071 엔진을 import하여 사용할 수 있는 완성 상태다.** 현재
`lib/k-conversation/`은 기준 Production 커밋 `d49b32b`와 diff가 없으며, 대상 디렉터리에서
`TODO`/`FIXME`/stub/`not implemented` 표식은 발견되지 않았다. 안전·결정론 응답·메모리 조회
실패·LLM 3회 재시도 실패는 모두 의도적으로 닫힌 fallback 경로를 가진다.

071은 "어떻게 말할지"만 소유한다. 073은 Goal 생성·충족 판정·완료·보상·이벤트·운영과
질문은행의 능동 선택만 소유하며, Persona/Memory/Action/Safety/Response Generator를 복제하지
않는다.

## Production 정합 및 안정성 근거

- `git diff --quiet d49b32b -- lib/k-conversation` 결과가 성공(0)이다. 즉 현재 엔진 파일 16개는
  071 Production 배포 기준과 동일하다.
- 실제 Free Chat Adapter인 `app/api/voice/respond/route.ts`가 barrel의 `respond`와
  `checkSafetyPreflight`를 사용한다. 이 route는 인증·세션 소유권·동의/승인·usage logging만
  담당하고, Persona/Memory/Boredom/Action/생성은 엔진으로 위임한다.
- `semanticTopicHistory`의 `conversation_topics` 테이블과
  `record_conversation_topic_usage` 원자 upsert RPC는
  `20260809110000_k_conversation_topic_history.sql`에 정의됐다. RPC는 service role만 실행할 수
  있고, `child_id + semantic_group` 유니크 키로 동시 증가 유실을 막는다.
- `responseGenerator`는 빈 응답·프롬프트 누출을 품질 실패로 취급하고 `[0, 3000, 5000]ms`로
  최대 3회 재생성한다. 모두 실패해도 안전한 자연어 fallback을 반환하므로 미완성 분기가 아니다.
- Semantic Topic History와 Memory는 조회/기록 실패 때 대화를 중단하지 않는 fail-open 경로다.
  이는 대화 가용성을 위한 의도된 오류 처리이며, 오류는 `console.error`로 남긴다.
- 071 E2E 명세(`e2e/qa-071-conversation-engine.spec.ts`)에는 안전, 성취, 갈등, 장난,
  일반지식, 앱 모드, 다중턴 기억, 지루함 반복, 응답 형식, UI 모드 전환, 새로고침 이력의
  11개 시나리오가 있다. 이번 Phase 0은 읽기 전용 정적 감사이므로 재실행하지 않았다.

## 소유권 경계와 호출 순서

```text
073 Mission Adapter (신규 전용 파일)
  ├─ Goal/질문은행에서 다음 능동 주제 선택
  │    └─ isTopicOnCooldownForK(...) 확인
  ├─ Goal 상태·완료·보상·이벤트를 자체 처리
  ├─ adapterInstruction: 불투명 자연어 지시만 구성
  └─ respond(EngineInput, RespondDependencies)
       └─ Safety → deterministic → 4-tier Memory → Boredom
          → Action → Gemini Response → Topic History 기록
```

`adapterContext`와 `adapterInstruction`은 서로 다르다. `adapterContext`는 `EngineInput`의
Adapter 전용 확장 슬롯이며 엔진은 해석하지 않는다. 실제 응답 방향은
`RespondDependencies.adapterInstruction`에 불투명 문자열로 전달한다. Goal ID, 남은 개수,
parent question 출처, 보상 판단을 엔진 내부 타입/분기로 옮기지 않는다.

## Phase 1 필수 공용 계약

### 1. 단일 Engine 진입점

```ts
import {
  respond,
  checkSafetyPreflight,
  type EngineInput,
  type EngineOutput,
  type ConversationAction,
  type ConversationMode,
  type GenerateArgs,
} from "@/lib/k-conversation";

interface RespondDependencies {
  db: SupabaseClient;
  ai: GenerateArgs["ai"];
  modelId: string;
  adapterInstruction?: string;
  recentActions?: ConversationAction[];
}

function respond(input: EngineInput, deps: RespondDependencies): Promise<EngineOutput>;
function checkSafetyPreflight(
  db: SupabaseClient,
  sessionId: string,
  currentUtterance: string,
): Promise<EngineOutput | null>;
```

`EngineInput`은 `{ childId, sessionId, mode, currentUtterance, asrConfidence?, appMode?,
adapterContext? }`다. Mission Adapter는 `mode: "MISSION"`을 넣는다. `appMode`는
`"auto" | "manual"`, `adapterContext`는 `Record<string, unknown>`이다.

`EngineOutput`은 `{ text, action, category, safetyFlagged?, safetySubcategory?,
memoryTiersUsed?, tokenIn, tokenOut }`다. `category`는 `"safety" | "deterministic" |
"generated"`; `action`은 safety/결정론 경로에서는 nullable이다. Adapter는 `tokenIn/out`을
usage event에 기록할 수 있지만 보상·Goal 완료의 근거로 사용하지 않는다.

### 2. Semantic Topic History — 질문은행 능동 선택 전용

```ts
import {
  recordTopicUsage,
  isTopicOnCooldownForK,
  fetchRecentTopics,
  type TopicInitiator,
  type TopicMode,
  type RecentTopic,
} from "@/lib/k-conversation/semanticTopicHistory";

type TopicInitiator = "child" | "k" | "parent_question";
type TopicMode = "mission" | "free_chat";

function recordTopicUsage(
  db: SupabaseClient, childId: string, semanticGroup: string,
  mode: TopicMode, initiatedBy: TopicInitiator, cooldownDays?: number,
): Promise<void>;
function isTopicOnCooldownForK(
  db: SupabaseClient, childId: string, semanticGroup: string,
): Promise<boolean>;
function fetchRecentTopics(
  db: SupabaseClient, childId: string, limit?: number,
): Promise<RecentTopic[]>;
```

`RecentTopic`은 `{ semanticGroup, lastUsedAt, childFrequency, kFrequency,
lastInitiatedBy, mode }`다. Phase 1의 질문은행/Goal 선택기는 **K가 먼저 새 질문을 제안하기
직전** `isTopicOnCooldownForK`가 `true`인 semantic group을 후보에서 제외한다. 아이가 먼저
꺼낸 주제에는 cooldown을 적용하지 않는다. parent question에서 유래했음을 기록할 때만
`initiatedBy: "parent_question"`을 사용한다. 일반 Engine `respond()`는 현재 아이 발화의
주제를 `child`로 기록하고, `TOPIC_SHIFT` 때만 K가 새로 낸 group을 `k`로 기록한다.

### 3. Boredom Detection

```ts
import {
  assessBoredom,
  type BoredomLevel,
  type BoredomAssessment,
} from "@/lib/k-conversation/boredomDetection";

type BoredomLevel = "none" | "rising" | "high";
function assessBoredom(recentChildUtterances: string[]): BoredomAssessment;
```

`BoredomAssessment`는 `{ level, signalCount, matchedTurns, suggestedAdjustment }`다.
`suggestedAdjustment`는 `none`이면 `null`, 그 외에는 question rate·topic stop·fun·child
choice·topic shift·early finish 허용의 boolean 묶음이다. 최근 5개 아이 발화에서 비협조
신호 2개면 `rising`, 3개 이상이면 `high`다. Engine `respond()`가 same-session 아이 발화로
이미 계산·Action 선택에 반영하므로, Adapter는 같은 감지를 재구현하지 않는다. Phase 4 보상은
이 결과를 직접 신뢰하지 말고, 정식 완료/Goal 상태와 결합해 판정한다.

### 4. Action Selector

```ts
import {
  selectAction,
  type ActionSelectorInput,
} from "@/lib/k-conversation/actionSelector";

function selectAction(input: ActionSelectorInput): ConversationAction;
```

`ActionSelectorInput`은 `{ signals, boredom, hasRecentEpisode, hasLongTermMemory,
recentActions, rand? }`다. 반환 `ConversationAction`은 `EMPATHY`, `CURIOSITY`, `JOKE`,
`MEMORY_RECALL`, `OWN_OPINION`, `PLAYFUL_TEASING`, `IMAGINATION`, `CELEBRATION`,
`COMFORT`, `FOLLOW_UP`, `TOPIC_SHIFT`, `JUST_LISTEN` 중 하나다. Mission Adapter의 기본
경로는 이 함수를 직접 부르지 않고 `respond()`에 `recentActions`만 전달한다. 직접 호출은
071과 Action 규칙이 분기될 위험이 있으므로 금지한다.

### 5. Response Generator

```ts
import {
  generateResponse,
  type GenerateArgs,
  type GeneratedResponse,
  type ResponseGeneratorInput,
  type ResponseGeneratorHistoryTurn,
} from "@/lib/k-conversation/responseGenerator";

function generateResponse(args: GenerateArgs): Promise<GeneratedResponse>;
```

`GenerateArgs`는 `{ ai, modelId, input }`이며 `ai.models.generateContent`는
`GoogleGenAI["models"]["generateContent"]`와 같은 SDK 함수 타입이다. `ResponseGeneratorInput`은
`{ mode, action, corePersonaFragment, gradePersonaFragment, memoryFragment,
currentUtterance, recentHistory, adapterInstruction?, isGeneralKnowledgeQuestion? }`다.
`GeneratedResponse`는 `{ text, tokenIn, tokenOut, regenerated }`다.

Phase 1은 이 저수준 API를 직접 호출하지 않는다. Persona/Memory fragment 조립을 중복하지
않고 `respond()`만 사용한다. Mission Goal의 자연어 방향이 필요할 경우에만
`adapterInstruction`을 통해 전달하며, 프롬프트 안에 parent question의 출처·Goal 상태·보상
규칙을 노출하지 않는다.

### 6. Persona와 4-tier Memory (엔진 내부가 조립, 필요 시 읽기 계약)

```ts
import {
  loadCorePersonaContext,
  buildCorePersonaFragment,
  type CorePersonaContext,
} from "@/lib/k-conversation/corePersona";
import {
  resolveGradePersona,
  buildGradePersonaFragment,
  type GradePersona,
  type ElementaryGrade,
} from "@/lib/k-conversation/gradePersonas";
import {
  loadRelationshipMemory,
  formatRelationshipMemory,
  type RelationshipMemoryInput,
  type RelationshipMemorySnapshot,
} from "@/lib/k-conversation/memory";
```

- `loadCorePersonaContext(db, childId): Promise<CorePersonaContext>`와
  `buildCorePersonaFragment(ctx): string`
- `resolveGradePersona(gradeRaw: string | number | null | undefined): GradePersona | null`와
  `buildGradePersonaFragment(persona): string`
- `loadRelationshipMemory(db, { childId, sessionId, currentUtterance }): Promise<RelationshipMemorySnapshot>`와
  `formatRelationshipMemory(snapshot): string`

`RelationshipMemorySnapshot`은 `sameSession`, `sameDay`, `recentEpisode`, `longTermFacts`,
`tiersUsed`를 가진다. 각 tier 실패는 빈 값으로 격리되고, formatter는 Silent Memory 규칙을
프롬프트에 포함한다. 073은 이 모듈을 읽거나 조립하지 않으며 `respond()`에 맡긴다.

### 7. Safety와 Utterance Signals

```ts
import {
  pickReaction,
  type ReactionResult,
  type ReactionCategory,
  type SafetySubcategory,
} from "@/lib/k-conversation/safety";
import {
  extractUtteranceSignals,
  estimateSemanticGroup,
  type UtteranceSignals,
} from "@/lib/k-conversation/utteranceSignals";

function extractUtteranceSignals(text: string): UtteranceSignals;
function estimateSemanticGroup(signals: UtteranceSignals): string;
```

Safety는 `respond()`와 `checkSafetyPreflight()`가 최우선으로 적용하므로 Mission Adapter가
`pickReaction`을 직접 호출해 별도 안전 규칙을 만들지 않는다. Signals 역시 엔진의 Action 및
주제 기록을 위한 내부 입력이다. Adapter가 질문은행 metadata의 `semantic_group`을 선택할 때는
그 metadata를 그대로 사용하고, 아이 발화의 근사 group이 정말 필요할 때에만 위 두 함수를
재사용한다.

## Phase 1 구현 가드

- 073 신규 파일에서 `lib/k-conversation`의 함수를 복사하거나 자체 Persona/Memory/Boredom/
  Action/Response 구현을 만들지 않는다.
- Mission 요청 경로는 `checkSafetyPreflight`를 엔진 밖 조기 반환보다 먼저 호출하거나,
  조기 반환이 없다면 `respond()`의 Safety 경로를 반드시 통과시킨다.
- Goal/parent question 데이터는 Adapter 소유다. 엔진에는 불투명 `adapterInstruction`만 전달하며,
  `EngineInput.adapterContext`를 엔진 조건 분기에 의존하는 계약으로 확장하지 않는다.
- K가 능동 선택하는 질문만 cooldown 대상으로 삼고, 현재 아이 발화에 대한 반응을 차단하지 않는다.
- 이번 감사는 코드 작성·마이그레이션·배포·동적 E2E를 수행하지 않았다.
