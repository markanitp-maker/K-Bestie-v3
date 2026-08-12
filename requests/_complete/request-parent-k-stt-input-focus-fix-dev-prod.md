# 부모–케이 대화 STT 입력창 포커스 의존 제거 및 Dev·Production 적용 요청

## 1. 작업 목적

부모–케이 대화 화면에서 마이크 버튼을 사용할 때, 사용자가 입력창을 먼저 터치했는지와 관계없이 음성 인식 결과가 항상 채팅 입력창에 유지되도록 수정한다.

현재 Development와 Production 모두 동일한 문제가 있으므로, 공통 코드 원인을 수정한 뒤 두 환경에 모두 적용하고 실제 동작을 검증한다.

## 2. 현재 문제

### 재현 A — 입력창을 먼저 터치한 경우

```text
채팅 입력창 터치
→ 입력창 focus 생성
→ 마이크 버튼 클릭
→ 음성 입력
→ 중지 버튼 클릭
→ 인식된 텍스트가 입력창에 표시됨
```

### 재현 B — 입력창을 먼저 터치하지 않은 경우

```text
입력창을 터치하지 않음
→ 마이크 버튼 바로 클릭
→ 음성 입력
→ 중지 버튼 클릭
→ 인식된 텍스트가 입력창에도 없고 채팅에도 전송되지 않음
→ transcript가 사라짐
```

확인된 환경:

```text
Development: 재현됨
Production: 재현됨
```

## 3. 요구 동작

입력창 선터치 여부와 무관하게 아래 두 경로가 완전히 동일하게 동작해야 한다.

```text
입력창 터치 후 마이크 사용
→ final transcript가 입력창에 표시

마이크 버튼 바로 사용
→ final transcript가 입력창에 표시
```

최종 정책:

```text
마이크 중지
→ final transcript 확정
→ 채팅 입력 state에 반영
→ 입력창에 텍스트 유지
→ 자동 전송 금지
→ 사용자가 전송 버튼을 눌렀을 때만 채팅 메시지 전송
```

## 4. 핵심 수정 원칙

현재 포커스된 DOM 요소나 `document.activeElement`에 의존해 STT 결과를 삽입하지 않는다.

채팅 입력값을 React 상태 또는 현재 앱의 단일 입력 상태를 기준으로 관리하고, STT 결과를 해당 상태에 직접 반영한다.

필수 원칙:

1. 입력창 focus 여부와 STT 결과 저장을 분리한다.
2. `final transcript`를 입력창 상태에 직접 반영한다.
3. 마이크 중지 후 cleanup보다 입력 상태 반영이 먼저 완료돼야 한다.
4. transcript 초기화는 입력창 반영 이후에만 실행한다.
5. 마이크 중지 시 `sendMessage()`를 자동 호출하지 않는다.
6. 기존 입력 문장이 있으면 STT 결과를 자연스럽게 이어 붙인다.
7. 빈 transcript는 입력하지 않는다.
8. 중복 `onresult`, `onend`, `stop` 호출로 같은 문장이 두 번 추가되지 않도록 한다.
9. 모바일 자체 STT·브라우저 STT 등 현재 지원 경로 모두 동일한 입력 상태 반영 함수를 사용한다.
10. Development와 Production에서 환경별 분기 없이 동일하게 동작해야 한다.

## 5. 구현 방향

정확한 파일명과 상태 변수명은 현재 코드를 먼저 확인한 뒤 적용한다. 추측한 API나 존재하지 않는 훅을 새로 만들지 않는다.

권장 구조:

```text
STT interim result
→ 임시 표시 상태에만 반영 가능

STT final result
→ appendTranscriptToInput(finalTranscript)
→ 채팅 입력 state 갱신

STT stop/onend
→ 남아 있는 final transcript 반영 여부 확인
→ STT 전용 임시 상태 초기화
→ 채팅 입력 state는 유지
```

개념 예시:

```ts
const appendTranscriptToInput = (transcript: string) => {
  const normalized = transcript.trim();

  if (!normalized) {
    return;
  }

  setInputValue((previous) => {
    const current = previous.trimEnd();
    return current ? `${current} ${normalized}` : normalized;
  });
};
```

마이크 버튼 클릭 시 입력창 focus를 주는 것은 UX 보조로 사용할 수 있지만, 이것만으로 해결하지 않는다.

```ts
inputRef.current?.focus();
startRecognition();
```

핵심은 `inputRef.current?.focus()`가 아니라 final transcript를 입력 state에 직접 저장하는 것이다.

## 6. 점검 대상

- 부모–케이 대화 입력 컴포넌트
- 마이크 시작 버튼 handler
- 마이크 중지 버튼 handler
- 모바일 자체 STT callback
- 브라우저 SpeechRecognition `onresult`
- `onend`, `onerror`, `finally`, cleanup
- `resetTranscript`, `setTranscript("")` 등 초기화
- 입력창 `value`와 `onChange`
- input/textarea ref
- `document.activeElement` 또는 focus 기반 삽입 코드
- 마이크 중지 시 자동 전송 코드
- Development/Production feature flag 또는 환경 분기

## 7. 상태 처리 요구사항

### 신규 음성 입력

```text
기존 입력값 없음
STT 결과: "서현이가 오늘 학교에서 어땠는지 궁금해"

최종 입력창:
서현이가 오늘 학교에서 어땠는지 궁금해
```

### 기존 텍스트 뒤에 추가

```text
기존 입력값:
서현이에게

STT 결과:
오늘 학교에서 재미있었던 게 있었는지 물어봐 줘

최종 입력창:
서현이에게 오늘 학교에서 재미있었던 게 있었는지 물어봐 줘
```

