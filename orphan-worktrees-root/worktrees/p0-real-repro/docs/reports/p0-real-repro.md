# P0 Mission manual mic / keyboard lock 실제 컴포넌트 재조사

## 기준과 방법

- 기준: `main`/격리 브랜치 `p0-real-repro` HEAD `22ebd1a` (`1c071fd` 포함)
- Chromium/Playwright는 실행하지 않았다.
- `app/child/missions/page.tsx`의 default export를 jsdom + React DOM `createRoot`로 직접 마운트했다.
- `useVoiceChat`/`useGeminiLive`와 외부 네트워크만 Node `mock.fn`으로 대체했고, 실제 페이지의 state/effect/handler를 실행했다.
- localStorage에 `k_child_id=child-1`, `k_voice_input_mode:child-1=manual`을 마운트 전에 저장했다.
- 신규 시작과 이어하기를 독립 마운트로 실행했다.

테스트: `app/child/missions/page.real-repro.test.ts`

실행: `npm run test:mission-real-repro`

## 1. manual 최초 진입 mic 결과

페이지 수준의 `setMicEnabled(true)`/`isRecording=true` 회귀는 재현되지 않았다. 실제 순서는 아래와 같았다.

```text
{"sequence":2,"event":"page.render","isAuto":true,"voiceInputModeHydrated":false,"isRecording":false,"mode":"voice","turnPhase":"idle"}
{"sequence":5,"event":"page.hydrate:start","isAuto":true,"voiceInputModeHydrated":false,"isRecording":false,"mode":"voice","turnPhase":"idle"}
{"sequence":6,"event":"live.setInteractionMode","args":["manual"]}
{"sequence":7,"event":"live.setMicEnabled","args":[false]}
{"sequence":8,"event":"stt.setInputMode","args":["manual"]}
{"sequence":9,"event":"stt.setMicEnabled","args":[false]}
{"sequence":10,"event":"page.hydrate:queued","isAuto":false,"voiceInputModeHydrated":true,"isRecording":false,"mode":"voice","turnPhase":"idle"}
{"sequence":13,"event":"page.render","isAuto":false,"voiceInputModeHydrated":true,"isRecording":false,"mode":"voice","turnPhase":"idle"}
```

manual 신규/이어하기 모두 `setMicEnabled(true)` 호출은 0회였다. 따라서 `voiceInputModeHydrated`/`didHydrateRef`가 늦게 동작하거나 다른 page effect가 먼저 `true`를 호출한다는 가설은 이 실행에서 기각됐다.

단, active 진입 후 다음 호출은 실제로 발생했다.

```text
{"sequence":36,"event":"layout.render","entryStatus":"active","isAuto":false,"isRecording":false,"isTextMode":false,"textInput":"","voiceState":"idle"}
{"sequence":37,"event":"stt.startSession","args":[]}
```

즉 hydration 게이트는 manual preference와 PCM enable 값은 정상 동기화하지만, manual에서도 음성 세션 자체를 자동 시작한다. 실제 훅은 mock 대상이어서 이 테스트로 브라우저 미디어 track 활성화 여부까지 주장할 수 없다. 다만 실제 `useVoiceChat.startSession()`은 `startSttCapture()`, `useGeminiLive.startSession()`은 `getUserMedia()`를 호출하는 구현이므로, 대표님이 본 것이 page의 녹음 상태가 아니라 브라우저 mic 사용 표시라면 다음 라운드에서 이 세션 시작/미디어 획득 경계를 별도 실제-hook 테스트로 확정해야 한다. 이번 결과만으로 mic 증상이 수정됐다고 판정하지 않는다.

## 2. keyboard 전환 후 입력 잠김 — 수정 전 재현

신규 STT/TTS 실행:

```text
{"sequence":61,"event":"layout.render","entryStatus":"active","isAuto":false,"isRecording":false,"isTextMode":true,"textInput":"학교에서 축구했어","voiceState":"idle"}
{"sequence":62,"event":"page.typed-guard","missionState":"active","turnPhase":"idle","answerInFlight":false,"voiceMode":"stt_tts","result":false}
```

