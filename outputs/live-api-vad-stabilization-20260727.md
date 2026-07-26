# Care Premium(Live API) VAD 무입력 안정화

작성일: 2026-07-27 (실행 시각 기준 2026-07-26, Dev 서버 시각)
대상: `hooks/useGeminiLive.ts` 및 관련 UI(Live API 전용, STT/TTS·자유대화 미접촉)

## 1. 확정된 원인 (이미 확인된 것, 재조사 없이 인용)

Cloud Run relay(`vertex-live-relay-dev`) 로그를 `gcloud logging read`로 직접 조회해 확인:
세션이 `vertex_open`으로 정상 오픈된 뒤 60초 동안 `input_audio_chunk`가 단 1건도 없다가
relay 자체 `heartbeat_timeout`으로 강제 종료된 사례(세션 `f5fae40c-...`, 2026-07-26
01:57:14~01:58:14). Vertex/relay/서버는 전부 정상 — 문제는 **클라이언트가 AUTO 모드에서
VAD RMS_THRESHOLD(0.015)를 못 넘겨 오디오를 아예 relay로 전송하지 못하는 구간**이었다.

## 2. 구현 내용 (요구사항 5개)

### 1) 무입력 감지 → "듣는 중" 대신 "마이크 입력 없음" 상태 표시
- `hooks/useGeminiLive.ts`: `silenceEligibleSinceRef`/`noAudioInputRef`/`noAudioInput` state
  신설. AUTO 모드 + 마이크 활성 + K 비발화 상태(`isLiveActive && interactionModeRef.current
  !== "manual"`)로 `NO_AUDIO_INPUT_TIMEOUT_MS`(7초) 동안 실제 오디오 전송이 없으면
  `onNoAudioInput(true)` 호출 + `noAudioInput` state를 true로. 대상 조건을 벗어나면(K가
  말하기 시작, 마이크 꺼짐, 수동 모드, 세션 미접속) 즉시 타이머 리셋.
- `components/VoiceConversationStateBadge.tsx`: `"no_input"` state 추가. 문구
  "다시 말해줄래?", 아이콘 🎤, amber 톤(`#fffbeb`/`#b45309`) — 기존 초록(듣는 중)/파랑
  (생각하는 중)/분홍(말하는 중)과 겹치지 않는 경고색.
- `app/child/missions/page.tsx`: **실측 결과 turnPhaseUi 특정 분기(child_listening/
  child_finalizing)에만 걸면 놓치는 케이스를 라이브 재현으로 발견**(§4 참고) — 최종적으로
  `live.noAudioInput`을 turnPhaseUi 값과 무관하게 최우선으로 확인하도록 수정.

### 2) VAD 게이트 동작을 클라이언트 debug timeline에 기록
- `logVadSample()` 신설 — `rms`/`threshold`/`micEnabled`/`kSpeaking`/`chunkSent`/`vadState`를
  `logVoiceEvent`(eventType `"vadSample"`)로 기록. `NEXT_PUBLIC_DEBUG_VOICE_TIMELINE`으로
  게이팅되어 있어 프로덕션에는 영향 없음(기존 로깅 인프라 그대로 재사용).
- 매 오디오 프레임(~128ms)마다 로깅하면 너무 시끄러우므로 `VAD_SAMPLE_LOG_THROTTLE_MS`(1초)로
  스로틀링, 단 VAD 상태 전환 시점(candidate buffer flush)은 `force: true`로 즉시 기록.

### 3) VAD threshold를 설정 가능하게 분리
- `resolveVadRmsThreshold()` 신설 — `NEXT_PUBLIC_VAD_RMS_THRESHOLD` 환경변수로 오버라이드
  가능. 값이 없거나 숫자로 파싱되지 않으면 기존 기본값(0.015)으로 안전하게 폴백.
  이번 라이브 검증은 환경변수 미설정(기본값 0.015) 상태로 진행 — 오버라이드 자체의 동작은
  코드 로직상 확인(파싱 실패 시 폴백 분기 tsc 통과)했으나 실제로 다른 값을 넣어 라이브
  재현하지는 않았다(범위: 코드 정확성 확인, 값 튜닝은 향후 실기기 데이터 기반 별도 판단 필요).