### 중지 후 유지

- 중지 버튼을 누른 뒤에도 입력창 값 유지
- 마이크를 다시 시작해도 기존 입력값 유지
- 사용자가 직접 삭제하거나 전송하기 전까지 유지
- 불필요한 재렌더링으로 값이 초기화되지 않도록 확인

### 자동 전송 금지

```text
마이크 중지
→ STT 결과 즉시 채팅 메시지 생성
```

위 동작은 금지한다. 사용자가 전송 버튼을 누른 경우에만 기존 텍스트 전송 로직을 호출한다.

## 8. 오류 처리

- 마이크 권한 거부 시 기존 입력값을 삭제하지 않는다.
- STT 오류가 발생해도 기존 입력값을 삭제하지 않는다.
- 빈 결과로 종료돼도 기존 입력값을 삭제하지 않는다.
- `onerror`와 `onend`가 연속 호출돼도 입력값을 초기화하지 않는다.
- 중복 callback으로 같은 transcript가 두 번 추가되지 않도록 final result 식별 또는 반영 여부를 관리한다.

## 9. 테스트 시나리오

### A. 입력창 선터치 없음

1. 부모–케이 대화 화면 진입
2. 입력창을 한 번도 터치하지 않음
3. 마이크 버튼 클릭
4. 문장 발화
5. 중지 버튼 클릭
6. 발화 문장이 입력창에 표시되는지 확인
7. 전송 버튼 클릭 전 채팅 메시지가 생성되지 않았는지 확인

### B. 입력창 선터치 있음

1. 입력창 터치
2. 마이크 버튼 클릭
3. 동일 문장 발화
4. 중지
5. A와 동일한 결과인지 확인

### C. 기존 입력값 존재

1. 입력창에 텍스트 일부 직접 입력
2. 마이크 사용
3. 중지
4. 기존 문장 뒤에 음성 문장이 자연스럽게 추가되는지 확인

### D. 재녹음

1. 첫 번째 음성 입력 후 중지
2. 입력값 유지 확인
3. 마이크 다시 시작
4. 두 번째 문장 발화 후 중지
5. 첫 번째 문장 뒤에 두 번째 문장이 추가되는지 확인

### E. 빈 음성·오류

- 말하지 않고 중지
- 권한 거부
- 네트워크 또는 STT 오류
- `onerror → onend` 연속 발생

각 경우 기존 입력값이 사라지지 않아야 한다.

### F. 자동 전송 방지

- 마이크 중지 후 네트워크 메시지 전송 요청 0건
- 채팅 메시지 DB 저장 0건
- 케이 응답 생성 0건
- 전송 버튼 클릭 후에만 기존 전송 흐름 실행

## 10. 검증 환경

### Development

- 모바일 브라우저
- 설치형 PWA
- PC Chrome
- 입력창 선터치 있음/없음
- 신규 입력/기존 입력 뒤 추가
- 중지/오류/재녹음

### Production

- 모바일 브라우저
- 설치형 PWA
- PC Chrome
- 입력창 선터치 있음/없음
- 신규 입력/기존 입력 뒤 추가
- 중지/오류/재녹음

iOS Safari와 Android Chrome은 사용 가능한 테스트 기기가 있으면 각각 확인한다.

## 11. 배포 순서

1. 현재 Development와 Production의 배포 Commit 및 음성 입력 코드 경로 확인
2. 공통 원인 분석
3. Development 코드 수정
4. 타입 검사·린트·빌드 실행
5. Development 배포
6. Development 실제 브라우저 E2E 검증
7. 기존 부모–케이 텍스트 전송 회귀 검증
8. 검증된 동일 Commit을 Production에 반영
9. Production 배포
10. Production 실제 모바일·PWA·PC 검증
11. Dev와 Production 동작이 동일함을 결과 보고

Development에서만 수정하고 종료하지 않는다. Production 배포와 실제 동작 확인까지 이번 작업 범위에 포함한다.

## 12. 완료 기준

- [ ] 입력창을 먼저 터치하지 않아도 STT 결과가 입력창에 표시됨
- [ ] 입력창을 먼저 터치한 경우와 결과가 동일함
- [ ] 마이크 중지 후 입력값이 사라지지 않음
- [ ] 기존 입력값 뒤에 음성 문장이 자연스럽게 추가됨
- [ ] 자동 채팅 전송 없음
- [ ] 전송 버튼 클릭 시에만 메시지 전송
- [ ] 빈 음성·권한 거부·오류 발생 시 기존 입력값 유지
- [ ] 중복 callback으로 문장 중복 추가 없음
- [ ] Development 실제 검증 PASS
- [ ] Production 실제 검증 PASS
- [ ] 모바일 브라우저·PWA·PC 회귀 검증 PASS

## 13. 결과 보고 형식

```text
1. 확인한 실제 원인
2. 수정한 파일과 함수
3. 기존 focus 의존 코드
4. 변경한 입력 state 처리 구조
5. 자동 전송 방지 확인
6. Development 배포 Commit/URL
7. Development 테스트 결과
8. Production 배포 Commit/URL
9. Production 테스트 결과
10. 모바일 브라우저·PWA·PC별 결과
11. 남은 제한사항
```

보안 환경변수, API key, 토큰, 비밀번호는 평문 하드코딩·로그 출력·임시 파일 저장을 금지한다. 기존 Secret Manager, Vercel/Supabase Secrets 또는 안전한 런타임 환경변수만 사용하고 값은 마스킹한다.
