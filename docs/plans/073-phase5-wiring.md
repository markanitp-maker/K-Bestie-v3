# 073 Mission v3 — Phase 5 실배선 (Live Route Wiring)

> 근거: `requests/073-mission-v3-single-daily-dynamic-conversation-master-request.md`
> 대표님 승인: 2026-08-11 채팅 직접 지시 ("073 Phase 5 실배선 작업 진행해줘")
> 작성: 메인 Claude (Opus, xhigh) — 아키텍처 전환 판단(하드룰 1 예외: 여러 모듈 통합·설계)

---

## 0. 배경

073 Phase 1~4(세션 로그 기준 명칭 — 마스터 지시서 §25-32의 공식 Phase 0-7과는 번호가
다르다, 아래 "번호 매핑" 참고)는 게이트①을 전부 통과했지만, AS-IS 감사(Codex Sol,
읽기전용, 2026-08-11) 결과 Mission v3가 **실제 아이 미션 플레이 흐름에 한 번도 연결된
적이 없다**는 사실이 확인됐다. DB 스키마·RPC·Goal Engine·질문은행 metadata·시간정책
모듈은 전부 존재하지만, 어느 것도 production route에서 호출되지 않는다.

### 번호 매핑 (혼동 방지)

| 세션 로그 명칭 | 마스터 지시서 공식 Phase | 내용 |
|---|---|---|
| "073 Phase 1" | §26-27 근처(§27 Phase 2에 해당) | Goal cooldown 초기 판정 |
| "073 Phase 2" | §28 Phase 3 | 질문은행 metadata + Semantic Topic History |
| "073 Phase 3" | §29 Phase 4 일부 | Time Policy + daily_single 정책(값 정의만, 미배선) |
| "073 Phase 4" | §29 Phase 4 일부 | Reward Idempotency + Boredom 보상 규칙(RPC만, 미배선) |
| **이 문서 "Phase 5"** | §29 Phase 4의 나머지("frontend", "mission_progress" 실배선) + §30 Phase 5 | **실배선** — 이 문서의 범위 |

즉 세션에서 "Phase 4까지 통과"라고 불러온 것은 마스터 지시서 기준으로는 아직 §29
Phase 4의 절반(DB/모듈 준비)만 끝난 상태다. "frontend"와 "mission_progress" 실사용
연결은 원래 마스터 지시서 §29가 요구하는 항목인데 지금까지 빠져 있었다.

---

## 1. AS-IS 감사 요약 (2026-08-11, Codex Sol 읽기전용)

### 1.1 이미 존재하지만 호출부가 없는 모듈

| 모듈 | 위치 | 상태 |
|---|---|---|
| Goal 초기화 | `lib/mission-v3/goalEngine.ts` `initializeConversationGoals` | 함수만 존재, production 호출 0 |
| Goal 후보(질문은행 metadata) | `lib/mission-v3/questionBank.ts` `loadMissionQuestionGoalCandidates` | 함수만 존재, production 호출 0 |
| Goal 판정 반영·K 응답 생성 | `lib/mission-v3/missionAdapter.ts` `respondToMissionTurn` | 파일 자체에 "no route wires this adapter yet" 명시 |
| 시간 게이트(13~23, daily_single) | `lib/mission-v3/timePolicy.ts` `evaluateMissionTimeGate`/`decideDailySingleOperation` | 함수만 존재, production 호출 0 |
| v3 보상 지급 | `lib/mission-v3/rewardPolicy.ts` `awardMissionV3Reward` → RPC `award_mission_v3_reward` | 래퍼·RPC 존재, production 호출 0 |
| Goal 판정 자체(`evaluateGoalSatisfaction`) | `goalEngine.ts` | **아이 발화를 실제로 판정하는 LLM 계층이 아예 없다** — 이미 만들어진 `assessments: GoalAssessment[]`를 검증·변환만 함 |

### 1.2 현재 실제로 실행되는 레거시 경로

