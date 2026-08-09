# K Conversation Engine — 자유대화 v2 전면 개편 (071 기준)

> 근거: `requests/071-request-free-chat-v2-k-conversation-engine.md`
> 관련(참고만, 이번 범위 아님): `requests/073-mission-v3-single-daily-dynamic-conversation-master-request.md`
> 작성: 메인 Claude (Opus, xhigh) — 아키텍처 전환 판단(하드룰 1 예외)

---

## Phase 0. AS-IS 감사 결과

### 호출 흐름 (현재)

```
app/chat/page.tsx (mode: voice|text, isAuto, 10분세션/1분쿨다운은 별도 API)
  → POST /api/voice/respond
      1. 인증 + chat_sessions 조회
      2. fetchKPeerPersonaForChild()          [lib/persona/kPeerPersona.ts]
      3. 동의/승인 가드
      4. pickReaction() 안전검사              [lib/freeChatReactions.ts] — 걸리면 즉시 반환 + safety_events insert
      5. 방학/새학기 규칙 분기                 [lib/plan/vacationEventDetector.ts]
      6. isMemoryRecallQuery() → generateMemoryRecallResponse() [lib/freechat/memoryRecallResponder.ts]
         (아이가 "내가 전에 뭐 좋아한다고 했어?" 류로 물을 때만. 전용 Gemini 호출, 기억 목록 밖 내용 금지)
      7. generateReflectiveReaction() 규칙엔진 [lib/freechat/reactionEngine.ts]
         - low ASR confidence → unclear_audio
         - app_mode_question (자동/수동모드 질문)
         - k_identity_question
         - direct_question → FREE_CHAT_UNKNOWN_CONTENT_PHRASE 고정 문구 반환 (Gemini 호출 안 함) ← 071이 제거 지시한 지점
      8. (7에서 안 걸리면) buildRelationshipContext(mode:"free_chat") [lib/relationship/relationshipContext.ts]
         + FREE_CHAT_SYSTEM_PROMPT + kPeerPersona fragment → Gemini 호출
      9. validateFreeChatResponse() [lib/freechat/geminiPolicy.ts]
         - 30자/2줄 제한, 물음표 금지, 의문사 패턴 금지, 조언투 금지, 프롬프트누출 금지
         - 실패 시 더 엄격한 지시로 1회 재시도
      10. normalizeFreeChatResponse() — 그래도 실패하면 고정 문구 "응, 네 이야기 잘 듣고 있어."

  → POST /api/chat/messages (child/k 각 턴 별도 저장, turn_id 기준 idempotent upsert)
  → POST /api/voice/tts (Google Cloud TTS Wavenet, Gemini TTS 아님, 응답 생성과 완전 분리)
```

### 기존 재사용 가능 자산

| 파일 | 현재 역할 | 071에서의 위치 |
|---|---|---|
| `lib/freeChatReactions.ts` | 안전검사(자해/폭력/방임 등 5종 세부), 규칙기반, LLM 미사용 | **그대로 유지**, Engine의 Safety 모듈로 그대로 흡수(로직 변경 없음, 항상 최우선 게이트) |
| `lib/freechat/reactionEngine.ts` | classifyAndExtract 분류 + 카테고리별 canned 템플릿 | unclear_audio/app_mode_question 분류는 유지(결정론 필요), **direct_question의 canned 응답 역할만 제거** |
| `lib/persona/kPeerPersona.ts` | K의 동갑 정체성(나이/학년 자기소개) 좁은 모듈 | K Core Persona의 하위 사실 모듈로 흡수 |
| `lib/persona/gradeAdaptivePersona.ts` | 학년별 페르소나, 9필드 | Grade Persona의 기반 — **16+필드로 확장 필요**(신규: peerAge/sentenceComplexity/responseLengthGuideline/reactionStyle/humorStyle/playfulTeasingLevel/curiosityStyle/followUpDepth/ownOpinionStyle/friendshipLanguage/imaginationStyle/forbiddenAdultTone/goodExamples/badExamples) |
| `lib/relationship/relationshipContext.ts` | profile + 최근 6턴(chat_messages) + memory_facts 벡터검색 top5 + 최근 event 1건, "Silent Memory" 원칙 이미 일부 반영 | 4-tier Memory의 **부분 구현** — Same-session(최근턴)·Long-term(memory_facts)은 있음. Same-day·Recent-Episode를 명시적 tier로 분리 안 됨. Semantic Topic History·Boredom 전혀 없음 |
| `lib/freechat/memoryRecallResponder.ts` | "기억나?" 질문 전용 Gemini 호출, memory_facts 우선 + child_memory fallback | Long-term Memory 조회 경로로 재사용 |
| `lib/memory/vectorRetrieval.ts` | memory_facts 벡터검색 | Long-term Memory tier의 조회 계층으로 재사용 |
| `lib/freechat/geminiPolicy.ts` | 30/15자 제한, 물음표·의문사·조언투 금지, canned fallback | **제거 대상 그 자체** — Response Generator로 교체 |