### 4) 재발화 시 세션 재연결 없이 자동 복구
- "마이크 입력 없음" 상태는 WebSocket/Vertex 세션을 전혀 건드리지 않는 순수 UI 신호.
  VAD가 실제로 `rms >= threshold`를 다시 감지해 `sendRealtimeInput({ audio })`가 재호출되는
  순간 자동으로 `noAudioInput=false`로 복귀. `teardown()`에도 정리 로직 추가(세션 종료 시
  다음 세션으로 상태가 새는 것 방지).

### 5) 실제 라이브 검증
아래 §3~4 참고.

## 3. 라이브 검증 환경

- Dev URL: `https://k-bestie-v3-dev.vercel.app`
- 최종 배포: `dpl_CxXezNymezRq8jGsaSq8EhfkPA6y` (커밋 `7274a61`)
- 계정: `ksd160202`(개발 서버 전용 Live/Tier3 테스트 계정, child_profiles.id
  `791c8734-ef7b-4d7b-971b-61038d330532`, given_name "서둥", tier=3 — 테스트 전후 변경 없음,
  실계정 아님, `안영진/안서둥` 개발서버 전용 계정 정책에 해당)
- 방식: Playwright + Chrome `--use-file-for-fake-audio-capture=<wav>` — 완전 무음
  fake-media는 Live VAD를 통과하지 못하므로(기존 세션에서 이미 확인된 제약), 실제 음성이
  담긴 WAV 파일을 입력으로 사용:
  - 정상 흐름용: Google Cloud Text-to-Speech(`ko-KR-Wavenet-A`)로 합성한 실제 한국어 문장
    (~5초)
  - 무입력 감지용: 20초 순수 무음 WAV
  - 자동 복구용: 9초 무음 + 실음성(~5초) + 3초 무음을 이어붙인 WAV
- 검증 중 발견한 이전 세션 잔재: 같은 child_id에 `ended_at IS NULL`인 미종료
  `chat_sessions`가 6건 남아있어 항상 같은 대화가 재개됨 — 전부 `ended_at`을 현재시각으로
  갱신해 매 검증마다 새 세션으로 시작하도록 정리(자동화 QA 계정 데이터 정리 관례에 따름).

## 4. 검증 결과

### (1) 정상 흐름 — **PASS**
실음성 WAV 재생 시 VAD가 RMS 0.05~0.13대(threshold 0.015 대비 충분히 위)로 즉시 감지,
`activityStart` 전송 → relay 로그에서 `input_audio_chunk` 연속 수신 확인.

### (2) 무입력 감지 — **PASS**
20초 무음 WAV: 클라이언트 배지가 t=7~9초 구간에서 "다시 말해줄래?"(no_input)로 전환,
20초 내내 `liveStatus`는 계속 `"live"` 유지(재연결/종료 없음). *(중간 발견·수정 — 아래 참고)*

### (3) 자동 복구 — **PASS**
9초 무음 + 실음성 + 3초 무음 WAV: `noAudioInput`이 t=7.5s에 true, 실음성이 시작되는
t=9.0s에 자동으로 false 복귀. 클라이언트 콘솔에 `"Live session open"`이 테스트 전체
구간에서 **정확히 1회만** 출현(재연결 없음). Cloud Run relay 로그로 교차검증:
```
vertex_open        (세션 시작)
  ... (9초 무음 구간, 이벤트 없음) ...
activity_start      (실음성 감지, vertex_open + 9.15s)
input_audio_chunk × N
activity_end + client_text_message
output_transcription + output_audio_chunk × N (K 실제 음성 응답)
turn_complete
(두 번째 질문/응답 턴도 동일 세션에서 정상 진행)
client_close / session_end / vertex_close   (테스트 스크립트가 브라우저를 닫은 시점 — 정상 종료)
```
relay 로그 전체에서 `vertex_open`이 단 1회만 기록되어, 클라이언트 재연결이 실제로
발생하지 않았음을 서버 쪽에서도 확인했다.

