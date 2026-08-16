032-fix-report-mixed-language-validation-and-regeneration.md

# 리포트 한글·일본어 혼합 생성 방지 및 문제 주간 리포트 재생성

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

부모에게 노출되는 일일/주간 리포트는 자연스러운 한국어 문장으로 생성되어야 하며, 아래와 같은 한글+일본어 혼합 표현이 더 이상 저장·노출되면 안 된다.

문제 사례:

```text
학업 면에서는 영어の実力 향상에 뿌듯함을 느끼면서도...
```

수정 후 기대:

```text
학업 면에서는 영어 실력 향상에 뿌듯함을 느끼면서도...
```

핵심 동작:

```text
리포트 LLM 생성
→ 언어 무결성 검사
→ 정상 한국어
   → DB 저장
→ 일본어/비의도 외국어 혼입
   → 저장 금지
   → 재생성
   → 재검사
   → PASS 시 저장
```

현재 문제로 확인된 Production 주간 리포트 1건은 수정 배포 후 동일 source를 기준으로 재생성한다.

### 대표님 테스트 정상 프로세스

1. 부모 계정으로 로그인한다.
2. `리포트 > 주간`으로 이동한다.
3. 문제 리포트를 연다.
4. 기존 `영어の実力` 같은 일본어 혼합 문자가 사라졌는지 확인한다.
5. 문장이 자연스러운 한국어로 표시되는지 확인한다.
6. 다른 일일/주간 리포트에서도 일본어 문자 혼입이 없는지 확인한다.
7. 기존 정상 리포트 내용이 임의로 변경되지 않았는지 확인한다.

PASS:

- 문제 주간 리포트가 자연스러운 한국어로 재생성됨
- 신규 일일/주간 리포트에 일본어 혼입 방어 적용
- 비정상 언어가 검출되면 DB 저장 전 차단
- 영향 없는 기존 리포트는 변경하지 않음

---

## 1. 상태 / 우선순위 / 대상

- 상태: 신규 수정 요청
- 우선순위: HIGH
- 대상: Production 리포트 생성 파이프라인
- 영향 범위:
  - Weekly Report Gemini 생성
  - Daily Report Gemini 생성
  - batch systemInstruction
  - report safety/validation
  - retry
  - 문제 Production 주간 리포트 1건 재생성

---

## 2. 확인된 Root Cause

읽기 전용 Production 진단 결과 최초 혼입 지점이 확정되었다.

경로:

```text
Raw STT
→ 정상 한글

Context Correction
→ 정상 한글

Memory / LLM Wiki
→ 정상 한글

Daily Report
→ 정상 한글

Weekly Report Gemini 생성
→ 최초 일본어 혼입: 영어の実力

weekly_summaries DB
→ 혼합 문자열 그대로 저장

API
→ 그대로 전달

UI
→ 그대로 렌더링
```

직접 원인:

```text
Weekly Report LLM 생성 단계의 code-mixing
+
한국어 강제 prompt 부족
+
저장 전 언어 무결성 validation 부재
+
언어 이상 발생 시 retry 부재
```

UI 문제로 처리하지 않는다.

---

## 3. Production 영향 범위

진단 결과:

- daily_reports 일본어 혼입: 0건
- weekly_summaries 일본어 혼입: 1건
- corrected conversation 혼입: 0건
- memory 혼입: 0건
- raw/chat 혼입: 0건
- 영향 사용자: 1명
- 최초 혼입 단계: Weekly Report Gemini

현재 문제 리포트:

- 테이블: `weekly_summaries`
- 대상 주간: `2026-08-01 ~ 2026-08-07`
- 문제 필드: `detail_text`
- 문제 표현: `영어の実力`

실제 report ID / child ID는 현재 Production에서 재확인하고 로그에서는 마스킹한다.

---

## 4. 목표

이번 작업은 다음 4가지를 모두 완료한다.

1. 리포트 생성 prompt에서 출력 언어를 자연스러운 한국어로 명확하게 제한
2. 저장 전 언어 무결성 validation 추가
3. 이상 언어 검출 시 저장하지 않고 자동 재생성/retry
4. 기존 문제 주간 리포트 1건만 안전하게 재생성

---

## 5. Prompt 강화

현재 실제 사용 중인 일일/주간 리포트 prompt를 확인한다.

최소 대상:

