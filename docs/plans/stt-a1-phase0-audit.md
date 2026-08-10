# STT A1 Phase 0 — AS-IS 감사

감사일: 2026-08-10
범위: `requests/request-stt-a1-browser-primary-gcp-fallback-dev-only.md` 전 원문, 현재 작업 트리의 실행 경로. 코드·기존 문서는 수정하지 않았다.

## 기준과 결론

- 현재 일반 미션(STT/TTS)과 자유대화는 **이미 하나의 클라이언트 훅과 하나의 GCP REST API를 공유**한다. 공통 경로는 `useVoiceChat → /api/mission/stt → GCP speech:recognize`다.
- 그러나 Premium Live 미션은 Native Audio/Vertex Live WebSocket이라는 별도 제품 경로다. 이 경로가 `sttMode: "gcp"`일 때만 같은 REST STT를 보조 전사로 쓰며, 일반 A1 Router에 합치면 Live의 오디오 스트리밍·barge-in·generation 락을 훼손할 위험이 있다.
- Browser `SpeechRecognition`은 이미 `hooks/useGeminiLive.ts`에만 존재한다. 현재 일반 미션과 자유대화의 GCP-primary `useVoiceChat` 경로에는 없다.
- `MediaRecorder`는 현재 대화 STT에 사용되지 않는다. 두 음성 훅은 `AudioContext`/`ScriptProcessorNode`로 LINEAR16 PCM을 RAM 배열에 쌓는다.

## 1. Mission 현재 STT 호출 경로 (자동 / 수동 / REST)

### 일반 미션: STT/TTS (`voice_mode = stt_tts`)

1. `app/child/missions/page.tsx:1309-1365`가 공용 `useVoiceChat`을 미션 콜백, 세션 ID, 자동 발화 VAD UI, 실패 처리와 함께 생성한다.
2. 자동 모드는 `hooks/useVoiceChat.ts:258-293`의 RMS VAD가 PCM을 RAM `chunksRef`에 축적하고, 900ms 무음 또는 10초 상한에서 `finalizeChildTurn()`을 호출한다. 수동 모드는 같은 훅의 `manualFinalize()` (`hooks/useVoiceChat.ts:387-389`)를 사용한다.
3. 미션 수동 마이크 버튼은 `app/child/missions/page.tsx:2257-2288`에서 새 child turn ID를 만들고 mic을 켠 뒤, 두 번째 탭에서 10초 watchdog과 함께 `sttTts.manualFinalize()`를 호출한다. 자동/수동은 입력 시작·종료만 다르고 같은 확정 함수를 사용한다.
4. 확정은 `hooks/useVoiceChat.ts:176-217`: RAM PCM을 base64로 만들고 `callStt()`를 호출한 뒤, 성공한 transcript 한 개만 `onTurnComplete`로 넘긴다. 단, 말하는 중 약 1.3초마다 같은 GCP API로 interim 재인식을 하는 기존 polling도 있다 (`hooks/useVoiceChat.ts:297-312`).
5. REST 호출은 `hooks/useVoiceChat.ts:146-174`의 `POST /api/mission/stt`; body는 `audioBase64`, `sessionId`, 예측 `childTurnId`다.
6. 서버는 `app/api/mission/stt/route.ts:22-108`에서 로그인·동의·승인·세션·아이 접근권한을 검증하고, 미션 세션에만 active 상태를 추가 검증한다. `:115-145`에서 GCP `speech.googleapis.com/v1/speech:recognize`로 LINEAR16/16kHz/mono/`ko-KR`를 보낸다. 아동 힌트는 `lib/stt/childSpeechHints.ts:1-5`다. 성공 응답은 `:190-191`의 `{ transcript, confidence }`다.
7. 미션 downstream은 `app/child/missions/page.tsx:562-746`의 `handleTurnComplete`: child turn을 저장/원자 처리 경로로 보내고, `answerInFlightRef`와 `turnPhaseRef`로 중복 제출을 차단한다. REST STT 그 자체는 결과를 저장하거나 LLM을 호출하지 않는다.

### Premium Live 미션: 별도 Native Audio 경로

`app/child/missions/page.tsx:1367-1375`는 `useGeminiLive({ sttMode: "gcp" })`도 항상 인스턴스화하고, 실제 선택은 `isLiveMode`다 (`:1533, :1550`). 이 경로의 자동·수동 상세는 항목 7과 10에 분리했다.

