# 078 Mission 텍스트 전송 readiness race 보완 설계

## 0. 범위와 판정

- 판정: **복잡**. E2E의 media 환경 누락과 Mission 제품의 비동기 상태 race가 동시에 존재한다.
- 목적: Mission 시작 직후 텍스트 모드로 전환했을 때 연결 시작이 취소되고, 화면은 전송 가능처럼 보이지만 `voice.canSendTypedText()`가 false라 턴 POST가 발생하지 않는 상태를 제거한다.
- 이 보완은 078 PWA update gate의 실제 DEV Mission hazard E2E를 가능하게 하는 최소 선행 수정이다. PWA update 상태 머신, Mission 서버/API/DB 계약, 음성 훅 내부 상태 머신은 변경하지 않는다.
- 허용 파일은 아래 5개뿐이다.
  1. `playwright.config.ts`
  2. `app/child/missions/page.tsx`
  3. `components/MissionConversationLayout.tsx`
  4. `components/MissionConversationLayout.test.tsx`
  5. `e2e/qa-078-pwa-safe-update.spec.ts`

## 1. 원인과 Source of Truth

### 1.1 제품 race

- `app/child/missions/page.tsx`의 자동 session 시작 effect는 `mode === "voice"`일 때만 `voice.startSession()`을 호출한다.
- `MissionConversationLayout`의 「텍스트로 답하기」 버튼은 `entryStatus === "active"`만 확인하므로 session이 `live`가 되기 전에 누를 수 있다.
- 빠른 클릭으로 `mode`가 `text`가 되면 자동 시작 effect 조건이 영구 불충족되고, session/첫 K 질문/`child_listening` 전이가 시작되지 않는다.
- 현재 text input과 send 버튼은 실제 voice/turn readiness를 보지 않는다. `대기 중`도 default idle 문구라 정확한 readiness 신호가 아니다.
- 실제 전송 수락 Source of Truth는 기존 `voice.canSendTypedText()`이다. 이 함수는 session live, Live 내부 발화/VAD/finalizing 상태, 페이지의 Mission turn gate를 함께 확인한다. 이 계약은 복제하거나 완화하지 않는다.

### 1.2 E2E 환경 결함

- 일반 Chromium 프로젝트에는 fake media UI/device launch argument가 있으나 `pwa-update-chromium`에는 없다.
- 078은 headless 실제 browser에서 Mission voice session을 열어야 하므로, fake microphone이 없으면 `getUserMedia` 실패가 제품 실패처럼 보일 수 있다.
- E2E는 오류 overlay의 「미션 이어하기」를 polling 중 자동 클릭해서는 안 된다. 해당 overlay는 readiness가 아니라 연결 실패 증거다.

## 2. 공개 DOM 및 network 계약

### 2.1 텍스트 진입 계약

- `voice.status !== "live"` 동안 「텍스트로 답하기」 버튼은 disabled다.
- session이 live가 되면 버튼이 enabled되고 텍스트 모드 진입을 허용한다.
- 기존 자동 session 시작 effect의 `mode === "voice"` 조건과 음성 훅은 변경하지 않는다. UI가 연결 전에 mode를 바꾸지 못하게 해 race를 닫는다.

### 2.2 전송 readiness 계약

- 페이지는 `mode === "text" && voice.canSendTypedText()` 결과를 `canSendText`로 Layout에 전달한다.
- Layout의 composer는 아래 public contract를 가진다.
  - `data-ui="mission-text-composer"`
  - `data-send-ready="true" | "false"`
- 전송 버튼은 `canSendText === true`, non-empty input, active entry, non-closing을 모두 만족할 때만 enabled다.
- `handleSendText`의 기존 실행 직전 `voice.canSendTypedText()` 재검사는 유지한다. DOM readiness와 실제 클릭 사이 race를 마지막으로 차단한다.
- 사전 network 신호(`/api/voice/token`, WebSocket open)만으로는 Mission turn readiness를 판정하지 않는다. 공개 DOM `data-send-ready=true`가 사전 신호이고, 실제 `POST /api/mission/v3/turn` 2xx가 사후 증거다.

