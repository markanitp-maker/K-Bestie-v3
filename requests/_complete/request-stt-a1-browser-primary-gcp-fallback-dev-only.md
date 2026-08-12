# STT A1 전환 — Browser STT Primary + GCP STT Fallback (Development Only)

## 0. 작업 목적

미션 대화와 자유대화의 음성 입력 STT 구조를 다음 A1 방식으로 전환한다.

Browser STT = Primary  
GCP STT = Fallback

이번 작업은 Development 서버까지만 구현·배포한다. Production에는 절대 배포하지 않는다.

Development 배포 후 대표님이 직접 다음 두 기능을 QA한다.

- 미션 대화
- 자유대화

대표님 QA 승인 전에는 Production 배포·환경변수 변경·DB 변경·릴리즈를 진행하지 않는다.

---

## 1. 최종 A1 아키텍처

한 아이 발화마다 아래 흐름을 사용한다.

```text
아이 발화 시작
        ↓
Browser SpeechRecognition
+
동일 발화 MediaRecorder RAM 임시 저장
        ↓
아이 발화 종료
        ↓
Browser STT final transcript?
   ┌────┴────┐
 성공       실패
   │         │
   ↓         ↓
Browser      RAM의 동일 발화 Blob
Transcript          ↓
   │             GCP STT
   │                ↓
   │            Transcript
   └──────┬─────────┘
          ↓
  단 하나의 Final Transcript
          ↓
   Mission / K Conversation Engine
```

핵심 원칙:

- Browser STT가 Primary
- GCP STT는 fallback일 때만 호출
- 한 턴의 최종 transcript는 반드시 1개
- Browser/GCP 중복 결과로 케이가 두 번 응답하면 안 됨
- 미션과 자유대화가 동일 STT Router를 사용

---

## 2. 적용 범위

### 미션
- 자동 음성
- 수동 음성
- 일반 REST STT 경로

### 자유대화
- 자동 음성
- 수동 음성
- 일반 REST STT 경로

키보드 입력은 STT Router를 우회한다.

Premium Gemini Live / Native Audio가 별도 경로라면 이번 작업에서 억지로 Browser STT로 변경하지 않는다. AS-IS 감사에서 별도 경로로 분리 보고한다.

---

## 3. 공통 STT Router

미션과 자유대화가 Browser STT / GCP fallback을 각각 복제 구현하지 않는다.

권장 책임:

```text
STT Router
├─ Browser SpeechRecognition
├─ Temporary Audio Buffer
├─ Fallback Decision
├─ GCP STT Client
├─ Turn Arbitration
├─ Cleanup
└─ Metrics
```

실제 파일명은 현재 코드 구조 감사 후 기존 convention에 맞춰 확정한다.

---

## 4. Browser STT Primary

브라우저가 SpeechRecognition을 지원하면 이를 가장 먼저 사용한다.

필수:

- language = ko-KR
- final transcript 기준
- 브라우저 prefix/support detection
- 자동/수동 모두 최종 transcript contract 동일
- 미지원이면 즉시 GCP fallback 가능

Browser STT가 정상 final transcript를 반환하면:

1. Browser transcript를 winner로 확정
2. GCP STT 호출 0회
3. 임시 오디오 Blob 즉시 폐기
4. Mission 또는 Free Chat downstream으로 transcript 전달
5. 사용자 메시지/LLM/TTS는 각각 1회만 처리

---

## 5. 동일 발화 임시 녹음

Browser STT를 실행하는 동안 동일 발화를 MediaRecorder 또는 현재 프로젝트의 안정적인 오디오 캡처 방식으로 임시 녹음한다.

목적:

Browser STT 실패 시 같은 발화를 아이에게 다시 말하게 하지 않고 GCP STT로 fallback하기 위함.

중요:

- 서버에 계속 저장하지 않음
- Cloud Storage / Supabase Storage 저장 금지
- IndexedDB/localStorage 영구 저장 금지
- 한 발화 동안 브라우저 RAM에만 임시 보관
- Browser STT 성공 즉시 폐기
- GCP fallback 완료 즉시 폐기
- 화면 이탈/취소/에러 시 반드시 폐기
- 10분 세션 전체 음성을 녹음하는 방식 금지
- 반드시 turn 단위로 관리

---

## 6. GCP Fallback 발생 조건

최소 후보:

- SpeechRecognition API 미지원
- SpeechRecognition onerror
- network/audio-capture 등 브라우저 오류
- 실제 Voice Activity가 있었는데 final transcript 없음
- final transcript가 빈 문자열
- final result timeout
- recognizer start 실패
- 비정상 abort/종료

