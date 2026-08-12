## 제목
Care Start / Care Insight / Care Premium 음성 대화 UI 레이아웃 통합

## 목적

현재 내친구 케이 음성 대화 화면은 Care Start, Care Insight, Care Premium 사용자별로 일부 UI 구조가 다르게 구현되어 있다.

특히 Care Premium(Live API 사용)은 기존 버전의 음성 대화 UI가 남아 있어 최신 변경된 미션/자유대화 UI 경험과 일치하지 않는다.

모든 Care 플랜 사용자가 동일한 케이 음성 대화 경험을 제공받도록 최신 Voice Conversation Layout으로 통합한다.

---

# 적용 대상

대상 플랜:

- Care Start
- Care Insight
- Care Premium

모든 플랜에 동일 UI 적용.

---

# 기본 원칙

## UI 통합

현재 확정된 최신 음성 대화 UI를 기준으로 한다.

적용 기준:

- 미션 대화 UI
- 자유 대화 UI

두 화면에서 확정된 공통 VoiceConversationLayout 구조 사용.

Care Premium도 동일 구조 적용.

---

# 1. 공통 Voice Conversation Layout 적용

모든 Care 플랜에서 아래 구조 사용:

```
VoiceConversationLayout

├── Header
│   ├── 뒤로가기
│   ├── 내친구 케이 로고
│   └── 연결 상태 표시
│
├── Conversation History
│   └── 최근 대화 영역
│
└── Voice Control Area
    ├── 상태 표시
    ├── 케이 마스코트
    ├── 자동/수동 토글
    └── 음성 버튼
```

---

# 2. Care Premium Live API 화면 변경

현재 Care Premium은 기존 Live API 전용 UI가 남아 있다.

변경:

기존:
- Premium 전용 오래된 음성 화면

변경:
- 최신 VoiceConversationLayout 적용

단, Live API 연결 방식과 음성 처리 방식은 유지한다.

---

# 3. 플랜별 기능 차이 유지

UI는 동일하게 통합하지만 기능 차이는 유지한다.

## Care Start

- 기존 STT/TTS 방식 유지
- 최신 UI 적용

## Care Insight

- 기존 STT/TTS 방식 유지
- 최신 UI 적용

## Care Premium

- Vertex AI Gemini Live API 사용 유지
- B안 아키텍처 유지

B안:

- Cloud Run Relay
- Vertex AI Live API
- Live 음성 스트리밍

UI만 최신 구조로 변경한다.

---

# 4. Care Premium Live API 정책

현재 Premium Live API는 아래 기준 유지.

- 아이 음성 입력
- 케이 음성 출력

Live API의 자연스러운 음성 대화 기능 유지.

단, UI 레이어에서는 다른 플랜과 동일한 상태 표시를 사용한다.

상태:

- 듣는 중
- 생각하는 중
- 말하는 중

---

# 5. 하단 Control 영역 통일

모든 Care 플랜 동일 적용.

구조:

```
[상태 배지]     [케이 마스코트]     [자동/수동]
```

조건:

- 케이 위치 고정
- 자동/수동 위치 고정
- 상태 텍스트 변경으로 레이아웃 이동 금지
- Layout Shift 발생 금지

---

# 6. 음성 버튼 통일

모든 플랜 동일 적용.

적용:

- 마이크 버튼
- 녹음 중지 버튼
- 케이 발화 중 비활성 상태

Care Premium Live API에서도 동일 UI 사용.

---

# 7. 변경 금지 영역

변경하지 않는다.

## 음성 처리

- Vertex AI Live API 연결
- Gemini Live Session
- STT/TTS Pipeline
- Relay Server
- Audio Streaming

## 비즈니스 로직

- 플랜 권한
- 사용량 제한
- 결제 정책
- 미션 진행
- 보상 정책

UI 통합만 수행한다.

---

# 8. QA 검증

수정 완료 후 QA 진행.

검증 대상:

- Care Start
- Care Insight
- Care Premium

확인 항목:

## UI 동일성

확인:

- Header 동일
- 케이 위치 동일
- 상태 배지 위치 동일
- 자동/수동 위치 동일
- 음성 버튼 동일

## 음성 상태 변경

테스트:

```
듣는 중
→ 생각하는 중
→ 말하는 중
→ 듣는 중
```

확인:

- 마스코트 이동 없음
- 버튼 이동 없음
- 레이아웃 흔들림 없음

## Premium Live API 검증

확인:

- Live API 연결 정상
- 음성 출력 정상
- UI 상태 표시 정상

---

# 완료 조건

- Care Start 최신 UI 적용 완료
- Care Insight 최신 UI 적용 완료
- Care Premium 기존 UI 제거 및 최신 UI 적용 완료
- 세 플랜 모두 동일 VoiceConversationLayout 사용
- Premium Live API 기능 유지
- B안 Live API 구조 유지
- QA 결과 로그 작성
- 변경 파일 목록 기록
```
