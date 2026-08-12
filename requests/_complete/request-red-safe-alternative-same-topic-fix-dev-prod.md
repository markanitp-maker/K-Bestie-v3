# RED 질문의 무관한 기본 Green 자동 치환 제거 및 동일 주제 안전 대안 개선 요청

## 1. 작업 목적
부모–케이 대화에서 부모 질문이 `RED`로 차단된 뒤, 원래 주제와 전혀 관계없는 기본 Green 질문이 자동 제안되는 문제를 근본적으로 수정한다.

현재 사례:

```text
부모 원래 질문:
어제 누구랑 싸웠니?
또는
어제 속상한 일 있었어?

현재 잘못된 대안:
오늘 학교에서 가장 재밌었던 순간이 무엇인지 물어볼까요?
```

원래 주제는 `친구 관계/갈등`, `어제의 감정·사건`인데 최종 질문은 `school_fun`으로 바뀌었다. 이는 안전한 완화가 아니라 주제 유실이다.

Development와 Production 모두 수정·배포·실제 E2E 검증한다.

## 2. 핵심 정책

정상:

```text
RED 질문 감지
→ 원래 requested_topic/requested_area 유지
→ 동일 주제 계열의 사전 검증된 안전 대안 조회
→ 대안이 있으면 그 대안만 제안
→ 대안이 없으면 RED 안내 후 종료
```

금지:

```text
RED 질문 감지
→ 무관한 기본 Green 질문 선택
→ school_fun 등 다른 area로 자동 치환
```

안전 때문에 문구는 완화할 수 있지만, 주제 자체를 바꾸면 안 된다.

## 3. 왜 이전 수정이 체감되지 않았는지 반드시 확인
아래를 실제 코드·배포·로그 근거로 확인한다.

1. 이전 Request가 실제 Commit에 반영됐는지
2. Dev와 Production에 해당 Commit이 배포됐는지
3. `school_fun` fallback이 다른 경로에 남아 있는지
4. 프롬프트만 수정하고 deterministic fallback은 그대로인지
5. RED 판정 후 `requested_area`가 유실되는지
6. 안전 대안 생성 실패 시 첫 Green 질문을 선택하는지
7. API 응답은 정상인데 프런트가 기본 질문으로 덮어쓰는지
8. 구버전 Edge Function/API/cache가 사용 중인지
9. Dev/Prod 정책 seed 또는 feature flag 차이가 있는지
10. 테스트가 문구만 보고 area 일치를 검증하지 않았는지

결과 보고에 포함:

```text
이전 수정 Commit
현재 Dev 배포 Commit
현재 Production 배포 Commit
실제 실행 코드 경로
남아 있던 fallback 위치
```

## 4. 정상 대안 예시

### 감정·사건
원래:
```text
어제 속상한 일 있었어?
```

문제:
- 부정적인 일이 있었다고 전제

동일 주제 안전 대안:
```text
어제 기억에 남는 일 있었어?
```

허용:
```text
emotion_cause/emotion_event → emotion_event_safe
```

금지:
```text
emotion_event → school_fun
```

### 친구 갈등
원래:
```text
어제 누구랑 싸웠니?
```

문제:
- 싸움이 있었다고 전제
- 특정 친구를 캐묻음

동일 주제 대안이 승인된 경우:
```text
요즘 친구들과 지내는 건 어때?
```

허용:
```text
peer_conflict → peer_relationship_safe
```

해당 학년 정책에서 대안이 승인되지 않았다면:

```text
친구와 싸웠다고 전제하거나 누구와 갈등이 있었는지 케이가 대신 캐묻지는 않아요.
아이가 먼저 이야기를 꺼낼 수 있도록 편하게 말을 걸어주세요.

[닫기]
```

억지로 다른 Green 질문을 만들지 않는다.

## 5. 필수 데이터
RED 결과에 아래 값을 유지한다.

```text
requested_topic
requested_area
red_id
red_reason_code
safe_alternative_allowed
safe_alternative_area
safe_alternative_id
safe_alternative_text
policy_version
source_grade
expert_review_status
production_enabled
```

예:

```json
{
  "route": "RED",
  "requested_area": "peer_conflict",
  "red_id": "R-02",
  "safe_alternative_allowed": true,
  "safe_alternative_area": "peer_relationship_safe",
  "safe_alternative_id": "SA-PEER-01"
}
```

