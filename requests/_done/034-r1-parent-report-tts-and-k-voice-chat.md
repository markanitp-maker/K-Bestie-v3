단순 버튼명 변경 작업이 아니다. `K와의 대화`를 실제로 2개의 동작 모드로 구현하라.

1. `채팅` 모드
- 기존 텍스트 대화 기능을 그대로 사용한다.
- 부모는 키보드로만 입력한다.
- `POST /api/parent/k-chat` 기존 API를 사용한다.
- K는 텍스트로만 답변한다.
- STT 자동 실행 금지.
- K 답변 자동 TTS 재생 금지.
- 기존 텍스트 채팅 UX를 유지한다.

2. `음성대화` 모드
- 부모가 마이크 버튼을 누르면 Browser STT를 시작한다.
- 부모 발화를 `ko-KR`로 인식한다.
- final transcript가 확정되면 별도 전송 확인 없이 기존 `POST /api/parent/k-chat`으로 자동 전송한다.
- K의 답변은 기존과 동일하게 텍스트로 생성하고 화면 말풍선에도 표시한다.
- 동시에 K 답변을 Browser TTS로 자동 재생한다.
- 즉 사용자 경험은 `부모 음성 → K 음성`이어야 한다.
- K가 말하는 중 부모가 다시 마이크를 누르면 TTS를 즉시 중단하고 새 음성 입력을 시작한다.
- 음성대화에서 채팅 모드로 전환하면 STT/TTS를 모두 정리하고 텍스트 모드로 복귀한다.
- 채팅 모드에서 음성대화로 전환하면 기존 TTS가 있다면 중단하고 음성 입력 준비 상태로 전환한다.
- STT 미지원/마이크 권한 거부 시 채팅 모드는 정상 사용 가능해야 한다.

3. UI 명칭
- 기존 `타이핑` → `채팅`
- 기존 `핸즈프리` → `음성대화`
- 이 명칭 변경은 위 실제 기능 분리와 함께 수행한다. 이름만 바꾸고 기존 동작을 그대로 두면 FAIL이다.

4. 별도 기능: 부모 리포트 음성 듣기
- 일간/주간 리포트의 빠른 요약·상세 보기·추천 가이드 각 탭에 `음성으로 듣기` 버튼을 구현한다.
- 누르면 현재 탭에 실제 표시되는 유효 리포트 내용만 Browser TTS로 읽는다.
- 숨김 항목/placeholder/이모지/bullet/UI 문구는 읽지 않는다.
- 탭 전환, 모달 닫기, 자녀 변경, route 이동 시 TTS 즉시 중단한다.

5. 완료 기준
- `채팅`은 실제 텍스트↔텍스트 모드
- `음성대화`는 실제 음성↔음성 모드
- 두 모드의 입력/출력 동작이 명확하게 다름
- 이름만 변경한 구현은 FAIL
- 기존 `POST /api/parent/k-chat`은 그대로 재사용
- 리포트 TTS까지 함께 구현
- 개발 QA 전체 PASS 후 Development 서버에만 먼저 배포
- 대표님 직접 QA 승인 전 Production 배포 금지

# REQUEST 034-R1 — 부모 리포트 음성 듣기 + K 음성대화

## 0. 완료 시 기대 결과 / 대표님 QA 정상 프로세스

부모 리포트는 각 섹션별로 Browser TTS로 들을 수 있어야 하고, `K와의 대화`는 아래 두 모드로 명확히 구분한다.

```text
[채팅]   [음성대화]
```

정의:

```text
채팅
= 부모 타이핑
→ K 텍스트 답변
→ 자동 음성 재생 없음

음성대화
= 부모 음성
→ Browser STT
→ 기존 K Chat API
→ K 텍스트 답변
→ Browser TTS 자동 재생
```

기존 버튼명은 제거한다.

```text
타이핑 → 제거
핸즈프리 → 제거
```

배포 순서는 반드시 아래와 같이 한다.

```text
개발 완료
→ 개발팀 QA 전체 통과
→ Development 서버 배포
→ 대표님 직접 QA
→ 대표님 승인
→ Production 배포
```

대표님 승인 전 Production 배포 금지.

---

## 1. 구현 범위

### A. 부모 리포트 음성 듣기
- 일간 리포트
- 주간 리포트
- 빠른 요약
- 상세 보기
- 추천 가이드
- 각 현재 섹션 상단에 `음성으로 듣기` 버튼 제공
- 현재 화면에 실제 표시되는 유효 텍스트만 Browser TTS로 낭독

