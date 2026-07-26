# STT/TTS(Tier1/2, Care Start/Insight) 상태전환·TTS재생 재현 테스트

작성일: 2026-07-27
범위: `app/child/missions/page.tsx`의 비Live(STT→LLM→TTS) 파이프라인 한정.
**Care Premium Live API(`hooks/useGeminiLive.ts`, `isLive`/`isLiveMode` 분기)는 이번 작업과 완전히 무관하며 전혀 수정하지 않았다.**

## 테스트 환경

- Dev URL: https://k-bestie-v3-dev.vercel.app
- 수정 전 커밋: b1f7249
- 수정 커밋: c7b3097 (1차 수정), 44b3dac (회귀 수정)
- 계정: `qaclaude160202@kbestie.local` — family `bc65ccf1...`(대표님 소유 계정) 내 `child_profiles.id = cde1b847-...`, `name: "QA테스트"`, `grade: 5학년`. 같은 family에 실제 자녀(김서둥/김서현/김서아)가 함께 있어 **이 세 계정은 전혀 접근하지 않았다.**
- 테스트 전 `child_profiles.tier`를 3(Live) → 1(Care Start, STT/TTS)로 임시 변경, **테스트 종료 후 3으로 정확히 원복 확인 완료.**
- 테스트 후 `mission_progress` 테스트 세션 삭제로 원상복구.
- 도구: Playwright(`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`), 브라우저 콘솔의 `[MISSION-DEBUG]` 로그 및 화면 DOM 텍스트(배지 문구) 직접 캡처.
- 로컬 전체 빌드(`npm run build`)는 같은 저장소에서 동시에 작업 중인 다른 병렬 세션과의 파일 충돌로 `/admin/plays`, `/account/withdrawn` 등 무관한 페이지에서 간헐적 `PageNotFoundError`가 발생해 신뢰할 수 없었다 — 이번 변경의 회귀 검증은 `npx tsc --noEmit`(클린) + `npm test`(111/111 통과)로 대체했고, 격리 워크트리에서의 빌드 1회는 실제로 성공했음을 확인(그 성공한 빌드를 그대로 Vercel에 배포함).

## 가설 1 — AUTO 모드에서 "듣는 중" 배지가 뜨지 않는다

### 재현 절차
1. `mission_progress` 테스트 세션 삭제 → 완전히 새 미션 세션으로 `/child/missions` 진입(수정 전 커밋 b1f7249 배포 상태).
2. AUTO 모드(기본값) 그대로, 인사 발화 재생 종료 후 아이 답변을 기다리는 구간을 300ms 간격으로 22초간 폴링하며 배지 텍스트(`듣는 중`/`생각하는 중`/`말하는 중`) 존재 여부 확인.

### 결과 (수정 전)
```
t+5.2s speak() invoked: "안녕~ 오늘 하루 어땠니?"
poll(300ms 간격, 60회): ----SSSSSSS-------------------------------------------------
```
TTS 재생 구간(S)은 정상 표시됐으나, 그 이후 아이 답변을 기다리는 약 13.5초 동안 배지는 계속 `-`(idle) — `듣는 중`이 단 한 번도 표시되지 않음. **재현됨.**

### 원인
`voiceState` 계산(비Live 분기)이 `isRecording`(수동 녹음 버튼 전용 상태)에만 의존한다. AUTO 모드는 `useVoiceChat`이 이미 제공하는 `onSpeechBegin`/`onSpeechEnd` 콜백을 애초에 연결하지 않아 `isRecording`이 AUTO 모드에서는 절대 `true`가 되지 않는다.

### 수정 내용 (커밋 c7b3097, 44b3dac)
- `app/child/missions/page.tsx`: `useVoiceChat` 옵션에 `onSpeechBegin`/`onSpeechEnd`를 AUTO 모드 전용으로 연결(`isLiveModeRef`/`isAutoRef` 가드) → 신규 상태 `isAutoListening`.
- `voiceState` 판정에 `isRecording || isAutoListening`으로 확장 (수동 모드 로직·버튼 동작 무변경).
- **회귀 발견 및 수정**: 1차 수정 후 텍스트 모드 답변 제출 재현 테스트에서, 헤드리스 fake-media 환경은 무음이 자연 발생하지 않아 `onSpeechEnd`가 오지 않고 `isAutoListening`이 계속 `true`로 남아 이후 "생각하는 중"/"말하는 중"을 가리는 회귀를 직접 재현·발견했다. `setIsProcessingAnswer(true)` 시점(답변 처리 시작, 487행)에 `setIsAutoListening(false)`를 확정적으로 추가해 해결(44b3dac).
- Live API 관련 파일은 전혀 수정하지 않음.

