`075-fix-mission-keyboard-close-response-tts.md`

# REQUEST #075 — Mission Keyboard Mode 채팅창 닫기 표시 및 K 응답 Bubble/TTS 수정

- 상태: TODO
- 유형: 버그 수정 / UX 개선
- 우선순위: HIGH
- 대상: Mission Keyboard Mode
- 환경: DEV 전용 구현·검증
- 핵심 방향: 기존 Mission session과 해결된 keyboard-first 동작을 유지하면서 `채팅창 닫기` 표시 정책과 Text → K Response 흐름만 수정

---

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

Mission에서 아이가 keyboard로 대화할 때 다음처럼 동작해야 한다.

```text
Mission
→ keyboard open
→ keyboard가 보이는 동안 `채팅창 닫기` 숨김
→ 아이 text 전송
→ 생각 중
→ K 응답 말풍선 표시
→ K 음성 출력
→ 대기 중
→ 계속 text 대화
→ keyboard dismiss
→ `채팅창 닫기` 표시
→ 버튼 클릭
→ 동일 Mission session으로 음성 화면 복귀
```

전체 과정에서:

- `session_id` 유지
- Conversation Context 유지
- Goal Progress 유지
- Memory 유지
- duplicate turn 없음
- session reconnect 없음
- `이어하기` modal 없음
- disconnect popup 없음

기존에 해결된 **Mission 진입 직후 음성 대화 없이 바로 keyboard text 입력 가능한 기능**도 그대로 유지되어야 한다.

### 대표님 테스트 정상 프로세스

#### A. 채팅창 닫기 버튼

1. Dev 아이 계정으로 Mission에 진입한다.
2. 음성 대화를 하지 않고 바로 keyboard를 연다.
3. iPhone software keyboard가 올라온 상태를 확인한다.
4. 화면 중앙의 `✕ 채팅창 닫기` 버튼이 보이지 않는지 확인한다.
5. keyboard만 내린다.
6. Text Chat Mode는 유지되고 `✕ 채팅창 닫기` 버튼이 나타나는지 확인한다.
7. text input을 다시 눌러 keyboard를 연다.
8. `✕ 채팅창 닫기` 버튼이 다시 사라지는지 확인한다.

#### B. Text → K 응답

1. keyboard가 열린 상태에서 아이가 text를 입력한다.
2. 전송한다.
3. 상태가 `생각 중...`으로 바뀌는지 확인한다.
4. K 응답 말풍선이 화면에 표시되는지 확인한다.
5. 같은 응답을 K 음성으로 들을 수 있는지 확인한다.
6. 음성이 끝난 뒤 `대기 중`으로 돌아오는지 확인한다.
7. 같은 방식으로 text 대화를 3턴 이상 연속 진행한다.

#### C. Text ↔ Voice 전환

1. Text 대화를 진행한다.
2. keyboard를 내린다.
3. `채팅창 닫기`를 누른다.
4. Mission 음성 화면으로 돌아간다.
5. 기존 대화 내용과 Mission 진행 상태가 유지되는지 확인한다.
6. 다시 keyboard를 열어 text를 보낸다.
7. 동일 Mission에서 정상적으로 이어지는지 확인한다.

정상이라면:

- keyboard visible → close button 숨김
- keyboard dismissed → close button 표시
- 첫 text부터 K bubble + 음성 정상
- `대기 중 → 생각 중 → 말하는 중 → 대기 중` 정상
- text 3턴 이상 연속 정상
- text ↔ voice 정상
- 동일 Mission session 유지
- 기존 keyboard-first 수정 회귀 없음

---

## 1. 목표

Mission Keyboard Mode의 두 가지 DEV 이슈를 수정한다.

### Issue A

iPhone software keyboard가 화면에 올라와 있는 동안 중앙의 큰:

`✕ 채팅창 닫기`

버튼이 표시되어 입력 UI를 가리는 문제를 수정한다.

정책:

```text
Keyboard visible
→ 채팅창 닫기 hidden

Keyboard dismissed + Text Chat Mode 유지
→ 채팅창 닫기 visible

Input refocus
→ keyboard visible
→ 채팅창 닫기 hidden
```

이 버튼은 **software keyboard를 닫는 버튼이 아니라 Text Chat Mode 자체를 종료하고 Mission 음성 화면으로 복귀하는 버튼**이어야 한다.

### Issue B

Mission Keyboard Mode에서 아이가 text를 전송한 뒤:

- K 응답 말풍선이 나타나지 않음
- K 음성이 출력되지 않음

문제를 수정한다.

정상 흐름:

```text
Child text submit
→ child turn 처리
→ K response 생성
→ K bubble 표시
→ K audio 재생
→ WAITING 복귀
```

원인을 TTS로 미리 단정하지 않고 실제 중단 지점을 확인한 뒤 수정한다.

