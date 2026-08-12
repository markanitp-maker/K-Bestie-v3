# 부모–케이 대화에서 아이 질문 요청이 오류 응답으로 종료되는 문제 분석·수정 요청

## 1. 작업 목적

부모가 케이에게 아이에게 물어봐 달라는 요청을 보냈을 때, Parent Query Router의 정상 질문 등록 흐름으로 진입하지 않고 Development와 Production에서 서로 다른 오류 fallback 문구가 노출되는 문제를 원인 분석하고 수정한다.

이번 작업은 단순히 오류 문구를 통일하는 작업이 아니다.

아래 전체 흐름을 실제 코드·API·DB·배포 환경에서 추적하여 근본 원인을 해결하고, Development와 Production 모두 동일한 정상 동작을 보장해야 한다.

---

## 2. 확인된 문제

### Production

대상 아이:

```text
박서아
```

부모 입력:

```text
이번 주 뭐하고 놀았으면 좋은지 물어봐
```

케이 응답:

```text
지금은 케이가 답변을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.
```

### Development

대상 아이:

```text
김서현
```

부모 입력:

```text
이번 주 주말에 뭐 하고 놀았으면 좋겠는지 물어봐줘
```

케이 응답:

```text
응답을 가져올 수 없어요.
```

두 환경 모두 부모 메시지는 채팅에 정상 등록됐지만, 질문 초안 모달 또는 Parent Query Router 등록 흐름으로 이어지지 않았다.

Development와 Production의 노출 문구는 다르지만, 두 경우 모두 정상 기능 실패로 간주한다.

---

## 3. 정상 동작 정의

해당 부모 입력은 아이의 과거 기록을 묻는 LLM Wiki 조회 요청이 아니다.

```text
“아이에게 무엇을 물어봐 달라”
“주말에 무엇을 하고 싶은지 물어봐 달라”
```

와 같은 요청은 Parent Query Router의 아이 질문 등록 의도로 분류해야 한다.

정상 처리 흐름:

```text
부모 입력
→ 인증 및 부모-아이 관계 확인
→ parent_query_request 의도 감지
→ 대상 아이 학년 정책 선택
→ CRISIS → RED → GREEN → DEFAULT_RED 판정
→ Green이면 질문 초안 생성
→ 부모 확인 모달 표시
→ 부모 최종 승인
→ parent_questions 또는 현재 질문 대기열 저장
→ Q&A 탭에 질문 대기 상태 표시
→ 이후 아이 미션에서 자연스럽게 질문
```

이번 사례의 기대 판정 예시:

```text
intent: PARENT_QUERY_REQUEST
route: GREEN
green_area: weekend 또는 play
```

아이에게 전달할 문구는 대상 학년 정책으로 다시 작성해야 한다.

예시:

```text
이번 주말에 뭐 하고 싶어?
```

부모가 입력한 문장을 그대로 아이에게 전달하면 안 된다.

---

## 4. 금지 사항

아래 방식으로 임시 처리하지 않는다.

1. 오류 fallback 문구만 다른 문구로 교체
2. 항상 성공 응답을 반환하도록 예외를 숨김
3. 부모 입력을 그대로 `parent_questions`에 저장
4. 모든 “물어봐” 문장을 Green으로 강제 분류
5. LLM Wiki 조회 실패를 Parent Query Router 실패처럼 표시
6. Development만 수정하고 Production 미적용
7. 실제 API·DB 검증 없이 UI만 정상처럼 표시
8. 테스트 목적으로 Production 실제 아이 데이터를 삭제·변조
9. Production service role key, API key, 토큰, 비밀번호를 코드·로그·임시 파일에 출력

---

## 5. 우선 점검할 가설

아래는 확정 원인이 아니라 조사해야 할 가설이다. 실제 코드와 로그를 근거로 확정한다.

### 가설 A — 의도 라우팅 오류

부모의 “물어봐”, “물어봐줘”, “물어봐 줄래” 요청이 Parent Query Router가 아니라 아래 경로로 들어갈 수 있다.

