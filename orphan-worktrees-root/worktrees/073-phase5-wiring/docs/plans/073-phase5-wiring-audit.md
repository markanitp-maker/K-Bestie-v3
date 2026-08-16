# 073 Mission v3 — 아이 미션 클라이언트 실배선 감사

> 감사일: 2026-08-12  
> 범위: 코드·마이그레이션 정적 감사와 배선 계획. 애플리케이션 코드, DB, 환경변수는 변경하지 않았다.  
> 판정 원칙: 이 문서의 경로·라인은 현재 worktree 기준이다. Production 원격 DB의 migration history는 조회하지 않았으므로, 저장소에 파일이 있다는 사실과 Production 적용 여부를 구분한다.

## 결론 요약

1. 일반 아이 계정의 실제 미션 경로에는 `/api/mission/v3/*` 호출이 하나도 없다. 일반 경로는 `/api/mission/start`와 `/api/mission/turn`을 중심으로 동작하고, 후자는 서버 내부에서 `/api/mission/answer`를 직접 호출한다. 비-Live 반응은 `/api/mission/reaction-lean`과 `/api/mission/respond`, 음성 전사는 `/api/mission/stt`를 쓴다 (`app/child/missions/page.tsx:815-925`, `app/api/mission/turn/route.ts:169-218`, `lib/mission/personalizedReaction.ts:29-54`).
2. v3는 URL만 바꿔 끼울 수 없다. v3 `start`에는 `checkOnly`, `questions`, `questionStates`, `requiredCount`, `progressPercent`가 없고, v3 `turn`은 아이 발화 저장부터 K 응답·종료·보상까지 한 요청에서 처리한다 (`app/api/mission/v3/start/route.ts:268-289`, `app/api/mission/v3/turn/route.ts:495-507`).
3. 가장 큰 실배선 선행조건은 정책 판정의 단일화, v3 전용 클라이언트 상태 어댑터, pending-turn 복구 포맷 분리, 홈/미션 화면의 동일 게이트 사용, 089 이벤트 기록의 명시적 폴백 여부 결정이다.

---

## 1. 레거시 v1/v2 흐름 전수 지도

### 1.1 실제 진입 분기와 호출 목록

`MissionRouteGate`는 먼저 `/api/child/test-mode`를 조회한다. E/F, C/D, A/B 테스트 계정은 각각 별도 runner로 보내고, 그 외 계정만 `MissionInner`를 사용한다 (`app/child/missions/page.tsx:3098-3155`). 따라서 “실제 아이 미션 클라이언트”에는 다음 두 계열이 공존한다.

| 계열 | 실제 미션 API |
|---|---|
| 일반 계정 `MissionInner` | `/api/mission/start`, `/api/mission/turn`, `/api/mission/respond`, `/api/mission/reaction-lean`, `/api/mission/stt`, `/api/mission/force-end` |
| A~F 테스트 runner | `/api/child/test-mission/start`, `/api/mission/answer` 또는 `/api/mission/answer-lean`, `/api/mission/reaction-lean`, `/api/mission/respond-lean` |

일반 계정은 `/api/mission/answer`, `/api/mission/answer-lean`, `/api/mission/respond-lean`을 브라우저에서 직접 호출하지 않는다. `/api/mission/turn`의 `action:"start"`가 같은 프로세스 안에서 `POST /api/mission/answer`를 구성해 호출한다 (`app/api/mission/turn/route.ts:169-183`). 반면 테스트 runner는 `answer`/`answer-lean`을 직접 선택한다 (`components/TestModeABRunner.tsx:161-169`, `components/TestModeCDRunner.tsx:144-152`, `components/TestModeERunner.tsx:176-184`).

저장소 검색 결과 `/api/mission/v3`, `/api/mission/v3/start`, `/api/mission/v3/turn`, `/api/mission/v3/today-progress`를 호출하는 클라이언트 코드는 없다. v3 문자열은 라우트 자체의 로그에만 나타난다 (`app/api/mission/v3/start/route.ts:47-54`, `app/api/mission/v3/turn/route.ts:96-130`).

### 1.2 시작, 사전확인, 이어하기

`fetchSessionData`가 모든 일반 계정 시작/이어하기를 담당한다.

1. 마운트 시 서버 시간 설정 `/api/config/child-time-restrictions`를 읽고 `activeRound`와 `scheduleEnforced`를 결정한다 (`app/child/missions/page.tsx:2271-2300`).
2. 첫 진입은 `fetchSessionData(..., checkOnly:true)`를 호출한다 (`app/child/missions/page.tsx:2309-2318`). 요청은 `POST /api/mission/start`와 `{ childId, roundType, confirmRestart, checkOnly }`다 (`app/child/missions/page.tsx:1953-1966`).
3. `checkOnly` 결과가 신규라면 실제 세션을 만들지 않고 `ready_to_start`가 된다 (`app/child/missions/page.tsx:2004-2012`; 서버 계약 `app/api/mission/start/route.ts:235-236`).
4. “시작”과 “이어하기” 버튼은 둘 다 같은 함수에 `checkOnly:false`를 전달한다 (`app/child/missions/page.tsx:2219-2236`). 서버가 당일 진행 중 세션을 찾으면 `resumed:true`와 고정 질문·질문상태·진행률을 반환한다 (`app/api/mission/start/route.ts:163-231`).
5. Production 완료 라운드는 `locked`, Dev 재시작은 `requiresConfirmation` 응답으로 갈린다 (`app/api/mission/start/route.ts:137-160`; 클라이언트 처리 `app/child/missions/page.tsx:1992-2002`).
6. 신규 세션은 `questions`에 로컬 `greeting_turn_0`을 앞에 넣고, 재개는 `questionStates`에서 첫 미완료/확인필요 질문 인덱스를 찾는다 (`app/child/missions/page.tsx:2111-2156`; 인덱스 규칙 `app/child/missions/page.tsx:580-593`).
7. 시작/재개 뒤 대화 이력은 `/api/chat/messages?sessionId=...`로 별도 복원한다 (`app/child/missions/page.tsx:2165-2177`).

중요한 배선 제약: v3 `start`는 `checkOnly`를 받지 않고 호출 즉시 세션을 만들거나 재개한다 (`app/api/mission/v3/start/route.ts:26-28`, `app/api/mission/v3/start/route.ts:179-245`). 현재 마운트 preflight의 URL만 v3로 바꾸면 화면 진입만으로 세션이 생성된다.

### 1.3 일반 계정의 한 턴

모든 입력은 최종적으로 `handleTurnComplete({ role:"child" })`로 합류한다 (`app/child/missions/page.tsx:595-633`). 이 함수는 현재 질문과 세션이 없으면 중단하므로 고정 질문 배열이 필수다 (`app/child/missions/page.tsx:718-729`).