```
app/child/missions/page.tsx (question_ids 배열을 순서대로 순회, K가 아니라 프론트가 "다음 질문" 결정)
  → POST /api/mission/start   (round1_day/round2_night/common만 허용, selectQuestions*로 고정 문항 10~20개 선택)
  → POST /api/mission/turn    action=start
      → RPC start_mission_turn_v1  (p_question_id가 mission_progress.question_ids 안에 있어야 함 — 하드 제약)
      → 내부적으로 POST /api/mission/answer 호출 (레거시 유효답변 판정 + nextQuestionText 생성, question_ids 인덱스 진행)
      → RPC mark_mission_turn_answered_v1
  → POST /api/mission/turn    action=finalize
      → RPC finalize_mission_turn_v1
          - mission_policy_version이 'v3_single_daily'가 아닌 세션(v2_dual 포함 모든 현재 세션)만
            유효답변 수 기준으로 COMPLETED 전이 + 레거시 보상 처리
          - v3 세션은 여기서 완료 처리를 의도적으로 건너뜀(award_mission_v3_reward 몫)
```

### 1.3 정확한 RPC 재사용성 확인 (이번 문서 작성 중 직접 확인)

- `start_mission_turn_v1`(최신 정의: `20260807193000_mission_turn_payload_validation.sql`)은
  `p_question_id::uuid = ANY(mission_progress.question_ids)`를 **하드 검증**한다. v3는
  고정 문항 목록이 없으므로(K가 매 턴 무엇을 물을지 동적으로 정함) 이 RPC를 그대로
  재사용할 수 없다 — **v3 전용 턴 저장 RPC가 별도로 필요하다**(§3.3).
- `finalize_mission_turn_v1`은 이미 v3 세션의 완료 처리를 의도적으로 건너뛰도록 설계돼
  있다(073 Phase 4 R2 수정) — 이 부분은 그대로 재사용 가능, 별도 수정 불필요.
- `mission_progress`에 `mission_policy_version`/`effective_at`/`round_type IN (...,'daily_single')`
  컬럼과 제약이 이미 있다(20260810220000) — 스키마는 준비돼 있다.

---

## 2. 설계 결정

### 2.1 레거시 코드에 손대지 않는다 — 신규 v3 전용 경로 병행

`app/api/mission/start/route.ts`(637줄)와 `app/api/mission/answer/route.ts`는 V1/V2
질문엔진 폴백, 동시성 dedup, resume, RESERVE backfill 등 극도로 얽힌 레거시 로직을
담고 있다. 이 안에 v3 분기를 끼워 넣으면 기존 아이들에게 회귀 위험이 크다.

**결정**: v3 전용 API 라우트를 완전히 새로 만든다. 레거시 라우트는 **한 줄도 수정하지
않는다**. 프론트엔드가 정책 해석 결과에 따라 legacy 라우트 또는 v3 라우트 중 하나만
호출하도록 분기한다.

```
app/api/mission/v3/
  start/route.ts   — daily_single 세션 시작/이어하기
  turn/route.ts     — 아이 발화 1턴 처리(저장 + Goal 판정 + K 응답 + 필요 시 보상)
  today-progress/route.ts — 홈 화면용 당일 daily_single 상태 조회
```

### 2.2 정책 판정 — 환경별 `effective_at` 스위치

마스터 지시서 §15가 요구하는 `mission_policy_version`/`effective_at` 메커니즘을
`STT_A1`이 썼던 것과 동일한 패턴(환경변수 기반, Dev/Production 완전 분리)으로 구현한다.

```ts
// lib/mission-v3/policyResolution.ts (신규)
export function resolveMissionPolicyVersion(now: Date = new Date()):
  { version: "v2_dual" | "v3_single_daily"; effectiveAt: string | null }
```

- 신규 환경변수 `MISSION_V3_EFFECTIVE_AT`(ISO 8601, KST 기준 cutover 시각) — 이번
  Phase 5에서는 **Dev에만** 설정한다(과거 즉시 cutover 값, 예: 2026-01-01). Production
  에는 절대 설정하지 않는다 — 미설정 시 항상 `v2_dual`을 반환해 레거시로 완전히
  폴백하므로, 이 변수 자체가 Production 무영향을 보장하는 안전장치다.
- 프론트엔드 홈 화면이 세션 시작 전에 이 정책을 알아야 하므로, 기존 `today-progress`
  또는 별도의 정책 조회 엔드포인트가 `{ policyVersion }`을 내려준다.

### 2.3 신규 DB — v3 전용 턴 저장 RPC

`start_mission_turn_v1`의 원자적 저장·idempotency(advisory lock, client_turn_id 재시도
안전성) 설계는 그대로 재사용하되, question_id 하드 검증만 제거한 v3 버전을 만든다.