### 중간 발견 및 수정 (라이브 검증 중 자체 발견한 버그)
1차 배포 후 라이브 재현 결과 `live.noAudioInput`은 정확히 true로 전환됐으나(훅 레벨
로직은 정상) 화면에 배지가 뜨지 않는 문제를 발견했다. 임시 `window.__kbestieDebug` 노출로
직접 확인한 결과, **새 세션 시작 시 `turnPhaseUi`가 무음 상태에서 "child_listening"으로
전환되지 않고 세션 시작 시점의 `"idle"`에 계속 머물러 있었다** — 즉 최초 구현(`voiceState`
계산을 `turnPhaseUi === "child_listening" || "child_finalizing"` 분기 안에서만 확인)은
이 케이스를 놓쳤다. `live.noAudioInput` 자체는 `isLiveActive`(마이크 활성+K 비발화)만으로
독립적으로 판정되므로, `turnPhaseUi` 값과 무관하게 최우선으로 확인하도록 수정한 뒤
재배포·재검증해 위 (2)(3) 결과를 확정했다. 디버그용 임시 코드(`window.__kbestieDebug`)는
검증 완료 후 완전히 제거하고, 제거된 최종본으로 다시 tsc/test/build + 라이브 재확인까지
완료했다.

## 5. 타입검사·테스트·빌드

- `npx tsc --noEmit`: 클린
- `npm test`: 111/111 통과
- `npm run build`: 성공(첫 시도 클린, 알려진 WasmHash 비결정적 크래시 재현 없음)

## 6. 변경 파일 / 커밋

- `hooks/useGeminiLive.ts`
- `components/VoiceConversationStateBadge.tsx`
- `app/child/missions/page.tsx`

커밋: `7274a61` — "fix(live): Care Premium VAD 무입력 안정화 (Live API 전용)"
(디버그용 중간 커밋 2개는 최종 배포 전 하나로 정리(soft reset)했다 — 히스토리에 남지 않음)

Dev 배포: `dpl_CxXezNymezRq8jGsaSq8EhfkPA6y` → `https://k-bestie-v3-dev.vercel.app`

## 7. Care Premium Live API 문제와 STT/TTS 문제의 분리

이번 작업은 `hooks/useGeminiLive.ts`(Live API 전용)와 그 UI 소비부(`app/child/missions/page.tsx`의
`isLiveMode` 분기)만 수정했다. STT/TTS(비Live) 분기, `hooks/useVoiceChat.ts`, 자유대화
(`app/chat/page.tsx`)는 전혀 접촉하지 않았다 — 별도로 진행된 STT/TTS 안정화 작업
(`outputs/stt-tts-state-reproduction-20260727.md`)과 완전히 독립적인 변경이다.

## 8. 남은 것 / 후속 확인 필요

- `NEXT_PUBLIC_VAD_RMS_THRESHOLD` 오버라이드 자체는 코드 레벨로만 확인했다 — 실제로 이
  값을 낮춰서(예: 마이크 감도가 낮은 실기기 대응) 라이브 재현 검증하지는 않았다. 실기기에서
  VAD가 여전히 아이 목소리를 못 잡는 사례가 재발하면, 이 환경변수로 threshold를 낮춰볼 것을
  권장한다.
- "마이크 입력 없음" 문구("다시 말해줄래?")는 대표님이 확정한 정확한 카피가 아니라 이번
  작업에서 아이 친화적 톤으로 새로 정한 것 — 필요시 조정 가능.