실제 error code 분류는 브라우저 동작을 확인하여 정리한다.

---

## 7. Fallback을 발생시키지 않는 경우

Browser STT가 정상 transcript를 반환했지만 단순 오타가 있는 경우에는 자동으로 GCP를 재호출하지 않는다.

예:

```text
아이: 민서랑 싸웠어
Browser: 민수랑 싸웠어
```

이 경우 Browser STT는 성공으로 본다.

모든 발화를 다시 GCP로 보내 비교하는 이중 STT는 금지한다.

의미/문맥 보정은 기존 Context Correction / LLM 문맥 처리 구조를 유지한다.

---

## 8. GCP Fallback 오디오 전달

Fallback 발생 시 RAM에 보관 중인 동일 발화 Blob을 기존 또는 공통 GCP STT API로 전송한다.

서버 처리:

```text
Client Blob
→ STT API
→ GCP Speech-to-Text
→ Transcript
→ Request 종료
```

금지:

- 서버 파일 저장
- GCS/Supabase Storage 저장
- DB 저장
- raw request body 로그
- raw audio debug 로그

---

## 9. Turn Arbitration — 중복 응답 방지

가장 중요하다.

Browser timeout 직후 GCP fallback을 시작했는데 Browser final result가 늦게 도착할 수 있다.

각 발화마다 고유 turn 식별자를 사용한다.

권장 상태:

```text
IDLE
LISTENING
BROWSER_PROCESSING
BROWSER_SUCCESS
GCP_FALLBACK
COMPLETED
FAILED
CANCELLED
```

최종 transcript winner는 반드시 하나다.

확인:

- 사용자 메시지 저장 1회
- LLM 호출 1회
- K 응답 저장 1회
- TTS 1회
- duplicate response 0

---

## 10. Timeout

Browser STT timeout은 명시적인 상수/설정으로 관리한다.

금지:

- hidden magic number

Dev telemetry를 통해 iOS/Android별 실제 지연을 확인하고 결과 보고서에 초기 timeout 값과 근거를 남긴다.

---

## 11. 자동 음성 모드

기존 VAD/발화 종료 감지를 유지한다.

목표:

```text
VAD speech_start
→ Browser STT 시작
→ temporary recording 시작

VAD speech_end
→ recording 종료
→ Browser final 결과 대기
→ success 또는 fallback
```

기존 listening/processing/barge-in 상태를 깨지 않는다.

---

## 12. 수동 음성 모드

```text
마이크 버튼 시작
→ Browser STT + temporary recording

마이크 버튼 종료
→ Browser final
→ success 또는 fallback
```

마이크 버튼 무반응 회귀가 발생하면 FAIL.

---

## 13. Mission / Free Chat 동일 STT 계약

```text
STT Router
      ↓
Final Transcript
   ┌──────┴──────┐
Mission       Free Chat
Adapter         Adapter
```

STT Router는 Mission Goal이나 Free Chat 대화 정책을 알지 않는다.

책임 범위는 음성 → final transcript까지다.

---

## 14. Browser STT 실패 UX

Fallback이 자동 진행되는 동안 기술 오류를 사용자에게 노출하지 않는다.

가능하면 기존 듣기/처리 UX를 유지한다.

Browser + GCP 모두 실패한 경우에만:

- 짧은 재시도 안내
- 새로고침 없이 다시 말할 수 있게 상태 복구

내부 오류 코드/HTTP status/stack trace 노출 금지.

---

## 15. Fallback까지 실패한 경우

```text
FAILED
→ audio Blob cleanup
→ lock release
→ microphone state reset
→ retry 가능
```

무응답 상태로 남으면 FAIL.

---

## 16. Metrics / Telemetry

Development QA 판단을 위해 최소 다음을 기록한다.

```text
mode = mission | free_chat
input_mode = auto | manual
platform = iOS | Android | Desktop
browser
browser_stt_supported
browser_stt_success
browser_stt_empty
browser_stt_error
browser_stt_timeout
fallback_triggered
gcp_fallback_success
gcp_fallback_error
browser_latency_ms
fallback_latency_ms
total_stt_latency_ms
stt_provider_final = browser | gcp
```

주의:

- raw audio 저장 금지
- 아이 발화 원문 전체 analytics 로그 금지
- 비밀키/토큰 로그 금지

---

## 17. Feature Flag

A1 전환은 Feature Flag로 제어 가능하게 한다.

권장 의미:

```text
BROWSER_STT_PRIMARY_ENABLED=true
GCP_STT_FALLBACK_ENABLED=true
```

Development:
- Browser Primary = ON
- GCP Fallback = ON

