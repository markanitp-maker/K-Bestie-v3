034-parent-report-tts-and-k-voice-chat.md

# REQUEST 034 — 부모 리포트 음성 듣기 + K 음성 대화

## 0. 완료 시 기대 결과 / 대표님 QA 정상 프로세스

### 완료 시 기대 결과

부모가 화면을 오래 보지 않아도 리포트를 음성으로 들을 수 있고, K와의 대화도 기존 텍스트 방식과 함께 음성 방식으로 사용할 수 있게 한다.

구현 범위는 두 가지다.

1. 부모 리포트 음성 듣기
   - 일간 리포트
   - 주간 리포트
   - 빠른 요약
   - 상세 보기
   - 추천 가이드
   - 각 현재 섹션 상단에 `음성으로 듣기` 버튼 제공
   - 클릭 시 현재 화면에 실제 표시 중인 리포트 텍스트만 Browser TTS로 순서대로 읽음

2. K와의 음성 대화
   - 기존 텍스트 대화 유지
   - Browser STT + Browser TTS 기반 음성 대화 모드 추가
   - 부모 음성 입력 → STT → 기존 `POST /api/parent/k-chat` 전송
   - K 텍스트 응답 화면 표시
   - 음성 질문으로 시작한 경우에만 K 답변 자동 TTS 재생

### 배포 순서

반드시 아래 순서로 진행한다.

```text
개발 완료
→ 개발팀 자동/수동 QA 전체 통과
→ Development 서버 배포
→ 대표님 직접 QA
→ 대표님 승인
→ Production 배포
```

대표님 승인 전 Production 배포 금지.

---

## 1. 현재 구조 기준

Antigravity 사전 점검 결과 현재 구조는 Request MD 작성 가능한 상태다.

### 부모 리포트

- 일간 메인: `app/parent/report/page.tsx`
- 주간 메인: `app/parent/report/weekly/page.tsx`
- 공통 상세 모달: `components/ReportDetailModal.tsx`
- 일간 단독 상세: `app/parent/report/[id]/page.tsx`
- 주간 단독 상세: `app/parent/report/weekly/[id]/page.tsx`
- 탭:
  - 빠른 요약
  - 상세 보기
  - 추천 가이드

### K와의 대화

- 화면: `app/parent/guide/page.tsx`
- API: `POST /api/parent/k-chat`
- 기존 Browser STT/TTS 관련 코드: `hooks/useParentVoice.ts`
- 새 LLM 파이프라인을 만들지 말고 기존 K text API를 재사용한다.

---

# 2. 기능 A — 부모 리포트 `음성으로 듣기`

## 2.1 기본 UX

각 리포트 상세 화면의 현재 탭 상단에 다음 버튼을 배치한다.

```text
[🔊 음성으로 듣기]
```

재생 중:

```text
[⏹ 정지]
```

1차 버전에서는 브라우저별 안정성 문제를 고려해 Pause/Resume은 제공하지 않는다.

한 번 누르면 현재 탭의 유효 콘텐츠를 처음부터 끝까지 읽고, `정지`로 즉시 중단할 수 있어야 한다.

---

## 2.2 적용 대상

### 일간
- 빠른 요약
- 상세 보기
- 추천 가이드

### 주간
- 빠른 요약
- 상세 보기
- 추천 가이드

### 진입 경로
- 목록 카드
- 지난 이력보기
- 달력
- 단독 상세 URL
- 다자녀 전환 이후 상세 화면

모든 경로에서 동일하게 동작해야 한다.

---

## 2.3 읽기 대상 원칙

TTS는 DB 전체 값을 직접 읽지 않는다.

반드시 `현재 화면에 실제 표시되는 유효 콘텐츠`만 읽는다.

제외:
- 데이터 부족으로 숨김 처리된 항목
- placeholder
- 버튼명
- 탭/닫기/네비게이션
- 날짜 선택 UI
- FAQ
- 이모지
- bullet
- 장식용 특수문자

