# STT A1 전환 계획 — Browser STT Primary + GCP STT Fallback (Development Only)

> 작성: Claude (Opus 5, xhigh) · 2026-08-10
> 근거: `requests/request-stt-a1-browser-primary-gcp-fallback-dev-only.md`(원본) + `docs/plans/stt-a1-phase0-audit.md`(AS-IS 감사)
> **하드 제약(전 Phase 공통)**: 이번 작업은 Development 배포까지만 진행한다. 대표님 명시 승인 전 Production 배포·env 변경·Production DB/Edge Function 변경을 절대 하지 않는다. 최종 상태는 `WAITING_FOR_OWNER_QA`.

---

## 0. Phase 0 감사에서 확정된 설계 전제

1. **PCM을 유지한다, MediaRecorder Blob으로 바꾸지 않는다.** 지시서 §5는 "MediaRecorder 또는 현재 프로젝트의 안정적인 오디오 캡처 방식"을 허용한다. 기존 `hooks/useVoiceChat.ts`가 이미 `AudioContext`/`ScriptProcessorNode`로 LINEAR16 PCM을 RAM `Uint8Array[]`로 쌓고, `POST /api/mission/stt`가 이미 이 포맷을 기대한다. MediaRecorder(webm/opus)로 바꾸면 서버 트랜스코딩이 추가로 필요해 회귀 위험만 커진다. **기존 PCM 캡처 파이프라인을 그대로 재사용**하고, 그 위에 "한 턴 동안만 RAM 보관 + Browser 성공 시 즉시 폐기" 수명 관리만 얹는다.
2. **기존 `POST /api/mission/stt`를 GCP fallback endpoint로 그대로 재사용한다.** 이미 `session_type === "free_chat"`을 지원하므로 신규 endpoint를 만들지 않는다.
3. **Premium Live(`hooks/useGeminiLive.ts`)는 이번 작업 범위에서 완전히 제외한다.** 지시서 §2가 명시적으로 허용한 예외다. Router는 `useVoiceChat` 소비자(일반 미션 STT/TTS + 자유대화)에만 적용한다.
4. **신규 공용 훅 위치는 `hooks/useSttRouter.ts`.** `useVoiceChat`은 이 Router의 `onFinalTranscript` 콜백만 받고, 자신의 GCP 직접 호출·1.3초 interim polling 로직은 제거한다.
5. **제거 대상**: `hooks/useVoiceChat.ts:297-312`의 기존 1.3초 GCP interim polling. Browser STT 성공 시 "GCP 호출 0회" 원칙과 정면 충돌하므로 Router 도입과 동시에 제거한다.

### 0.1 (2026-08-11 계획 정정 — 게이트① 3연속 반려 후 CLAUDE.md §12-C에 따른 설계 보강)

**놓친 전제**: 원안은 "한 발화 = 한 SpeechRecognition 세션"을 암묵적으로 가정했다.
그러나 Android Chrome류 엔진은 `continuous=true`를 지키지 않고 세그먼트마다
recognition을 종료하므로, 한 발화(턴) 안에서도 recognizer 객체가 **여러 번
재시작**될 수 있다(§1 관찰 4, claude-review-stt-a1-phase1-r2 [복잡]A). 이 재시작
경계를 명시적 설계 결정 없이 구현한 3라운드 전부가 같은 결함군(세그먼트 유실/
순서 뒤바뀜)을 반복 재도입했다 — `SpeechRecognitionEvent.resultIndex`는 발화
전체가 아니라 **현재 recognition 세션 내부**의 상대 위치이므로, 재시작된 새
세션의 index는 항상 0부터 다시 시작한다.

**확정 설계**: 턴 단위 상태를 두 계층으로 분리한다.
- `committedSegments: string[]` — 재시작으로 폐기되기 **전** recognition
  세션들이 이미 확정한 세그먼트. 재시작 시점에 그 세션의 `finalSegments`를
  통째로 여기 append하고 폐기한다.
- `finalSegments: string[]` — **현재** recognition 세션 내부에서만 유효한,
  세션 로컬 resultIndex 기준 세그먼트.
- 조립 시 항상 `[...committedSegments, ...finalSegments].filter(Boolean).join(" ")`.
- `startTurn()`(새 턴)은 둘 다 초기화한다. `startRecognition()`의 **재시작
  경로**만 committedSegments로 flush한다.