## 3. 파일별 변경 계약

### 3.1 `playwright.config.ts`

- `pwa-update-chromium`에 일반 Chromium과 동일한 아래 launch argument를 추가한다.
  - `--use-fake-ui-for-media-stream`
  - `--use-fake-device-for-media-stream`
- service worker 허용, screenshot/trace/video 설정은 유지한다.
- Production URL·credential·제품 fault hook은 추가하지 않는다.

### 3.2 `app/child/missions/page.tsx`

- 현재 렌더의 `voice.status`로 `canEnterTextMode`를 계산한다. `entryStatus`/closing 조건은 Layout의 기존 조건과 결합한다.
- 현재 렌더에서 `mode === "text" && voice.canSendTypedText()`를 계산해 `canSendText`로 전달한다.
- `switchToText`는 방어적으로 session live가 아니면 return한다. UI disabled만 신뢰하지 않는다.
- 자동 session 시작 effect, `useGeminiLive`, `useVoiceChat`, turn phase 전이, Mission API 호출은 변경하지 않는다.
- `handleSendText`의 입력 보존과 실행 직전 재검사를 유지한다.

### 3.3 `components/MissionConversationLayout.tsx`

- props에 `canEnterTextMode: boolean`, `canSendText: boolean`을 추가한다.
- 음성 화면의 「텍스트로 답하기」 버튼은 기존 조건에 `!canEnterTextMode`를 추가해 disable한다.
- text composer wrapper에 stable public DOM attributes를 추가한다.
- 전송 버튼 disabled 조건에 `!canSendText`를 추가한다.
- input은 기존처럼 입력을 보존할 수 있게 하되, 실제 send 가능 여부를 표시하는 계약은 composer attribute와 send button disabled로 통일한다.
- `대기 중` 문구는 readiness assertion에 사용하지 않으며, 이번 보완에서 voice 상태 copy를 재설계하지 않는다.

### 3.4 `components/MissionConversationLayout.test.tsx`

- 모든 기본 render fixture에 새 props를 명시한다.
- 다음 계약을 테스트한다.
  1. `canEnterTextMode=false`이면 텍스트 진입 버튼 disabled.
  2. `canEnterTextMode=true`이면 기존 active 조건에서 enabled.
  3. `canSendText=false`이면 non-empty input이어도 send disabled, `data-send-ready=false`.
  4. `canSendText=true`이고 non-empty이면 send enabled, `data-send-ready=true`.
  5. empty input/closing/non-active는 readiness true여도 기존 차단을 유지.

### 3.5 `e2e/qa-078-pwa-safe-update.spec.ts`

- `waitForMissionSendReady`에서 `대기 중` 문자열 판정과 「미션 이어하기」 자동 클릭을 제거한다.
- 진입 순서를 다음으로 고정한다.
  1. Mission 시작/이어하기 클릭.
  2. 「텍스트로 답하기」가 visible 및 enabled가 될 때까지 대기.
  3. 텍스트 모드 진입.
  4. composer `data-send-ready=true` 대기.
  5. input fill 후 send button enabled 대기.
  6. 실제 send click과 `/api/mission/v3/turn` POST 및 2xx 확인.
- `미션 이어하기` 오류 overlay가 나타나면 재시도하지 않고 연결 실패로 즉시 FAIL한다.
- placeholder `케이가 질문을 준비하고 있어요...`가 새 Mission에서 영구 유지되지 않고 실제 K 질문으로 바뀌는 것을 확인한다.
- 기존 PWA update hazard/defer/controller reconciliation assertions는 유지한다.

## 4. 10분 이내 순차 작업 단위

### U1 — E2E media 실행 환경 정상화 (5분, 선행)

- 대상: `playwright.config.ts`
- 작업: `pwa-update-chromium`에 fake media UI/device arguments를 추가한다.
- 완료 조건: 일반 Chromium과 PWA Chromium이 동일 fake media launch contract를 가지며 기존 SW 설정은 유지된다.
- 검증: config 정적 확인 및 Playwright test collection 성공. 실제 E2E 실행은 게이트 단계에서만 수행한다.