관련 파일 전부(현재 실행 경로):

- `app/child/missions/page.tsx` — 모드 선택, 자동/수동 UI, 미션 turn 상태머신·downstream adapter.
- `hooks/useVoiceChat.ts` — 일반 미션/자유대화 공용 PCM 캡처, VAD, REST STT, TTS.
- `app/api/mission/stt/route.ts` — 두 제품이 공유하는 GCP STT HTTP endpoint.
- `lib/stt/childSpeechHints.ts` — GCP speech context.
- `app/api/mission/answer/route.ts`, `app/api/mission/respond/route.ts`, `app/api/mission/turn/route.ts` — transcript 뒤의 미션 판정·K 응답·원자 persistence 경로; STT 호출 주체는 아니다.
- `app/api/mission/timing/route.ts` — `speech_end`/`stt_*` timing event 저장 (`hooks/useVoiceChat.ts:193-197`, `app/api/mission/stt/route.ts:100-108,147-155`).

## 2. Free Chat 현재 STT 호출 경로 (자동 / 수동 / REST)

1. 실제 자유대화 화면은 `app/chat/page.tsx`다. `app/child/chat/page.tsx:5-13`은 이 화면으로 redirect만 한다.
2. `app/chat/page.tsx:100-120`이 `useVoiceChat`을 생성한다. 따라서 자동과 수동 모두 미션과 동일한 PCM/VAD/GCP REST 엔진을 탄다.
3. 자동/수동 모드 반영은 `app/chat/page.tsx:354-361`, 모드 전환은 `:499-520`이다. 자동은 훅 VAD, 수동은 중앙 버튼의 시작/종료가 `:522-536`에서 `setMicEnabled(true)`와 `manualFinalize()`를 호출한다.
4. REST 구간은 `hooks/useVoiceChat.ts:146-217` 및 `app/api/mission/stt/route.ts:86-98`이다. endpoint 명칭은 mission이지만 `session_type === "free_chat"`도 명시적으로 허용하며 미션 active 검사만 건너뛴다.
5. transcript 후 `app/chat/page.tsx:73-98`가 child 메시지를 `/api/chat/messages`에 저장하고 `respondText()`를 한 번 호출한다. `hooks/useVoiceChat.ts:518-546`가 `/api/voice/respond`를 호출해 자유대화 K 텍스트 응답을 만든다(TTS 없음).
6. `/api/chat/messages`는 `(session_id, turn_id)` conflict에 `ignoreDuplicates` upsert를 사용한다 (`app/api/chat/messages/route.ts:176-187`). 자유대화의 response API는 free_chat 세션만 받는다 (`app/api/voice/respond/route.ts:122-128`).

관련 파일 전부(현재 실행 경로):

- `app/chat/page.tsx` — 자유대화 UI, 자동/수동 제어, transcript 저장 및 응답 트리거.
- `app/child/chat/page.tsx` — `/chat` redirect.
- `hooks/useVoiceChat.ts` — 공용 STT/VAD/audio capture.
- `app/api/mission/stt/route.ts`, `lib/stt/childSpeechHints.ts` — 공용 GCP STT 서버 측.
- `app/api/chat/messages/route.ts` — child/K 메시지 persistence 및 turn-id upsert.
- `app/api/voice/respond/route.ts` — K Conversation Engine Free Chat adapter.

## 3. Mission / Free Chat 공유 STT·오디오 코드

있다. `hooks/useVoiceChat.ts:68-584`가 두 제품의 일반 음성 입력을 공유한다. 여기에는 getUserMedia/AudioContext, PCM encoding, 자동 VAD, 수동 finalize, GCP REST STT, interim polling, teardown이 모두 있다. 두 화면의 생성 근거는 미션 `app/child/missions/page.tsx:1309-1365`, 자유대화 `app/chat/page.tsx:100-120`이다.

서버도 `app/api/mission/stt/route.ts:86-98`에서 두 세션 타입을 하나의 endpoint로 처리한다. 이름만 mission이며 실제 책임은 공용 STT다. 이 명명 불일치는 A1에서 새 공용 client Router를 추가할 이유이지만, 기존 API를 이번 전환에서 삭제할 근거는 아니다.

공유하지 않는 부분은 downstream이다. 미션은 answer/respond/진행률 상태를 처리하고(`app/child/missions/page.tsx:562-746`), 자유대화는 messages 저장 후 `/api/voice/respond`만 호출한다(`app/chat/page.tsx:73-98`).