정상 질문 턴의 정확한 순서는 다음과 같다.

1. `clientTurnId = ${sessionId}:${questionId}:${sequence}`를 만든다 (`app/child/missions/page.tsx:754-756`).
2. 비-Live에서 `/api/mission/reaction-lean` 스트림을 동시에 시작한다. 2.2초 내 첫 조각이 없으면 로컬 content-echo 반응으로 폴백한다 (`app/child/missions/page.tsx:819-840`, `lib/mission/personalizedReaction.ts:29-68`).
3. IndexedDB pending turn에 `sessionId`, `clientTurnId`, `questionId`, `answerText`, `voiceMode`, `displaySequence`를 저장한다 (`app/child/missions/page.tsx:879-888`).
4. `/api/mission/turn`에 `action:"start"`를 보낸다 (`app/child/missions/page.tsx:890-901`; 실제 URL은 `lib/mission/turnRequest.ts:15-35`).
5. 서버는 `start_mission_turn_v1`로 아이 메시지를 저장한 뒤 `/api/mission/answer`를 내부 호출하고 `mark_mission_turn_answered_v1`로 판정 결과를 고정한다 (`app/api/mission/turn/route.ts:122-129`, `app/api/mission/turn/route.ts:162-218`).
6. 클라이언트는 `questionStates`, `questions`, `validAnswerCount`, `progressPercent`, `requiredCount`, `engine_version`을 소비한다 (`app/child/missions/page.tsx:945-962`).
7. 미완료 턴의 K 문장은 다음처럼 만든다.
   - 비-Live: `reaction-lean` 결과 + 전환 연결어 + `/api/mission/respond`의 `parentQuestionOnly:true` 결과(실패 시 고정 다음 질문)를 합친다 (`app/child/missions/page.tsx:1147-1189`).
   - Live: `/api/mission/respond`의 `{ text }`를 그대로 쓴다 (`app/child/missions/page.tsx:1190-1208`).
8. 만든 K 문장을 `/api/mission/turn` `action:"finalize"`로 저장한 후 발화한다 (`app/child/missions/page.tsx:849-877`, `app/child/missions/page.tsx:1261-1270`).
9. `completionCandidate`면 먼저 종료 문구를 finalize하고, 서버가 `completed:true`임을 확인한 뒤 완료 UI/TTS로 간다 (`app/child/missions/page.tsx:964-991`).

`greeting_turn_0`은 예외다. 아이가 인사에 답해도 `/api/mission/turn` start/answer/finalize를 호출하지 않고 로컬 질문상태만 `answered`로 바꾼다 (`app/child/missions/page.tsx:843-847`, `app/child/missions/page.tsx:953-956`).

### 1.4 입력 방식별 합류 지점

| 입력 | 실제 처리 |
|---|---|
| 키보드 | `handleSendText` → 통합 `voice.sendTypedText` (`app/child/missions/page.tsx:1790-1806`). Live와 STT/TTS 훅 모두 child 턴을 append하고 `handleTurnComplete`를 호출한다 (`hooks/useGeminiLive.ts:2359-2378`, `hooks/useVoiceChat.ts:448-454`). |
| STT/TTS 자동 | `useSttRouter`가 실제 RMS에서 턴을 시작하고 10초 최대 발화 또는 900ms 무음에서 자동 종료한다 (`hooks/useSttRouter.ts:840-897`). Browser STT 성공 또는 GCP fallback 성공이 `useVoiceChat.onFinalTranscript`로 들어와 child 턴과 `handleTurnComplete`를 만든다 (`hooks/useSttRouter.ts:516-595`, `hooks/useVoiceChat.ts:140-164`). |
| STT/TTS 수동 | 첫 버튼은 turn id/sequence를 잡고 mic를 켠다. 둘째 버튼은 `manualFinalize`로 `endTurn()`을 호출한다 (`app/child/missions/page.tsx:2399-2457`, `hooks/useVoiceChat.ts:273-287`). 이후 자동과 같은 `onFinalTranscript` 경로다. |
| Gemini Live 자동 | 미션 화면은 `sttMode:"gcp"`로 훅을 생성한다 (`app/child/missions/page.tsx:1411-1420`). VAD 무음 확정 시 Live 모델의 자동 K 응답을 억제하고 `/api/mission/stt`로 전사한 뒤 child `onTurnComplete`를 호출한다 (`hooks/useGeminiLive.ts:2122-2168`, `hooks/useGeminiLive.ts:1033-1104`). |
| Gemini Live 수동 | 첫 버튼은 `sendActivityStart`, 둘째 버튼은 `sendActivityEnd`; GCP 모드에서는 명시적 `turnComplete`와 `/api/mission/stt` flush를 실행한다 (`app/child/missions/page.tsx:2417-2456`, `hooks/useGeminiLive.ts:2480-2515`, `hooks/useGeminiLive.ts:2517-2564`). |

`useSttRouter`의 GCP 호출 payload는 `{audioBase64, sessionId, childTurnId, conversationMode}`이고 (`hooks/useSttRouter.ts:218-244`), Browser-primary 및 GCP fallback 여부는 `BROWSER_STT_PRIMARY_ENABLED`, `GCP_STT_FALLBACK_ENABLED`로 결정된다 (`hooks/useSttRouter.ts:742-764`). Gemini Live의 자체 GCP 전사 payload는 `{audioBase64, sessionId}`다 (`hooks/useGeminiLive.ts:1033-1048`).

K 발화는 정책 결정과 분리돼 있다. Live는 `speakAsK`가 지정 문장만 읽도록 Live 모델에 요청하고 (`hooks/useGeminiLive.ts:2380-2451`), 비-Live는 `/api/voice/tts`를 호출해 재생과 동시에 K 턴 완료 콜백을 낸다 (`hooks/useVoiceChat.ts:293-364`). 이 두 출력 훅은 v3에서도 재사용할 수 있다.

`useVoiceChat` 안에는 `/api/voice/respond`를 호출하는 자유대화용 `respondText`도 있지만 (`hooks/useVoiceChat.ts:416-446`), `MissionInner`는 이를 꺼내 쓰지 않는다. 미션의 K 문장 생성은 위의 `/api/mission/respond`·`reaction-lean` 경로이며, 훅 내부 `/api/voice/respond`는 현재 미션 진행 지도에 포함되지 않는다 (`app/child/missions/page.tsx:1595-1625`).

### 1.5 이어하기 중 pending-turn 복구

