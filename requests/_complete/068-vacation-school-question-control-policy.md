# 068 - 방학·개학일 기반 학교 질문 자동 제어

## 1. 목적

아이가 미션 또는 자유대화에서 “방학이라 학교에 안 간다”고 말했을 때 케이가 개학일을 확인하고, 확인 상태에 따라 학교 관련 질문을 자동 제어하도록 구현한다.

핵심 정책:

```text
방학이라고 말함
→ 그날 남은 학교 질문 중단
→ 개학일 질문

개학일을 모름
→ 장기 차단하지 않음
→ 같은 날에는 학교 질문과 개학일 재질문 금지
→ 다음 날부터 학교 질문 다시 가능
→ 아이가 다시 방학이라고 말하면 개학일 재확인

개학일을 알려줌
→ 개학일 전날까지 학교 질문 차단
→ 개학일 당일 또는 이후 첫 대화에서 실제 개학 여부 확인
→ 개학 확인 후 학교 질문 재개
```

단순 Prompt 수정으로 완료하지 않는다. 기간성 상태 저장, 질문 분류, 질문 선택 필터, 발화 직전 Guard, 실제 E2E QA가 모두 필요하다.

---

## 2. 적용 범위

### 아이 화면
- 미션 자동·수동 마이크
- 미션 텍스트 입력
- 자유대화 자동·수동 마이크
- 자유대화 텍스트 입력
- Live·비Live
- 세션 재진입·복원
- 기본 질문·예비 질문·재순환 질문
- 부모 질문 전달

### 질문 생성·선택
- 미션 질문 Selector
- 자유대화 후속 질문
- LLM 동적 후속 질문
- 이미 예약된 다음 질문
- 세션 복원 후 첫 질문

---

## 3. 확정 대화 흐름

### 3.1 방학 선언

```text
케이: 오늘 학교 갔다 왔어?
아이: 아니, 나 방학이야.
케이: 아, 방학이라 학교를 안 가는구나. 언제 개학해? 날짜를 알려주면 그때까지 학교 얘기는 안 물어볼게.
```

이 시점:

```text
상태 = VACATION_UNCONFIRMED
해당 business_date 남은 학교 질문 = 차단
장기 차단 = 미적용
개학일 질문 = 오늘 1회 완료
```

### 3.2 개학일을 모르는 경우

```text
아이: 개학 날짜는 잘 모르겠어.
케이: 알겠어. 개학 날짜를 알게 되면 알려줘. 그러면 그때까지 학교 얘기는 안 물어볼게.
```

정책:

```text
같은 날 학교 질문 = 0
같은 날 개학일 재질문 = 0
다음 business_date 학교 질문 = 다시 허용
장기 차단 = 미적용
```

다음 날 학교 질문 후 아이가 다시 “아직 방학이야”라고 정정하면 그날 학교 질문을 중단하고 개학일을 다시 확인한다.

### 3.3 개학일 제공

```text
아이: 8월 20일에 개학해.
케이: 알겠어. 8월 20일까지는 학교 얘기 안 물어볼게.
```

저장:

```text
status = VACATION_CONFIRMED
expected_school_start_date = 2026-08-20
school_question_block_until = 2026-08-19
```

### 3.4 개학일 당일 또는 이후

학교에 갔다고 자동 단정하지 않는다.

```text
케이: 오늘이 개학하는 날이라고 했지. 이제 학교 갔어?
아이: 응, 오늘 개학했어.
케이: 그렇구나. 오랜만에 학교 가니까 어땠어?
```

확인 후:

```text
VACATION_CONFIRMED → SEMESTER
학교 질문 재개
```

개학이 연기되었다면:

```text
아이: 아니, 개학이 미뤄졌어.
케이: 그렇구나. 그럼 언제 개학해?
```

새 날짜를 받아 갱신한다.

---

## 4. 상태 정의