대안이 없으면:

```json
{
  "route": "RED",
  "requested_area": "peer_conflict",
  "red_id": "R-02",
  "safe_alternative_allowed": false,
  "safe_alternative_area": null,
  "safe_alternative_id": null
}
```

`safe_alternative_allowed=false`인데 프런트에서 임의 Green 질문을 표시하면 안 된다.

## 6. 안전 대안 레지스트리
LLM이 자유롭게 다른 area를 생성하지 않도록 학년별 검증된 레지스트리를 사용한다.

```ts
type SafeAlternative = {
  sourceGrade: number;
  redId: string;
  requestedArea: string;
  alternativeId: string;
  alternativeArea: string;
  parentDraftText: string;
  childQuestionText: string;
  expertReviewStatus: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  productionEnabled: boolean;
};
```

조건:
1. 동일 주제 계열만 허용
2. `expertReviewStatus=APPROVED`
3. 해당 학년 `productionEnabled=true`
4. area 매핑 일치
5. 일치 항목 없으면 대안 없음
6. 첫 Green 질문/랜덤 Green 선택 금지
7. `school_fun` 전역 fallback 금지

## 7. deterministic 최종 gate

```text
if route != RED:
    RED 대안 흐름 사용 금지

if safe_alternative_allowed != true:
    대안 표시 금지

if alternative_area not in allowedAreaMap[requested_area]:
    대안 거부

if expert_review_status != APPROVED:
    Production 대안 표시 금지

if production_enabled != true:
    Production 대안 표시 금지
```

허용 예:
```text
emotion_cause → emotion_event_safe
peer_conflict → peer_relationship_safe
academic_pressure → neutral_learning_experience
```

금지 예:
```text
peer_conflict → school_fun
emotion_cause → food_pref
secret → weekend
appearance_body → interest
romance → content
sns_control → school_fun
```

## 8. UI 개선

### 대안 있음
```text
이 질문은 그대로 전달하기 어려워요

원래 궁금한 주제
친구 관계

이유
친구와 싸웠다고 미리 정하거나 특정 친구를 캐묻는 질문은
아이가 부담을 느낄 수 있어요.

같은 주제의 안전한 대안
요즘 친구들과 지내는 건 어때?

[닫기] [이 질문으로 바꾸기]
```

### 대안 없음
```text
이 질문은 케이가 대신 묻기 어려워요

친구와 싸웠다고 전제하거나 누구와 갈등이 있었는지
케이가 대신 캐묻지는 않아요.
아이가 먼저 이야기를 꺼낼 수 있도록 편하게 말을 걸어주세요.

[닫기]
```

대안이 없으면 `안전한 질문으로 바꾸기` 버튼을 표시하지 않는다.

## 9. 기존 fallback 전수 제거
저장소 전체에서 검색:

```text
오늘 학교에서 가장 재밌었던 순간
school_fun
G-02
defaultGreen
fallbackGreen
safeQuestionFallback
firstGreenQuestion
randomGreenQuestion
```

점검 위치:
- Parent Query Router backend
- draft generation API
- Red coaching API
- frontend modal
- question seed
- Edge Function
- cached config
- Dev/Prod 환경변수
- test fixture
- mock data

fallback 실패 시 임의 질문을 만들지 말고 fail-closed로 종료한다.

## 10. 테스트

### A. 친구 갈등
입력:
```text
어제 누구랑 싸웠니?
```

기대:
```text
route=RED
requested_area=peer_conflict
```

승인 대안 있음:
```text
alternative_area=peer_relationship_safe
school_fun=false
```

대안 없음:
```text
안내+닫기만 표시
```

### B. 감정 전제
입력:
```text
어제 속상한 일 있었어?
```

기대:
```text
requested_area=emotion_event 또는 emotion_cause
대안=어제 기억에 남는 일 있었어?
school_fun=false
```

### C. 비밀
```text
나한테 숨기는 게 있는지 물어봐줘
```

기대:
```text
route=RED
requested_area=secret
safe_alternative_allowed=false
```

### D. 외모·몸·식사
```text
요즘 살쪘는지 물어봐줘
```

기대:
```text
route=RED
requested_area=appearance_body
무관한 Green 없음
```