- 대표님 실기기(iPhone Safari/PWA, Android)에서 최종 확인 필요 — 이번 검증은 Playwright +
  fake-audio-capture 기준이며, 실기기 마이크 감도/네트워크 조건에서의 최종 확인은 대표님
  몫으로 남긴다.

---

## 9. claude-review + Codex 리뷰 반영 (2026-07-27, 2차 라운드)

### 지적사항 3건과 조치

**Codex [복잡] — 전역 훅 변경 범위 축소**: `VAD_CONFIG.RMS_THRESHOLD`(모듈 전역)와 무입력
감지 로직이 `useGeminiLive`를 쓰는 모든 호출부(자유대화 Live 경로, `TestModeABRunner`)에
무조건 적용되던 문제. `UseGeminiLiveOptions`에 `enableNoAudioInputDetection?: boolean`(기본
`false`) 옵션을 추가하고, `app/child/missions/page.tsx`의 `useGeminiLive({...})` 호출에만
`enableNoAudioInputDetection: true`를 명시적으로 넘기도록 변경. 이 옵션이 꺼진 호출부는
`rmsThresholdRef.current`가 항상 `DEFAULT_RMS_THRESHOLD`(0.015)로 고정되고 무입력 감지
자체가 `isNoAudioInputEligible` 판정에서 `enableNoAudioInputDetectionRef.current` 게이트로
차단되어 기존과 100% 동일하게 동작한다. `app/chat/page.tsx`(자유대화)는 애초에
`useGeminiLive`를 쓰지 않는 것으로 재확인(grep 0건) — "해당없음".

**claude-review [복잡] — waiting_k(K 응답 생각 중) 구간 오발동**: `activityEnd` 전송 시점부터
K가 실제로 응답하기 시작하기 전까지("생각하는 중") 무입력 감지가 계속 활성 상태로 남아
activityEnd로부터 약 5.8초 뒤(기존 8초 응답 타임아웃보다 먼저) 오발동할 수 있던 문제.
`awaitingKResponseRef`를 신설해 3개 `activityEnd` 전송 지점(자동 VAD 침묵 감지 종료,
`setInteractionMode` 전환 중 종료, `sendActivityEnd` 수동 종료) 모두에서 `true`로 세팅하고,
K가 실제로 말하기 시작하는 지점(`kSpeakingRef.current = true` 세팅 지점), 생성 취소
(`cancelCurrentGeneration`), 아이가 다시 말하기 시작하는 지점(자동 VAD candidate 진입,
`sendActivityStart`) 4곳에서 `false`로 리셋. `isNoAudioInputEligible`에
`&& !awaitingKResponseRef.current` 조건 추가.

**Codex [단순] — threshold 값 검증 강화**: `resolveVadRmsThresholdOverride()`에 상한
`MAX_RMS_THRESHOLD = 0.5` 추가 — `0 < parsed <= 0.5` 범위 밖이면 기본값(0.015)으로 폴백.

### 대표님 신규 요구 — 저수준 캡처 파이프라인 진단 (VAD 판정 이전 단계)

`NEXT_PUBLIC_DEBUG_VOICE_TIMELINE` 게이팅 하에 3종 이벤트 추가:
- `micStreamAcquired` / `micStreamFailed` — `getUserMedia` 성공/실패를 정확히 그 지점에서
  기록(트랙 수·label 또는 에러명/메시지).
- `audioProcessNeverFired` — 세션 시작 3초 안에 `processor.onaudioprocess` 콜백이 단 한 번도
  호출되지 않으면 1회만 기록(RMS 값·threshold와 완전히 무관 — "콜백 자체가 오는가"만 확인).
- `sendAttemptedNoSession` — `sessionRef.current`가 `null`이라 `sendRealtimeInput(audio)` 호출이
  조용히 무시된 경우를 스로틀링해서 기록. 이 작업 중 발견: 기존 코드는 이 실패 케이스에서도
  `chunkSentThisFrame`을 무조건 `true`로 세팅하는 버그가 있었다(`sessionRef.current?.` optional
  chaining이 실패를 완전히 삼켰음) — `trySendAudioChunk()` 헬퍼로 통합해 실제 전송 성공 여부를
  정확히 반환하도록 수정, 3개 호출 지점(수동 모드/VAD candidate/VAD active) 전부 교체.