```text
SEMESTER
VACATION_UNCONFIRMED
VACATION_CONFIRMED
SCHOOL_START_CONFIRMATION_DUE
```

### SEMESTER
- 학교 질문 허용

### VACATION_UNCONFIRMED
- 방학은 확인
- 개학일 미확인
- 해당 business_date만 학교 질문 차단
- 다음 business_date부터 학교 질문 재허용

### VACATION_CONFIRMED
- 개학일 확인 완료
- 오늘 < expected_school_start_date 동안 학교 질문 차단

### SCHOOL_START_CONFIRMATION_DUE
- 오늘 >= expected_school_start_date
- 학교 질문 즉시 재개 금지
- 개학 여부 확인 질문 우선
- 확인 전까지 학교 질문 보류

---

## 5. 데이터 구조

일반 `memory_facts`만으로 처리하지 않는다. 기간과 날짜에 따라 질문 행동이 달라져야 하므로 별도 기간성 Context를 사용한다.

권장 테이블:

```text
child_temporal_context
```

권장 컬럼:

```text
id
child_id
context_type
status
expected_school_start_date
school_question_block_until
confirmation_status
last_asked_business_date
source_session_id
source_message_id
created_at
updated_at
expired_at
```

제약:

```text
child_id + context_type 기준 active row 1개
```

기존 active row가 있으면 중복 생성하지 말고 멱등적으로 갱신한다.

---

## 6. 발화 이벤트 감지

공통 대화 처리 단계에서 다음을 감지한다.

### 방학
- 방학이야
- 학교 안 가
- 여름방학이야
- 겨울방학이야
- 아직 방학이야
- 개학 전이야

### 개학일 모름
- 잘 모르겠어
- 날짜 몰라
- 기억 안 나
- 엄마가 알아

### 개학일 제공
- 8월 20일
- 20일에 개학해
- 다음 주 월요일
- 이번 달 말

### 개학 확인
- 오늘 개학했어
- 이제 학교 다녀
- 학교 갔다 왔어

### 개학 연기
- 개학 미뤄졌어
- 날짜 바뀌었어
- 아직 방학이야

LLM을 사용하면 반드시 구조화 결과로 반환한다.

```json
{
  "eventType": "VACATION_DECLARED",
  "schoolStartDate": null,
  "needsSchoolStartDateFollowUp": true
}
```

날짜가 모호하면 저장 전에 한 번 확인한다.

---

## 7. 질문지 분류

학교 질문을 삭제하지 않는다. 기존 질문에 Context 태그를 추가한다.

```text
school_required
school_optional
universal
vacation_preferred
```

예:

| 질문 | 분류 |
|---|---|
| 오늘 학교에서 무슨 일이 있었어? | school_required |
| 급식은 어땠어? | school_required |
| 쉬는 시간에 누구랑 놀았어? | school_required |
| 오늘 누구랑 놀았어? | universal |
| 오늘 가장 재미있었던 일은 뭐야? | universal |
| 방학 동안 해보고 싶은 게 있어? | vacation_preferred |

질문 문구가 DB·JSON·코드·Prompt에 분산돼 있으면 전수 조사한다.

---

## 8. 질문 선택 로직

```text
child_id
→ KST business_date
→ active temporal context 조회
→ 학교 질문 가능 여부 결정
→ 질문 Context 필터
→ 학년별 정책
→ 최근 질문 중복 제거
→ 최종 질문
```

### VACATION_UNCONFIRMED

```text
같은 business_date → school_required 제외
다음 business_date → school_required 다시 허용
```

### VACATION_CONFIRMED

```text
오늘 < expected_school_start_date
→ school_required 제외
```

### SCHOOL_START_CONFIRMATION_DUE

```text
개학 여부 확인 질문 우선
확인 전 school_required 제외
```

---

## 9. 발화 직전 Guard

질문 Selector만 믿지 않는다.

이미 예약된 질문·세션 복원 질문·LLM 동적 질문도 발화 직전에 다시 검사한다.