- 입력 문자열은 정상적으로 state에 들어갔다.
- `missionState=active`, `answerInFlight=false`, voice 연결도 `live`였다.
- 차단 원인은 오직 `turnPhase=idle`이었다.
- `stt.sendTypedText` 호출은 0회였고 입력은 화면에 남았다.

이어하기 실행도 동일했다.

```text
{"sequence":63,"event":"layout.render","entryStatus":"active","isAuto":false,"isRecording":false,"isTextMode":true,"textInput":"이어하기 답변","voiceState":"idle"}
{"sequence":64,"event":"page.typed-guard","missionState":"active","turnPhase":"idle","answerInFlight":false,"voiceMode":"stt_tts","result":false}
```

### 확정 원인

`canAcceptTypedInput()`이 모든 음성 파이프라인에 `turnPhaseRef.current === "child_listening"`을 강제했다. 그러나 이 `turnPhase` 상태머신은 Live 전용이고, STT/TTS의 정상 첫 질문/이어하기에서는 `idle`에 머문다. `1c071fd`는 hydration과 mic gate를 보강했지만 이 잘못된 공통 typed-input 조건을 수정하지 않아 keyboard 잠김이 그대로 남았다.

## 3. 최소 수정 및 수정 후 실행

`canAcceptTypedInput()`에서 `child_listening` 조건을 Live에만 적용했다. 공통 조건인 active mission과 `answerInFlight=false`는 유지했다.

신규 수정 후:

```text
{"sequence":62,"event":"page.typed-guard","missionState":"active","turnPhase":"idle","answerInFlight":false,"voiceMode":"stt_tts","result":true}
{"sequence":63,"event":"page.typed-guard","missionState":"active","turnPhase":"idle","answerInFlight":false,"voiceMode":"stt_tts","result":true}
{"sequence":64,"event":"stt.sendTypedText","args":["학교에서 축구했어"]}
{"sequence":68,"event":"layout.render","entryStatus":"active","isAuto":false,"isRecording":false,"isTextMode":true,"textInput":"","voiceState":"idle"}
```

이어하기 수정 후:

```text
{"sequence":64,"event":"page.typed-guard","missionState":"active","turnPhase":"idle","answerInFlight":false,"voiceMode":"stt_tts","result":true}
{"sequence":65,"event":"page.typed-guard","missionState":"active","turnPhase":"idle","answerInFlight":false,"voiceMode":"stt_tts","result":true}
{"sequence":66,"event":"stt.sendTypedText","args":["이어하기 답변"]}
{"sequence":70,"event":"layout.render","entryStatus":"active","isAuto":false,"isRecording":false,"isTextMode":true,"textInput":"","voiceState":"idle"}
```

수정 후 실제 페이지 테스트 3/3 통과.

## 검증 결과

- `npm run test:mission-real-repro`: 3/3 통과
- `npx tsc --noEmit`: 통과
- `npm test`: 기존 54/54 + 실제 페이지 3/3 통과
- 클린 빌드 1차: compile/type 통과, static pages `0/238`에서 worker code 1
- 클린 빌드 2차: workspace TMPDIR로 분리, compile/type 통과, static pages `59/238`에서 worker code 1

빌드 worker는 두 번 모두 상세 오류 없이 종료했다. 첫 실행 당시 `/tmp`는 99% 사용 중이었지만 workspace TMPDIR 재시도도 실패했으므로 용량 문제로 단정하지 않는다. 동일 문제 2회 제한에 따라 추가 빌드는 중단했다. 실패 산출물은 ignored `scratch/p0-real-repro/`에 보존했다.

## 결론

- keyboard 잠김: 실제 컴포넌트로 신규/이어하기 모두 재현, 원인 확정, 최소 수정 후 동일 테스트 통과.
- mic의 `setMicEnabled(true)`/`isRecording=true`: 실제 컴포넌트 테스트에서는 재현되지 않음. 단, manual에서도 `startSession()` 자동 호출은 확인됐으므로 실제 mic media track 문제는 해결 판정하지 않음.
- 커밋하지 않음.
