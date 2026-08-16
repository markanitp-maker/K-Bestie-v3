# 074 — Mission Keyboard Mode Live Status & Session Continuity Request

## 0. 목적

Mission 진행 중 좌측 키보드 버튼을 눌러 텍스트 입력 모드로 전환했을 때, 아이가 현재 K의 상태를 알 수 있도록 실시간 상태 표시 UI를 추가한다.

현재 문제:
- 키보드 모드에서는 K가 `대기 중 / 생각 중 / 말하는 중 / 연결 중`인지 알 수 없다.
- 아이가 텍스트를 전송한 뒤 응답이 늦으면 입력이 전달됐는지 판단하기 어렵다.
- 키보드 UI open/close 과정에서 Mission Live 세션이 끊기거나 `이어하기` 상태가 발생할 수 있으므로, 상태 UI 구현과 함께 같은 Mission 세션 유지도 회귀 검증한다.

이 작업은 단순 로딩 문구 추가가 아니다.

실제 Gemini Live / WebSocket / response generation / audio playback 상태를 UI에 연결하여 K의 현재 상태를 정확히 보여주는 작업이다.

---

## 1. 최종 UX 요구사항

Mission 음성 화면에서 키보드 버튼 클릭:

```text
Mission Live Session 진행 중
→ 키보드 UI open
→ 기존 session_id 유지
→ 기존 WebSocket / Live Session 유지
→ 텍스트 입력 가능
→ K 실시간 상태 표시
→ 텍스트 전송
→ 생각 중
→ 말하는 중
→ 대기 중
→ 키보드 UI close
→ 동일 Mission 세션에서 음성 대화 계속
```

키보드 화면 진입 자체가 다음을 발생시키면 안 된다.
- session end
- force_end
- reconnect
- resume
- new session
- `이어하기`
- `케이랑 접속이 끊겼네?`
- Conversation Context reset
- Goal Progress reset

---

## 2. K 상태 UI

키보드 모드에서 항상 확인 가능한 작은 상태 영역을 표시한다.

권장 위치:
- K 말풍선 아래 또는
- 텍스트 입력창 위

기존 레이아웃을 크게 밀어내지 않는 1줄 형태를 우선한다.

예:

```text
케이 · 대기 중
케이 · 생각 중...
케이 · 말하는 중
케이 · 연결 중...
```

아이용 UI이므로 기술 용어 사용 금지.

---

## 3. 상태 정의

### IDLE / WAITING
- 연결 정상
- K 응답 없음
- 아이 입력을 기다리는 상태
- 화면: `케이 · 대기 중`

### LISTENING
- 음성 모드에서 실제 마이크/VAD로 아이 발화를 듣는 중
- 키보드 모드에서 mic를 의도적으로 pause한다면 표시하지 않아도 됨
- 화면: `케이 · 듣는 중`

### THINKING
- 아이 텍스트 또는 음성 turn이 정상 제출됨
- K 응답 생성이 아직 시작되지 않음
- server/model response 대기 중
- 화면: `케이가 생각 중...`
- 텍스트 전송이 정상 접수된 직후 THINKING으로 전환

### SPEAKING
- K 응답 audio/text output이 실제 시작됨
- TTS/audio playback 또는 Gemini Live audio output 진행 중
- 화면: `케이가 말하는 중`
- 실제 output 종료 후 WAITING으로 복귀

### CONNECTING
- 최초 연결 또는 정상적인 reconnect 진행 중
- 화면: `케이와 연결 중...`
- keyboard open 자체로 CONNECTING이 발생하면 안 됨

### ERROR / DISCONNECTED
- 실제 비정상 연결 종료일 때만 사용
- keyboard open/close, mic pause/resume 같은 의도된 UI 변화는 ERROR로 분류 금지

---

## 4. 실제 상태 기반 구현

가짜 timer 기반 상태 연출 금지.

상태는 실제 시스템 이벤트에 연결한다.