### B. K와의 대화
- 기존 텍스트 대화 유지
- 텍스트 모드 명칭을 `채팅`으로 변경
- 음성 모드 명칭을 `음성대화`로 변경
- 부모 음성 입력은 Browser STT
- K 답변 음성 출력은 Browser TTS
- 기존 `POST /api/parent/k-chat` 재사용
- 새로운 LLM 음성 파이프라인 생성 금지

---

## 2. 현재 구조 재사용

### 부모 리포트
- `app/parent/report/page.tsx`
- `app/parent/report/weekly/page.tsx`
- `components/ReportDetailModal.tsx`
- `app/parent/report/[id]/page.tsx`
- `app/parent/report/weekly/[id]/page.tsx`

공통 탭:
- 빠른 요약
- 상세 보기
- 추천 가이드

### K와의 대화
- `app/parent/guide/page.tsx`
- `POST /api/parent/k-chat`
- `hooks/useParentVoice.ts`

기존 STT/TTS 구현을 최대한 재사용하고 필요한 경우에만 공통 Hook으로 최소 리팩터링한다.

---

## 3. 리포트 `음성으로 듣기`

대기:

```text
[🔊 음성으로 듣기]
```

재생 중:

```text
[⏹ 정지]
```

1차 버전은 재생/정지만 제공하고 Pause/Resume은 제외한다.

한 번 누르면 현재 섹션의 실제 표시 내용을 처음부터 끝까지 읽는다.

### 읽지 않는 것
- 데이터 부족으로 숨긴 항목
- placeholder
- 버튼명
- 닫기 버튼
- 탭 UI
- 날짜 선택 UI
- FAQ
- 네비게이션
- 이모지
- bullet
- 장식 문자

REQUEST 031/033에서 숨긴 항목은 TTS에서도 제외한다.

---

## 4. 일간/주간 읽기 기준

### 일간 빠른 요약
- `summary_line`
- 실제 빠른 요약 본문

### 일간 상세 보기
- `buildMeaningfulReportSections()` 기준 실제 표시 중인 유효 섹션만
- 섹션 제목 → 본문 순서

### 일간 추천 가이드
- 부모 대화 실마리
- 부모용 추천 질문
- 오늘의 케이 코멘트
- 실제 화면에 표시되는 항목만

### 주간 빠른 요약
- `summary_text`
- 실제 표시 중인 주간 요약

### 주간 상세 보기
- `detail_text`
- 실제 표시 중인 유효 상세 카드

### 주간 추천 가이드
- `parent_conversation_clue`
- `recommended_questions`
- `weekend_activity_recommendation`
- 기타 실제 렌더링 중인 유효 콘텐츠

---

## 5. Browser TTS

사용:
- `window.speechSynthesis`
- `SpeechSynthesisUtterance`
- `lang = ko-KR`

Voice 우선순위:
1. `ko-KR`
2. Korean voice
3. 브라우저 기본 voice

`voiceschanged`를 처리하고 특정 OS voice 이름을 하드코딩하지 않는다.

긴 리포트는 문장 단위로 분할해 순차 재생한다.

---

## 6. TTS 텍스트 정제

TTS 전달 직전에만 정제한다.

- emoji 제거
- markdown 장식 제거
- bullet 제거
- HTML tag 제거
- 중복 whitespace 정리
- 불필요 특수문자 정리

DB 원본 데이터는 수정하지 않는다.

---

## 7. TTS Cleanup

다음 상황에서 현재 음성을 즉시 중단한다.

- 리포트 탭 변경
- 모달 닫기
- 다른 리포트 열기
- 자녀 변경
- route 이동
- K 음성대화 시작
- document hidden/background
- component unmount

탭 전환 시 새 탭을 자동 재생하지 않는다. 사용자가 다시 `음성으로 듣기`를 눌러야 한다.

---

## 8. K 대화 모드 명칭

기존:

```text
[타이핑] [핸즈프리]
```

최종:

```text
[채팅] [음성대화]
```

버튼명, 접근성 label, 안내 문구 등 동일 기능을 가리키는 용어를 전부 통일한다.

---

## 9. `채팅` 모드

```text
부모 = 키보드 타이핑
K = 텍스트 답변
```

Flow:

```text
텍스트 입력
→ 기존 POST /api/parent/k-chat
→ K 텍스트 응답
→ 말풍선 표시
```

자동 TTS 없음.

금지:
- 채팅 모드에서 STT 자동 실행
- 채팅 모드에서 K 답변 자동 TTS

---

## 10. `음성대화` 모드

```text
부모가 음성대화 선택
→ 마이크 탭
→ Browser STT
→ 부모 발화
→ final transcript
→ 기존 POST /api/parent/k-chat 자동 전송
→ K 텍스트 답변
→ 말풍선 표시
→ Browser TTS 자동 재생
```

즉 사용자 경험은:

