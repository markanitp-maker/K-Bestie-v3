# 076 미션 키보드 모드 실제 컴포넌트 재조사

- 조사일: 2026-08-12
- 기준: main HEAD `22ebd1a7f6a09ac28b86e3c0f3e18e14a10e17ca`
- 원 구현 커밋: `60d06df02bb45bd9349813d5e81a940a4d2029f7`
- 검증 대상: 실제 `app/child/missions/page.tsx`와 실제 `components/MissionConversationLayout.tsx`
- 실행 환경: Vitest 3.2.7 + jsdom 28.1.0 + Testing Library React 16.3.2
- Chromium/Playwright: 실행하지 않음

## 결론

076의 네 주장 중 세션 연속성, 공통 턴 수락 조건, presentation overlay의 비종료 동작은 실제 마운트에서 통과했다. 그러나 텍스트 overlay의 K 상태 뱃지는 실제 DOM에 전혀 렌더되지 않아 실패했다.

원인은 `MissionConversationLayout`이 상태 텍스트와 아이콘을 계산하고도 `isTextMode === false`인 마스코트 분기 안에서만 렌더한 것이다. `isTextMode === true` 분기는 닫기 CTA만 렌더하므로 부모의 최신 `voiceState`가 바뀌어도 overlay DOM에는 구독 결과를 표시할 노드가 없었다.

텍스트 분기에 같은 `stateText`와 `StateIcon`을 사용하는 상태 뱃지를 추가한 뒤 동일 테스트 4개가 모두 통과했다.

## 테스트 방법

`app/child/missions/page.076.test.tsx`가 기본 export인 실제 `ChildMissionsPage`를 jsdom에 렌더한다. `/api/mission/start`는 고정 `sessionId`인 `session-076-stable`을 반환한다. 실제 네트워크와 WebSocket을 여는 `useGeminiLive`와 `useVoiceChat`만 mock하고 다음을 스파이로 추적한다.

- Live 훅 인스턴스 수
- `startSession` 호출 수와 연결 identity
- `getSessionId()`가 반환한 세션 identity
- `sendActivityEnd`와 `stopSession` 호출 수
- 실제 페이지가 훅에 전달한 `canAcceptTypedInput()` 결과
- 실제 layout DOM의 상태 텍스트

## 수정 전 결과

```text
Test Files  1 failed (1)
Tests       1 failed | 3 passed (4)

Unable to find an element with the text: 말하는 중.
```

통과한 스파이 로그:

```text
[076][open] {"startSessionCalls":1,"hookInstances":1,"connectionIds":["connection-1"],"sessionIds":["session-076-stable"],"activityEndCalls":0,"stopSessionCalls":0,"micCallsAdded":1}
[076][turn-gate] {"childListening":true,"waitingK":false}
[076][close] {"startSessionCalls":1,"hookInstances":1,"connectionIds":["connection-1"],"sessionIds":["session-076-stable"],"activityEndCalls":0,"stopSessionCalls":0}
```

## 주장별 판정

1. 키보드 overlay 전환 중 기존 session/WebSocket/Live 세션 유지: **통과**
   - 열기 전후 `startSessionCalls=1`, `hookInstances=1`, 연결 identity `connection-1`, session identity `session-076-stable`로 고정됐다.
2. overlay 안 K 상태 실시간 표시: **수정 전 실패 → 수정 후 통과**
   - 수정 전 overlay DOM에 상태 노드가 없었다.
   - 수정 후 실제 DOM이 `말하는 중 → 대기 중 → 생각 중 → 연결 중`으로 리렌더됐다.
3. `canAcceptTypedInput()`의 공통 턴 수락 조건: **통과**
   - `child_listening=true`, `waiting_k=false`였고, 유효 상태에서 실제 overlay 전송이 `sendTypedText("텍스트 답변")`까지 도달했다.
4. `switchToText()`의 순수 presentation overlay 동작: **통과**
   - 열기와 닫기 모두 `sendActivityEnd=0`, `stopSession=0`이었다. 마이크 gate만 한 번 닫혔고 새 연결은 생기지 않았다.

## 수정 후 결과

```text
[076][open] {"startSessionCalls":1,"hookInstances":1,"connectionIds":["connection-1"],"sessionIds":["session-076-stable"],"activityEndCalls":0,"stopSessionCalls":0,"micCallsAdded":1}
[076][badge] rendered=말하는 중→대기 중→생각 중→연결 중
[076][turn-gate] {"childListening":true,"waitingK":false}
[076][close] {"startSessionCalls":1,"hookInstances":1,"connectionIds":["connection-1"],"sessionIds":["session-076-stable"],"activityEndCalls":0,"stopSessionCalls":0}

Test Files  1 passed (1)
Tests       4 passed (4)
```

## 전체 검증

```text
npx tsc --noEmit
# exit 0, 오류 0건

node --import tsx --test <package.json의 전체 test 파일 목록>
# tests 54, pass 54, fail 0

npm run test:mission-076
# Test Files 1 passed, Tests 4 passed

npm run build
# exit 0
# Compiled successfully in 57s
# Generating static pages (238/238)
# SUCCESS: 클라이언트 번들에 서버 전용 비밀키가 노출되지 않았습니다.
```

기존 `npm test` 명령은 assertion 실행 전에 `tsx` CLI가 `/tmp/tsx-1000/14.pipe` IPC 소켓을 열지 못해 `EPERM`으로 종료됐다. 동일한 package.json 테스트 파일 목록을 IPC 서버가 필요 없는 `node --import tsx --test`로 실행해 54/54 통과를 확인했다.

## 변경 파일

- `components/MissionConversationLayout.tsx`: 텍스트 overlay 상태 뱃지 추가
- `app/child/missions/page.076.test.tsx`: 실제 페이지 마운트 회귀 테스트 4개
- `vitest.config.ts`, `vitest.setup.ts`: jsdom 테스트 환경
- `package.json`, `package-lock.json`: 테스트 명령과 devDependency

커밋은 생성하지 않았다.