---

## 2. 요구사항

### 착수 조건

현재 진행 중인 우선순위 작업과 동일 Mission keyboard 관련 파일을 병렬 수정하지 않는다.

착수 전에:

- 최신 안정 branch/commit 상태 확인
- 현재 P0 / 073 관련 변경의 merge/commit 상태 확인
- 동일 파일 충돌 여부 확인

후 안정된 최신 기준에서 작업한다.

이번 Request는 **DEV에서만 구현·검증**한다.

별도 승인 전:

- Production deploy 금지
- Production DB 변경 금지
- Production config 변경 금지
- Production 사용자 대상 QA 금지

### Keyboard Visibility

가능하면 프로젝트에 이미 존재하는 keyboard visibility hook/util을 재사용한다.

없다면 iOS Safari/PWA 동작을 고려해 실제 viewport/focus 상태를 기반으로 하나의 명확한 Source of Truth를 사용한다.

목표 상태:

`isKeyboardVisible`

최소 다음 상황에서 일관되어야 한다.

- keyboard open
- keyboard dismiss
- input focus/refocus
- 한글/영문/숫자/특수문자 keyboard 전환
- viewport 변화

고정 timeout만으로 keyboard 상태를 추측하지 않는다.

### K Response Processing

Text submit 이후 다음 chain의 **최초 실패 지점**을 확인한다.

```text
Child text submit
→ child turn accepted
→ child turn persisted
→ K response generation
→ K response persisted
→ client receives response
→ bubble state update
→ TTS/audio queue
→ playback start
→ playback end
→ WAITING
```

우선 분기:

```text
K response DB row 없음
→ turn processing / generation 영역 확인

K response DB row 있음
→ client receive / render / TTS 영역 확인
```

원인을 확인한 뒤 필요한 영역만 수정한다.

### K Bubble

Keyboard visible 여부와 관계없이 K response bubble은 표시되어야 한다.

현재 Mission에서:

- text mode에서 bubble render를 막는 조건
- voice 전용 state 의존
- layout/overflow 문제
- latest K turn state 동기화 문제

등 실제 원인을 확인한다.

### K Audio / TTS

정책:

```text
Text Input Mode ≠ Silent K Mode
```

아이의 입력 방식이 text여도 K는:

- 응답 말풍선을 보여주고
- 음성으로 답해야 한다.

Keyboard Mode에서 child mic input을 pause할 수는 있지만 K output audio까지 막아서는 안 된다.

```text
Child audio input pause 가능
K audio output 유지
Mission session 유지
```

### 상태 UI

기존 K 상태 UI는 유지한다.

최소 상태:

```text
대기 중
생각 중...
말하는 중
연결 중...
```

정상 lifecycle:

```text
WAITING
→ THINKING
→ SPEAKING
→ WAITING
```

상태는 실제 처리/재생 상태를 따라야 하며 fake timer로 전환하지 않는다.

### Free Chat 재사용

Free Chat의:

`text submit → K response → bubble → TTS`

흐름이 안정적으로 동작한다면 Mission과 비교하고 재사용 가능한 공통 로직을 우선 활용한다.

Mission 전용 duplicate implementation을 불필요하게 추가하지 않는다.

---

## 3. 기존 구조 확인

Issue A/B 해결에 직접 필요한 범위만 확인한다.

### Issue A

- Mission Keyboard/Text Mode UI
- `채팅창 닫기` 현재 render 조건
- text mode state
- input focus/blur
- 기존 keyboard visibility hook/util
- `visualViewport` 또는 현재 viewport 처리 방식
- iOS/PWA keyboard 대응 코드

### Issue B

- Mission text submit handler
- child turn persistence
- K response generation trigger
- K turn persistence
- client response 전달
- bubble rendering/state
- TTS/audio queue 및 playback
- mic input pause와 output audio 관계
- Mission state lifecycle
- Free Chat의 정상 text response path

기존 해결된 keyboard-first/manual mode 로직은 구조를 확인할 수는 있지만 이번 Request에서 다시 설계하지 않는다.

코드에서 확인 가능한 내용을 추측하지 않는다.

Issue A/B와 직접 관계없는 Mission 전체 또는 Conversation Engine 전체로 조사 범위를 확대하지 않는다.

---

## 4. 금지

- 기존 keyboard-first fix 재설계
- Mission 진입 직후 text 입력 기능 회귀
- manual/auto mic 정책 재설계
- Mission session 종료를 통한 우회 해결
- text submit 후 새 Mission session 생성
- keyboard open/close 시 reconnect
- `이어하기` modal 발생
- disconnect popup 발생
- Goal Progress 초기화
- Memory/Conversation Context 초기화
- duplicate child/K turn 생성
- K output audio를 Text Mode에서 의도적으로 mute
- fake timer 기반 상태 전환
- 고정 timeout만으로 keyboard visibility 추정
- Free Chat 정상 로직의 불필요한 복제
- 관련 없는 Mission/UI 리팩터링
- Production deploy/config/DB 변경
- Production 사용자 대상 QA