```text
부모 음성 ↔ K 음성
```

백엔드는 기존 text API를 그대로 사용한다.

---

## 11. 음성 질문 전송

대표 확정:

```text
STT final result 확정
→ 별도 확인 없이 즉시 전송
```

단 transcript가 비었거나 STT 오류/인식 실패면 전송하지 않는다.

---

## 12. K 답변 자동 TTS 정책

### 음성대화
```text
부모 음성 질문
→ K 답변 수신
→ 자동 TTS
```

### 채팅
```text
부모 타이핑
→ K 답변 수신
→ 텍스트만 표시
→ 자동 TTS 없음
```

---

## 13. Browser STT

기존:
- `SpeechRecognition`
- `webkitSpeechRecognition`
- `ko-KR`

필수 상태:
- idle
- listening
- processing
- speaking
- error

UI 상태 예:
- 듣는 중
- 생각 중
- K가 말하는 중

---

## 14. Barge-in

K가 말하는 중 부모가 마이크를 누르면:

```text
K TTS 즉시 중단
→ listening 전환
→ 새 음성 입력
```

마이크 시작 전에 `stopSpeaking()`을 실행한다.

STT와 TTS 동시 실행 금지.

---

## 15. 리포트 TTS와 K TTS 충돌 방지

동시에 두 음성이 재생되면 안 된다.

```text
리포트 듣기 시작 → 기존 K TTS cancel
K 음성대화 시작 → 기존 리포트 TTS cancel
K 답변 TTS 시작 → 기존 speechSynthesis cancel 후 시작
```

가능하면 공통 Speech Controller/Hook 사용.

---

## 16. Feature Detection / Fallback

### TTS 미지원
- `음성으로 듣기` 숨김 또는 disabled
- 텍스트 리포트 정상 유지

### STT 미지원
- `음성대화` disabled 또는 지원 불가 안내
- `채팅` 정상 유지

### 마이크 권한 거부
```text
마이크 권한을 허용해주세요.
채팅 모드는 계속 사용할 수 있어요.
```

---

## 17. 필수 브라우저 QA

- iPhone Safari
- iPhone PWA
- Android Chrome
- Desktop Chrome
- Desktop Safari

검증:
- 사용자 gesture 기반 첫 실행
- background 전환 시 안전 중단
- 장문 TTS 문장 큐
- STT/TTS 미지원 fallback
- 모드 전환 cleanup

---

## 18. 운전/이동 상황 UX

- 큰 `음성으로 듣기` 버튼
- 조작 최소화
- 재생/정지 중심
- 불필요한 플레이어 UI 금지
- 현재 섹션 한 번에 완독
- 음성대화는 마이크 → 질문 → 자동 전송 → K 자동 음성 답변

CarPlay/Android Auto는 이번 범위 아님.

---

## 19. UI 원칙

```text
시각적 정렬과 가독성을 위한 적절한 여백은 유지
의미 없이 휑하게 차지하는 공백은 제거
```

- 큰 빈 wrapper 금지
- 과도한 고정 height 금지
- 숨긴 요소 공간 잔존 금지
- 본문 폭 불필요 축소 금지

---

## 20. 개인정보 / 보안

- raw audio 서버 저장 금지
- STT 결과 텍스트만 기존 K Chat API에 전달
- 기존 `parent_k_chat_messages` 정책 유지
- 마이크 권한은 사용자 명시 동작으로 요청
- 비밀키/토큰 노출 금지

---

## 21. 금지 사항

- `타이핑` 명칭 유지 금지
- `핸즈프리` 명칭 유지 금지
- Cloud STT/TTS 신규 도입 금지
- Gemini Live 신규 연결 금지
- 기존 K text API 교체 금지
- raw audio 서버 저장 금지
- 채팅 모드 K 답변 자동 TTS 금지
- 숨긴 리포트 항목 낭독 금지
- 화면 이동 후 음성 지속 금지
- 대표님 승인 전 Production 배포 금지

---

## 22. 개발 QA

### 리포트 TTS
- 일간 빠른 요약 PASS
- 일간 상세 PASS
- 일간 추천 가이드 PASS
- 주간 빠른 요약 PASS
- 주간 상세 PASS
- 주간 추천 가이드 PASS
- 숨김 항목 미낭독 PASS
- 탭 전환 시 정지 PASS
- 모달 닫기 시 정지 PASS
- 자녀 전환 시 정지 PASS
- route 이동 시 정지 PASS
- 긴 텍스트 완독 PASS

### 채팅
- 버튼명 `채팅`
- 키보드 입력 정상
- 기존 API 정상
- K 텍스트 답변
- 자동 TTS 없음