### DB 자산

- `memory_facts`(interest/friend/family/dream/event/trait/pattern, confidence/importance/status, 벡터) — Long-term Memory.
- `child_memory`(short_term 7일/long_term, 배치 2회/일 채움) — 구버전 병렬 레이어, memoryRecallResponder의 fallback으로만 사용 중.
- `chat_messages`(session_id/turn_id/role/content/mode/voice_mode/display_sequence/turn_status) — Same-session tier의 원천.
- **Semantic Topic History에 필요한 테이블 없음 — 신규 테이블 필요** (`conversation_topics`: child_id/semantic_group/last_used_at/frequency/cooldown_until/child_initiated/k_initiated/mode/created_at). 13개 보호 테이블 변경이 아니라 신규 생성이지만, DB 스키마 변경 항목이므로 §2 예외(즉시 게이트) 적용 + `_log.md`에 기록.

### 건드리지 않는 것 (071 명시 + 아키텍처 경계)

- 세션 정책(10분 세션 + 1분 쿨다운, 일일 횟수/시간 제한 없음) — `app/api/chat/session`, `freechat-usage`, `pause`.
- TTS 경로(Wavenet, sanitizeForTts) — 완전히 분리된 관심사.
- `chat_messages` 저장 경로(`/api/chat/messages`) — 계약(turn_id idempotency, mission의 displaySequence 요구) 그대로.
- 안전검사(`freeChatReactions.ts`)의 판정 로직 자체 — 항상 Persona보다 우선.
- 미션 어댑터(073) — 이번 패스에서 구현하지 않음. Engine의 계약만 미션과 호환되게 설계.
- Relationship Stage — 명시적으로 이번 범위 제외(071 표기).

---

## Phase 1. lib/k-conversation/ 모듈 계약 (TO-BE)

```
lib/k-conversation/
  types.ts                 — ConversationMode(FREE_CHAT|MISSION), ConversationAction enum, 공통 인터페이스
  corePersona.ts            — K Core Persona (전 학년 공통 정체성/톤/금지선), kPeerPersona.ts 흡수
  gradePersonas.ts          — 1~6학년 독립 프로필 16+필드 (gradeAdaptivePersona.ts 확장)
  memory/
    sameSession.ts          — 이번 세션 내 최근 턴 (relationshipContext의 기존 chat_messages 조회 이관)
    sameDay.ts               — 오늘 있었던 다른 세션/미션 turn 요약 (신규 — 오늘자 chat_messages 전체 세션 스캔)
    recentEpisode.ts         — 최근 1~2개 salient event (memory_facts fact_type=event 우선)
    longTerm.ts               — memory_facts 벡터검색 + child_memory fallback (vectorRetrieval.ts, memoryRecallResponder.ts 재사용)
    index.ts                  — 4-tier를 하나의 RelationshipContext로 합성 (relationshipContext.ts 리팩터)
  semanticTopicHistory.ts    — conversation_topics 테이블 read/write, cooldown 판정
  boredomDetection.ts        — 최근 N턴 반복/짧은응답 패턴 감지 (단발 트리거 금지, 다중턴 근거)
  actionSelector.ts          — Action 열거형만 결정 (EMPATHY/CURIOSITY/JOKE/MEMORY_RECALL/OWN_OPINION/
                                PLAYFUL_TEASING/IMAGINATION/CELEBRATION/COMFORT/FOLLOW_UP/TOPIC_SHIFT/JUST_LISTEN)
                                — 고정 문구 절대 생성 안 함, 방향 결정만
  safety.ts                  — freeChatReactions.ts 재노출(로직 불변), Engine의 최우선 게이트
  responseGenerator.ts       — Action+GradePersona+CorePersona+현재발화+RelationshipContext+RecentHistory+mode
                                → Gemini 자연생성. geminiPolicy의 hard-guard/재시도/canned-fallback 제거.
                                안전 관련 최소 검증(빈 응답/프롬프트 누출)만 남김.
  index.ts                   — respond(input): Adapter가 호출하는 단일 진입점
```