- `WEEKLY_REPORT_PROMPT_TEMPLATE`
- daily report prompt
- 실제 batch에서 호출되는 `systemInstruction`
- 동일 report model을 사용하는 공통 instruction

다음 원칙을 명확히 추가한다.

```text
모든 사용자 노출 텍스트는 자연스러운 한국어로 작성한다.
한국어 문장 안에 일본어 히라가나/가타카나 또는 비의도 한자 표현을 혼합하지 않는다.
원본 대화 의미는 보존하되 번역투·일본어식 표현·혼합언어 표현을 생성하지 않는다.
리포트 용어는 한국어 표현을 우선 사용한다.
```

중요:

- JSON 구조 지시와 언어 지시를 둘 다 유지한다.
- 단순히 prompt에 한 줄 추가하고 끝내지 않는다.
- 저장 전 validation을 반드시 함께 구현한다.

---

## 6. batch systemInstruction 강화

현재 batch systemInstruction이 JSON 형식만 강제하고 언어 제약이 없다면 수정한다.

예상 개념:

```text
반드시 지정된 JSON schema에 맞춰 응답한다.
사용자에게 노출되는 모든 텍스트 필드는 자연스러운 한국어로만 작성한다.
일본어 히라가나/가타카나 및 비의도 외국어 혼용을 금지한다.
```

실제 코드 구조와 model router 패턴을 따른다.

---

## 7. 저장 전 언어 무결성 Validation

리포트 LLM 응답을 DB에 저장하기 전에 전체 사용자 노출 텍스트를 검사한다.

최소 탐지:

### 일본어 Hiragana

```regex
[぀-ゟ]
```

### 일본어 Katakana

```regex
[゠-ヿ]
```

### 주의가 필요한 CJK 한자

한자는 한국어에서도 일부 고유명사/표현에 의도적으로 등장할 가능성이 있으므로 Hiragana/Katakana처럼 단순 전면 reject하지 않는다.

비의도 CJK 혼입 검사는 다음 원칙으로 설계한다.

- 한글 문장 한가운데 일본어식 조사/문형과 함께 등장
- source에 없는 한자어가 모델 생성 단계에서 새로 생김
- 정상 한국어 표현으로 자연스럽게 대체 가능한 혼합 표현
- 명백한 일본어 문맥 pattern

무리한 전체 한자 차단은 하지 않는다.

---

## 8. Validation 적용 필드

검사는 리포트의 모든 사용자 노출 문자열 필드에 적용한다.

최소:

- summary
- detail_text
- dashboard/card summaries
- parent guide
- recommendation
- weekly summary fields
- daily report fields
- 기타 부모 UI에 그대로 노출되는 문자열

실제 schema를 확인해서 공통 recursive scanner를 사용한다.

특정 필드 하나만 검사하지 않는다.

---

## 9. 이상 검출 시 동작

비정상 언어가 검출되면 해당 LLM 응답을 DB에 저장하지 않는다.

정상 흐름:

```text
LLM generation attempt 1
→ language validation FAIL
→ 저장 금지

retry generation
→ language validation

PASS
→ 저장

FAIL
→ 제한된 횟수만 추가 retry
```

권장 retry:

- 최초 + 최대 2회 재시도

실제 기존 retry policy가 있으면 그 패턴에 맞춘다.

무한 재시도 금지.

---

## 10. Retry prompt

retry 시 단순 동일 prompt를 그대로 반복하지 말고 validation 실패 사실을 내부 지시로 보강한다.

예:

```text
이전 응답에 일본어 또는 비의도 외국어 문자가 포함되어 검증에 실패했다.
모든 사용자 노출 텍스트를 자연스러운 한국어로 다시 작성하라.
의미와 사실은 변경하지 않는다.
```

사용자 대화 원문은 불필요하게 추가 노출하지 않는다.

---

## 11. 최종 retry 실패 처리

최대 retry 후에도 validation FAIL이면:

- 비정상 리포트를 DB에 저장하지 않는다.
- job을 성공 처리하지 않는다.
- 명확한 generation/validation failure 상태를 남긴다.
- 자동 retry 가능한 기존 pipeline 구조가 있으면 해당 실패 경로를 사용한다.
- 실제 일본어 문자열 전체를 로그에 남기지 않는다.
- 오류 로그에는 field/path + detected script 정도만 기록한다.

잘못된 리포트를 저장하는 것보다 실패시키는 것이 우선이다.