부수 요구사항(같은 재시작 지점에서 함께 확정):
- 재시작은 `state === "LISTENING" && !browserFailed`일 때만 유효하다.
  이미 `browserFailed`가 선 턴은 `endTurn()`이 항상 GCP로 가므로 재시작이
  득이 없고, 재시작을 허용하면 마이크 권한 회수처럼 즉시 재실패하는 조건에서
  이벤트 루프 스핀이 발생한다(턴당 상한 없이 반복 재시작).
- 재시작 직전 이전 recognition 객체는 `releaseRecognition(false)`로
  핸들러를 반드시 해제한다(폐기된 세션의 지연 이벤트가 새 세션의 상태를
  오염시키지 않도록).

**테스트 순서 요구(재발 방지)**: 재시작을 검증하는 테스트는 반드시 2번째
recognition 세션의 첫 final을 `resultIndex: 0` + **새 `results` 배열**로
모델링해야 한다. 첫 세션의 이어지는 index(1, 누적 배열)로 모델링하면 재시작이
"같은 세션의 연속"처럼 보여 실제 버그를 가린다 — 이 실수가 2·3라운드 모두에서
반복됐다.

---

## 1. Phase 1 — 공용 STT Router (`hooks/useSttRouter.ts`)

**개발 주체**: Codex Sol (`gpt-5.6-sol`, effort high) — 아키텍처 민감(신규 상태머신, 기존 공유 훅 리팩터).

### 1.1 Public Contract

```ts
interface SttRouterOptions {
  sessionId: string;
  childTurnId: string; // 기존 downstream idempotency key 그대로 전달받음 (감사 §8)
  language?: string; // default "ko-KR"
  timeoutMs?: number; // Browser STT final-result timeout, named constant로 export, magic number 금지 (§10)
  onFinalTranscript: (transcript: string, meta: SttRouterMeta) => void;
  onFailure: (reason: SttFailureReason) => void; // Browser+GCP 모두 실패
}

interface SttRouterMeta {
  provider: "browser" | "gcp";
  browserSupported: boolean;
  fallbackTriggered: boolean;
  browserLatencyMs?: number;
  fallbackLatencyMs?: number;
  totalLatencyMs: number;
}

type SttFailureReason = "browser_and_gcp_failed" | "unsupported_and_gcp_failed";

interface SttRouter {
  state: "IDLE" | "LISTENING" | "BROWSER_PROCESSING" | "BROWSER_SUCCESS" | "GCP_FALLBACK" | "COMPLETED" | "FAILED" | "CANCELLED";
  startTurn(): void;   // 자동 모드: VAD speech_start에서 호출
  endTurn(): void;     // 자동 모드: VAD speech_end / 수동 모드: 버튼 종료
  cancel(): void;      // 화면 이탈/취소 — 반드시 Blob/PCM 폐기
}
```

Router는 Mission Goal이나 Free Chat 정책을 알지 않는다 (지시서 §13). `useVoiceChat`이 이 Router를 내부에서 생성하고 감싸며, 기존 `useVoiceChat` 소비자(미션 화면, 자유대화 화면)의 외부 인터페이스는 변경하지 않는다 — Router는 `useVoiceChat` **내부** 구현으로 들어간다.

### 1.2 내부 책임 분리

```
hooks/useSttRouter.ts
├─ Browser SpeechRecognition 래핑 (prefix detection, ko-KR, final-only)
├─ 기존 PCM 캡처 재사용 (useVoiceChat의 AudioContext 로직을 Router로 이전)
├─ turn 상태머신 (IDLE→...→COMPLETED/FAILED/CANCELLED)
├─ Fallback 판단 (§6 조건 전부: unsupported/onerror/network/no-speech-empty-final/timeout/start실패/비정상abort)
├─ GCP fallback 호출 (기존 POST /api/mission/stt 재사용, PCM 그대로 전송)
├─ Arbitration (late browser result 도착 시 이미 COMPLETED면 폐기 — 지시서 §9)
├─ Cleanup (성공/폴백완료/실패/취소 4개 경로 전부 PCM 버퍼 즉시 해제)
└─ Metrics (지시서 §16 필드 그대로, raw transcript/audio는 metrics에 넣지 않음)
```

### 1.3 turn_id 매핑 (감사 §8 위험 해소)

Router 내부 turn 식별자(`routerTurnId`)는 매 발화 시작 시 새로 발급하는 로컬 epoch다. **기존 `childTurnId`(미션 downstream idempotency key)를 대체하지 않는다** — Router는 `onFinalTranscript` 콜백 한 번만 정확히 호출하는 책임만 지고, 그 transcript를 어떤 turn/session에 귀속할지는 여전히 `useVoiceChat`/화면 레이어가 기존 로직대로 결정한다.