화면 렌더링과 TTS의 Source of Truth를 최대한 동일하게 유지한다.

---

## 2.4 일간 빠른 요약 읽기 순서

```text
오늘의 한 줄
→ summary_line

1분 요약 리포트
→ 현재 실제 빠른 요약 본문
```

빈 콘텐츠는 읽지 않는다.

---

## 2.5 일간 상세 보기 읽기 순서

`buildMeaningfulReportSections()` 또는 현재 실제 렌더링되는 유효 섹션 결과를 재사용한다.

```text
상세 리포트
→ 학교·학원 생활
→ 친구 관계와 또래 생활
→ 감정 힌트 / 마음 흐름
→ 관심사와 개인 취향
→ 공부 고민
→ 디지털·콘텐츠
→ 기타 실제 표시 중인 섹션
```

데이터 없는 섹션은 화면과 동일하게 TTS에서도 제외한다.

---

## 2.6 일간 추천 가이드 읽기 순서

현재 실제 표시 중인 항목만 읽는다.

예:

```text
부모 대화 실마리
→ clue

부모용 추천 질문
→ 질문 1
→ 질문 2

오늘의 케이 코멘트
→ comment
```

REQUEST 031/033 정책으로 숨겨진 항목은 읽지 않는다.

---

## 2.7 주간 리포트 읽기

주간도 현재 화면에 표시되는 유효 텍스트만 읽는다.

빠른 요약:
- `summary_text`
- 실제 화면에 표시 중인 주간 요약 내용

상세 보기:
- `detail_text`
- `detail_dashboard_cards` 중 실제 렌더링된 유효 카드

추천 가이드:
- `parent_conversation_clue`
- `recommended_questions`
- `weekend_activity_recommendation`
- 기타 실제 표시 중인 유효 항목

---

# 3. Browser TTS 구현

## 3.1 기술

Browser Web Speech API 사용.

- `window.speechSynthesis`
- `SpeechSynthesisUtterance`

기존 `useParentVoice.ts` 구현을 최대한 재사용하고, 필요할 경우 공통 Hook으로 분리한다.

---

## 3.2 권장 공통 구조

가능하면:

```text
hooks/useBrowserTTS.ts
hooks/useBrowserSTT.ts
lib/speech/speechNormalization.ts
```

단 기존 `useParentVoice.ts`를 불필요하게 깨지 않는다.

---

## 3.3 긴 텍스트 분할

긴 리포트를 하나의 utterance로 읽지 않는다.

문장 단위로 나누어 순차 재생한다.

```text
문장 1
→ onend
문장 2
→ onend
문장 3
...
```

한국어 문장 부호를 포함해 분할한다.

---

## 3.4 한국어 Voice

기본:

```text
lang = ko-KR
```

Voice 우선순위:
1. ko-KR
2. Korean voice
3. 브라우저 기본 음성

`voiceschanged` 비동기 로딩을 처리하고 특정 OS voice 이름을 하드코딩하지 않는다.

---

# 4. TTS 텍스트 정제

TTS 직전에만 텍스트를 정제한다.

DB 원본 수정 금지.

최소:
- 이모지 제거
- bullet 제거
- markdown 장식 제거
- HTML tag 제거
- 중복 whitespace 정리
- 불필요한 특수문자 제거

예:

```ts
cleanTtsText(rawText)
```

문장 의미 자체는 변경하지 않는다.

---

# 5. TTS Cleanup

다음 상황에서는 현재 음성을 즉시 중단한다.

- 모달 닫기
- 탭 전환
- 다른 리포트 열기
- 자녀 변경
- route 이동
- K 음성 대화 시작
- 페이지 hidden/background 전환

공통 `stop()` 또는 `speechSynthesis.cancel()` 사용.

컴포넌트 unmount cleanup 필수.

---

# 6. 대표 확정 UX — 탭 전환