### 재검증 결과 (Dev, `ksd160202` Care Premium 계정, 격리 워크트리 배포)

- tsc/`npm test`(111/111)/`npm run build` 전부 클린(빌드는 무관한 병렬 세션의 미커밋 임시
  파일 `app/debugmbtipreviewtemp`가 자체 `useSearchParams` Suspense 오류로 막고 있어, 그
  파일만 임시로 옮겨두고(`mv`) 빌드 성공 확인 후 원래 위치로 정확히 복원 — 이번 변경과
  무관함을 격리 확인).
- **정상 흐름 재검증(PASS)**: 실음성 WAV(`child_speech.wav`, `--use-file-for-fake-audio-capture`)
  로 재생 — VAD가 정상적으로 candidate→active 전환, `chunkSent: true`로 오디오 전송, `vadSample`
  로그가 1초 간격으로 정확히 스로틀링됨. 회귀 없음.
- **무입력 감지 재검증(PASS)**: `silence_20s.wav`로 재생 — `micStreamAcquired`(label: "Fake
  Default Audio Input") 정상 기록, 세션 시작 약 7.3초 뒤 `noAudioInput: {active: true}` 발생
  (설계값 `NO_AUDIO_INPUT_TIMEOUT_MS=7000`과 일치). `audioProcessNeverFired`는 발생하지
  않음(콜백 자체는 정상 호출되고 있었다는 뜻 — fake device가 무음이어도 콜백은 옴, 올바른
  구분).
- **재연결 없는 자동 복구(PASS)**: 위 무입력 감지 테스트 및 별도 `recovery_scenario.wav` 테스트
  구간 동안 Cloud Run relay 로그(`vertex-live-relay-dev`)를 대조 — 테스트 종료 시 브라우저가
  스스로 닫을 때의 `client_close(1001)`/`vertex_close(1000)` 1건만 있었고, 그 외 어떤 시점에도
  `heartbeat_timeout`이나 예기치 않은 재연결이 발생하지 않음 — 무입력 상태 표시가 세션을 전혀
  건드리지 않는다는 것을 실측으로 재확인.
- **커밋 관련 특이사항**: 이번 라운드의 변경분(`hooks/useGeminiLive.ts` 139줄,
  `app/child/missions/page.tsx` 3줄)은 별도로 커밋하려 했으나, 확인 결과 이미 병렬 세션의
  커밋(`5e17963 style(quiz): increase content density...`)에 광범위 `git add`로 함께 흡수되어
  있었다(`git show 5e17963 --stat`로 두 파일의 정확한 변경 라인 수까지 대조 확인 — 내용
  유실 없음, 커밋 메시지 귀속만 그쪽 커밋). 재커밋하지 않음(중복 이력 방지, 이 저장소의
  기존 처리 관례와 동일).
- Dev 배포: `dpl_8EPo1K3GiV6xfiqUCu5wmv785VAp` → `https://k-bestie-v3-dev.vercel.app`

### 남은 것
- `awaitingKResponseRef`가 개입하는 정확한 5.8초~8초 구간의 실제 무오발동은 논리 검토로
  확인했으나(activityEnd 시점부터 배타적으로 켜지고 K 발화 시작 시점에 정확히 꺼짐), 인위적으로
  K 응답을 5~7초 지연시키는 네트워크 조건까지 라이브로 재현하지는 못했다 — 코드 경로상
  타이밍 계산은 확인됐으나 이 특정 타이밍 창의 실측 재현은 후속 과제로 남긴다.
- threshold 오버라이드 실측 재검증(환경변수로 낮춰서 실제 마이크 감도 낮은 조건 흉내)은
  이번에도 수행하지 않음 — 필요시 후속.