Production:
- 변경 금지
- 현재 STT 동작 유지

---

## 18. GCP 기존 코드 삭제 금지

기존 GCP STT 구현은 제거하지 않는다.

역할만:

```text
Primary → Fallback
```

으로 변경한다.

대표님 QA 후 Production 전환 여부를 별도로 결정한다.

---

## 19. iOS QA

Development 선행 검증:

- iPhone Safari
- 가능하면 설치형 PWA
- 자동 마이크
- 수동 마이크
- Browser STT success
- fallback 강제 테스트
- 연속 10턴
- 앱 전환 후 복귀
- 마이크 권한
- STT/TTS 전환
- 중복 응답 0

---

## 20. Android QA

최소:

- Galaxy / Android Chrome
- 자동 마이크
- 수동 마이크
- Browser STT success
- fallback 강제
- 연속 10턴

---

## 21. Desktop QA

Chrome 기준:

- Browser STT
- 자동/수동
- fallback
- timeout
- race condition
- cleanup

---

## 22. Fallback 강제 테스트

Development에서 Browser STT failure를 안전하게 강제 검증한다.

예:

- mock browser error
- mock empty result
- mock timeout
- unsupported simulation

Production 사용자 UI에 debug switch 노출 금지.

---

## 23. 대표님 직접 QA 시나리오

Development 배포 후 대표님이 직접 검증한다.

### 자유대화

1. 자동 모드 5턴 이상
2. 수동 모드 5턴 이상
3. 짧은 발화
4. 긴 발화
5. 친구 이름/게임 이름 등 고유명사
6. 연속 대화
7. 응답 속도
8. 무응답 여부

### 미션

1. 자동 모드
2. 수동 모드
3. 여러 질문 연속 진행
4. 아이 답변 transcript
5. K reaction
6. 다음 질문
7. DB 저장 정상
8. 무응답 여부

대표님이 체감상 확인할 것:

- Browser STT 정확도
- 기존 GCP 대비 체감 차이
- 응답 latency
- 미션/자유대화 자연스러움
- fallback 필요성

---

## 24. 대표님 QA Gate

Development 배포 후 작업 상태:

```text
WAITING_FOR_OWNER_QA
```

대표님이 명시적으로 승인하기 전 금지:

- Production deploy
- Production env 변경
- Production Supabase 변경
- Production Edge Function 변경
- canary rollout

Dev PASS를 Production 승인으로 해석하지 않는다.

---

## 25. Production 배포 금지

이번 Request의 완료 범위는 Development 배포까지다.

최종 상태:

```text
IMPLEMENTED
DEV_DEPLOYED
DEV_INTERNAL_QA_PASS
WAITING_FOR_OWNER_QA
```

Production PASS 단계는 이번 Request에 존재하지 않는다.

대표님 QA 승인 후 별도의 Production 배포 Request를 작성한다.

---

## 26. 구현 순서

### Phase 0 — AS-IS 감사
- Mission STT 호출 경로
- Free Chat STT 호출 경로
- 공통/중복 코드
- MediaRecorder/VAD
- Browser SpeechRecognition 기존 사용 여부
- GCP STT API
- Live API 경로
- turn_id / lock
- iOS/Android handling

### Phase 1 — 공통 STT Router
- Browser STT primary
- Audio Buffer
- GCP fallback
- Arbitration
- Cleanup
- Metrics

### Phase 2 — Mission 연결
- 자동
- 수동
- downstream regression

### Phase 3 — Free Chat 연결
- 자동
- 수동
- downstream regression

### Phase 4 — Failure / Race QA
- Browser success
- error
- empty
- timeout
- late result
- GCP success/failure

### Phase 5 — Device QA
- iOS
- Android
- Desktop

### Phase 6 — Development 배포
- Dev만 배포
- Production 변경 0건

### Phase 7 — 대표님 QA 대기

---

## 27. Unit / Integration Tests

필수:

- Browser success → GCP 호출 0
- Browser error → GCP 1회
- Browser empty → GCP 1회
- Browser timeout → GCP 1회
- unsupported → GCP 1회
- Browser success 후 late error → GCP 0
- fallback 후 late Browser result → final transcript 1개
- GCP success → downstream 1회
- Browser + GCP 모두 실패 → 상태 복구
- Blob cleanup
- page unmount cleanup
- duplicate submit 0

---

## 28. 회귀 검증

### Mission
- 자동 음성
- 수동 음성
- keyboard
- turn locking
- classification
- reaction
- next question
- progress
- TTS
- DB 저장

### Free Chat
- 자동 음성
- 수동 음성
- keyboard
- K Conversation Engine
- Memory
- TTS
- DB 저장