### U2 — Mission readiness Source of Truth 연결 (10분, U1 후)

- 대상: `app/child/missions/page.tsx`, `components/MissionConversationLayout.tsx`
- 작업: 연결 전 텍스트 진입 차단, `voice.canSendTypedText()` 기반 public composer readiness, send disabled를 연결한다.
- 완료 조건: session live 전 mode가 text로 바뀌지 않고, 실제 guard가 false인 동안 send가 enabled로 보이지 않는다.
- 검증: TypeScript 오류 0, 기존 실행 직전 guard 보존, voice/session/API 코드 변경 0.

### U3 — 컴포넌트 회귀 계약 (8분, U2 후)

- 대상: `components/MissionConversationLayout.test.tsx`
- 작업: 진입·composer readiness·기존 empty/closing/entry 상태 차단 테스트를 추가한다.
- 완료 조건: readiness false/true의 native disabled 및 `data-send-ready`가 모두 검증된다.
- 검증: 해당 component test 통과.

### U4 — 실제 DEV E2E wait 교정 (10분, U3 후)

- 대상: `e2e/qa-078-pwa-safe-update.spec.ts`
- 작업: 거짓 `대기 중` wait와 오류 overlay 자동 재시도를 제거하고 공개 readiness + 실제 turn POST 2xx로 전환한다.
- 완료 조건: readiness 미충족은 timeout/FAIL이며, 오류 overlay가 PASS를 위한 자동 복구 수단으로 사용되지 않는다.
- 검증: Playwright collection 성공, 금지 패턴 `page.route`/synthetic product hook 0.

### U5 — 독립 게이트 (U4 후, 구현 세션 외부)

- 대상: 위 5개 파일 전체 diff.
- 정적 검증: 별도 Codex 리뷰가 session lifecycle 변경/guard 완화/범위 이탈 0을 확인한다.
- 동적 검증: fresh agy가 deployed DEV와 전용 QA child만 사용해 실제 Chromium E2E를 수행한다.
- 완료 조건: 아래 §5 전체 통과. 구현 세션의 자체 실행만으로 완료 판정하지 않는다.

## 5. 최종 QA 기준

1. Mission 시작 직후 session live 전 텍스트 버튼 disabled.
2. fake microphone 환경에서 `/api/voice/token` 성공 후 Live 연결 및 텍스트 버튼 enabled.
3. 새 Mission의 placeholder가 실제 K 질문으로 변경.
4. K 질문 종료 전 composer `data-send-ready=false`; 아이 답변 차례에는 true.
5. 입력 후 send 버튼 enabled, 실제 `POST /api/mission/v3/turn` 발생, 응답 2xx.
6. 턴 처리 중 readiness false, 다음 K 질문 종료 후 다시 true.
7. 같은 QA child로 Mission hazard 시나리오를 2회 수행해 no-op click, 영구 placeholder, resume overlay 각각 0건.
8. PWA update 중 active Mission NACK/defer, 동일 session 지속, 안전 route 복귀 후 reconciliation 성공.
9. Production·고객 계정·Production DB/env 변경 0건.

## 6. 위험요소와 금지사항

- `mode === "voice"` 자동 시작 조건을 단순 삭제하지 않는다. STT/TTS text mode에서 mic stream을 다시 획득하는 회귀가 생길 수 있다.
- `voice.canSendTypedText()` 조건을 UI용 별도 규칙으로 재구현하지 않는다. 기존 guard 호출 결과를 그대로 사용한다.
- 오류 overlay를 E2E가 반복 클릭해 성공을 만드는 방식은 금지한다.
- `/api/voice/token` 또는 status text만으로 readiness를 간주하지 않는다.
- 078 범위 밖 음성 훅 구조 변경, Mission API/DB 수정, Production 배포는 이 보완 단위에 포함하지 않는다.