## 4. MediaRecorder 및 VAD

- **MediaRecorder 미사용:** 전체 실행 코드 검색에서 `MediaRecorder` 참조는 없고, 대화 음성은 PCM 캡처다. `useVoiceChat`은 `AudioContext.createScriptProcessor` (`hooks/useVoiceChat.ts:252-271`), Live도 동일 방식 (`hooks/useGeminiLive.ts:1880-1903`)을 쓴다.
- 일반 경로 VAD: `hooks/useVoiceChat.ts:40-48` 상수, `:262-291` RMS 계산·900ms 무음·10초 상한. 자동만 무음 finalize하고 수동은 버튼 종료다.
- Live 경로 VAD: `hooks/useGeminiLive.ts:1961-2126`의 idle/candidate/active 3단계 상태머신. 150ms 후보 확인, silent timer, activityStart/activityEnd를 Relay에 보낸다.
- 현재 RAM 보관 형태는 `Uint8Array[]` PCM chunks다: 일반 `hooks/useVoiceChat.ts:108,179-190`, Live `hooks/useGeminiLive.ts:1006-1015,1057-1069`. Blob/MediaRecorder 수명 관리나 one-turn Blob cleanup은 아직 없다.

## 5. Browser SpeechRecognition API 사용 여부

**사용 중이다.** 단, `hooks/useGeminiLive.ts`에만 있고 일반 미션/자유대화의 primary STT가 아니다.

- prefix detection: `hooks/useGeminiLive.ts:1156-1160`의 `window.SpeechRecognition || window.webkitSpeechRecognition`.
- 설정: continuous/interim/`ko-KR` (`:1161-1165`).
- final transcript는 `:1166-1201`에서 Live input transcription이 아직 없을 때만 flush한다.
- error는 경고 로그만 남긴다 (`:1204-1206`); A1에서 요구하는 fallback decision·timeout·one-winner router 역할은 제공하지 않는다.
- 시작 조건은 non-GCP Live mode에 한정된다 (`hooks/useGeminiLive.ts:925-932,1377-1383`). 미션 Live는 `sttMode: "gcp"`이므로 이 Browser API를 시작하지 않는다 (`app/child/missions/page.tsx:1367-1371`). 자유대화도 `useVoiceChat`만 써서 이 API를 사용하지 않는다.

## 6. 기존 GCP Speech-to-Text 전체 흐름

### 일반 미션·자유대화

`AudioContext PCM` → `hooks/useVoiceChat.ts:190-217` base64/`callStt` → `POST /api/mission/stt` (`:152-156`) → `app/api/mission/stt/route.ts:115-132` GCP REST recognize → `{ transcript, confidence }` (`:141-191`) → 각 화면의 `onTurnComplete`.

이 endpoint는 `GCP_STT_API_KEY`를 서버에서만 읽는다 (`app/api/mission/stt/route.ts:31-35`). audio는 request JSON의 base64로만 전달되며 파일/Storage/DB 저장 코드는 이 경로에 없다. 사용량만 비동기로 기록한다 (`:168-187`).

### Premium Live 미션의 GCP 보조 전사

Live PCM도 `hooks/useGeminiLive.ts:1952-1958,2014-2020,2050-2056`에서 별도 RAM `childAudioChunksRef`에 복제한다. 발화 끝에는 `flushChildTurn()`이 `postMissionStt()`로 같은 endpoint를 1~2회 호출한다 (`:1017-1093`, `lib/stt/scriptGuard.ts:48-70`). 이때 GCP 결과가 유효하면 winner이고, GCP 자체 요청 실패 때만 Live transcription을 최후 후보로 검증한다.

## 7. Gemini Live / Native Audio 별도 경로

**있으며 A1 공통 STT Router와 분리해야 한다.**

경로는 `app/child/missions/page.tsx:1367-1375` → `hooks/useGeminiLive.ts:1220-1281` → `POST /api/voice/token` → Cloud Run WebSocket relay다. 토큰 route는 서버에서 signed ticket만 발급한다 (`app/api/voice/token/route.ts:41-76`). Relay는 `services/vertex-live-relay/src/server.ts:164-181`에서 `gemini-live-2.5-flash-native-audio`, input/output transcription, 수동 activity detection을 설정하고, `:248-262`에서 PCM/activity/text를 Vertex Live로 전달한다.