리포트 음성 재생 중 탭을 변경하면:

```text
기존 음성 즉시 정지
→ 새 탭 자동 재생 안 함
→ 새 탭에서 사용자가 다시 `음성으로 듣기`를 눌러야 재생
```

---

# 7. 기능 B — K와의 음성 대화

## 7.1 기존 텍스트 대화 유지

```text
텍스트 입력
→ 전송
→ POST /api/parent/k-chat
→ K 텍스트 응답
```

기존 텍스트 기능을 삭제하거나 음성 전용으로 바꾸지 않는다.

---

## 7.2 음성 모드 추가

K와의 대화 화면에서 다음 두 방식이 공존해야 한다.

```text
[텍스트로 입력]
[🎙 음성으로 대화하기]
```

음성 흐름:

```text
부모 마이크 탭
→ Browser STT 시작
→ 부모 발화
→ final transcript 확보
→ 기존 K text API에 자동 전송
→ K 텍스트 응답 수신
→ 화면에 말풍선 표시
→ Browser TTS로 K 답변 자동 재생
```

---

# 8. 대표 확정 UX — 음성 질문 전송

음성 질문은 핸즈프리 방식으로 한다.

```text
STT final result 확정
→ 별도 확인 버튼 없이 바로 전송
```

STT 오류 또는 final text가 비어 있으면 전송하지 않는다.

---

# 9. 대표 확정 UX — K 답변 자동 재생

### 음성 질문

```text
음성 질문
→ K 답변 수신
→ 자동 TTS 재생
```

### 텍스트 질문

```text
텍스트 질문
→ K 답변 수신
→ 자동 TTS 재생하지 않음
```

기존 수동 듣기 기능이 있다면 유지 가능하다.

---

# 10. Browser STT

기존 구현을 최대한 재사용한다.

후보:
- `SpeechRecognition`
- `webkitSpeechRecognition`

기본 언어:

```text
ko-KR
```

상태:
- idle
- listening
- processing
- speaking
- error

UI:
- 듣는 중
- 생각 중
- K가 말하는 중

---

# 11. STT/TTS 충돌 방지

마이크 시작 전 기존 TTS를 중단한다.

```text
startListening()
→ stopSpeaking()
→ recognition.start()
```

K가 말하는 중 부모가 마이크를 누르면:

```text
K TTS 즉시 중단
→ listening 전환
```

---

# 12. 리포트 TTS와 K TTS 공존 규칙

동시에 두 음성이 재생되면 안 된다.

```text
리포트 듣기 시작 → 기존 K TTS cancel
K 음성 질문 시작 → 기존 리포트 TTS cancel
K 답변 TTS 시작 → 기존 다른 TTS cancel
```

가능하면 공통 Speech Controller/Hook에서 관리한다.

---

# 13. Feature Detection / Fallback

## TTS 미지원
- 음성 듣기 버튼 숨김 또는 disabled
- 텍스트 리포트 정상 유지

## STT 미지원
- 음성 대화 버튼 숨김 또는 disabled
- 텍스트 K 대화 정상 유지

## 마이크 권한 거부

```text
마이크 권한을 허용해주세요.
텍스트로도 대화할 수 있어요.
```

텍스트 대화는 즉시 사용 가능해야 한다.

---

# 14. 이동 상황 UX

핵심 사용 시나리오는 부모가 이동 중 화면을 오래 보기 어려운 상황이다.

따라서:
- 버튼은 크고 명확하게
- 한 번 탭하면 현재 섹션 끝까지 재생
- 재생 중 조작은 `정지` 중심
- 작은 조작 버튼 여러 개 추가 금지
- 복잡한 오디오 플레이어 UI 금지
- 화면 interaction 최소화

CarPlay/Android Auto는 이번 범위 아님.

---

# 15. 브라우저/PWA 테스트