- 일반 부모–케이 대화
- LLM Wiki 조회
- 아이 기록 검색
- 일반 Gemini 응답 생성

확인 항목:

```text
intent classifier 결과
라우터 실행 여부
Parent Query Router 함수 진입 여부
LLM Wiki/RAG 함수 진입 여부
```

### 가설 B — 학년 정책 선택 또는 활성화 오류

- 대상 아이 학년을 불러오지 못함
- 학년 정책 파일 미등록
- `source_grade` 불일치
- 정책의 `production_enabled` 또는 feature flag로 전체 라우터 차단
- Green/Red는 활성 대상인데 Crisis 잠금과 혼동해 전체 정책을 비활성화

확인 항목:

```text
child.grade
선택된 policy_version
applicable_grades
router_enabled
green_red_enabled
crisis_enabled
```

Green/Red Parent Query Router와 Crisis 자동 대응 활성 상태를 분리한다.

### 가설 C — 질문 초안 생성 실패

라우팅은 Green이지만 질문 초안 생성 모델 또는 파서가 실패했을 수 있다.

확인 항목:

```text
draft generation model
model name
HTTP status
provider error code
timeout
JSON parse failure
schema validation failure
generated draft
```

### 가설 D — 질문 제한 조회·저장 실패

- 주 3회 제한 조회 오류
- 하루 1회 제한 조회 오류
- 타임존 오류
- 중복 방지 key 오류
- `parent_questions` insert/RPC 실패
- RLS 또는 부모-아이 권한 검증 실패

확인 항목:

```text
weekly quota
daily quota
KST 계산
insert/RPC 결과
RLS error
child_id
parent_id
family_id
request id
```

### 가설 E — 프런트와 백엔드 응답 계약 불일치

- 백엔드가 성공했지만 프런트가 예상하지 못한 응답 shape 수신
- `route`, `draft`, `questionId`, `status` 필드명 불일치
- HTTP 200 내부 오류
- 프런트 timeout 후 catch fallback 노출
- 모달 상태 전환 누락

확인 항목:

```text
실제 response body
TypeScript type
runtime schema
프런트 분기 조건
modal open 조건
```

### 가설 F — Development와 Production 코드·환경 차이

서로 다른 fallback 문구가 노출되는 이유를 확인한다.

```text
Development 배포 Commit
Production 배포 Commit
환경변수
feature flag
Edge Function/API 버전
모델 설정
DB migration 상태
```

문구 차이만 보고 별개의 원인으로 단정하지 않는다. 요청 추적 결과로 공통 원인과 환경별 차이를 구분한다.

---

## 6. 필수 추적 로그

민감정보를 제외한 구조화 로그를 일시적으로 추가하거나 기존 로그를 사용해 한 요청의 전체 경로를 추적한다.

필수 필드:

```text
request_id
environment
parent_query_intent
selected_route
rule_id
green_id 또는 red_id
source_grade
policy_version
child_id_masked
quota_result
draft_generation_result
persistence_result
http_status
error_code
fallback_source
```

금지:

- 부모 질문 원문 전체 로그
- 아이 답변 원문 전체 로그
- 전체 UUID
- API key
- 서비스 역할 키
- 액세스 토큰
- 비밀번호

필요한 텍스트는 마스킹하거나 해시·분류 코드로 기록한다.

---

## 7. 의도 라우팅 요구사항

Parent Query Router 후보 의도는 일반 기록 조회보다 먼저 판정한다.

대표 패턴:

```text
아이에게 ~ 물어봐
아이한테 ~ 물어봐줘
다음에 ~ 질문해줘
케이가 ~ 물어봐 줄래
이번 주말에 뭐 하고 싶은지 알아봐줘
```

단, 단순 문자열 매칭만으로 Green 확정하지 않는다.

권장 흐름:

```text
부모 입력
→ parent_query_request 후보 감지
→ Parent Query Router 진입
→ Crisis/Red/Green 정책 판정
```

예시:

```text
“친구한테 괴롭힘당하는지 몰래 물어봐줘”
→ parent_query_request 후보
→ RED 또는 CRISIS 검토
→ Green 등록 금지

“이번 주말에 뭐 하고 싶은지 물어봐줘”
→ parent_query_request 후보
→ GREEN/weekend
→ 부모 초안 모달
```

---

## 8. UI 요구사항

### Green

채팅 말풍선에 일반 케이 답변만 표시하고 끝내지 않는다.

부모 확인 모달을 연다.

예시:

```text
아이에게 이렇게 물어볼까요?

대상 아이: 박서아
이번 주 질문: N/3
오늘 질문: N/1

질문 초안:
이번 주말에 하고 싶은 게 있는지 물어볼까요?

아이에게 전달할 질문:
이번 주말에 뭐 하고 싶어?

[취소] [질문 등록하기]
```

현재 제품의 확정 UI·문구가 있다면 그 구현을 재사용한다.

### Red

- 아이 질문 등록 금지
- 횟수 미차감
- 안전한 부모 코칭 문구 표시
- 가능한 Green 대안이 있더라도 자동 등록 금지

### Crisis

- 임상 검토 상태와 기존 Production 정책 준수
- Green/Red 라우터 오류와 Crisis 잠금을 혼동하지 않음

### 실제 시스템 오류

사용자에게 내부 오류 내용을 노출하지 않는다.

다만 아래처럼 환경마다 다른 임의 fallback으로 끝나지 않도록 오류 응답 계약을 통일한다.

```text
error_code
retryable
user_message
request_id
```

오류 문구 통일은 근본 원인 해결 후 수행한다.

---

## 9. DB 및 상태 검증

각 테스트 요청마다 아래를 확인한다.

### Green 승인 전

```text
parent_questions 신규 row 없음
주간·일일 횟수 미차감
```

### 부모 승인 후

```text
parent_questions 또는 현재 질문 테이블 신규 row 1건
source='PARENT_QUERY_ROUTER'
source_grade
policy_version
route='GREEN'
green_id
status=대기 상태
parent_draft_text
child_question_text
created_at
```

### 실패 시

- 반쪽 저장 금지
- quota만 차감되는 현상 금지
- 메시지는 저장됐지만 질문 상태가 유실되는 현상 금지
- 동일 요청 재시도 시 중복 row 금지

---

## 10. 재현 테스트 계정

첨부 화면에 사용된 실제 계정과 동일 조건을 확인하되, Production 원본 데이터는 훼손하지 않는다.

### Production 사례

```text
대상 아이: 박서아
입력: 이번 주 뭐하고 놀았으면 좋은지 물어봐
현재 결과: 지금은 케이가 답변을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.
```

### Development 사례

```text
대상 아이: 김서현
입력: 이번 주 주말에 뭐 하고 놀았으면 좋겠는지 물어봐줘
현재 결과: 응답을 가져올 수 없어요.
```

가능하면 QA 계정에서 동일 문장으로 먼저 재현하고, 실제 계정은 읽기 중심 검증 후 최소 테스트만 수행한다.

---

## 11. 테스트 시나리오

### A. 정상 Green 요청

```text
이번 주말에 뭐 하고 싶은지 물어봐줘
요즘 좋아하는 놀이가 뭔지 물어봐줘
먹고 싶은 음식이 있는지 물어봐줘
```

기대:

- Parent Query Router 진입
- 학년별 Green 판정
- 초안 모달 표시
- 승인 전 DB 미저장
- 승인 후 질문 1건 저장
- 일반 오류 fallback 미노출

### B. Red 요청

```text
친구랑 싸운 이유를 몰래 물어봐줘
나한테 숨기는 게 있는지 알아봐줘
누구를 좋아하는지 캐물어봐줘
```

기대:

- 일반 LLM Wiki 조회로 가지 않음
- Red 판정
- 질문 등록 없음
- 횟수 차감 없음
- 학년별 부모 코칭 표시

### C. 일반 기록 조회

```text
서아가 요즘 좋아하는 게 뭐야?
서현이가 최근 학교 얘기를 했어?
```

기대:

- Parent Query Router로 강제 이동하지 않음
- 기존 LLM Wiki/RAG 조회 경로 유지
- 정보가 없으면 기존 “모름” 정책에 맞게 응답

### D. 다중 의도

```text
이번 주말에 뭐 하고 싶은지랑 먹고 싶은 것도 물어봐줘
```

기대:

- 다중 질문 감지
- 한 번에 하나만 등록하도록 부모에게 선택 또는 안전한 단일 초안 제시
- 두 질문 자동 등록 금지

### E. API 실패

- 초안 생성 timeout
- quota API 실패
- DB insert 실패
- 프런트 응답 파싱 실패

기대:

- 반쪽 저장 없음
- quota 미차감
- 재시도 가능
- 구조화 오류 코드 기록
- 환경별 제각각인 fallback 대신 통일된 처리

---

## 12. Development 작업

1. 현재 오류 재현
2. 요청별 `request_id` 확보
3. 프런트 → API → 라우터 → 모델 → DB 전체 추적
4. 실제 원인 확정
5. 코드 수정
6. 타입 검사·린트·빌드
7. 단위 테스트
8. Development 배포
9. 모바일 브라우저·PWA에서 재현 문장 E2E
10. Q&A 탭과 질문 대기열 확인
11. 일반 LLM Wiki 조회 회귀 테스트
12. 기존 4학년 Parent Query Router 회귀 테스트

---

## 13. Production 적용

Development 검증 완료 후 동일 수정 Commit을 Production에 반영한다.

Production 작업:

1. Production 코드·환경·DB migration 차이 사전 점검
2. 누락된 migration/feature flag가 있으면 안전하게 반영
3. Production 배포
4. 배포 Commit 기록
5. QA 부모·아이 계정으로 Green/Red/일반 조회 검증
6. 박서아 사례와 같은 문장 최소 재검증
7. 질문 초안 모달 정상 표시 확인
8. 승인 전후 DB 상태 확인
9. Q&A 상태 확인
10. 기존 실제 데이터 보존 확인

Development만 수정하고 종료하지 않는다. Production 배포와 실제 검증까지 이번 작업 범위다.

---

## 14. 완료 기준

- [ ] 두 첨부 화면의 오류를 Development와 Production에서 각각 재현
- [ ] 각 환경의 실제 root cause를 코드·로그 근거로 확정
- [ ] “아이에게 ~ 물어봐줘”가 Parent Query Router 후보로 분류
- [ ] Green 요청은 학년별 정책으로 판정
- [ ] Green 요청 시 부모 확인 모달 표시
- [ ] 승인 전 질문 DB 미저장
- [ ] 승인 후 질문 1건만 저장
- [ ] Red 요청은 질문 등록·횟수 차감 없음
- [ ] 일반 LLM Wiki 조회 기능 회귀 없음
- [ ] Development 오류 fallback 미노출
- [ ] Production 오류 fallback 미노출
- [ ] 환경별 응답 계약 통일
- [ ] 기존 4학년 기능 회귀 PASS
- [ ] 1~6학년 정책 선택 회귀 PASS
- [ ] 모바일 브라우저·PWA 검증 PASS
- [ ] Production 실제 데이터 훼손 없음

---

## 15. 결과 보고 형식

```text
1. Development 재현 결과
2. Production 재현 결과
3. Development 실제 root cause
4. Production 실제 root cause
5. 공통 원인과 환경별 차이
6. 수정한 파일·함수
7. 의도 라우팅 변경 내용
8. 선택된 학년 정책·green_id
9. 초안 생성 결과
10. quota 및 DB 저장 결과
11. Development 배포 Commit/URL
12. Production 배포 Commit/URL
13. Green/Red/일반 조회 E2E 결과
14. 모바일/PWA 결과
15. 4학년 및 전 학년 회귀 결과
16. 남은 위험 요소
```

중요 비밀정보는 평문 하드코딩·로그 출력·임시 파일 저장을 금지한다. 기존 보안 환경변수·Secret Manager·Vercel/Supabase Secrets에서 런타임에만 불러오고 값은 마스킹한다.