분리 이유:

1. Native Audio는 STT만이 아니라 양방향 audio generation, barge-in, audio queue, Live generation lifecycle을 포함한다. `hooks/useGeminiLive.ts:880-935`는 K 재생 중 SpeechRecognition을 멈추고 재생 종료 뒤에만 재개한다.
2. Live의 GCP 모드는 이미 `childTurnFlushedRef` one-flush guard(`hooks/useGeminiLive.ts:1037-1045`), generation settle wait, K-A 억제(`:2075-2121`)를 갖는다. A1의 Browser-vs-GCP arbitration을 그대로 삽입하면 이 별도 lock과 충돌할 수 있다.
3. request §2가 Premium Live/Native Audio는 억지로 Browser STT로 바꾸지 말라고 명시한다. 따라서 A1 Router의 적용 대상은 현재 `useVoiceChat` 소비자인 일반 미션·자유대화이고, Live는 회귀 비대상/별도 유지로 명시하는 것이 안전하다.

## 8. turn_id 및 락 메커니즘

이미 여러 층에 존재하지만 A1의 **STT provider arbitration 전용 turn 상태**는 없다.

- 일반 공용 훅: `hooks/useVoiceChat.ts:118-133`의 utterance epoch와 local `tN` ID, `:206-217`의 오래된 STT 결과 폐기. `cancelFinalize()`도 AbortController+epoch 증가로 취소한다 (`:391-395`).
- 미션 화면: `app/child/missions/page.tsx:166-195`의 `turnPhaseRef`, `answerInFlightRef`, child sequence; `:608-639`의 2차 재진입 차단; `:721-746`의 server idempotency key와 처리 중 mic lock.
- 서버 미션: answer/respond는 `childTurnId`로 in-memory cache/inflight를 사용한다. 예를 들어 `app/api/mission/respond/route.ts:83-84,203-215` 및 `app/api/mission/respond-lean/route.ts:83-94,317-398`; 메시지 저장은 `app/api/chat/messages/route.ts:176-187`의 `(session_id,turn_id)` upsert다.
- Live: `hooks/useGeminiLive.ts:314-345`의 finalizing, browser/Live one-flush, generation/connection refs와 `:1037-1093`의 flush guard가 있다.

권고: A1 Router는 이 기존 downstream ID를 대체하지 말고, 각 utterance에 별도의 `routerTurnId`/state (`LISTENING`→`BROWSER_SUCCESS` 또는 `GCP_FALLBACK`→terminal)를 두고 **딱 한 번만** 기존 `onFinalTranscript` contract를 호출해야 한다.

## 9. iOS / Android 분기 현황

STT provider 선택을 iOS/Android로 직접 분기하는 코드는 현재 없다.

- 일반 음성 공용 대응은 화면 꺼짐 방지 hook이다: `hooks/useScreenWakeLock.ts:5-14,43-99` (특히 Android 언급, unsupported/failure는 기능을 막지 않음). 미션과 자유대화는 각각 이를 사용한다 (`app/child/missions/page.tsx`의 `useScreenWakeLock`, `app/chat/page.tsx:143-146`).
- Live에는 Android audio activation/복귀 주석·재개 처리만 있다: `hooks/useGeminiLive.ts:821`, `:1309`, `:2497-2558`; 이는 provider 분기가 아니라 AudioContext autoplay/recovery 대응이다.
- iOS/PWA의 명시적 UA 분기는 설치 UX용 `lib/pwa/standalone.ts:7-29` 및 `components/pwa/KakaoInAppBrowserNotice.tsx:82-106`이며 STT 호출 경로에는 연결되어 있지 않다.

따라서 A1 telemetry의 platform 값을 만들 때 기존 `lib/notifications/usePushSubscription.ts:54-57`의 UA 분류 패턴은 참고 가능하지만, STT Router에 기존 OS provider policy가 있다고 가정하면 안 된다.

## 10. `hooks/useGeminiLive.ts` 관련성 분석

관련은 높지만, **일반 A1 Router의 직접 이식 대상은 아니다.** 이 파일은 현재 작업 트리에서 `git log --all -- hooks/useGeminiLive.ts` 기준 49개 커밋 이력이 확인되며, 파일 자체가 2,569줄로 Live audio transport·VAD·전사·TTS 재생·barge-in·reconnect·turn locks를 한데 가진 고위험 훅이다.