현재 복구 레코드는 `questionId`가 필수이며, 재개 직후 `/api/mission/turn` `action:"start"`를 같은 payload로 재전송한다. 성공하면 클라이언트가 임의 복구 K 문장을 만든 뒤 `action:"finalize"`까지 호출한다 (`app/child/missions/page.tsx:2018-2071`). v3는 `questionId`와 `action`이 없고 서버가 K 문장을 고정하므로, 이 복구기를 그대로 쓰면 안 된다. v3 pending 레코드와 replay 처리는 정책 버전별로 분리해야 한다.

### 1.6 홈 화면

홈은 `/api/mission/today-progress?childId=...`를 호출하고 `activeRound`가 없으면 시간 제한 상태를 닫는다 (`app/child/home/page.tsx:123-155`). 레거시 응답은 `hasMission`, `status`, `validAnswerCount`, `requiredCount`, `roundType`, `currentRound`, `activeRound`, `scheduleEnforced`다 (`app/api/mission/today-progress/route.ts:61-75`). v3 홈 배선도 미션 화면과 같은 게이트를 사용하지 않으면 홈 CTA와 실제 진입 가능 상태가 어긋난다.

---

## 2. v3 라우트와 지원 모듈의 실제 계약

### 2.1 `POST /api/mission/v3/start`

요청 body는 `{ childId: string }` 하나다 (`app/api/mission/v3/start/route.ts:26-28`, `app/api/mission/v3/start/route.ts:88-102`). UUID 형식, 로그인, 본인 child role, 동의 철회를 검사한다. approval guard는 현재 항상 통과하는 deprecated 호환 함수다 (`app/api/mission/v3/start/route.ts:83-112`, `lib/plan/approvalGuard.ts:3-27`).

성공 응답:

```ts
{
  resumed: boolean;
  sessionId: string;
  policyVersion: "v3_single_daily";
  effectiveAt: string;
  businessDate: string;
  status: string;
  completed: boolean;
  goalProgress: {
    total: number; satisfied: number; partial: number; pending: number;
    declined: number; skipped: number; completionThreshold: 3;
  };
  tier: number;
  voiceMode: "live" | "stt_tts";
  liveVoiceName: string;
  givenName: string | null;
  childContext: { childId; displayName; givenName; grade; knownProfileFacts: {} };
}
```

근거는 `app/api/mission/v3/start/route.ts:268-289`, voice mode 반환 타입 `lib/plan/voiceMode.ts:7-16`, goal progress 생성기 `lib/mission-v3/routeSupport.ts:58-66`이다. 신규 세션은 `daily_single`, `engine_version:"v3"`, `required_valid_count:3`, 빈 `question_ids/question_states`로 만들어진다 (`app/api/mission/v3/start/route.ts:179-209`). 정확히 네 Goal을 보장한 뒤 응답한다 (`app/api/mission/v3/start/route.ts:58-81`, `app/api/mission/v3/start/route.ts:248-255`).

오류 계약:

| HTTP | body/조건 |
|---|---|
| 400 | `{error:"Invalid JSON"}`, `{error:"childId required"}`, `{error:"Cannot parse child grade"}` (`app/api/mission/v3/start/route.ts:88-102`, `app/api/mission/v3/start/route.ts:128-132`) |
| 401 | `{error:"Unauthorized"}` (`app/api/mission/v3/start/route.ts:83-86`) |
| 403 | `{error:"Forbidden"}`; 동의 철회 시 한국어 error; `policy_not_effective`, `before_open`, `closed` 차단 응답 (`app/api/mission/v3/start/route.ts:104-112`, `lib/plan/consentGuard.ts:20-25`, `app/api/mission/v3/start/route.ts:154-176`) |
| 404 | `{error:"Child not found"}` (`app/api/mission/v3/start/route.ts:114-126`) |
| 409 | `daily_limit_reached`; `reason`, `policyVersion`, `effectiveAt`, `businessDate`, `sessionId`, `status` 포함 (`app/api/mission/v3/start/route.ts:154-176`, `app/api/mission/v3/start/route.ts:221-245`) |
| 500 | 프로필/정책/세션/진행/Goal/정책 snapshot 실패별 한국어 `error` (`app/api/mission/v3/start/route.ts:114-151`, `app/api/mission/v3/start/route.ts:179-265`) |

### 2.2 `GET /api/mission/v3/today-progress?childId=...`

성공 응답은 다음 필드다 (`app/api/mission/v3/today-progress/route.ts:70-85`).

```ts
{
  policyVersion: "v2_dual" | "v3_single_daily";
  effectiveAt: string | null;
  businessDate: string;
  hasMission: boolean;
  sessionId: string | null;
  status: string | null;
  completed: boolean;
  roundType: "daily_single";
  operation: "create" | "resume" | "blocked";
  canStart: boolean;
  blockReason: "policy_not_effective" | "before_open" | "closed" | "daily_limit_reached" | null;
  timeGate: MissionTimeGateResult | null;
  goalProgress: GoalProgress | null;
}
```

오류는 401 `Unauthorized`, 400 `childId required`, 403 `Forbidden`, 정책/진행/Goal 조회 500 `서버 오류`다 (`app/api/mission/v3/today-progress/route.ts:14-27`, `app/api/mission/v3/today-progress/route.ts:29-67`). 이 route는 child role을 강제하지 않고 가족 접근 권한만 검사한다 (`app/api/mission/v3/today-progress/route.ts:24-27`).

### 2.3 `POST /api/mission/v3/turn`

요청 계약:

```ts
{
  sessionId: string;          // UUID
  clientTurnId: string;       // 1~200자
  answerText: string;         // trim 후 비어 있지 않음, 원문 500자 이하
  voiceMode: "live" | "stt_tts";
  displaySequence: number;    // 0 이상 safe integer
}
```

정의와 엄격 검증은 `app/api/mission/v3/turn/route.ts:35-41`, `app/api/mission/v3/turn/route.ts:141-165`다. `action`, `questionId`, `kTurnId`, `kContent`, `kDisplaySequence`를 받지 않는다.

성공 응답:

```ts
{
  kMessage: string;
  status: "IN_PROGRESS" | "COMPLETED" | "SAFETY_PAUSED" | "FORCE_ENDED";
  completed: boolean;
  safetyPaused: boolean;
  earlyEnded: boolean;
  rewardStatus: string;
  goalProgress: GoalProgress;
  replayed: boolean;
}
```

근거는 `app/api/mission/v3/turn/route.ts:495-507`이다. 한 요청이 v3 턴 admission → Safety → Goal assessor → adapter/K 생성 → K draft 저장 → atomic finalize → Goal 3/4 보상까지 수행한다 (`app/api/mission/v3/turn/route.ts:214-245`, `app/api/mission/v3/turn/route.ts:271-447`, `app/api/mission/v3/turn/route.ts:450-484`).

오류 계약:

| HTTP | body/코드 |
|---|---|
| 400 | `Invalid JSON`, `Invalid turn payload`, `This endpoint only serves Mission v3 sessions` (`app/api/mission/v3/turn/route.ts:141-165`, `app/api/mission/v3/turn/route.ts:183-193`) |
| 401/403/404 | `Unauthorized`, `Forbidden`, `Mission session not found`, `Mission progress not found` (`app/api/mission/v3/turn/route.ts:136-193`) |
| 409 | `{code:"TURN_PAYLOAD_CONFLICT"}` 또는 `{code:"TURN_IN_PROGRESS"}` (`app/api/mission/v3/turn/route.ts:240-257`) |
| 423 | 새 턴인데 세션이 terminal이면 `{error,status}`; RPC 55000이면 `{code:"MISSION_TURN_BLOCKED",status}` (`app/api/mission/v3/turn/route.ts:200-212`, `app/api/mission/v3/turn/route.ts:221-245`) |
| 500 | 세션 턴/학년/Goal/history/상태 조회·복원 실패. 각 지점은 한국어 `error`만 반환하고 machine code는 없다 (`app/api/mission/v3/turn/route.ts:260-383`, `app/api/mission/v3/turn/route.ts:450-464`, `app/api/mission/v3/turn/route.ts:486-492`) |
| 503 | `{code:"TURN_START_FAILED"}` 또는 assessor/K draft/finalize/reward 단계별 한국어 `error`; 대부분 machine code가 없다 (`app/api/mission/v3/turn/route.ts:240-249`, `app/api/mission/v3/turn/route.ts:284-447`, `app/api/mission/v3/turn/route.ts:467-480`) |

클라이언트 retry는 409/423을 자동 재시도해서는 안 된다. 같은 `clientTurnId`·완전히 같은 payload로 네트워크/503만 재시도하고, `TURN_IN_PROGRESS`는 짧은 poll/retry UX, `TURN_PAYLOAD_CONFLICT`는 복구 불가능한 로컬 불변식 위반으로 처리해야 한다. 현재 공용 helper는 URL이 legacy로 고정돼 있고 429/5xx만 재시도한다 (`lib/mission/turnRequest.ts:1-48`). v3용 URL/타입 wrapper가 별도로 필요하다.

### 2.4 지원 모듈 계약

- `goalEngine`: 세션당 Goal은 정확히 4개이고 confidence 0.5 미만 판정은 버린다 (`lib/mission-v3/goalEngine.ts:3-8`, `lib/mission-v3/goalEngine.ts:327-373`). P0 부모 질문을 먼저 넣고 후보를 네 개까지 채우며, 부족하면 실패한다 (`lib/mission-v3/goalEngine.ts:132-195`). 초기화는 기존 네 개를 재사용하고, 진행된 불완전 세션은 재초기화하지 않는다 (`lib/mission-v3/goalEngine.ts:254-320`). 한 발화가 여러 Goal을 충족할 수 있고, persistence는 `Promise.allSettled`로 부분 성공을 보존한다 (`lib/mission-v3/goalEngine.ts:322-415`). 완료 threshold는 SATISFIED 3개다 (`lib/mission-v3/goalEngine.ts:417-421`).
- `goalAssessor`: 열린 Goal과 최근 대화, 현재 발화를 JSON 배열로 분류한다. 상태는 SATISFIED/PARTIAL/DECLINED/SKIPPED이고 evidence는 `child_utterance`로 고정한다 (`lib/mission-v3/goalAssessor.ts:29-59`, `lib/mission-v3/goalAssessor.ts:61-86`). 0/3/5초 최대 3회 시도하며 모두 실패하면 빈 배열로 턴을 계속한다 (`lib/mission-v3/goalAssessor.ts:21-27`, `lib/mission-v3/goalAssessor.ts:93-138`).
- `missionAdapter`: Safety를 먼저 확인하고, Goal 판정 저장, 다음 열린 Goal 선택, 071 `respond` 호출, SATISFIED Goal에만 cooldown 기록을 수행한다 (`lib/mission-v3/missionAdapter.ts:112-193`, `lib/mission-v3/missionAdapter.ts:195-245`). P0 부모 질문은 일반 cooldown을 무시하지만 terminal Goal은 후보에서 빠진다 (`lib/mission-v3/missionAdapter.ts:67-95`). 내부 Goal·우선순위·체크리스트를 말하지 말라는 지시를 K에 넣는다 (`lib/mission-v3/missionAdapter.ts:97-104`). `:208`의 “no route wires this adapter yet” 주석은 현재 `v3/turn` 호출(`app/api/mission/v3/turn/route.ts:388-400`)과 불일치하는 오래된 주석이다.
- `timePolicy`: KST 기준 일반 학기 13:00, 확인된 방학 10:00에 열고 23:00 미만까지 허용한다 (`lib/mission-v3/timePolicy.ts:119-147`). 당일 non-terminal 세션은 시간 밖에서도 resume하고, COMPLETED/SAFETY_PAUSED/FORCE_ENDED는 일일 1회 한도를 소비한다 (`lib/mission-v3/timePolicy.ts:168-217`).
- `rewardPolicy`: 유일한 reward type은 `mission_v3_complete`; Goal이 정확히 4개이고 3개 이상 SATISFIED일 때만 RPC를 호출한다 (`lib/mission-v3/rewardPolicy.ts:9-14`, `lib/mission-v3/rewardPolicy.ts:62-76`, `lib/mission-v3/rewardPolicy.ts:82-134`).
- `routeSupport`: `goalProgress` shape를 만들고 (`lib/mission-v3/routeSupport.ts:58-66`), DB Goal에서 prompt instruction을 복원하며 (`lib/mission-v3/routeSupport.ts:68-118`), 저장된 first-writer assessment를 엄격히 재파싱한다 (`lib/mission-v3/routeSupport.ts:120-161`). 최근 이력은 현재 turn을 빼고 최신 9개 중 8개를 시간순으로 반환한다 (`lib/mission-v3/routeSupport.ts:163-187`).

### 2.5 v1/v2와 shape 비교 및 어댑터 판정

| 영역 | legacy | v3 | 그대로 재사용 가능? |
|---|---|---|---|
| start 요청 | `childId, roundType, confirmRestart, checkOnly` (`app/api/mission/start/route.ts:29-38`) | `childId`만 | 불가 |
| start 성공 | 고정 `questions/questionStates`, 숫자 progress, `engine_version`, voice context (`app/api/mission/start/route.ts:214-231`, `app/api/mission/start/route.ts:619-635`) | policy/status/businessDate/hidden goalProgress, voice context | voice 관련 일부만 가능 |
| turn 요청 | `action:start/finalize`, 고정 `questionId`, 클라이언트 K 문장 (`app/api/mission/turn/route.ts:9-29`) | child payload 한 번 | 불가 |
| turn 응답 | start는 answer shape + `completionCandidate`; finalize는 `completed/rewardStatus/replayed` (`app/api/mission/turn/route.ts:40-47`, `app/api/mission/turn/route.ts:279-284`) | `kMessage/status/safetyPaused/earlyEnded/goalProgress` + 완료/보상 | 완료·보상·replayed 일부만 동명 |
| today-progress | `currentRound/activeRound/scheduleEnforced` + 유효답 수 (`app/api/mission/today-progress/route.ts:61-75`) | policy/operation/canStart/timeGate/goalProgress | 불가 |

