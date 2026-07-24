# agy 작업 지시문 — Plan02 Phase 2 마무리: A안/B안 (Gemini Live 실시간 음성) 구현

## 목표
테스트 계정(testi01/testi02) 전용 A안/B안을 기존 구조 재사용으로 구현한다.
- **A안**: Gemini Live 음성 + 아이·케이 말풍선 모두 표시
- **B안**: 동일하되 **아이 말풍선만 렌더 숨김**(저장·유효성·진행률·usage 기록은 전부 유지)
- Plan02 §14 금지: **Live API 재설계 금지, 신규 오케스트레이터/미션엔진 생성 금지.** 기존 `useGeminiLive` 훅과 공통 미션 오케스트레이터를 그대로 재사용한다.

## 대상 파일 (이 목록 외 파일 수정 절대 금지)
1. **신규** `components/TestModeABRunner.tsx`
2. **수정** `app/child/missions/page.tsx` — 하단 `MissionRouteGate`의 decision 분기에만 손댄다(1855행 부근). `MissionInner` 본문 수정 금지.
3. **수정** `app/child/test-modes/page.tsx` — 시작 버튼 분기.
4. **수정(additive 1건만)** `hooks/useGeminiLive.ts` — 옵션에 `conversationMode?: string` 추가하고 내부 `/api/usage/live` fetch body(408행 부근, start/end 모두)에 `conversationMode` 포함. **그 외 이 훅의 어떤 로직도 수정 금지**(기존 호출부는 미전달 → 동작 불변이어야 함).

## 참고(읽기만, 수정 금지)
- `components/TestModeCDRunner.tsx` — **구조 원본.** 상태머신·오케스트레이터 호출·재시작(epoch)·복원·레이아웃을 이 파일과 최대한 동일하게 유지하고 음성 계층만 교체하라.
- `app/child/missions/page.tsx`의 MissionInner 중 Live(tier3) 경로 — `useGeminiLive` 사용 패턴(startSession, onTurnComplete, speakAsK, setKSpeechAllowed, lockNow, turnPhase 가드) 참조.
- `app/api/child/test-mission/start`(forceNew/이어하기), `/api/mission/answer-lean`·`/api/mission/answer`, `/api/mission/reaction-lean`·`/api/mission/respond-lean` — 그대로 호출만.
- `lib/mission/conversationModeStrategy.ts` — A/B 항목 이미 정의됨.

## 요구사항
### 1) TestModeABRunner.tsx
- Props: `selectedMode: "A" | "B"` (게이트에서 전달).
- **TestModeCDRunner의 흐름을 그대로 복제하되 음성 계층만 교체**:
  - `useVoiceChat`(STT→TTS) 대신 `useGeminiLive` 사용. `conversationMode: selectedMode` 옵션 전달(→ usage_events 태깅).
  - 아이 발화: Live 입력 transcription의 `onTurnComplete(role:"child")`로 수신 → CD러너와 동일하게 아이 말풍선 저장(chat_messages, turn_id/display_sequence) → 오케스트레이터 answer(-lean) 호출(진행률·완료·황금열쇠는 서버가 처리, 클라이언트는 표시만).
  - 케이 발화: CD러너와 동일하게 반응+고정 다음 질문 텍스트를 구성한 뒤 **TTS 대신 `live.speakAsK(text)`** 로 케이가 말하게 한다. 케이 텍스트 말풍선도 저장/표시.
  - **barge-in**: 케이 발화 중 아이가 끼어들면 Live의 interrupted 처리를 따르고, 미션 page tier3의 turnPhase 가드 패턴을 준용해 **중복 answer 호출·중복 말풍선을 방지**한다(단순화 가능하되 가드 필수).
  - 미션 완료 시 `lockNow()` 호출 + CD러너와 동일한 완료 UI(🔄 다시 테스트 / 대화 방식으로).
  - '🔄 새 테스트'/'다시 테스트' = `test-mission/start`에 `forceNew:true` — CD러너의 loadSession/epoch 무효화 패턴 그대로.
  - 새로고침/재입장 복원: CD러너와 동일(chat_messages 복원, display_sequence 이어받기).
  - **B안 차이 단 하나**: `showChildBubble=false`면 아이 말풍선 렌더만 건너뜀(CD러너 562행 패턴). 저장·answer·진행률·usage는 A와 완전 동일.
  - 레이아웃: CD/E러너와 동일(고정 헤더+채팅 스크롤+하단 composer, 버튼 44px, data-testid 유지: progress/bubbles/completed/new-test/retry).
  - Live 연결 실패/재연결: 미션 page의 기존 처리 수준으로 단순 대응(오류 안내 + 재시도 버튼). 새 아키텍처 금지.
### 2) MissionRouteGate (app/child/missions/page.tsx 하단만)
- decision에 `"ab"` 추가: `selectedMode === "A" || "B"` → `<TestModeABRunner selectedMode={...} />`. 기존 e/cd/normal 분기·로직 무변경.
### 3) test-modes 시작 버튼
- 구현된 모드(A,B,C,D,E) 선택 시 "○안으로 미션 시작 → `/child/missions`" 버튼 노출. 미구현 문구는 남은 미구현 모드에만 표시(현재 기준 전부 구현이면 문구 제거).

## 제약(하드)
- 오케스트레이터/서버 라우트/DB/`MissionInner`/`useVoiceChat` 수정 금지. `useGeminiLive`는 위 additive 1건 외 수정 금지.
- tier·요금제·일반 계정 흐름 변경 금지. Production 관련 어떤 것도 금지.
- `src/` 디렉터리 생성 금지, AI SDK는 `@google/genai`만, AI 키 `NEXT_PUBLIC_` 금지.

## 셀프검증 게이트 (완료 보고 전에 직접 수행)
1. `npx tsc --noEmit` → 0 에러
2. `npm run build` → 성공(postbuild 시크릿 검사 포함)
3. 셀프 리뷰 체크: (a) B안에서 아이 발화가 chat_messages/answer/usage에 정상 기록되는가 (b) barge-in 시 중복 answer 호출 가드 (c) 재시작(epoch) 시 in-flight 턴 무효화 (d) 기존 미션 페이지(tier3 Live)와 useGeminiLive 기존 호출부 동작 불변

## 결과 보고 형식 (마지막 출력)
```
[변경 파일] ...목록...
[요구사항 충족] 1)... 2)... 3)... 각 항목별 충족/부분/미충족 + 이유
[셀프검증] tsc: / build: / 셀프리뷰 3항목:
[미해결·주의] ...
```