```text
학교 질문 차단 상태
+
선택 질문 = school_required
→ 질문 폐기
→ universal 또는 vacation_preferred 질문으로 교체
```

---

## 10. 반복 방지

```text
개학일 질문 = 하루 최대 1회
```

아이가 “모르겠어”라고 답한 날에는 다시 묻지 않는다.

금지:

```text
같은 세션에서 반복 질문
같은 날 여러 번 개학일 질문
학교 질문 직후 또 학교 질문
```

---

## 11. 학년별 말투

기존 1~6학년 Grade Policy를 적용한다.

예:

```text
1학년: 아, 방학이구나! 언제 학교 다시 가?
2학년: 방학이라 학교를 안 가는구나. 언제 개학해?
3학년: 아, 지금 방학이구나. 개학하는 날짜를 알고 있어?
4학년: 방학이라 학교를 안 가는구나. 언제 개학하는지 알려주면 그때까지 학교 얘기는 안 물어볼게.
5학년: 아직 방학 중이구나. 개학일을 알려주면 그전까지 학교 관련 질문은 하지 않을게.
6학년: 지금은 방학이구나. 개학 날짜를 알려주면 그때까지 학교 이야기는 묻지 않을게.
```

---

## 12. LLM과 코드 역할

### LLM
- 방학·개학 자연어 의미 추출
- 상대 날짜 해석
- 학년별 자연스러운 후속 질문
- 모호한 날짜 재확인

### 코드·DB
- 상태 저장
- 날짜 비교
- 당일 차단
- 기간 차단
- 다음 날 재허용
- 질문 필터
- 같은 날 반복 방지
- 개학 확인 후 상태 전환

금지:

```text
매번 LLM 판단에만 의존
Prompt 한 줄 추가만으로 완료
```

---

## 13. 기존 정책 유지

- 미션 유효 답변 10개 완료
- 기본 10개 → 예비 10개 → 미답변 재순환
- 고정 감사 문구 매턴 금지
- 1~6학년별 대화 정책
- LLM WIKI 기억 활용
- 모르는 정보 추측 금지
- 한 번에 질문 1개

학교 질문이 차단돼도 다른 질문으로 미션 완료가 가능해야 한다.

---

## 14. Dev QA 시나리오

### A. 방학 선언 + 개학일 모름

1. 케이: `오늘 학교 갔다 왔어?`
2. 아이: `아니, 나 방학이야.`
3. 기대:
   - 방학 인식
   - 개학일 질문
   - 당일 남은 학교 질문 0
4. 아이: `개학 날짜는 잘 모르겠어.`
5. 기대:
   - 같은 날 개학일 재질문 0
   - 같은 날 학교 질문 0
   - 장기 차단 0
6. 다음 business_date:
   - 학교 질문 다시 가능
7. 아이가 `아직 방학이야`라고 정정:
   - 해당 날짜 학교 질문 중단
   - 개학일 재확인

### B. 개학일 제공

아이:

```text
8월 20일에 개학해.
```

기대:

```text
VACATION_CONFIRMED
expected_school_start_date = 2026-08-20
school_question_block_until = 2026-08-19
```

8월 19일까지 `school_required` 노출 0.

### C. 개학일 확인

현재 날짜가 개학일 이상이면:

```text
학교 질문 즉시 재개 0
개학 여부 확인 질문 우선
```

아이가 개학 확인 후에만 `SEMESTER` 전환.

### D. 개학 연기
- 새 개학일 질문
- 기존 날짜 갱신
- 확인 전 학교 질문 보류

### E. 세션 복원
- 기존 예약 질문이 학교 질문이어도 Guard가 차단
- 대체 질문으로 교체

### F. 질문 순환
- 기본·예비·재순환 모두 필터 적용
- 학교 질문 차단 상태에서도 유효 답변 10개 완료

### G. 아이 간 격리
- TestA 방학
- TestB 학기 중
- TestA만 학교 질문 차단
- 교차 child_id 상태 혼입 0