판정: URL 치환이 아니라 **정책별 controller/adapter가 필요**하다. 공용으로 재사용할 수 있는 것은 인증된 child/session context, transcript UI, 음성 입력 훅, K TTS/Live `speakAsK`, 완료 모달의 일부다. 질문 배열, gauge, 다음 질문 선택, reaction/respond 조립, legacy start/finalize, pending-turn 복구는 v3 분기에서 사용하면 안 된다.

---

## 3. DB·RPC 계약과 마이그레이션 정합성

### 3.1 `mission_v3` 관련 마이그레이션 전수 목록

`supabase/migrations`의 `mission_v3`, `Mission v3`, `v3_single_daily` 검색 결과 실제 실행 마이그레이션은 다음 8개다.

1. `20260810190000_mission_v3_conversation_goals.sql`
2. `20260810200000_mission_question_metadata.sql`
3. `20260810220000_mission_v3_daily_single_policy.sql`
4. `20260810230000_mission_v3_reward_idempotency.sql`
5. `20260811010000_mission_v3_turn_persistence.sql`
6. `20260811170000_mission_v3_assessed_transition.sql`
7. `20260811200000_mission_v3_assessment_retry_idempotency.sql`
8. `20260811250000_mission_v3_turn_terminal_contract.sql`

검증 SQL은 `supabase/migrations/tests/mission_v3_conversation_goals_verification.sql`, `supabase/migrations/tests/mission_v3_reward_idempotency_verification.sql`에 별도로 있다.

주요 schema 정합성:

- `conversation_goals`의 route/module 조회 필드는 모두 실제 컬럼으로 존재하고, `(session,order)` 및 `(session,semantic_group)` unique, hidden RLS, `GRANT ALL ... TO anon, authenticated`가 있다 (`supabase/migrations/20260810190000_mission_v3_conversation_goals.sql:4-39`, `supabase/migrations/20260810190000_mission_v3_conversation_goals.sql:41-68`; 조회 `lib/mission-v3/goalEngine.ts:239-251`).
- `mission_progress`에는 `mission_policy_version`, `effective_at`, `daily_single` check와 child/date당 하나의 partial unique index가 있다 (`supabase/migrations/20260810220000_mission_v3_daily_single_policy.sql:4-6`, `supabase/migrations/20260810220000_mission_v3_daily_single_policy.sql:46-105`).
- 질문 metadata 컬럼은 route의 question-bank 후보가 의존하는 `semantic_group`, `cooldown_days`, `weekday_affinity`, `conversation_style`, `fun_type`, `sensitivity`, `answer_mode` 등을 추가한다 (`supabase/migrations/20260810200000_mission_question_metadata.sql:1-15`).

### 3.2 라우트와 최신 RPC 시그니처 대조

`20260811250000`이 `start_mission_turn_v3`의 이전 반환 계약을 drop/recreate하고 네 RPC의 최종 계약을 정의한다. 라우트 타입과 정적으로 일치한다.