```sql
-- 신규 마이그레이션 (파일명 미정, 최신 마이그레이션 이후 타임스탬프)
CREATE OR REPLACE FUNCTION public.start_mission_turn_v3(
  p_session_id uuid,
  p_client_turn_id text,
  p_answer_text text,
  p_voice_mode text,
  p_display_sequence integer
) RETURNS TABLE (turn_status text, already_processed boolean)
-- question_id 파라미터 없음 — v3는 고정 문항이 없다.
-- mission_progress.mission_policy_version = 'v3_single_daily'인 세션에서만 허용(CHECK).
-- 나머지 idempotency/advisory lock 로직은 start_mission_turn_v1과 동일 패턴.
```

기존 `finalize_mission_turn_v1`은 수정하지 않고 그대로 재사용(v3 세션은 이미 완료
처리를 건너뛰도록 설계돼 있음 — §1.3).

DB 스키마 변경이므로 CLAUDE.md §2 예외(즉시 게이트, Sol 리뷰) 적용.

### 2.4 Goal Assessment 판정기 — 신규 LLM 계층 (가장 중요한 신규 설계)

`evaluateGoalSatisfaction()`은 이미 만들어진 `GoalAssessment[]`를 소비만 한다. 이
`GoalAssessment[]`를 아이 발화로부터 실제로 만드는 계층이 없다 — 이것이 073 전체에서
유일하게 "새로 설계해야 하는 AI 판정 로직"이다.

**설계**:

```ts
// lib/mission-v3/goalAssessor.ts (신규)
export async function assessGoalsFromUtterance(input: {
  ai: GenerateArgs["ai"];       // 071 K Conversation Engine과 동일한 AI 클라이언트 재사용
  modelId: string;
  currentUtterance: string;
  goals: MissionPromptGoal[];   // PENDING/PARTIAL 상태인 Goal들만 판정 대상
}): Promise<GoalAssessment[]>
```

- **071/073 공통 계약을 지킨다**: Persona/Safety/Response Generator를 재구현하지
  않는다 — 이 판정기는 순수하게 "이 발화가 어떤 Goal을 얼마나 충족했는가"만 구조화
  출력으로 판정하고, K의 실제 답변 문장은 만들지 않는다(그건 `respondToMissionTurn`
  내부의 `engine.respond()`가 담당).
- `@google/genai` SDK 사용, `responseMimeType` 금지 — 프롬프트에 JSON 스키마를
  강제하고 `extractJSON`으로 파싱(AGENTS.md §6~§10 규약 그대로).
- 프롬프트 입력: 현재 PENDING/PARTIAL Goal들의 `semanticGroup` + `promptInstruction`
  (아이에게 보여줄 목적이 아니라 판정 기준으로) + 아이의 현재 발화 + 직전 몇 턴의
  대화 맥락(과잉 추궁 방지용, Same-session Memory 재사용).
  출력 스키마: `[{ goalId, status: SATISFIED|PARTIAL|DECLINED|SKIPPED, confidence, evidenceSource }]`.
- 신뢰도 낮은 판정은 이미 `evaluateGoalSatisfaction`이 `MIN_GOAL_CONFIDENCE` 미만이면
  버리므로, 판정기는 과감하게 판정하고 후단 필터링에 맡긴다.
- 실패(파싱 실패/API 오류) 시: 빈 배열 반환 — 판정 불가는 "아직 충족 안 됨"과 동일
  효과(PENDING 유지), 세션을 막지 않는다(fail-open이 아니라 "이번 턴은 판정 보류").

### 2.5 턴 처리 시퀀스 (v3 전용)

```
POST /api/mission/v3/turn { sessionId, clientTurnId, answerText, voiceMode, displaySequence }
  1. auth + session ownership + mission_policy_version='v3_single_daily' 확인
  2. RPC start_mission_turn_v3 (아이 발화 원자적 저장, idempotent)
  3. 현재 세션의 conversation_goals 조회 (PENDING/PARTIAL만)
  4. assessGoalsFromUtterance() → GoalAssessment[]
  5. respondToMissionTurn({ ...., assessments }) 호출
     → 내부에서 evaluateGoalSatisfaction + persistGoalDecisions + K 응답 생성 + cooldown 기록
  6. K 응답을 finalize_mission_turn_v1로 저장 (기존 RPC 그대로 재사용)
  7. 갱신된 Goal 목록 재조회 → hasMissionGoalThreshold() 체크
  8. 3개 이상 SATISFIED이고 아직 미완료면 awardMissionV3Reward() 호출
  9. 응답: { kMessage, completed, rewardStatus, goalProgress(내부용, 아이에게 체크리스트로 노출 금지) }
```

