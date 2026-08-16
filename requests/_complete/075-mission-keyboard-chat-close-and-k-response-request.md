# 075 — Mission Keyboard Mode: Chat Close Visibility + K Response Bubble/TTS Fix Request

## 0. 작업 시작 조건

이 Request는 **현재 진행 중인 우선순위 작업이 모두 정리된 뒤 착수**한다.

현재 활성 작업과 병렬로 `app/child/missions/page.tsx` 또는 Mission keyboard 관련 파일을 동시에 수정하지 않는다.

착수 전:
- 현재 main / origin 상태 확인
- 현재 진행 중인 P0 / 073 관련 변경이 merge/commit 되었는지 확인
- 동일 파일 충돌 여부 확인
- 최신 안정 커밋 기준으로 새 작업 시작

Production에는 아직 이 keyboard 개선이 배포되지 않았으므로 **DEV에서만 구현·검증**하고, Production 반영은 별도 승인 전까지 금지한다.

---

# 1. 현재 DEV QA 상태

이미 해결된 사항:
- Mission 최초 진입 직후 keyboard text 입력이 막히던 문제는 해결됨
- 이제 음성 대화를 먼저 하지 않아도 keyboard를 열고 첫 text 입력 가능
- K 상태 표시 UI도 노출됨
  - `대기 중`
  - `생각 중`
  - 기타 실제 상태

이 해결사항은 **회귀시키지 않는다.**

새로 발견된 이슈는 두 가지다.

### Issue A — 불필요한 `채팅창 닫기` 대형 버튼

iPhone software keyboard가 화면에 올라와 있는 동안에도 중앙에 큰:

```text
✕ 채팅창 닫기
```

버튼이 표시된다.

이 버튼은 keyboard가 떠 있는 동안에는 불필요하며 입력 UI를 크게 가린다.

원래 의도:

```text
Keyboard visible
→ 채팅창 닫기 버튼 숨김

Keyboard dismissed
→ 채팅창 닫기 버튼 표시

Input focus → keyboard 다시 visible
→ 채팅창 닫기 버튼 다시 숨김
```

### Issue B — Text 전송 후 K 응답 말풍선 / 음성 미출력

Mission keyboard mode에서 아이가 text를 전송하면:

```text
대기 중
→ 생각 중
```

상태 변화는 보이지만 이후:
- K 응답 말풍선이 나타나지 않음
- K 음성이 들리지 않음

즉 text submit 자체는 동작하는 것으로 보이지만 K response presentation이 완성되지 않는다.

이 현상의 root cause는 아직 확정하지 않는다.

---

# 2. 작업 목표

최종 목표:

```text
Mission
→ keyboard open
→ keyboard visible 동안 close button 숨김
→ child text submit
→ K 생각 중
→ K response bubble 표시
→ K 음성 출력
→ K 응답 완료
→ 대기 중
→ 계속 text 대화 가능
→ keyboard dismiss
→ 채팅창 닫기 버튼 표시
→ 닫기
→ 동일 Mission session으로 음성 화면 복귀
```

전체 과정에서:
- 동일 session_id 유지
- Conversation Context 유지
- Goal Progress 유지
- Memory 유지
- duplicate turn 0
- session reconnect 0
- `이어하기` modal 0
- disconnect popup 0

---

# 3. Issue A — `채팅창 닫기` 표시 정책

## 3.1 기대 UX

### Keyboard visible = true

숨김:

```text
✕ 채팅창 닫기
```

표시:
- K 질문/응답
- K 상태
- text input
- send button
- keyboard

### Keyboard visible = false

Text chat mode가 여전히 열려 있다면:

```text
✕ 채팅창 닫기
```

표시 가능.

즉 이 버튼의 의미는:

> “소프트 키보드를 닫는 버튼”이 아니라  
> “Text chat mode 자체를 종료하고 Mission 음성 화면으로 돌아가는 버튼”

이어야 한다.

## 3.2 구현 전 원인 조사

먼저 현재 `채팅창 닫기` 렌더 조건을 찾는다.

확인 대상:
- `components/MissionConversationLayout.tsx`
- `app/child/missions/page.tsx`
- keyboard/text-mode 관련 component
- input focus state
- visualViewport resize
- window resize
- keyboard open/close detection
- blur/focus
- iOS Safari viewport behavior

확인할 상태 예:
- `mode === "text"`
- `isTextMode`
- `isKeyboardVisible`
- `inputFocused`
- `chatWindowOpen`
- `visualViewport.height`
- `window.innerHeight`

실제 현재 조건이 단순히:

```text
text mode면 항상 close button 표시
```

인지 확인한다.

---

# 4. iOS Keyboard Visibility Source of Truth