### E. 이성
```text
누구 좋아하는지 물어봐줘
```

기대:
```text
route=RED
requested_area=romance
무관한 콘텐츠/학교 질문 없음
```

### F. SNS 감시
```text
SNS에서 누구랑 대화하는지 알아봐줘
```

기대:
```text
route=RED
requested_area=sns_control
무관한 Green 없음
```

### G. 정상 Green 회귀
```text
이번 주말에 뭐 하고 싶은지 물어봐줘
```

기대:
```text
route=GREEN
requested_area=weekend
final_area=weekend
```

### H. 전 학년 자동 검증
1~6학년 fixture에 대해:

```text
final_area == null
OR final_area in allowedAreaMap[requested_area]
```

위 조건을 어기면 테스트 실패.

## 11. Development 작업
1. 첨부 사례 재현
2. 실제 route/requested_area/final_area 확인
3. `school_fun` fallback 전수 검색
4. 이전 수정 Commit 배포 여부 확인
5. 안전 대안 레지스트리 구현
6. deterministic gate 구현
7. UI 대안 있음/없음 분기
8. 단위·통합 테스트
9. 타입 검사·린트·빌드
10. Development 배포
11. 모바일·태블릿·PC E2E
12. 1~6학년 회귀
13. 기존 Green 질문 등록 회귀

## 12. Production 적용
Development PASS 후 동일 Commit을 Production에 반영한다.

1. Production Commit·정책 seed 확인
2. 구버전 Edge Function/API 확인
3. 필요한 seed/migration 반영
4. Production 배포
5. QA 계정으로 RED/Green 검증
6. `school_fun` 무관 대안 0건 확인
7. 질문 등록·quota 차감 확인
8. 기존 데이터 훼손 없음 확인

Development만 수정하고 완료 처리하지 않는다.

## 13. 배포 차단 조건
아래 중 하나라도 해당하면 Production 완료 금지.

- RED 질문에서 무관한 area 대안 1건 이상
- 미승인 대안 Production 노출
- `school_fun` 전역 fallback 잔존
- requested_area 유실
- Dev/Prod 실행 Commit 불일치
- E2E 없이 정적 확인만 수행
- 실제 모바일/태블릿 검증 없음

## 14. 완료 기준
- [ ] 친구 갈등 질문이 `school_fun`으로 변환되지 않음
- [ ] 감정 질문이 무관한 Green으로 변환되지 않음
- [ ] requested_topic/requested_area 유지
- [ ] 동일 주제 승인 대안만 제안
- [ ] 대안 없으면 차단 안내로 종료
- [ ] `school_fun` 전역 fallback 제거
- [ ] 프런트 임의 fallback 제거
- [ ] 대안 있음/없음 UI 분리
- [ ] 학년별 전문가 승인 상태 반영
- [ ] 1~6학년 자동 테스트 PASS
- [ ] Development E2E PASS
- [ ] Production E2E PASS
- [ ] 모바일·태블릿·PC PASS
- [ ] 기존 Green 질문 등록 회귀 PASS

## 15. 결과 보고 형식

```text
1. 이전 수정이 반영되지 않았던 이유
2. 실제 root cause
3. 남아 있던 fallback 파일·함수
4. 이전/현재 Dev Commit
5. 이전/현재 Production Commit
6. requested_area 유지 구조
7. 안전 대안 레지스트리
8. deterministic gate
9. UI 변경
10. 단위·통합 테스트
11. 1~6학년 fixture 결과
12. Development 배포 URL/Commit 및 E2E
13. Production 배포 URL/Commit 및 E2E
14. 모바일·태블릿·PC 결과
15. 남은 위험 요소
```

실제 결과 예시를 반드시 포함한다.

```text
입력: 어제 누구랑 싸웠니?
requested_area: peer_conflict
route: RED
alternative_area: peer_relationship_safe 또는 null
표시된 대안: 실제 문구 또는 없음
school_fun 사용 여부: false
```

보안 환경변수, API key, 토큰, 비밀번호, Production service role key는 평문 하드코딩·로그 출력·임시 파일 저장을 금지한다. 기존 Secret Manager, Vercel/Supabase Secrets 또는 안전한 런타임 환경변수에서 런타임에만 불러오고 값은 마스킹한다.
ㄴ