---

## 12. 하드코딩 치환 금지

다음처럼 특정 문자열을 primary 해결책으로 사용하지 않는다.

```text
の → 의
実力 → 실력
```

이유:

- 다른 일본어 조사가 나오면 재발
- 다른 한자 조합이 나오면 재발
- 문맥에 따라 잘못된 치환 가능
- 근본 원인인 LLM code-mixing을 해결하지 못함

정상 해결:

```text
prompt 강화
+
validation
+
retry/regeneration
```

특정 normalize mapping은 예외적 fallback 용도로도 최소화한다.

---

## 13. 의도적인 외국어 표현 처리

제품 특성상 아이가 실제로 외국어 단어/고유명사를 말할 수 있으므로 무조건 모든 비한글 문자를 제거하면 안 된다.

예:

- Roblox
- YouTube
- MBTI
- 영어 제목
- 실제 고유명사

원칙:

```text
source에 실제 존재하는 의도된 외국어 고유명사
→ 보존 가능

LLM이 새로 만든 일본어 조사/혼합언어
→ validation FAIL
```

특히 Hiragana/Katakana가 원본 source에 실제 존재하는 경우는 source-aware 검토가 필요하다.

현재 내친구 케이 기본 리포트 정책상 부모용 서술 문장은 자연스러운 한국어를 우선한다.

---

## 14. Safety Guard 구조

기존 `reportSafetyGuard.ts` 또는 실제 공통 report validation 위치를 확인한다.

가능하면 다음을 분리한다.

```text
sanitizeReportJson
→ 기존 안전성/금칙어 처리

validateReportLanguageIntegrity
→ 언어 무결성 검사

validateReportSchema
→ schema 검증
```

각 책임을 명확히 분리한다.

언어 validation을 UI 컴포넌트에 넣지 않는다.

---

## 15. Daily + Weekly 공통 적용

이번 문제는 weekly에서 발생했지만 daily도 동일 LLM 계열을 사용하므로 방어는 공통으로 적용한다.

반드시:

- daily report
- weekly report

둘 다 저장 전 language validation을 통과해야 한다.

현재 daily report에 문제가 없었다는 이유로 제외하지 않는다.

---

## 16. 기존 문제 주간 리포트 재생성

코드 수정 및 Production 배포 후 현재 혼합언어가 저장된 문제 주간 리포트 1건만 재생성한다.

대상:

```text
week_start = 2026-08-01
week_end   = 2026-08-07
```

실제 문제 report row를 Production에서 다시 식별한다.

재생성 원칙:

- 동일 child
- 동일 week_start/week_end
- 정상 source data 사용
- raw/corrected/memory 수정 금지
- 다른 정상 weekly report 재생성 금지
- unrelated users 재생성 금지

재생성 후:

- Japanese char 0건
- 의미 보존
- 자연스러운 한국어
- DB 정상 저장
- 부모 UI 정상 표시

를 확인한다.

---

## 17. Production 전체 재검사

수정 후 Production 전체 일일/주간 리포트에 대해 언어 스캔을 다시 수행한다.

최소:

- daily_reports
- weekly_summaries

Hiragana/Katakana 검사 결과:

```text
daily_reports = 0
weekly_summaries = 0
```

이어야 한다.

과거 raw/corrected/memory는 변경하지 않고 regression 확인만 한다.

---

## 18. 기존 데이터 보호

이번 요청에서 수정하지 않는다.

- raw STT
- chat_messages
- corrected conversations
- memory_facts
- child_memory
- LLM Wiki
- 정상 daily reports
- 정상 weekly reports
- 부모 UI 레이아웃

문제 row 재생성 외 기존 리포트 일괄 재생성 금지.

---

## 19. 보안

- Service Role Key 하드코딩 금지
- API key/token 로그 출력 금지
- 임시 script에 secret 평문 저장 금지
- 기존 Production Secret/환경변수 사용
- 실제 아이 대화 원문 로그 출력 금지
- 문제 문자열 전체 report dump 금지
- ID는 완료 보고에서 마스킹

---

## 20. 필수 테스트

### A. 정상 한국어

입력:
```text
영어 실력이 늘었다고 느낀다.
```

결과:
- validation PASS

### B. Hiragana 혼입

입력:
```text
영어の실력
```

결과:
- validation FAIL
- 저장 금지
- retry