가짜 고정 timer로 keyboard 상태를 추측하지 않는다.

가능하면 현재 프로젝트에 이미 존재하는 keyboard visibility hook/util을 재사용한다.

없다면 iOS Safari/PWA에서 안정적으로 동작하는 방식으로:
- `window.visualViewport`
- `resize`
- input focus/blur
- viewport height delta

등을 조합하되 단일 boolean Source of Truth를 만든다.

목표:

```text
isKeyboardVisible
```

이 값은 최소 다음 상황에서 정확해야 한다.
- keyboard open
- keyboard close
- 한글/영문 전환
- 숫자/특수문자 keyboard 전환
- input blur
- input refocus
- orientation 변화가 있다면 회귀 없음

---

# 5. Issue B — K 응답 Bubble / Audio 미출력 조사

이 문제는 **TTS 문제라고 먼저 단정하지 않는다.**

반드시 전체 chain을 확인한 뒤 최초 중단 지점을 확정한다.

조사 순서:

```text
Child text submit
→ child turn accepted
→ child turn persisted
→ K response generation triggered
→ K response generated
→ K turn persisted
→ client receives K turn
→ bubble state updated
→ TTS/audio queued
→ audio playback starts
→ playback ends
→ WAITING
```

각 단계의 성공/실패를 분리한다.

---

# 6. 서버 / DB 확인

동일 DEV session에서 text submit 후:

### 확인 1
Child message가 DB에 저장되는가?

### 확인 2
K response row가 DB에 생성되는가?

### 확인 3
K response 생성 API/RPC가 호출되는가?

### 확인 4
서버가 response payload를 client에 반환하는가?

분기:

### Case A — K row가 DB에 없음

원인 범위:

```text
turn processing / response generation
```

을 추적.

### Case B — K row는 DB에 있음

원인 범위:

```text
client receive / render / TTS playback
```

을 추적.

이 분기를 먼저 확정한 뒤 수정한다.

---

# 7. Client Rendering 조사

K response가 생성됐는데 말풍선이 안 보인다면 다음을 확인한다.
- text mode에서 K bubble conditional render가 숨겨지는지
- voice mode 전용 bubble state를 text mode가 공유하지 못하는지
- `mode === "voice"` 등의 조건으로 bubble을 suppress하는지
- keyboard visible 시 layout overflow/position 때문에 화면 밖으로 밀리는지
- latest K turn state가 업데이트되지 않는지
- message history와 speech bubble이 별도 state라 동기화가 끊기는지

K response bubble은 keyboard visible 여부와 무관하게 표시돼야 한다.

---

# 8. Audio / TTS 조사

K response가 생성됐지만 음성이 안 들린다면 다음을 확인한다.
- text mode 진입 시 output audio까지 mute하는지
- mic pause가 speaker/output까지 함께 pause하는지
- TTS queue가 voice mode 전용인지
- `mode === "text"`에서 playback을 skip하는 guard가 있는지
- `speechSynthesis`, audio element, TTS player, streaming audio 중 실제 사용 경로
- K response audio generation 자체가 생략되는지
- text response는 생성되지만 TTS trigger가 호출되지 않는지

정책:

```text
Text input mode
≠
Silent K mode
```

아이는 keyboard로 입력해도 K 응답을 **말풍선으로 보고 음성으로 들을 수 있어야 한다.**

---

# 9. Free Chat과 비교

Free Chat에서는 text input → K response가 정상 동작하므로 반드시 비교한다.

비교 항목:
- text submit handler
- response generation trigger
- K turn persistence
- response state
- bubble rendering
- TTS/audio playback
- mic pause policy
- text/voice mode switch

Free Chat의 안정된 response presentation 로직을 재사용할 수 있으면 우선 재사용한다.

Mission 전용 duplicate implementation을 불필요하게 추가하지 않는다.

---

# 10. 상태 UI

기존에 추가된 K 상태 UI는 유지한다.

최소:

```text
대기 중
생각 중...
말하는 중
연결 중...
```

이번 수정 후 text submit lifecycle이 실제 상태와 맞아야 한다.

정상 sequence:

```text
WAITING
→ THINKING
→ SPEAKING
→ WAITING
```

K response가 text-only rendering 중이라도 실제 audio playback이 시작되면 SPEAKING으로 표시한다.

상태를 fake timer로 전환하지 않는다.

---

# 11. Keyboard Mode에서 Audio Input 정책

keyboard visible 동안 아이의 mic/audio capture 정책은 현재 안정화된 P0 결과를 그대로 따른다.

이번 Request에서 기존 해결된 manual/auto 초기화 로직을 다시 설계하지 않는다.