| RPC | 최신 SQL | route 호출/타입 | 판정 |
|---|---|---|---|
| `start_mission_turn_v3(uuid,text,text,text,integer)` | 9개 반환: turn status, assessment, K draft, 이전/현재 goal, engine/safety/boredom, already (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:37-56`) | 동일 9개 `StartTurnRpcRow`, 동일 5 args (`app/api/mission/v3/turn/route.ts:43-53`, `app/api/mission/v3/turn/route.ts:214-220`) | 일치 |
| `mark_mission_turn_v3_assessed(uuid,text,jsonb)` | `(turn_status, already_assessed)` (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:208-270`) | 동일 args/row (`app/api/mission/v3/turn/route.ts:55-58`, `app/api/mission/v3/turn/route.ts:364-385`) | 일치 |
| `store_mission_turn_v3_output(uuid,text,text,uuid,text,text,boolean)` | K draft/goal/engine/safety/boredom/already (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:272-365`) | 동일 args/row (`app/api/mission/v3/turn/route.ts:60-67`, `app/api/mission/v3/turn/route.ts:416-433`) | 일치 |
| `finalize_mission_turn_v3(uuid,text,integer)` | progress/K/goal/safety/early/already (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:367-379`) | 동일 args/row (`app/api/mission/v3/turn/route.ts:69-76`, `app/api/mission/v3/turn/route.ts:436-447`) | 일치 |
| `award_mission_v3_reward(uuid,date,text,uuid)` | rewarded/eligible/reason/type/date/satisfied count (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:208-221`) | 동일 args와 runtime shape validation (`lib/mission-v3/rewardPolicy.ts:28-46`, `lib/mission-v3/rewardPolicy.ts:108-134`) | 일치 |

최신 RPC의 중요한 불변식도 route 의도와 맞는다.

- session-level advisory lock, `IN_PROGRESS`, `daily_single/v3_single_daily`, 동일 payload replay, 다른 미완료 턴 차단을 한 트랜잭션에서 검사한다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:82-157`).
- first-writer assessment, K draft, prompt provenance를 재시도에서 재사용한다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:208-268`, `supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:304-364`).
- K 메시지 삽입과 Safety/BOREDOM terminal 전이를 원자적으로 처리한다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:419-526`).
- 모든 RPC는 service_role만 실행 가능하다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:529-545`).

### 3.3 적용 여부 판정

- **정적으로 확인됨:** 저장소의 최신 route는 반드시 `20260811250000` 반환 shape를 요구하며, 최신 migration 정의와 일치한다.
- **정적으로 확인 불가:** Production DB에 8개 migration이 실제 적용됐는지, 실제 `pg_proc`가 최신 반환 컬럼을 갖는지는 이 worktree와 git history로 증명할 수 없다. migration 파일 주석 자체도 Dev/Production 적용을 별도 게이트로 표현한다 (`supabase/migrations/20260810200000_mission_question_metadata.sql:1-3`).
- **안전한 컷오버 선행 확인:** Production에서 migration history뿐 아니라 `pg_get_function_result`/`pg_get_function_arguments`로 위 5개 함수, `mission_turns` 여섯 추가 컬럼, `conversation_goals`, `mission_progress_daily_single_child_date_key`, `gold_key_ledger_mission_v3_daily_reward_unique`, 089 trigger의 실제 존재를 조회해야 한다. 특히 Production에 `20260811200000`까지만 있고 `20260811250000`이 없으면 route의 9-column destructuring과 terminal finalization 계약이 성립하지 않는다.

---

## 4. Goal, Safety, Boredom, FORCE_ENDED, Idempotency 비교

| 항목 | legacy v1/v2 | v3 | 확인된 개선/차이 |
|---|---|---|---|
| Goal | `question_ids` 안의 고정 질문을 순회하고 answered 수로 완료한다. membership는 API와 RPC 양쪽에서 강제된다 (`app/api/mission/answer/route.ts:325-331`, `supabase/migrations/20260807193000_mission_turn_payload_validation.sql:36-42`). | 숨은 Goal 4개, 한 발화가 여러 Goal을 만족, 3개 SATISFIED가 완료다 (`lib/mission-v3/goalEngine.ts:322-373`, `lib/mission-v3/goalEngine.ts:417-421`). | 동적 대화·부모 P0·거절/부분상태·confidence evidence를 갖고 고정 질문 인덱스에서 분리됐다. |
| Safety | V2만 `classifyAnswer`의 `SAFETY_SIGNAL`을 `record_v2_safety_pause`로 전이한다 (`app/api/mission/answer/route.ts:393-455`, `app/api/mission/answer/route.ts:492-556`). V1은 별도 `validateAnswer` 분기로 들어가며 이 safety RPC를 호출하지 않는다 (`app/api/mission/answer/route.ts:986-995`). | Goal assessor/생성 모델보다 먼저 공통 071 safety preflight를 실행하고, finalizer가 K safety 응답 저장·`SAFETY_PAUSED`·`safety_events`를 원자화한다 (`app/api/mission/v3/turn/route.ts:271-298`, `supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:474-492`). | v3는 생성 이전 선차단과 DB terminal/event 원자성을 갖는다. adapter도 safety-first 계약을 유지한다 (`lib/mission-v3/missionAdapter.ts:138-149`). |
| Boredom | legacy mission route/answer에는 boredom 판정이나 boredom 종료가 없다. | 최근 5턴 중 반복 신호 2회 rising, 3회 high이며 high가 early finish를 허용한다 (`lib/k-conversation/boredomDetection.ts:24-50`, `lib/k-conversation/boredomDetection.ts:75-102`). 엔진이 현재 발화를 포함해 계산한다 (`lib/k-conversation/index.ts:184-192`). | route는 `engineOutput.boredom`이 있으면 그것을 우선하고 엔진 조기반환 때만 독립 계산한다 (`lib/k-conversation/boredomDetection.ts:52-72`, `app/api/mission/v3/turn/route.ts:409-424`). 따라서 same-session에 이미 저장된 현재 발화를 독립 계산으로 다시 더해 signal을 이중집계하는 경로를 제거했다. |
| FORCE_ENDED | 시간 만료 시 클라이언트가 `/api/mission/force-end` → `force_end_mission_session_if_expired`를 호출한다 (`app/child/missions/page.tsx:327-423`, `app/api/mission/force-end/route.ts:37-51`). | 시간 만료 경로 외에 boredom high이고 Goal 만족이 0~2개면 finalizer가 `FORCE_ENDED`, `ended_reason='BOREDOM_EARLY_FINISH'`로 원자 전이한다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:493-508`). Goal 3개이면 boredom 종료보다 보상 완료 threshold가 우선된다. | 무보상 조기종료가 명시적 terminal contract가 됐고 당일 재시작을 막는다 (`lib/mission-v3/timePolicy.ts:168-194`). |
| Idempotency | `(session_id,client_turn_id)` unique, logical-turn advisory lock, answer_result replay, start/finalize 분리다 (`supabase/migrations/20260807190000_mission_turn_atomic_persistence.sql:1-20`, `supabase/migrations/20260807193000_mission_turn_payload_validation.sql:34-65`). 클라이언트 pending 복구가 임의 K 문장을 만들어 finalize한다. | session 단위 한 턴 admission, 전체 payload equality, first-writer assessment/K draft/prompt provenance, atomic terminal, 일별 reward unique를 갖는다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:82-166`, `supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:304-430`, `supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:64-70`). | 비결정적 Goal assessor와 K 생성 결과까지 첫 writer로 고정하고 동시 “다른 턴”도 session lock으로 막는다. |

주의할 사실 두 가지:

1. `missionAdapter.ts:208`의 “live impact 없음/no route wires” 주석은 현재 사실이 아니다. route는 adapter를 호출한다 (`app/api/mission/v3/turn/route.ts:388-400`). 동작 문제가 아니라 유지보수 문서 drift다.
2. v3 turn의 `earlyEnded` replay 계산은 `started.boredom_early_finish`를 참조한다 (`app/api/mission/v3/turn/route.ts:495-506`). 첫 요청에서 `started`는 output 저장 전 snapshot이라 false일 수 있지만 `finalized.early_ended`가 true여서 정상 응답한다. replay는 latest start RPC가 저장값을 반환하므로 두 경로 모두 커버된다 (`supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:125-134`, `supabase/migrations/20260811250000_mission_v3_turn_terminal_contract.sql:419-430`).

---

## 5. Event 60 / 089와 황금열쇠 보상

### 5.1 legacy 보상과 이벤트

- legacy atomic finalize는 v3가 아닌 세션에서 `valid_answer_count >= required_valid_count`일 때 `reward_type='mission_complete'` ledger를 쓰고 `mission_progress`를 COMPLETED로 바꾼다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:153-193`).
- V2 direct answer 경로도 `record_v2_mission_answer(_pending)`에 `p_reward_type:"mission_complete"`를 전달한다 (`app/api/mission/answer/route.ts:599-626`).
- V1 non-atomic 경로는 완료 시 `recordMissionOnboardingCompletion`을 명시 호출한다 (`app/api/mission/answer/route.ts:1185-1207`). 이 helper는 environment를 앱 설정에서 확정해 activity `mission_complete`를 5-parameter RPC로 보낸다 (`lib/events/missionOnboarding.ts:11-30`).
- V2 direct branch는 `newly_completed` 때 behavior log만 남기며 helper를 직접 호출하지 않는다 (`app/api/mission/answer/route.ts:670-680`). 그 경로와 legacy atomic finalize는 DB COMPLETED trigger가 이벤트 집계를 담당한다.

### 5.2 v3 보상