최소:
- iPhone Safari
- iPhone PWA
- Android Chrome
- Desktop Chrome
- Desktop Safari

주의:
- 첫 TTS/STT 시작은 사용자 gesture 기반
- background/잠금 상태 지속 재생을 보장하지 않음
- background 전환 시 stop
- 긴 TTS는 문장 큐 사용
- Pause/Resume은 이번 버전 제외

---

# 16. 개인정보/보안

- K-Bestie 서버에 raw audio 저장 기능 추가 금지
- STT 결과 텍스트만 기존 K Chat API에 전달
- 기존 `parent_k_chat_messages` 정책 유지
- 비밀키/토큰 추가 노출 금지
- 마이크 권한은 사용자 명시 동작으로만 요청
- 필요한 privacy 문구가 있으면 완료 보고에서 별도 제안하고 약관/정책은 임의 수정하지 않는다

---

# 17. UI 원칙

```text
시각적 정렬과 가독성을 위한 여백은 유지
의미 없이 휑하게 차지하는 공백은 제거
```

음성 버튼 추가로:
- 큰 빈 wrapper 생성 금지
- 과도한 고정 height 금지
- 리포트 본문 폭 축소 최소화
- 모바일 한 손 조작 고려

---

# 18. 예상 수정 파일

| 기능 | 파일 | 변경 |
|---|---|---|
| 공통 TTS | `hooks/useParentVoice.ts` 또는 `hooks/useBrowserTTS.ts` | TTS/cleanup |
| 공통 STT | `hooks/useParentVoice.ts` 또는 `hooks/useBrowserSTT.ts` | STT 상태/지원 감지 |
| TTS 정제 | `lib/speech/speechNormalization.ts` | 텍스트 정제 |
| 리포트 | `components/ReportDetailModal.tsx` | 각 탭 음성 듣기 |
| 일간 단독 | `app/parent/report/[id]/page.tsx` | TTS 연결 |
| 주간 단독 | `app/parent/report/weekly/[id]/page.tsx` | TTS 연결 |
| K 대화 | `app/parent/guide/page.tsx` | 음성 대화 모드 |

실제 코드 기준으로 최소 파일만 변경한다.

---

# 19. 금지 사항

- Cloud TTS/STT 추가 금지
- Gemini Live 신규 연결 금지
- 기존 K text API 교체 금지
- raw audio 서버 저장 금지
- 기존 텍스트 대화 제거 금지
- 리포트 DB를 TTS용으로 수정 금지
- 숨김 리포트 항목 낭독 금지
- 화면 이동 후 음성 계속 재생 금지
- 텍스트 질문까지 자동 TTS 재생 금지
- 대표님 승인 전 Production 배포 금지

---

# 20. 개발 QA

## 리포트 TTS
- 일간 빠른 요약 PASS
- 일간 상세 보기 PASS
- 일간 추천 가이드 PASS
- 주간 빠른 요약 PASS
- 주간 상세 보기 PASS
- 주간 추천 가이드 PASS
- 숨김 항목 미낭독 PASS
- 탭 전환 시 정지 PASS
- 모달 닫기 시 정지 PASS
- 자녀 전환 시 정지 PASS
- route 이동 시 정지 PASS
- 긴 텍스트 완독 PASS

## K 음성 대화
- 음성 인식 PASS
- final transcript 자동 전송 PASS
- 기존 K API 재사용 PASS
- K 답변 화면 표시 PASS
- 음성 질문에만 자동 TTS PASS
- 텍스트 질문 자동 TTS 없음 PASS
- 말하는 중 마이크 누르면 TTS 중단 PASS
- STT 실패 fallback PASS
- 마이크 권한 거부 fallback PASS

## 브라우저
- iPhone Safari
- iPhone PWA
- Android Chrome
- Desktop Chrome
- Desktop Safari

---

# 21. Development 배포 전 완료 기준