### C. Katakana 혼입

임의 사용자 노출 필드에 Katakana 포함

결과:
- validation FAIL

### D. 실제 영어 고유명사

```text
Roblox를 재미있게 했습니다.
```

결과:
- 정책상 허용
- PASS

### E. nested JSON

중첩 object/array 내부 문자열에 일본어가 있을 때도 탐지해야 한다.

### F. retry

1차 생성 FAIL
→ retry
→ 2차 정상 한국어 생성
→ 저장

### G. retry 최종 실패

최대 retry 모두 FAIL
→ DB 저장 없음
→ job failure 기록

### H. 문제 주간 리포트

재생성 후 `영어の実力` 0건.

---

## 21. QA

필수:

- unit test
- typecheck
- build
- daily report generation test
- weekly report generation test
- language validation test
- retry test
- nested JSON scan test
- Production 문제 row 재생성 smoke
- Production 전체 scan

BLOCKER/HIGH 0건.

---

## 22. 완료 조건

- [ ] Weekly prompt에 자연스러운 한국어 강제 규칙 추가
- [ ] Daily prompt에도 동일 방어 적용
- [ ] batch systemInstruction 언어 규칙 추가
- [ ] Hiragana 탐지 추가
- [ ] Katakana 탐지 추가
- [ ] 비의도 CJK 혼합 검사 전략 적용
- [ ] 사용자 노출 전체 문자열 recursive validation
- [ ] validation FAIL 시 저장 차단
- [ ] bounded retry 구현
- [ ] retry prompt 강화
- [ ] 최대 retry 실패 시 job 실패 처리
- [ ] 하드코딩 단어 치환을 primary 해결책으로 사용하지 않음
- [ ] daily/weekly 공통 적용
- [ ] 문제 2026-08-01~2026-08-07 weekly report 1건 재생성
- [ ] 다른 정상 리포트 미변경
- [ ] Production daily 일본어 0건
- [ ] Production weekly 일본어 0건
- [ ] 타입체크 PASS
- [ ] 빌드 PASS
- [ ] BLOCKER/HIGH 0건

---

## 23. 배포 순서

1. 현재 실제 report generation 경로 재확인
2. Dev prompt 수정
3. Dev validation 추가
4. retry 구현
5. unit test
6. typecheck
7. build
8. Dev daily/weekly generation test
9. BLOCKER/HIGH 확인
10. Production 배포
11. 문제 weekly report 1건만 재생성
12. Production DB 언어 재검사
13. 부모 UI smoke test

BLOCKER/HIGH 0건이면 추가 승인 대기 없이 끝까지 진행한다.

---

## 24. 완료 보고 형식

### 최종 판정

`PASS / PARTIAL / FAIL`

### Root Cause

- 최초 혼입 단계:
- 모델:
- 직접 원인:

### 수정 파일

| 파일 | 변경 내용 | 이유 |
|---|---|---|

### Validation

- Hiragana:
- Katakana:
- CJK mixed pattern:
- recursive scan:
- retry 횟수:
- 최종 실패 처리:

### 문제 리포트 재생성

- 대상 주간:
- 기존 일본어 혼입:
- 재생성 결과:
- 일본어 문자:
- UI 확인:

### Production 전수 검사

| 대상 | 수정 전 | 수정 후 |
|---|---:|---:|
| daily_reports | 0 | |
| weekly_summaries | 1 | |

### 회귀

- Raw STT 변경 없음:
- corrected 변경 없음:
- memory 변경 없음:
- 정상 daily 변경 없음:
- 정상 weekly 변경 없음:

### 최종 확인

반드시 `맞다 / 아니다`로 답한다.

- 한글+일본어 혼합의 최초 원인이 Weekly Report LLM 생성 단계였는가?
- 리포트 prompt에 한국어 출력 규칙이 추가됐는가?
- 저장 전 일본어 문자 validation이 적용됐는가?
- 이상 출력은 DB 저장 전에 차단되는가?
- validation 실패 시 자동 재생성되는가?
- 하드코딩 단어 치환에 의존하지 않는가?
- Daily와 Weekly 모두 동일 방어가 적용됐는가?
- 문제 주간 리포트 1건이 정상 한국어로 재생성됐는가?
- 영향 없는 기존 리포트는 변경하지 않았는가?
- Production 리포트 일본어 혼입이 최종 0건인가?