### 2.6 프론트엔드 계약 변경 (Phase 5의 후반 서브단계, §4 참고)

`app/child/missions/page.tsx`는 현재 "질문 배열 인덱스 순회" 모델이다. v3는 그 모델이
아예 없다 — 매 턴 자유발화를 보내고 K의 자연스러운 응답을 받을 뿐이다. 이는 사실상
`app/chat/page.tsx`(자유대화, 071 Free Chat Adapter)의 턴 처리 패턴에 더 가깝다.
프론트엔드 서브단계에서는 미션 전용 UI 골격(진행률 표시는 "질문 몇 개 남음"이 아니라
Goal 내부 카운트를 아이에게 안 보이는 방식으로 은유적으로만 — 예: 대화 시간 기반
진행바)만 유지하고, 실제 턴 송수신 로직은 자유대화 패턴을 참고해 재작성한다.

---

## 3. 서브 Phase 분할 (게이트 단위)

같은 파일 그룹은 함께 묶어 게이트를 최소화하되, DB 변경은 즉시 게이트(하드룰 §2 예외).

| 서브 Phase | 범위 | 위험도 | 담당 |
|---|---|---|---|
| **5A** | `lib/mission-v3/policyResolution.ts` 신규 + 신규 DB 마이그레이션(`start_mission_turn_v3` RPC) | 낮음(신규 파일만, 레거시 무변경) | Codex Terra(정책) + Codex Sol(DB, [복잡] 등급) |
| **5B** | `lib/mission-v3/goalAssessor.ts` 신규(Goal 판정 LLM 계층) | 중간(신규 AI 판정 로직) | Claude 직접 설계 후 Codex Terra 구현, 정적 리뷰 Sol |
| **5C** | `app/api/mission/v3/start/route.ts`, `app/api/mission/v3/turn/route.ts`, `app/api/mission/v3/today-progress/route.ts` 신규 | 높음(엔드투엔드 조립, Goal→보상 흐름) | Codex Sol([복잡], 다중 모듈 통합) |
| **5D** | 프론트엔드(`app/child/missions/page.tsx` 또는 신규 v3 전용 화면, `app/child/home/page.tsx` 정책 분기) | 높음(사용자 화면 직접 영향) | Claude 설계 후 Codex 위임, 게이트①+② 필수 |
| **5E** | Admin/Report policy-aware rendering(§22 요구사항) | 낮음(표시 전용) | Codex Terra |
| **5F** | Dev E2E — daily_single 실제 아이 플레이 1건 이상 성공 확인(마스터 §31 Full E2E Gate의 축소판) | — | agy 또는 Claude 직접 Playwright |

**Production 배포는 이 문서의 범위가 아니다** — 마스터 지시서 §32 "Production Cutover"는
Full E2E Gate(§31) 전체 통과 후에만 진행되며, 이번 Phase 5 실배선은 Dev 전용이다.

---

## 4. 금지사항 재확인 (마스터 §35 그대로 적용)

- 레거시 `round1_day`/`round2_night` 경로 및 데이터 UPDATE/DELETE 금지 — 신규 파일만 추가.
- 미션 시작 보상 금지(v3도 동일 — `awardMissionV3Reward`는 완료 시에만 호출).
- Goal 체크리스트를 아이에게 노출 금지 — API 응답에 goalProgress를 내려주더라도 프론트가
  숫자/체크리스트로 렌더링하지 않는다(§4의 실제 문구는 K의 자연스러운 대화 자체).
- `mission_v3_effective_at`을 Production에 설정하는 것은 이 Phase 5의 범위 밖 — 반드시
  마스터 §31/§32 통과 후 별도 대표님 승인.

---

## 5. 완료 기준 (이 Phase 5 실배선의)

- 5A~5C 게이트① 통과 + 5D 게이트①·② 통과.
- Dev 환경에서 `MISSION_V3_EFFECTIVE_AT` 활성화 후, 실제 QA 계정으로 daily_single 미션을
  시작 → 자유발화 여러 턴 → Goal 3개 이상 충족 → 정상 완료 → 황금열쇠 +1 → event
  activity +1(089 시스템에 반영)까지 end-to-end 1회 이상 실증.
- Admin 화면에서 해당 세션이 v3/daily_single로 올바르게 표시됨을 확인.
- 레거시(v2_dual) 세션에 회귀 없음(기존 e2e 스펙 재실행 또는 스모크).
