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