### 핵심 계약

```ts
// types.ts
type ConversationMode = "FREE_CHAT" | "MISSION";

interface EngineInput {
  childId: string;
  sessionId: string;
  mode: ConversationMode;
  currentUtterance: string;
  asrConfidence?: number;
  // Adapter가 채우는 모드별 확장 슬롯(Mission Goal Layer는 여기로만 주입, Engine은 내용을 모름)
  adapterContext?: Record<string, unknown>;
}

interface EngineOutput {
  text: string;
  action: ConversationAction;
  category: "safety" | "deterministic" | "generated"; // 안전/규칙엔진/Gemini생성 구분(관측용)
  safetyFlagged?: boolean;
}
```

- **Engine은 "어떻게 말할지"만 안다. Mission Goal/Completion/parent_questions/reward는 절대 모른다.** Free Chat Adapter는 `adapterContext`를 아예 채우지 않는다.
- Safety는 Engine 최우선 게이트로 `index.ts`에서 가장 먼저 호출 — Persona/Action보다 항상 우선.
- Silent Memory: `responseGenerator`에는 항상 `currentUtterance`를 최우선 컨텍스트로 넘기고, 기억은 "참고 정보"로만 프롬프트에 주입 — 기억 자체를 그대로 출력하도록 강제하지 않는다.
- child_id 격리: 모든 tier 조회는 `child_id` 필수 파라미터, 다른 아이 데이터 조인 금지(기존 relationshipContext 원칙 유지).
- child_initiated/k_initiated 구분: `semanticTopicHistory`가 각 topic 사용을 누가 먼저 꺼냈는지로 기록.

---

## 실행 순서 (게이트 포함)

1. **Phase 1 스켈레톤+계약**: 메인 Claude 직접 작성(`types.ts`, 각 모듈 빈 골격+시그니처, `index.ts` 배선). 아키텍처 결정이므로 위임 안 함.
2. **Phase 2 Grade Persona 확장**: Codex Sol(high, 아키텍처 민감 아니지만 6학년×16필드 볼륨+톤 일관성 필요라 Sol) 위임 → claude-review 아님, codex-rv(Sol 별도세션) 리뷰.
3. **Phase 3 Memory/Topic/Boredom**: Codex Sol 위임(DB 신규 테이블 포함 → §2 예외, 즉시 게이트) → codex-rv(Sol).
4. **Phase 4 Action Selector + Response Generator**: 메인 Claude 직접(guard 제거는 안전 경계와 직결되는 아키텍처 판단) → claude-review(Opus) 게이트, 하드룰 3 준수.
5. **Phase 5 Free Chat Adapter(route.ts) 통합**: Codex Terra(단순 배선 성격) 또는 Claude 직접(연결부 복잡하면), 완료 후 게이트①.
6. **Phase 6 Dev QA**: agy, 1~6학년 대표 시나리오×Memory×반복성×Boredom×Topic Shift×자동/수동/키보드×STT/TTS×세션정책×기존 파이프라인 회귀.
7. **Phase 7**: BLOCKED/HIGH/MEDIUM 0건 시 Production 배포, 071 §33 형식으로 보고.

각 Phase 산출물은 그 자체로 게이트①(정적)을 통과해야 다음 Phase로 넘어간다(071 자체 규정).