직접 관련 근거:

- Browser SpeechRecognition의 유일한 현행 구현 (`hooks/useGeminiLive.ts:1156-1218`). A1 Browser provider의 prefix detection/`ko-KR`/final-only 처리 참고 원본이다.
- GCP STT 전사와 final-text 검증 (`:1017-1093`, `lib/stt/scriptGuard.ts:40-70`). A1 fallback server client contract 참고 원본이다.
- audio capture/VAD/temporary PCM lifecycle (`:1901-2126`, teardown `:1097-1154`). A1의 one-turn RAM audio buffer가 지켜야 할 cleanup 기준을 제공한다.
- duplicate 방지: child flush guard (`:1037-1045`), K generation/audio queue gate (`:880-935`)가 있다.

그러나 Live 전용 의존성이 너무 크다: relay transport (`:25-76`), Native Audio generation, activityStart/activityEnd, K speech/audio queue, Vertex turnComplete settlement다. A1 구현에서 이 파일을 수정해 일반 미션·자유대화 Router로 겸용화하는 것은 범위·회귀 위험이 크다. 현 단계에서는 **읽기 전용 참고 + Premium Live 비적용 명시**가 맞다.

## 공통 STT Router 권고안

권고 위치: `hooks/useSttRouter.ts`.

근거:

- `docs/conventions.md`의 `hooks/`는 여러 화면의 공통 로직을 callback options로 추출하는 위치이며, STT Router의 책임은 브라우저 마이크/Browser API/RAM buffer/async cleanup이라는 클라이언트 상태 관리다.
- 기존 공유 음성 훅이 이미 `hooks/useVoiceChat.ts`에 있고, Mission과 Free Chat 모두 그 훅을 소비한다. `lib/stt/`는 현재 `childSpeechHints.ts`, `scriptGuard.ts`처럼 순수 server/shared 정책에 적합하며 브라우저 lifecycle 훅의 주 위치가 아니다.
- GCP fallback HTTP 호출은 새 endpoint를 만들지 말고 우선 기존 `POST /api/mission/stt`를 재사용한다. endpoint가 free_chat도 지원하는 사실이 코드에 명시돼 있다 (`app/api/mission/stt/route.ts:86-98`).

권장 분리:

```text
hooks/useSttRouter.ts        Browser SpeechRecognition + per-turn PCM/Blob RAM + winner/cleanup/metrics
hooks/useVoiceChat.ts        공용 mic/TTS/화면 transcript orchestration; Router의 final transcript만 받음
app/api/mission/stt/route.ts 기존 GCP REST fallback endpoint 유지
lib/stt/*                    child hints, transcript validation 같은 순수 정책만 유지
```

Router public contract는 Mission/Free Chat business rule을 받지 않고 `{ inputMode, onFinalTranscript, onFailure, sessionId }` 수준으로 제한해야 한다. 키보드 입력은 현재처럼 `sendTypedText()`를 통해 Router를 우회한다 (`hooks/useVoiceChat.ts:548-554`). Premium Live `useGeminiLive`는 이번 A1 적용 대상에서 제외한다.

## Phase 1 전 확인할 위험

1. 기존 `useVoiceChat`의 1.3초 GCP interim polling(`hooks/useVoiceChat.ts:297-312`)은 Browser success 때 GCP 0회라는 A1 원칙과 충돌한다. Router 전환 시 이를 제거/대체하는 명시적 설계가 필요하다.
2. 일반 `useVoiceChat`의 `tN`은 훅 내부 local ID이고 미션 downstream의 `${sessionId}:${questionId}:${seq}`와 다르다. A1 Router turn ID와 기존 persistence idempotency key의 매핑을 정해야 한다.
3. 현재 PCM은 `Uint8Array[]`이며 A1 요구의 MediaRecorder Blob은 아니다. 동일 발화 fallback을 보장하려면 현 PCM buffer를 유지할지 MediaRecorder로 바꿀지, GCP endpoint의 LINEAR16 계약(`app/api/mission/stt/route.ts:13-14,121-130`)과 함께 확정해야 한다.
4. Browser `SpeechRecognition`은 iOS Safari 지원이 제한적일 수 있으므로 unsupported는 정상적인 즉시 GCP fallback으로 취급해야 한다. 현 코드에는 OS별 provider 분기가 없다.