- v3의 유일한 보상은 `mission_v3_complete`이고, `(child_id,business_date,reward_type)` unique로 하루 한 번만 지급된다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:40-70`).
- 권위 RPC는 source session/child/business date/policy를 검증하고 Goal을 DB에서 다시 센다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:233-282`). 이미 ledger가 있으면 `already_rewarded`, Goal이 4개가 아니면 `goals_not_initialized`, 3개 미만이면 `goal_threshold_not_met`다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:284-309`).
- Goal 3/4이면 같은 RPC가 먼저 `mission_progress.status='COMPLETED'`로 전이한 뒤 active key 22개 상한을 확인하고 ledger를 쓴다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:311-368`). 따라서 active balance 상한으로 새 키를 못 받아도 미션 완료와 이벤트 trigger는 이미 발생한다.
- legacy finalizer에는 v3 session을 완료·보상하지 않는 명시적 guard가 있어 `mission_complete`와 `mission_v3_complete` 이중 지급을 막는다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:153-157`). v3 client가 legacy finalize를 호출하지 않아야 이 경계가 더 단순해진다.

### 5.3 089 이벤트 연결

089는 `child_mission_event_completions`에 `activity_type`, `business_date`, `source_session_id`를 추가하고 `(event_id,child_id,activity_type,business_date)`를 unique로 만든다 (`supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql:7-36`). 활동 유형은 `mission_complete`와 `freechat_daily_engagement`뿐이다. v3의 **황금열쇠 reward type** `mission_v3_complete`는 이벤트 activity type과 다른 namespace이므로, 이벤트에는 계속 `mission_complete`로 기록되는 것이 맞다 (`supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql:25-36`).

이벤트 RPC는 KST business date마다 같은 활동을 한 번만 insert하고, 30일 window 안에서 최대 60까지 count한다 (`supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql:131-203`). legacy 4-parameter RPC도 새 `mission_complete` 호출로 위임된다 (`supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql:214-241`).

v3는 `recordMissionOnboardingCompletion`을 직접 호출하지 않는다. `award_mission_v3_reward`가 COMPLETED로 바꾸면 `trg_mission_progress_event_completion`이 activity를 기록하는 구조다 (`supabase/migrations/20260810230000_mission_v3_reward_idempotency.sql:311-319`; trigger 생성 `supabase/migrations/20260804080000_mission_progress_event_completion_trigger.sql:32-36`). 최신 trigger 함수는 PostgREST request host가 알려진 Production/Dev project host일 때만 environment를 정하고, 알 수 없으면 아무것도 하지 않는다 (`supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql:243-289`).

**정적 판정:** 정상 Production PostgREST RPC context에서 host가 보존되고 최신 089 trigger가 설치돼 있으면 v3 완료 → COMPLETED → `mission_complete` +1은 멱등하게 연결된다. 그러나 route 레이어의 명시적 helper 폴백이 없으므로 host context가 없는 완료, trigger 미적용/구버전, project host 변경에서는 이벤트가 누락될 수 있다. 코드만으로 Production host context와 실제 trigger 설치를 증명할 수 없으므로 “깨지지 않는다”를 무조건 보증할 수는 없다.

**배선 게이트에 포함할 확인:** v3 완료 한 건에서 (a) `gold_key_ledger.reward_type='mission_v3_complete'` 0 또는 1행(상한에 따라), (b) progress COMPLETED, (c) `child_mission_event_completions.activity_type='mission_complete'` 1행, (d) event count 정확히 +1을 함께 확인해야 한다. 실패 시 선택지는 route에서 `recordMissionOnboardingCompletion`을 completion 확인 후 추가 호출하거나 reward RPC 안에서 environment를 명시적으로 받아 이벤트 RPC를 호출하는 것이다. 089 unique key가 있으므로 명시 호출과 trigger의 이중 방어는 중복 count를 만들지 않는다 (`supabase/migrations/20260810170000_mission_event_daily_activity_policy.sql:182-203`). 최종 방식은 이 감사에서 결정하지 않는다.

---

## 6. Feature gate 후보와 실배선 계획

### 6.1 확인된 기존 게이트 관례

- 서버 환경변수 + seed child IDs: `QUESTION_ENGINE_V2=true`가 먼저 켜져야 하며 seed 목록이 비면 전량, 값이 있으면 해당 child만 활성화한다 (`lib/questions/feature-flags.ts:5-17`).
- DB allowlist + fail-closed: 질문 alpha는 `alpha_safety_text_allowlist` 조회 실패 시 false다 (`lib/questions/alphaAllowlist.ts:3-15`).
- 서버 환경변수 + 서버 계산값을 클라이언트에 전달: `MISSION_SCHEDULE_ENFORCED`는 서버 전용이고 config route가 `enabled/scheduleEnforced/activeRound`를 내려준다 (`lib/mission/missionScheduleFlag.ts:1-8`, `app/api/config/child-time-restrictions/route.ts:7-23`).
- 동일 서버 flag로 read/write 양쪽 게이트: free chat hard limit은 GET과 POST 모두 같은 `FREE_CHAT_HARD_LIMIT_ENABLED`를 검사하고 off일 때 DB RPC를 건드리지 않는다 (`app/api/chat/freechat-usage/route.ts:7-14`, `app/api/chat/freechat-usage/route.ts:42-65`, `app/api/chat/freechat-usage/route.ts:74-107`).
- v3 자체에는 이미 `MISSION_V3_EFFECTIVE_AT`가 있고, 미설정/invalid는 `v2_dual`, 시각 도달 후 `v3_single_daily`다 (`lib/mission-v3/policyResolution.ts:1-24`). 다만 현재 클라이언트가 이 판정을 조회하거나 사용하지 않는다.

### 6.2 후보안

#### 후보 A — 기존 `MISSION_V3_EFFECTIVE_AT` 전량 시각 컷오버

홈이 v3 today-progress를 조회해 `policyVersion`을 받고, 미션 페이지도 같은 결과로 legacy/v3 controller를 고른다. 세션 생성 후에는 `mission_progress.mission_policy_version/effective_at` snapshot을 권위값으로 사용한다.

- 장점: 이미 구현된 정책과 DB snapshot을 그대로 사용한다. 미설정/invalid가 v2로 fail-closed하며 환경별 시각 컷오버·롤백이 단순하다.
- 단점: 지정 시각에 전량 전환된다. 마운트 preflight, 홈 CTA, 새/기존 세션, 이벤트를 동시에 배포·검증해야 하고 소규모 실사용 cohort가 없다.
- 필수 조건: 클라이언트가 자체 시각을 보지 말고 서버 응답만 사용해야 한다. 이미 시작된 세션은 environment 변경과 무관하게 저장된 policy version으로 계속 같은 controller를 써야 한다.

#### 후보 B — 환경변수 + 명시 child seed cohort

`QUESTION_ENGINE_V2` 패턴처럼 `MISSION_V3_ENABLED`와 `MISSION_V3_SEED_CHILD_IDS`를 두고, seed가 있으면 해당 child만 v3, 빈 seed면 전량을 허용한다. `MISSION_V3_EFFECTIVE_AT`과 AND 조건으로 결합한다.

- 장점: QA 계정 → 내부 아동 → 전량 순서로 좁은 rollout이 가능하며 저장소 관례가 이미 있다.
- 단점: 현재 `resolveMissionPolicyVersion(now)`는 childId를 받지 않으므로 start와 today-progress 모두 같은 child-aware resolver로 바꿔야 한다. 홈/미션 중 한쪽만 seed 판정을 적용하면 계약이 분리된다.
- 필수 조건: cohort 변경이 진행 중 session의 controller를 바꾸지 않도록 session snapshot이 항상 우선해야 한다. seed 목록은 서버에만 두고 클라이언트 bundle에 노출하지 않는다.

#### 후보 C — 전용 DB allowlist/rollout table

질문 alpha의 fail-closed 패턴처럼 전용 `mission_v3_rollout` 테이블에서 child별 enable/disable과 선택적 rollout metadata를 조회한다. `alpha_safety_text_allowlist`는 의미가 다르므로 재사용하지 않는다.

- 장점: 배포 없이 cohort를 변경하고 즉시 특정 아이를 제외할 수 있으며 운영 감사가 쉽다. child별 sticky assignment를 명시적으로 보존할 수 있다.
- 단점: 새 schema/RLS/cache/관리 경로가 필요하고, DB 조회 실패 정책과 latency를 설계해야 한다. 현재 코드베이스에는 퍼센트 rollout 구현 관례가 확인되지 않았다.
- 퍼센트 확장이 필요하면 무작위 매 요청이 아니라 `hash(childId) % 100 < percent`를 최초 배정 후 snapshot해야 한다. 이는 새 패턴이므로 단순 environment gate보다 구현·검증 범위가 크다.

이 감사는 후보를 결정하지 않는다. 코드베이스 관례와 변경 범위를 기준으로 보면 A가 가장 적은 신규 구성, B가 기존 cohort 패턴에 가장 가까운 점진 rollout, C가 운영 유연성이 가장 높은 선택지다.

### 6.3 안전한 배선 순서

1. **계약 타입 고정:** legacy/v3 start, today-progress, turn을 discriminated union으로 정의한다. `any` 기반의 현재 응답 소비를 v3 분기까지 확장하지 않는다.
2. **단일 정책 조회:** 홈과 미션 entry가 같은 server decision을 사용한다. v3 start를 preflight로 호출하지 않고 v3 today-progress 또는 별도 read-only policy endpoint를 쓴다.
3. **홈 배선:** legacy 응답의 `activeRound` 의존을 v3 `canStart/blockReason/timeGate/status`로 명시 분기한다. policy가 legacy면 기존 응답을 그대로 유지한다.
4. **v3 session controller:** `MissionInner` 내부의 질문 배열 controller와 분리한다. v3 start 성공 시 고정 질문/gauge를 초기화하지 않고, `goalProgress`는 내부 상태로만 유지한다. Goal 숫자·체크리스트는 아이에게 노출하지 않는 기존 설계 제약을 지킨다 (`docs/plans/073-phase5-wiring.md:185-192`, `docs/plans/073-phase5-wiring.md:214-221`).
5. **첫 K 발화:** v3 start는 첫 `kMessage`를 주지 않는다. 현재 로컬 greeting을 policy-independent v3 greeting으로 재사용할지, start contract에 서버 생성 greeting을 추가할지 먼저 결정해야 한다. 첫 인사에는 turn API를 호출하지 않는 현재 규칙을 유지할 수 있지만, 질문 배열 존재를 전제로 하면 안 된다.
6. **입력 공용화:** 키보드, STT/TTS auto/manual, Gemini Live auto/manual은 기존대로 child transcript를 `handleTurnComplete`에 전달한다. 그 지점에서 policy별 handler만 분기한다.
7. **v3 한 번 호출:** v3 handler는 pending v3 record 저장 → `POST /api/mission/v3/turn` → `kMessage` 수신 → pending clear → Live `speakAsK` 또는 STT/TTS `speak/sayText` 순서만 수행한다. `reaction-lean`, `respond`, legacy turn finalize를 호출하지 않는다.
8. **terminal 매핑:** `SAFETY_PAUSED`, `FORCE_ENDED`, `COMPLETED`, 423을 각각 별도 UI 상태로 매핑한다. `earlyEnded`는 정상 완료/보상 모달로 보내지 않는다. reward modal은 `rewardStatus`가 `awarded`일 때만 새 지급으로 표시하고 `already_rewarded`, `active_balance_limit`을 구분한다.
9. **복구 분리:** v3 pending record에는 policy version과 정확한 turn payload 전체를 저장한다. 같은 `clientTurnId`로 같은 payload만 재전송하고, 서버의 first-writer `kMessage`를 그대로 재생한다. 클라이언트 임의 복구 K 문장을 만들지 않는다.
10. **테스트 runner 격리:** A~F runner는 `/api/child/test-mission/start`와 answer/lean 실험 경로이므로 명시적 별도 요구가 없으면 legacy로 남긴다. route gate의 normal 분기만 v3 rollout 대상이다.
11. **이벤트·보상 게이트:** §5.3의 네 상태를 한 세션에서 대조하고, 같은 turn 재시도와 같은 날 재진입에서 key/event가 증가하지 않는지 확인한다.
12. **롤백:** 신규 session admission만 legacy로 되돌리고, 이미 생성된 `v3_single_daily` session은 v3 controller로 끝까지 resume한다. v3 session을 legacy start/turn으로 넘기지 않는다.

### 6.4 컷오버 전 정적·동적 승인 체크포인트

- 최신 8개 migration과 5개 RPC 실제 Production signature 확인.
- 홈과 미션 화면이 동일 child에 동일 policy를 표시하는지 확인.
- 신규, 이어하기, 완료 후 재진입, 시간 밖 resume, daily limit, consent-withdrawn 시나리오 확인.
- 키보드와 네 음성 경로 모두 동일 v3 turn contract를 쓰며 legacy reaction/respond/finalize 호출이 0인지 네트워크 로그로 확인.
- 409 `TURN_IN_PROGRESS`, 409 `TURN_PAYLOAD_CONFLICT`, 423 terminal, 503 replay를 각각 확인.
- Safety가 Goal assessor/생성보다 먼저 terminal이 되고, boredom high + Goal 0~2는 무보상 FORCE_ENDED, Goal 3은 COMPLETED가 되는지 확인.
- 황금열쇠, 089 activity, 60-count가 재시도·재접속·trigger/helper 이중 호출에도 정확히 한 번만 반영되는지 확인.