### 음성대화
- 버튼명 `음성대화`
- Browser STT 정상
- final transcript 자동 전송
- 기존 K API 재사용
- K 텍스트 답변 화면 표시
- K 답변 자동 TTS
- barge-in
- 마이크 권한 거부 fallback
- STT 미지원 fallback
- 모드 변경 cleanup

---

## 23. Development 배포 전 Gate

- [ ] 타입체크 PASS
- [ ] 빌드 PASS
- [ ] unit test PASS
- [ ] 리포트 TTS E2E PASS
- [ ] 채팅 모드 회귀 PASS
- [ ] 음성대화 E2E PASS
- [ ] iPhone Safari PASS
- [ ] iPhone PWA PASS
- [ ] Android Chrome PASS
- [ ] Desktop Chrome PASS
- [ ] 기존 리포트 기능 회귀 PASS
- [ ] BLOCKER/HIGH 0건

모두 통과하면 Production이 아니라 Development 서버에 먼저 배포한다.

---

## 24. Development 서버 배포 후 대표님 QA

Development 배포 후 작업을 멈추고 대표님 QA를 기다린다.

### 일간/주간 리포트
- 각 섹션 `음성으로 듣기`
- 표시 내용과 낭독 내용 일치
- 숨긴 항목 미낭독
- 정지/탭전환/모달닫기 정상

### K와의 대화
```text
[채팅] [음성대화]
```

채팅:
- 타이핑
- K 텍스트 답변

음성대화:
- 부모 음성 입력
- 자동 전송
- K 음성 답변

대표님 승인 전 Production 배포 금지.

---

## 25. Production 배포 Gate

```text
개발팀 QA PASS
+
Development 배포 완료
+
대표님 직접 QA PASS
+
대표님 명시적 Production 배포 승인
```

하나라도 없으면 Production 배포 금지.

---

## 26. 완료 기준

- [ ] 리포트 각 탭에 `음성으로 듣기`
- [ ] 현재 표시 콘텐츠만 낭독
- [ ] 숨김 항목 미낭독
- [ ] 긴 리포트 문장 큐
- [ ] 탭/모달/route/child 전환 cleanup
- [ ] K 대화 버튼 `채팅`
- [ ] K 대화 버튼 `음성대화`
- [ ] `타이핑` 제거
- [ ] `핸즈프리` 제거
- [ ] 채팅 = 텍스트↔텍스트
- [ ] 음성대화 = 음성↔음성
- [ ] 음성 질문 자동 전송
- [ ] 음성 질문 K 답변 자동 TTS
- [ ] 채팅 질문 자동 TTS 없음
- [ ] barge-in 정상
- [ ] fallback 정상
- [ ] Development 배포 완료
- [ ] 대표님 QA 전 Production 미배포

---

## 27. 완료 보고 형식

### 최종 판정
`DEV_READY / DEV_DEPLOYED / PROD_READY / PASS / PARTIAL / FAIL`

### 수정 파일
| 파일 | 변경 내용 | 이유 |
|---|---|---|

### 리포트 음성 듣기
| 항목 | 결과 |
|---|---|
| 일간 빠른 요약 | |
| 일간 상세 | |
| 일간 추천 가이드 | |
| 주간 빠른 요약 | |
| 주간 상세 | |
| 주간 추천 가이드 | |
| 숨김 항목 제외 | |
| 장문 큐 | |
| cleanup | |

### K와의 대화
| 항목 | 결과 |
|---|---|
| 채팅 명칭 | |
| 음성대화 명칭 | |
| 채팅 텍스트 입력 | |
| 채팅 자동 TTS 없음 | |
| 음성 STT | |
| 자동 전송 | |
| 기존 K API 재사용 | |
| K 자동 TTS | |
| barge-in | |
| fallback | |

### 배포
- 개발팀 QA:
- Development 배포:
- 대표님 QA:
- Production 승인:
- Production 배포:

### 최종 확인
- K 대화 모드명이 `채팅 / 음성대화`로 변경됐는가?
- `타이핑 / 핸즈프리` 명칭이 제거됐는가?
- 채팅 모드는 텍스트 입력/텍스트 답변인가?
- 음성대화 모드는 부모 음성/K 음성 방식인가?
- 음성 질문은 자동 전송되는가?
- 음성대화에서 K 답변은 자동 TTS 되는가?
- 채팅 모드에서는 자동 TTS 하지 않는가?
- 일간/주간 리포트 각 섹션을 음성으로 들을 수 있는가?
- 숨김 리포트 항목은 읽지 않는가?
- STT/TTS 미지원 시 기존 텍스트 기능은 유지되는가?
- Development 서버 배포가 완료됐는가?
- 대표님 QA 승인 전 Production 배포를 하지 않았는가?