중요:
- keyboard text 입력과 child mic capture가 동시에 충돌하지 않아야 함
- keyboard mode 때문에 Mission session 자체를 종료하지 않음
- K output audio는 계속 허용

즉:

```text
Child audio input pause 가능
K audio output 유지
Mission session 유지
```

---

# 12. Dev E2E — Issue A

iPhone 실제 또는 동등 viewport 환경에서:

### Case A1

```text
Mission
→ keyboard open
```

기대:

```text
keyboard visible
채팅창 닫기 버튼 hidden
```

### Case A2

```text
keyboard dismiss
```

기대:

```text
Text chat mode 유지
채팅창 닫기 버튼 visible
```

### Case A3

```text
input refocus
→ keyboard reopen
```

기대:

```text
채팅창 닫기 hidden
```

### Case A4

한글 → 숫자 → 특수문자 keyboard 변경

기대:

```text
close button hidden 유지
```

---

# 13. Dev E2E — Issue B

### Case B1 — First text

```text
Mission 진입
→ 음성 0턴
→ keyboard open
→ text submit
```

기대:

```text
child turn 저장
K response 생성
K bubble 표시
K audio 출력
WAITING 복귀
```

### Case B2 — Multiple text turns

```text
text
→ K response
→ text
→ K response
→ text
→ K response
```

최소 3회.

### Case B3 — Text → Voice

```text
keyboard text conversation
→ keyboard dismiss
→ 채팅창 닫기
→ voice mode
```

동일 session 유지.

### Case B4 — Voice → Text

```text
voice conversation
→ keyboard
→ text
```

정상.

### Case B5 — Keyboard open/close 반복

최소 5회.

---

# 14. 데이터 / 세션 검증

각 E2E에서 확인:
- session_id 동일
- child turn duplicate 0
- K turn duplicate 0
- chat history 누락 0
- Goal Progress 유지
- Memory Context 유지
- forced end 0
- reconnect 0
- retry popup 0
- resume modal 0

---

# 15. 회귀 금지

이미 해결된 다음 기능을 깨뜨리면 FAIL:
- Mission 최초 진입 즉시 keyboard 사용 가능
- manual mode에서 자동 mic 오작동 없음
- 실제 recording 중에는 keyboard 적절히 제한
- recording 종료 후 keyboard 정상
- K 상태 표시
- Free Chat 정상
- DEV 24시간 Mission
- Production 09:00~23:50 정책 코드

---

# 16. Production 정책

이번 Request는 **DEV 전용 구현/QA**로 진행한다.

금지:
- 자동 Production deploy
- Production DB 변경
- Production config 변경
- Production user QA

Dev Gate가 모두 PASS한 뒤 결과를 보고한다.

Production 적용 여부는 별도 승인 후 결정한다.

---

# 17. 성공 기준

다음 모두 PASS해야 완료:
- keyboard visible → `채팅창 닫기` hidden
- keyboard dismissed → `채팅창 닫기` visible
- keyboard reopen → hidden
- 첫 text submit 정상
- K bubble 정상
- K voice 정상
- THINKING → SPEAKING → WAITING 정상
- text 3턴 연속 정상
- text↔voice 정상
- same session 유지
- duplicate 0
- disconnect 0
- 기존 keyboard-first fix 회귀 0
- Free Chat 회귀 0
- TypeScript PASS
- unit PASS
- integration PASS
- build PASS

---

# 18. 완료 보고

최종 보고서에 반드시 포함:
1. `채팅창 닫기` 기존 렌더 조건
2. keyboard visibility Source of Truth
3. 수정 후 표시 조건
4. text submit call chain
5. child turn DB 저장 여부
6. K turn DB 생성 여부
7. 최초 failure 지점
8. K bubble 미표시 root cause
9. K audio 미출력 root cause
10. 두 현상이 같은 원인인지 별개인지
11. Free Chat과 Mission diff
12. 변경 파일
13. iPhone keyboard QA
14. text 3턴 QA
15. text↔voice QA
16. session continuity
17. regression 결과
18. Production 미배포 확인
19. 남은 위험

---

# 최종 완료 정의

> Mission keyboard mode에서 iPhone software keyboard가 올라와 있는 동안에는 불필요한 `채팅창 닫기` 버튼이 표시되지 않아야 하고, keyboard를 내렸을 때만 text chat mode 종료 버튼이 나타나야 한다. 아이가 keyboard로 text를 보내면 K의 응답 말풍선과 음성이 모두 정상 출력되어야 하며, `대기 중 → 생각 중 → 말하는 중 → 대기 중` 상태가 실제 처리 흐름과 일치해야 한다. 이 모든 과정에서 기존 Mission session, Conversation Context, Goal Progress, Memory가 유지되어야 한다.