- [ ] 타입체크 PASS
- [ ] 빌드 PASS
- [ ] unit test PASS
- [ ] 리포트 TTS E2E PASS
- [ ] K 음성 대화 E2E PASS
- [ ] iPhone Safari PASS
- [ ] iPhone PWA PASS
- [ ] Android Chrome PASS
- [ ] 기존 텍스트 K 대화 회귀 PASS
- [ ] 기존 리포트 UI 회귀 PASS
- [ ] BLOCKER/HIGH 0건

위 조건을 모두 만족하면 Production이 아니라 `Development 서버`에 먼저 배포한다.

---

# 22. Development 배포 후 대표님 QA

Development 배포 후 작업을 멈추고 대표님 QA를 기다린다.

대표님 QA 항목:

### 일간 리포트
- 각 탭 `음성으로 듣기`
- 내용 정상 낭독
- 숨김 항목 미낭독
- 정지 정상

### 주간 리포트
- 각 탭 동일 확인

### K 음성 대화
- 음성 질문
- 자동 전송
- K 답변 자동 음성 재생
- 텍스트 입력 기존 동작 유지

대표님 승인 전 Production 배포 금지.

---

# 23. Production 배포 Gate

Production 배포 조건:

```text
Development QA 전체 PASS
+
Development 서버 배포 완료
+
대표님 직접 QA PASS
+
대표님 Production 배포 승인
```

위 조건이 모두 충족되어야 한다.

자동 Production 배포 금지.

---

# 24. Production 배포 후 Smoke Test

대표님 승인 후 Production 배포 시 최소 확인:
- 일간 TTS
- 주간 TTS
- K 음성 질문
- K 답변 자동 TTS
- 텍스트 K 대화
- iPhone Safari
- iPhone PWA
- Android Chrome

---

# 25. 완료 보고 형식

## 최종 판정

`DEV_READY / DEV_DEPLOYED / PROD_READY / PASS / PARTIAL / FAIL`

## 수정 파일

| 파일 | 변경 내용 | 이유 |
|---|---|---|

## 리포트 TTS

| 항목 | 결과 |
|---|---|
| 일간 빠른 요약 | |
| 일간 상세 | |
| 일간 추천 가이드 | |
| 주간 빠른 요약 | |
| 주간 상세 | |
| 주간 추천 가이드 | |
| 숨김 항목 제외 | |
| 긴 문장 큐 | |
| cleanup | |

## K 음성 대화

| 항목 | 결과 |
|---|---|
| Browser STT | |
| 자동 전송 | |
| 기존 API 재사용 | |
| 음성 질문 답변 자동 TTS | |
| 텍스트 질문 자동 TTS 없음 | |
| barge-in | |
| 권한 fallback | |

## 브라우저
- iPhone Safari:
- iPhone PWA:
- Android Chrome:
- Desktop Chrome:
- Desktop Safari:

## 배포 상태
- 개발 QA:
- Development 배포:
- 대표님 QA:
- 대표님 Production 승인:
- Production 배포:

## 최종 확인
반드시 `맞다 / 아니다`로 답한다.

- 일간 리포트 각 섹션을 음성으로 들을 수 있는가?
- 주간 리포트 각 섹션을 음성으로 들을 수 있는가?
- 화면에 실제 표시되는 콘텐츠만 읽는가?
- 숨김/데이터 부족 항목은 읽지 않는가?
- 탭/모달/자녀/route 전환 시 음성이 중단되는가?
- 기존 K 텍스트 대화가 유지되는가?
- K와 음성으로 질문할 수 있는가?
- 음성 질문은 자동 전송되는가?
- 음성 질문에 대한 K 답변은 자동으로 읽어주는가?
- 텍스트 질문에는 자동 음성 재생하지 않는가?
- STT/TTS 미지원 환경에서 기존 텍스트 기능이 유지되는가?
- Development 서버 배포가 완료됐는가?
- 대표님 QA 승인 전 Production 배포를 하지 않았는가?