---

## 15. 오류 코드

```text
VACATION_NOT_DETECTED
SCHOOL_START_DATE_NOT_ASKED
UNKNOWN_DATE_NOT_HANDLED
SAME_DAY_REASK
SAME_DAY_SCHOOL_QUESTION_LEAK
UNCONFIRMED_LONG_TERM_BLOCK
CONFIRMED_BLOCK_NOT_APPLIED
SCHOOL_QUESTION_FILTER_FAIL
PRE_SPEECH_GUARD_FAIL
SCHOOL_START_CONFIRMATION_MISSING
SCHOOL_QUESTION_RESUMED_TOO_EARLY
SCHOOL_QUESTION_NOT_RESUMED
VACATION_CONTEXT_DUPLICATED
CROSS_CHILD_TEMPORAL_CONTEXT
GRADE_POLICY_NOT_APPLIED
```

---

## 16. 작업 순서

```text
1. 현재 질문지 저장 구조 조사
2. 학교 관련 질문 전체 식별
3. Context 태그 추가
4. child_temporal_context Migration
5. 미션·자유대화 공통 상태 감지
6. 개학일 확인 흐름
7. 당일 차단
8. 기간 차단
9. 질문 Selector 필터
10. 발화 직전 Guard
11. 학년별 말투 적용
12. 단위 테스트
13. Dev 배포
14. 실제 UI E2E
15. 실패 수정
16. 전체 재검증
17. Dev PASS 후 Production 배포
```

---

## 17. Production 배포 조건

```text
방학 발화 감지 PASS
개학일 질문 PASS
날짜 모름 처리 PASS
당일 학교 질문 차단 PASS
다음 날 학교 질문 재허용 PASS
개학일 제공 시 기간 차단 PASS
개학일 전 학교 질문 0
개학일 이후 확인 질문 PASS
개학 확인 후 학교 질문 재개 PASS
개학 연기 갱신 PASS
세션 복원 Guard PASS
기본·예비·재순환 필터 PASS
아이 간 격리 PASS
1~6학년 말투 PASS
```

---

## 18. 최종 보고 형식

첫 줄:

```text
방학·개학일 기반 학교 질문 제어 전체 정상
당일 차단 실패
개학일 기간 차단 실패
개학 확인 전 학교 질문 노출
일부 경로 미적용
전체 실패
```

### 변경 파일

| 파일 | 변경 내용 | Dev | Production |
|---|---|---|---|

### 질문지 분류

```text
전체 질문:
school_required:
school_optional:
universal:
vacation_preferred:
미분류:
```

### 적용 경로

| 경로 | 상태 감지 | 질문 필터 | 최종 Guard | QA |
|---|---|---|---|---|
| 미션 자동 마이크 | | | | |
| 미션 수동 마이크 | | | | |
| 미션 텍스트 | | | | |
| 자유대화 자동 마이크 | | | | |
| 자유대화 수동 마이크 | | | | |
| 자유대화 텍스트 | | | | |
| Live | | | | |
| 비Live | | | | |
| 세션 복원 | | | | |

### 핵심 결과

```text
방학 선언 감지:
개학일 질문:
개학일 모름:
같은 날 재질문:
같은 날 학교 질문:
다음 날 학교 질문:
개학일 제공:
기간 차단:
개학일 확인:
학교 질문 재개:
개학 연기:
아이 간 격리:
전체 결과:
```

---

## 19. 절대 금지

- “방학이야” 한마디만으로 무기한 차단
- 개학일을 모르는 아이에게 같은 날 반복 질문
- 개학일을 모른다고 다음 날도 자동 차단
- 개학일에 바로 학교 질문 재개
- 개학 확인 없이 semester 자동 전환
- 학교 질문 전체 삭제
- Prompt 수정만으로 완료
- 일부 입력 경로만 적용
- 세션 복원 Guard 생략
- 코드 존재만으로 PASS