조사 대상:
- `useGeminiLive`
- WebSocket lifecycle
- Live session status
- response start/end
- audio playback start/end
- text response start/end
- mic/VAD state
- reconnect state
- error state
- Mission session state

기존 상태값을 재사용할 수 있으면 새 state machine을 중복 생성하지 않는다.

가능하면 공통 Live 상태를 single source of truth로 사용한다.

---

## 5. 키보드 모드 전환과 세션 유지

키보드 UI는 Mission Live Session과 독립된 presentation state여야 한다.

키보드 버튼 클릭 시:
- 기존 Mission component unmount 금지
- `useGeminiLive` owner unmount 금지
- WebSocket close 금지
- mission session 종료 금지
- 새로운 session 생성 금지
- route navigation으로 page lifecycle 종료 금지

필요하면:
- audio capture만 pause/mute
- WebSocket 유지
- session_id 유지
- Conversation Context 유지
- Goal Progress 유지
- Semantic Topic History 유지
- Memory Context 유지

텍스트 전송은 기존 Mission session에 귀속한다.

---

## 6. 키보드 UI 닫기

```text
현재 Text Mode
→ UI close
→ 동일 Mission session 유지
→ 필요 시 audio capture resume
→ 음성 Mission 계속
```

금지:
- resume API 새 호출
- 새 Mission session 생성
- `이어하기` modal
- retry modal
- conversation reset

---

## 7. 텍스트 전송 UX

아이 텍스트 전송:
1. 입력 유효성 검증
2. 전송 성공 처리
3. 입력창 clear
4. 상태 즉시 THINKING
5. 실제 K output 시작 시 SPEAKING
6. output 종료 후 WAITING

중복 전송 방지:
- 전송 버튼 연타
- Enter 중복
- 네트워크 retry

때문에 동일 turn이 중복 저장되지 않도록 기존 idempotency 구조 확인.

---

## 8. 음성/텍스트 동시성

키보드 모드에서 mic 정책을 실제 현재 설계 기준으로 확인한다.

권장:
- Text Mode 동안 mic pause
- background noise로 VAD 오인 방지
- 단 WebSocket / Live Session은 유지

현재 아키텍처가 mic 계속 활성화를 의도한다면 text submit과 음성 input 충돌 여부를 검증한다.

어느 정책이든 Mission session 자체는 종료하지 않는다.

---

## 9. UI 요구사항

상태 영역은:
- 작은 화면에서도 입력창을 가리지 않음
- iPhone software keyboard가 올라온 상태에서도 표시 가능
- safe area 고려
- K 말풍선과 입력창 사이 또는 입력창 바로 위
- 상태 변화 시 layout jump 최소화
- spinner/점 애니메이션 사용 시 실제 상태와 연결
- 색상만으로 상태를 구분하지 않음
- 과한 애니메이션 금지

권장 텍스트:
```text
대기 중
듣는 중
생각 중...
말하는 중
연결 중...
```

---

## 10. Error UX 분리

다음 정상 상태를 disconnect/error로 처리하지 않는다.
- keyboard open
- keyboard close
- mic pause
- mic resume
- text submit
- input focus
- mobile keyboard open/close
- page layout resize
- 정상 overlay 표시

`케이랑 접속이 끊겼네?` 또는 `이어하기`는 실제 session disconnect / invalid session / backend termination인 경우에만 표시한다.

---

## 11. Dev 환경 조건

DEV Mission은 테스트를 위해 24시간 동작해야 한다.

DEV:
```text
scheduleEnforced = false
→ 24h Mission start/resume 가능
```

Production:
```text
Mission v3
→ 13:00 ~ 23:00 KST
```

키보드 UI 문제와 Time Gate 문제를 섞지 말되 회귀 테스트에는 포함한다.

---

## 12. 구현 전 Read-only 추적

