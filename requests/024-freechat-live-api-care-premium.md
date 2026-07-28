# Feature: 자유대화 화면에 Care Premium(Live API) 적용

- 상태: TODO
- 유형: 신규 기능(제품 방향 결정 필요 — 비즈니스 로직/범위 확장 포함)
- 우선순위: 미정(대표님 결정 대기)

## 배경

`requests/020-unify-care-plan-voice-layout.md` 처리 중 코드로 직접 확인한 사실
(2026-07-28):

- **미션 화면**(`app/child/missions/page.tsx`)은 Live API(Care Premium)와
  STT/TTS(Care Start/Insight) 모두 이미 동일한 `MissionConversationLayout` 구조를
  쓴다 — 011 지시서의 여러 라운드에서 이미 통합 완료됨(020의 "UI 통합" 요구사항
  충족, 별도 작업 불필요).
- **자유대화 화면**(`app/chat/page.tsx`)은 Care Premium(tier 3) 사용자라도
  Live API(`useGeminiLive`)를 전혀 쓰지 않는다 — `useVoiceChat`(STT/TTS)만
  import되어 있고, Care Start/Insight와 완전히 동일하게 동작한다.
  `useGeminiLive`/Live API는 저장소 전체에서 `app/child/missions/page.tsx`와
  테스트 하네스(`components/TestModeABRunner.tsx`)에서만 쓰인다 — 자유대화용
  Live 화면은 "교체할 기존 UI"가 아니라 애초에 존재한 적이 없다.

020의 전제("Care Premium은 기존 Live API 전용 UI가 남아 있다")는 미션 화면
기준으로는 맞지만 자유대화 기준으로는 맞지 않는다 — 020 자체가 "UI 통합만
수행, 비즈니스 로직 변경 금지"로 범위를 명시했기 때문에, 자유대화에 Live API를
새로 구현하는 것은 020의 범위 밖으로 판단해 이 별도 요청서로 분리했다
(대표님 확정 지시, 2026-07-28).

## 결정이 필요한 이유

- Live API를 자유대화에 추가하는 것은 UI 수정이 아니라 신규 기능 구현이다
  (비용·지연시간·Cloud Run Relay 용량·기존 STT/TTS 파이프라인과의 병행 유지
  여부 등 제품 결정 사항 포함).
- Care Premium 요금제의 "약속된 가치"가 무엇인지(미션에서만 Live API 제공 vs
  전체 대화 경험에서 Live API 제공)는 코드가 아니라 대표님의 제품 정책 결정
  사항이다.

## 대표님이 결정할 사항

1. 자유대화에 Live API를 실제로 추가할지 여부.
2. 추가한다면 우선순위(다른 큐 항목 대비)와 일정.
3. 추가 시 범위 — 미션 화면의 기존 Live 파이프라인(`useGeminiLive`,
   Cloud Run Relay, B안 아키텍처)을 그대로 재사용할지, 자유대화 전용 정책
   (예: 세션 길이 제한, 별도 사용량 계산)이 필요한지.

## 참고 — 이미 확인된 기술적 사실(재조사 불필요)

- 미션 화면의 Live 통합 패턴(`isLiveMode` 분기, `MissionConversationLayout`
  공유, 하단 상태배지/마스코트/토글 레이아웃 고정)은 그대로 참고 가능 —
  011 지시서 여러 라운드에서 실기기/PC PWA/여러 뷰포트로 이미 검증됨
  (`requests/_log.md` 011 관련 항목 다수 참고).
- `useGeminiLive` 훅과 Cloud Run Relay(B안 아키텍처)는 자유대화에서도 그대로
  재사용 가능한 구조로 보이나, 세션 시작/종료 시점이 미션과 다르므로(자유대화는
  고정된 질문 흐름이 없음) 그 차이를 반영한 초기화/종료 로직은 신규 설계가 필요.

## 완료 조건(초안 — 대표님 결정 후 구체화)

- 대표님이 위 결정사항 1~3을 확정.
- 확정 후 별도 세션에서 구현 범위·설계 재정리 후 착수.