### Common
- 마이크 권한
- AudioContext
- PWA
- session cleanup
- duplicate response 0

---

## 29. 개인정보 / 보안

- raw audio 영구 저장 0
- server file 저장 0
- GCS/Supabase Storage 저장 0
- Browser RAM one-turn only
- fallback request body logging 금지
- transcript 기존 정책 외 중복 저장 금지
- API key 클라이언트 노출 금지

---

## 30. 완료 기준

### Architecture
- 공통 STT Router
- Mission/Free Chat 중복 fallback 없음
- Browser Primary
- GCP Fallback

### Browser success
- 정상 transcript
- GCP 호출 0
- Blob cleanup
- downstream 1회

### Fallback
- error/empty/timeout/unsupported fallback
- 동일 오디오 사용
- 서버 저장 없음
- GCP success
- downstream 1회

### Race
- final transcript 1개
- user message 1개
- LLM response 1개
- TTS 1회
- duplicate 0

### Device
- iOS Safari PASS
- Android Chrome PASS
- Desktop Chrome PASS

### Mission
- 자동 PASS
- 수동 PASS
- 연속 턴 PASS

### Free Chat
- 자동 PASS
- 수동 PASS
- 연속 턴 PASS

### Deployment
- Development 배포 완료
- Production deploy 0건
- Production env 변경 0건
- Production DB 변경 0건

### Issues
- BLOCKED 0
- HIGH 0
- MEDIUM 0

최종 상태:

`WAITING_FOR_OWNER_QA`

---

## 31. 결과 보고 형식

### AS-IS
- Mission STT:
- Free Chat STT:
- GCP route:
- Browser API existing:
- MediaRecorder:
- 중복 코드:

### A1 Architecture
- STT Router:
- Browser provider:
- Audio Buffer:
- Fallback:
- Arbitration:
- Cleanup:

### Fallback Conditions
- unsupported:
- error:
- empty:
- timeout:
- 기타:

### Temporary Audio
- format:
- 저장 위치:
- lifecycle:
- 평균/최대 메모리 사용:
- cleanup:

### Metrics
- browser success:
- browser error:
- browser empty:
- timeout:
- fallback rate:
- gcp success:
- latency:

### Mission QA
- iOS auto:
- iOS manual:
- Android auto:
- Android manual:
- Desktop:
- regression:

### Free Chat QA
- iOS auto:
- iOS manual:
- Android auto:
- Android manual:
- Desktop:
- regression:

### Race / Failure QA
- late browser:
- duplicate prevention:
- browser+gcp failure:
- cleanup:

### Development Deployment
- commit:
- Dev URL:
- deployment:
- env flags:

### Production
- Production deploy: NOT DEPLOYED
- Production env changed: NO
- Production DB changed: NO

### Issues
- BLOCKED:
- HIGH:
- MEDIUM:
- LOW:

### Final Status
`WAITING_FOR_OWNER_QA`

---

## 32. 절대 금지

- 이번 Request에서 Production 배포 금지
- Production 환경변수 변경 금지
- Production DB/Edge Function 변경 금지
- 대표님 QA 없이 Production rollout 금지
- GCP STT 코드 삭제 금지
- 모든 발화를 Browser+GCP 동시에 이중 STT 금지
- Browser 정상 결과를 품질 비교 목적으로 매번 GCP에 재전송 금지
- 10분 전체 음성 녹음 금지
- raw audio 영구 저장 금지
- Cloud Storage/Supabase Storage 저장 금지
- localStorage/IndexedDB 음성 저장 금지
- duplicate transcript/LLM/TTS 금지
- Browser STT 실패를 무응답으로 종료 금지
- fallback 실패 후 processing lock 유지 금지
- Mission/Free Chat 별도 STT Router 복제 금지

---

## 33. 최종 기준 문장

STT A1은 미션과 자유대화 모두 Browser SpeechRecognition을 Primary STT로 사용하고, 동일 발화를 한 턴 동안만 클라이언트 RAM에 임시 녹음하여 Browser STT가 실제 실패·빈 결과·timeout·미지원인 경우에만 해당 오디오를 기존 GCP Speech-to-Text로 fallback한다. Browser STT가 성공하면 GCP는 호출하지 않고 임시 오디오는 즉시 폐기하며, 한 턴의 최종 transcript는 반드시 하나만 downstream으로 전달한다. 이번 작업은 Development 서버까지만 구현·배포하며 대표님이 iOS/Android에서 미션과 자유대화를 직접 QA한 뒤 별도 승인하기 전에는 Production을 절대 변경하거나 배포하지 않는다.