코드 수정 전에 아래 흐름을 추적한다.
1. keyboard button onClick
2. chat UI open state
3. conditional render
4. component key 변화
5. route/navigation 발생 여부
6. `useGeminiLive` mount/unmount
7. cleanup
8. WebSocket close handler
9. mission session teardown
10. `showRetryButton`
11. `이어하기` 상태 생성
12. Live response status
13. audio playback status
14. text submit lifecycle

정확한 원인을 먼저 확정한 뒤 최소 수정한다.

---

## 13. 성공 기준

### Session Continuity

```text
음성 Mission 2~3턴
→ 키보드 open
→ session_id 동일
→ text 2~3턴
→ keyboard close
→ 음성 2~3턴
```

결과:
- socket close = 0
- force_end = 0
- new session = 0
- resume modal = 0
- retry modal = 0
- duplicate session = 0

### Status

Text submit 후 실제 순서:

```text
WAITING
→ THINKING
→ SPEAKING
→ WAITING
```

네트워크 지연이 있어도 실제 상태와 UI가 일치해야 한다.

### Repeat Test

키보드 open/close 최소 5회 반복:
- 세션 동일
- 상태 정상
- memory/history 정상
- Goal progress 정상

### Error Regression

실제 WebSocket 강제 단절 테스트:
- ERROR 정상 표시
- 기존 retry/reconnect UX 정상

---

## 14. E2E 체크리스트

- [ ] Mission 음성 정상 시작
- [ ] keyboard open
- [ ] session_id 유지
- [ ] K status visible
- [ ] WAITING 표시
- [ ] text submit
- [ ] THINKING 표시
- [ ] K output start
- [ ] SPEAKING 표시
- [ ] output end
- [ ] WAITING 복귀
- [ ] keyboard close
- [ ] 같은 session 음성 재개
- [ ] keyboard open/close ×5
- [ ] Goal Progress 유지
- [ ] Conversation History 유지
- [ ] Memory Context 유지
- [ ] disconnect popup 0
- [ ] resume modal 0
- [ ] duplicate turn 0
- [ ] duplicate session 0
- [ ] 실제 network disconnect retry UX 정상
- [ ] iPhone software keyboard 대응
- [ ] TypeScript PASS
- [ ] unit PASS
- [ ] integration PASS
- [ ] production build PASS

---

## 15. 금지 사항

- keyboard open 시 Mission session 종료 금지
- keyboard close 시 새 Mission 생성 금지
- UI mode switch를 WebSocket disconnect로 처리 금지
- fake timer로 THINKING/SPEAKING 상태 생성 금지
- 상태를 별도 중복 state machine으로 만들어 실제 Live 상태와 불일치시키지 말 것
- Goal/Memory/History reset 금지
- 실제 network error UX 제거 금지
- DEV 24시간 Mission 정책 훼손 금지
- Production Mission Time Gate 훼손 금지
- 테스트 완화/삭제 금지
- 아이 대화 원문 debug logging 금지

---

## 16. 완료 보고

최종 보고서:
1. 실제 원인
2. 변경 파일
3. keyboard open/close lifecycle
4. Live/WebSocket owner
5. session_id 유지 증거
6. 상태 Source of Truth
7. WAITING/THINKING/SPEAKING/CONNECTING/ERROR mapping
8. text submit lifecycle
9. mic pause/resume 정책
10. Goal/History/Memory 연속성
11. 5회 반복 QA 결과
12. network disconnect regression
13. TypeScript/unit/integration/build 결과
14. Production 영향
15. 남은 위험

---

# 최종 완료 정의

> 아이가 Mission 도중 키보드를 열어 텍스트로 대화하더라도 기존 Mission Live 세션이 끊기지 않고, 현재 K가 대기 중인지, 생각 중인지, 말하는 중인지 실시간으로 명확히 알 수 있어야 한다. 텍스트와 음성을 오가더라도 같은 session_id, Conversation Context, Goal Progress, Memory가 유지되며, 키보드 UI 전환 때문에 `이어하기` 또는 disconnect 오류가 발생하지 않아야 한다.