다음 기존 동작을 보호한다.

- Mission 최초 진입 즉시 keyboard 사용 가능
- 음성 0턴 상태에서도 첫 text 전송 가능
- manual mode에서 자동 mic 오작동 없음
- 실제 recording 중 keyboard 제한 정상
- recording 종료 후 keyboard 정상
- K 상태 표시
- Free Chat 정상
- 기존 Mission session continuity
- 현재 DEV/Production 시간 정책

---

## 5. 모호성 처리

Request와 현재 코드로 원인이 확인되면 해당 최초 실패 지점만 수정한다.

다음 경우 관련 코드와 필요한 Skill/Reference만 추가 확인한다.

- keyboard visibility를 판단하는 기존 Source of Truth가 여러 개 존재
- K response DB row는 생성되지만 client 전달 경로가 여러 개 존재
- Mission과 Free Chat이 서로 다른 TTS pipeline을 사용
- mic pause와 output audio control이 같은 state에 묶여 있음
- Mission bubble이 voice 전용 state와 강하게 결합되어 있음

다음과 같은 경우에는 임의로 우회 구현하지 않는다.

- session 구조 변경이 필요함
- Mission/Free Chat 공통 Conversation Engine 변경이 필요함
- 기존 P0 keyboard 정책과 충돌함
- 073에서 변경 중인 공통 영역과 직접 충돌함
- 수정 방식에 따라 Production Mission 동작이 달라짐

이 경우 해당 지점에서 중단하고 다음만 보고한다.

1. 실제 최초 실패 지점
2. 현재 구조에서 가능한 수정 방법
3. 각 방법의 Mission/Free Chat/session 영향
4. 기존 구조 기준 권장 방향

---

## 6. QA

`qa-scope` Skill을 적용하여 실제 최종 diff에 필요한 최소 충분 QA만 수행한다.

이번 Request의 필수 Gate:

### Keyboard

- keyboard visible → `채팅창 닫기` hidden
- keyboard dismissed → `채팅창 닫기` visible
- keyboard refocus → hidden
- keyboard 종류 전환 중 hidden 유지

### Text Response

- 음성 0턴 상태의 첫 text submit 정상
- child turn 저장 정상
- K response 생성 정상
- K bubble 표시 정상
- K audio 출력 정상
- `THINKING → SPEAKING → WAITING` 정상
- text 최소 3턴 연속 정상

### Mode / Session

- Text → Voice 정상
- Voice → Text 정상
- keyboard open/close 반복 시 정상
- 동일 `session_id` 유지
- Conversation Context 유지
- Goal Progress 유지
- Memory 유지
- duplicate child/K turn 0
- reconnect 0
- resume modal 0
- disconnect popup 0

기존 Free Chat 또는 keyboard-first 구현을 직접 변경한 경우에만 해당 영향 범위를 추가 검증한다.

---

## 7. 완료 조건

다음이 모두 충족되면 완료한다.

- keyboard visible 동안 `채팅창 닫기`가 보이지 않음
- keyboard dismiss 후 Text Chat Mode에 `채팅창 닫기` 표시
- keyboard reopen 시 다시 숨김
- Mission 진입 직후 첫 text 입력 정상
- text submit 후 K response 정상 생성
- K response bubble 정상 표시
- K 음성 정상 출력
- 실제 상태와 K 상태 UI 일치
- text 대화 연속 진행 가능
- text ↔ voice 전환 정상
- 동일 Mission session 유지
- Conversation Context / Goal Progress / Memory 유지
- duplicate/reconnect/disconnect 없음
- 기존 keyboard-first 수정 회귀 없음
- Free Chat에 직접 영향이 있는 변경이 있다면 정상 동작 확인
- Production에는 배포되지 않음

DEV Gate 완료 후 결과만 보고한다.

Production 반영 여부는 별도 승인 대상으로 유지한다.

---

## 8. 완료 보고

아래만 간단히 보고한다.

1. Issue A root cause
2. keyboard visibility Source of Truth
3. 수정된 close button 표시 조건
4. Issue B 최초 failure 지점
5. K bubble 미표시 root cause
6. K audio 미출력 root cause
7. 두 현상의 동일/별개 원인 여부
8. Mission과 Free Chat 차이 및 재사용 내용
9. 주요 수정 파일
10. QA Level 및 필수 Gate 결과
11. session continuity 결과
12. 기존 keyboard-first 회귀 결과
13. Production 미배포 확인
14. Commit SHA
15. 남은 위험이 있는 경우만 해당 내용

최종 판정:

`PASS` 또는 `BLOCKED`