### 수정 후 재검증 (Dev 재배포 후 라이브)
```
[1차 확인] t+7.8s speak() invoked → poll: ----SSSSSSSSLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL
[회귀 확인 후 재검증] 텍스트 답변 제출 → poll: TTTTTTTTSSSSSSSSSSSSSSSSSSSSSSSSSS----------------
```
- 인사 발화 후 실제 "듣는 중"이 정상 표시됨(첫 번째 확인).
- 회귀 수정 후, 답변 제출 → "생각하는 중"(T) → "말하는 중"(S) → idle 순서가 다시 정확히 재현됨(두 번째 확인) — 회귀 해소 확인.
- 두 차례의 전체 대화(총 4턴, 아래 가설 2 절 참고)에서 추가 회귀 없음 확인.

**판정: 재현됨 → 수정 완료 → 재검증 통과.**

## 가설 2 — TTS 재생 실패가 조용히 삼켜질 수 있다

### 재현 시도
텍스트 모드로 총 4턴(별도 세션 2회, 각 2턴) 답변을 제출해 매번 `/api/mission/respond` 없이(비Live는 `fetchPersonalizedReaction`+`/api/mission/reaction-lean` 사용) 실제 리액션 생성 → `sttTts.speak()` → TTS 합성 → 오디오 디코딩/재생까지 풀 파이프라인을 라이브로 통과시켰다.

### 결과
- 4턴 전부 `[MISSION-DEBUG] /api/voice/tts status: 200` 확인, `speak() caught exception`/`tts !res.ok`/`tts response missing audioContent` 등 실패 로그 0건.
- 배지가 매번 `생각하는 중` → `말하는 중` → idle로 정확히 전환됨.
- 콘솔 에러 2건(`Failed to load resource: 403`)은 `[WAKE-LOCK-DEBUG] acquire:failed`와 동일 시점에 발생 — Wake Lock API가 이 헤드리스 환경에서 거부된 것으로, TTS/음성 파이프라인과 무관함을 확인.
- 사전 코드 분석에서 우려했던 "DB `turn_timing_events`에 `speech_end`는 있는데 `playback_start`가 없는 세션 다수" 관찰은, 이번 라이브 재현에서는 재현되지 않았다 — AUTO 모드 fake-media 환경은 RMS 무음이 자연 발생하지 않아 애초에 `finalizeChildTurn`(따라서 `speech_end`)이 거의 트리거되지 않는다는 점을 함께 확인했으며, 이는 실제 재생 실패가 아니라 세션이 애초에 끝까지 진행되지 않은 사례가 다수 섞였을 가능성을 시사한다(확정은 아님, 대표님 실기기 확인 시 추가로 봐야 할 부분).

**판정: 재현 안 됨. 코드/텔레메트리는 조용히 삼켜질 여지를 열어두고 있으나, 4회 라이브 재현에서는 한 번도 실패하지 않았다. 재현되지 않았으므로 코드는 건드리지 않았다.**

## Live API와의 분리 확인

- 수정한 두 커밋(c7b3097, 44b3dac) 모두 `app/child/missions/page.tsx` 단일 파일, `isLiveMode`/`isLive` 분기 밖의 AUTO-모드 전용 코드만 변경.
- `hooks/useGeminiLive.ts`는 diff에 전혀 등장하지 않음.
- 커밋 메시지에 "STT/TTS 한정, Live API 미변경" 명시.
- Care Premium Live API 문제는 이번 재현 테스트 범위 밖이며, 별도 이슈로 완전히 분리되어 있다.

## 검증 결과 요약

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | 클린 (2회, 각 수정 후) |
| `npm test` | 111/111 통과 (2회) |
| 로컬 전체 `npm run build` | 격리 워크트리에서 1회 성공 확인. 이후 반복 검증은 병렬 세션 파일 충돌로 신뢰 불가 판단, 생략 |
| Vercel 배포 빌드 | 2회 모두 READY, `k-bestie-v3-dev.vercel.app`에 정상 alias |
| 라이브 재현(수정 전) | 가설 1 재현 확인 |
| 라이브 재검증(수정 후) | 가설 1 해소 확인 + 회귀 1건 발견·수정·재검증 |
| 라이브 재현 시도(가설 2) | 4턴 전부 재현 안 됨 |

## 변경 파일

- `app/child/missions/page.tsx` (isAutoListening 신규 state, onSpeechBegin/onSpeechEnd 연결, voiceState 판정 확장, resetToIdle/답변처리 시작 지점의 확정적 해제)

## 커밋

- `c7b3097` — AUTO 모드 "듣는 중" 배지 미표시 수정
- `44b3dac` — 위 수정의 회귀(isAutoListening 미해제로 생각/말하는 중 가림) 수정

## 남은 사항

- 가설 2는 재현되지 않았으나 완전히 배제된 것은 아니다 — `turn_timing_events`의 `speech_end`/`playback_start` 불일치가 실제 재생 실패인지, 세션 미완주 아티팩트인지는 실기기(대표님)에서 AUTO 모드로 끝까지 완주한 대화 몇 건을 직접 확인해야 최종 확정 가능하다.
- 로컬 전체 빌드가 병렬 세션과 충돌하는 현상 자체는 이번 작업 범위 밖이라 별도 조치하지 않았다.