### 1.4 제거·변경

- `hooks/useVoiceChat.ts`의 기존 PCM 캡처/VAD/GCP 직접 호출/1.3초 interim polling을 `useSttRouter`로 이전.
- `useVoiceChat`의 외부 시그니처(미션 화면·자유대화 화면이 쓰는 부분)는 유지 — 내부에서 Router를 쓰도록 리팩터.
- `app/api/mission/stt/route.ts`는 **수정하지 않는다** (기존 GCP fallback endpoint 그대로 재사용, 지시서 §18 "GCP 코드 삭제 금지"와 일치).

### 1.5 완료조건

- Unit test (지시서 §27 전부): Browser success→GCP 0 / error→GCP 1 / empty→GCP 1 / timeout→GCP 1 / unsupported→GCP 1 / success 후 late error→GCP 0 / fallback 후 late Browser result→최종 transcript 1개 / GCP success→downstream 1회 / 둘 다 실패→상태 복구 / PCM cleanup / unmount cleanup / duplicate submit 0.
- `npx tsc --noEmit` 클린.
- Feature flag `BROWSER_STT_PRIMARY_ENABLED`/`GCP_STT_FALLBACK_ENABLED` (env, Dev만 true, Production 미설정 시 항상 기존 GCP-only 경로로 동작 — 지시서 §17).
- AGENTS.md §5 셀프검증 7항목 통과 후 반환.

---

## 2. Phase 2 — Mission 연결

**개발 주체**: Codex Sol (high) — Phase 1과 동일 세션 계열, 자동/수동 모두 `useVoiceChat` 내부 교체만으로 동작해야 하며 `app/child/missions/page.tsx`의 외부 호출부는 최소 변경.

- 자동/수동 모두 Router 경유 확인.
- downstream(`handleTurnComplete`, answer/respond/turn 저장)은 기존 로직 무변경 — Router가 주는 transcript 형태만 기존과 동일하게 유지.
- Premium Live(`sttMode: "gcp"`) 경로는 손대지 않음 — 회귀 테스트로 확인.

## 3. Phase 3 — Free Chat 연결

**개발 주체**: Codex Sol (high), Phase 2와 병렬 가능(파일 겹침 없으면) 또는 직후 순차.

- `app/chat/page.tsx`도 동일하게 내부 `useVoiceChat` 교체만으로 동작.
- `/api/voice/respond` 및 메시지 저장 로직 무변경.

## 4. Phase 4 — Failure / Race QA

Dev 환경에서 mock browser error / empty result / timeout / unsupported 강제 시나리오 실행 (지시서 §22, debug switch는 Production UI에 노출 금지).

## 5. Phase 5 — Device QA (iOS Safari/PWA, Android Chrome, Desktop Chrome)

지시서 §19~21 체크리스트 그대로.

## 6. Phase 6 — Development 배포

격리 워크트리 + `vercel --prod`로 **`k-bestie-v3-dev`에만** 배포. Production 프로젝트(`k-bestie-v3`) 배포는 이번 작업에서 어떤 경우에도 수행하지 않는다.

## 7. Phase 7 — 대표님 QA 대기

최종 상태 `WAITING_FOR_OWNER_QA` 보고. 지시서 §31 형식 그대로 결과 보고.

---

## 게이트 계획

- Phase 1(아키텍처 민감) 게이트①: claude-review(Opus, high) — Codex Sol 구현분이므로 하드룰 3에 따라 Codex로 리뷰하지 않는다.
- Phase 2/3 게이트①: 파일 규모·성격에 따라 Sol/claude-review 판단 (변경 범위가 각 화면의 얇은 wiring이면 Terra도 가능, Router 자체를 건드리면 Sol 유지).
- Phase 4 결과가 [복잡] 실패를 내면 §12-C 절차(2회 실패 시 Sol 승격, 그래도 실패면 Claude 직접 개입)를 그대로 적용.
- 전체 완료 후 게이트②는 agy가 아닌 **Dev 환경에서 Claude 또는 Codex의 Playwright 실행**으로 지시서 §22 강제 fallback 시나리오까지 커버(§12-G 패턴 참고, agy는 실제 마이크 권한/Browser SpeechRecognition을 headless에서 흉내내기 어려우므로 이번 건은 처음부터 §12-G 3단계 경로를 우선 고려).
