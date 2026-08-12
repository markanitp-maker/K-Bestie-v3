# 부모–케이 대화 기본 기능 정상화 및 Green List 임시 비활성화 요청

## 0. 작업 목적

현재 부모–케이 대화에서 Parent Query Router의 Green List 화이트리스트 게이트가 기본 대화·후속 대화·아이에게 질문하기 흐름까지 과도하게 막거나 `DEFAULT_RED`, `fallback`, 무관한 안전 대안으로 보내는 문제가 반복되고 있다.

이번 작업의 최우선 목표는 부모와 케이의 기본 대화 기능을 정상화하는 것이다.

따라서 Green List 기반의 “허용 질문만 통과” 기능은 당분간 임시 비활성화한다.

단, Green List를 끈다고 해서 안전 기능 전체를 끄는 것이 아니다.

반드시 아래 기능은 유지한다.

```text
유지:
- Crisis 차단
- Red 민감 질문 차단
- 부모 문장 아이에게 그대로 전달 금지
- 부모 최종 승인
- 질문 횟수 제한
- 아이 거부권
- 답변 재확인
- 가족/아이 데이터 격리

임시 비활성화:
- Green List 화이트리스트에 없다는 이유만으로 질문을 차단하는 기능
- DEFAULT_RED fallback
- Green List 미매칭 시 임의 기본 Green 질문으로 치환하는 기능
```

Development와 Production 모두 동일하게 적용한다.

---

## 1. 이번 변경의 핵심 정책

현재:

```text
부모 질문
→ Crisis
→ Red
→ Green List 매칭
→ Green List에 있으면 허용
→ 없으면 DEFAULT_RED
```

임시 변경:

```text
부모 질문
→ Crisis 검사
→ Red 검사
→ Crisis/Red가 아니면 일반 질문 후보로 처리
→ 질문 의도와 직전 대화 맥락 유지
→ 아이에게 부담 없는 중립 질문으로 재작성
→ 부모 확인
→ 부모 승인
→ 질문 등록
```

중요:

```text
NOT RED = 자동 GREEN
```

으로 단순 구현하라는 뜻이 아니다.

정확한 정책은:

```text
Crisis/Red가 아닌 일반 질문
→ Green List 매칭 여부를 차단 조건으로 사용하지 않음
→ 질문의 원래 주제를 유지한 채 중립 문장으로 재작성
→ 부모 확인 후 등록
```

---

## 2. Green List 임시 비활성화 범위

아래 기능을 비활성화한다.

```text
GREEN_RULES whitelist gate
Green List 미매칭 → DEFAULT_RED
Green List 미매칭 → fallback
Green List 미매칭 → school_fun 기본 질문
Green List 미매칭 → 첫 Green 질문 선택
Green List 미매칭 → random Green 질문
```

현재 코드의 실제 구현 위치를 먼저 확인하고 최소 변경한다.

예상 점검 대상:

```text
학년별 Parent Query Router 정책
Parent Query Router 공통 orchestration
app/api/parent/k-chat/route.ts
app/parent/k-chat/page.tsx
```

실제 저장소 기준으로 확인한다. 존재하지 않는 파일을 추측해 새로 만들지 않는다.

---

## 3. 반드시 유지할 안전 게이트

Green List를 꺼도 기존 Red/Crisis 영역은 그대로 유지한다.

### Crisis
현재 구현된 Crisis 정책과 전문가 검토 상태를 유지한다. 이번 작업 때문에 범위를 넓히거나 줄이지 않는다.

### Red
기존 학년별 Red 차단은 유지한다.

예:

```text
emotion_cause
peer_conflict
academic_pressure
secret
family_complaint
appearance_body
romance
sns_control
```

실제 학년별 Red 목록은 현재 코드 기준으로 사용한다.

예:

```text
"친구가 괴롭히는지 몰래 알아봐줘"
→ Red

"나한테 숨기는 게 있는지 물어봐줘"
→ Red

"누구 좋아하는지 캐물어봐줘"
→ Red
```

Green List가 꺼져 있다고 해서 위 질문들이 통과되면 안 된다.

---

## 4. 기본 부모–케이 대화는 PQR 때문에 막히면 안 됨

아래는 일반 대화 또는 정보 조회다.

```text
서현이가 야외에서 노는 걸 좋아해?
서아는 케이랑 친해?
요즘 수학 때문에 힘들어해?
원래도 그래?
그렇구나
왜 그렇게 생각해?
방학이라 학교는 안 가
```

정상:

```text
부모 질문
→ 일반 대화 / 아이 정보 조회 / 경향 질문
→ 대시보드 + 일일 + 주간 + 상세 리포트 + Memory Facts + 대화 맥락
→ 케이 답변
```

Parent Query Router는 아래처럼 아이에게 실제로 질문해 달라는 요청에서만 동작한다.

```text
서현이에게 물어봐줘
그럼 직접 물어봐줘
이번 주말에 뭐 하고 싶은지 물어봐줘
```

---

## 5. 아이에게 질문하기 — 임시 자유 질문 모드

부모가 아이에게 물어봐 달라고 요청하면:

```text
직전 대화 topic
+
현재 부모 요청
+
대상 child_id
```

를 유지한다.

그 후:

```text
Crisis 검사
→ Red 검사
→ 일반 질문이면 중립 질문 재작성
→ 부모 확인 모달
```

Green List에 등록된 주제인지 여부는 차단 조건으로 사용하지 않는다.

---

## 6. 질문 재작성 원칙

질문의 핵심 주제를 절대 바꾸지 않는다.

정상:

```text
부모:
서현이가 케이랑 앞으로도 이야기하고 싶은지 물어봐줘

아이 질문 초안:
앞으로도 케이랑 이야기하고 싶어?
```

금지:

```text
친구 관계 질문
→ 오늘 학교에서 제일 재미있었던 순간 질문

케이 관계 질문
→ 주말에 뭐 하고 싶은지 질문

감정 질문
→ 음식 취향 질문
```

주제 변경 금지.

안전한 동일 주제 재작성이 불가능하면 Red 안내로 종료한다.

---

## 7. fallback 및 내부 용어 제거

전체 저장소에서 아래 문자열·처리를 전수 검색한다.

```text
fallback
DEFAULT_RED
defaultGreen
fallbackGreen
school_fun
firstGreenQuestion
randomGreenQuestion
Green List에 명확히 해당하지
```

특히 아래 UI는 제거한다.

```text
원래 궁금한 주제: fallback
4학년 Green List에 명확히 해당하지 않아...
```

부모 화면 금지 용어:

```text
Green List
GREEN
RED
DEFAULT_RED
fallback
R-01
R-02
G-01
G-02
PQR-G4-1.1
policy_version
rule_id
confidence
```

부모에게는 쉬운 한국어만 보여준다.

---

## 8. Feature Flag 방식 권장

이번 변경은 임시 운영 정책이므로 다시 켤 수 있어야 한다.

가능하면 Green List 코드를 삭제하지 말고 feature flag로 우회한다.

예:

```text
PARENT_QUERY_GREEN_WHITELIST_ENABLED=false
```

단, 기존 프로젝트의 feature flag 방식이 있으면 그 방식을 우선 사용한다.

필수:

```text
Dev: OFF
Prod: OFF

Red gate: ON
Crisis gate: 기존 상태 유지
```

Green List 데이터와 정책 파일은 삭제하지 않는다.

향후 전문가 검토 후 재활성화 가능해야 한다.

---

## 9. 미래 예측/경향 질문 정상화

아래 질문은 기본 대화에서 처리한다.

```text
케이랑 매일 대화할 것 같아?
앞으로도 미션 계속 할 것 같아?
```

기대:

```text
최근 기록을 보면 계속 이야기할 가능성은 있어 보여요.
다만 매일 할지는 아직 단정하기 어려워요.
```

근거가 부족하면:

```text
지금 기록만으로는 매일 할지까지는 판단하기 어려워요.
```

금지:

```text
응답을 가져올 수 없어요.
Green List에 없습니다.
아이에게 물어보기로 강제 이동.
```

---

## 10. 직전 주제 유지

예:

```text
부모:
케이랑 매일 대화할 것 같아?

케이:
최근 기록만으로 매일 할지까지는 단정하기 어려워요.

부모:
그럼 서현이에게 물어봐줘.
```

정상:

```text
requested_topic = 케이와 앞으로도 이야기하고 싶은지
```

질문 초안:

```text
앞으로도 케이랑 이야기하고 싶어?
```

금지:

```text
requested_topic=fallback
school_fun 질문 생성
직전 topic 유실
```

---

## 11. 아이별 컨텍스트 격리

안서아와 안서현의 대화 상태를 완전히 분리한다.

확인 대상:

```text
last_topic
pending_question
pending_draft
requested_topic
requested_area
conversation history
```

모두 `child_id` 기준으로 격리한다.

---

## 12. 기존 통합 Retrieval은 건드리지 않음

최근 QA에서 아래 기능은 정상으로 확인되었다.

```text
대시보드 retrieval
일일 리포트 retrieval
주간 리포트 retrieval
상세 리포트 retrieval
Memory Facts retrieval
대화 맥락 retrieval
```

이번 작업에서 해당 통합 retrieval 구조를 재설계하거나 롤백하지 않는다.

회귀 테스트만 수행한다.

---

## 13. Q&A / STT 실제 E2E 재검증

QA 보고서상 코드 분석에서는 PASS였지만 실제 사용 화면에서 과거 오류가 재현된 적이 있으므로 실제 환경에서 검증한다.

### Q&A

```text
부모–케이 대화
→ Q&A
```

확인:

- 404 없음
- 질문 목록 정상
- 아이별 질문 구분
- 대화로 복귀 정상

### STT

Case A:

```text
입력창 먼저 터치
→ 마이크
→ 말하기
→ 중지
```

Case B:

```text
입력창 터치하지 않음
→ 마이크 바로 사용
→ 말하기
→ 중지
```

두 경우 모두:

```text
음성 text → 입력창
자동 전송 없음
```

이어야 한다.

---

## 14. Development 테스트 시나리오

### A. 일반 정보 질문
```text
서현이가 야외에서 노는 걸 좋아해?
```
기대:
- 통합 Retrieval
- 정상 답변
- PQR 미개입

### B. 케이 관계 질문
```text
서현이가 케이를 좋아하는 것 같아?
```
기대:
- 일반 대화
- 근거 기반 답변
- Green List로 차단 금지

### C. 미래 경향
```text
케이랑 매일 대화할 것 같아?
```
기대:
- 경향/예측형 답변
- 오류 문구 금지

### D. 아이에게 질문하기
```text
그럼 서현이에게 물어봐줘
```
기대:
- 직전 topic 유지
- Crisis/Red 검사
- Red 아니면 중립 질문 초안
- Green List 미매칭 차단 없음

### E. 기존 Policy Gap 사례
```text
케이랑 이야기하는 게 좋은지 물어봐줘
```
기대:
- DEFAULT_RED 금지
- fallback 금지
- 안전한 중립 질문 초안

### F. 기존 허용 질문
```text
이번 주말에 뭐 하고 싶은지 물어봐줘
```
기대:
- 질문 생성 가능

### G. Red
```text
친구가 괴롭히는지 몰래 알아봐줘
```
기대:
- Red 유지
- 자동 등록 금지

### H. 비밀
```text
나한테 숨기는 게 있는지 물어봐줘
```
기대:
- Red 유지

### I. 내부 용어
부모 UI 전체에 아래 문자열 0건:
```text
Green List
fallback
DEFAULT_RED
R-02
G-01
PQR-
```

---

## 15. Production 적용

Development에서 핵심 시나리오 PASS 후 동일 Commit을 Production에 반영한다.

순서:

1. 현재 Dev/Prod Commit 확인
2. Green whitelist 차단 경로 확인
3. feature flag 또는 최소 코드 변경 구현
4. Development build/test
5. Development 배포
6. 실제 모바일/PWA E2E
7. 일반 대화 회귀
8. 통합 Retrieval 회귀
9. Parent Query Request 회귀
10. Red/Crisis 회귀
11. Q&A 실제 확인
12. STT 실제 확인
13. PASS 후 동일 Commit Production 배포
14. Production 실제 모바일/PWA 재검증
15. 결과 보고

Development만 수정하고 종료하지 않는다.

---

## 16. 롤백 가능성

Green List 정책 파일과 seed는 삭제하지 않는다.

향후 전문가 검토 및 정책 보완 후 다시 활성화할 수 있게 유지한다.

반드시 기록:

```text
Green whitelist feature:
TEMPORARILY_DISABLED

Red gate:
ENABLED

Crisis gate:
기존 상태 유지
```

---

## 17. 완료 기준

- [ ] Green List 미매칭만으로 일반 질문 차단하지 않음
- [ ] DEFAULT_RED fallback 때문에 기본 대화가 막히지 않음
- [ ] Green List 미매칭 질문도 Red/Crisis가 아니면 중립 재작성 가능
- [ ] Red 차단 유지
- [ ] Crisis 기존 정책 유지
- [ ] 부모 문장 직접 전달 금지 유지
- [ ] 부모 승인 유지
- [ ] 아이 거부권 유지
- [ ] 질문 횟수 제한 유지
- [ ] 답변 재확인 유지
- [ ] 직전 topic 유지
- [ ] 안서아/안서현 컨텍스트 격리
- [ ] `fallback` 사용자 노출 0건
- [ ] `Green List` 사용자 노출 0건
- [ ] 일반 부모–케이 대화 정상
- [ ] 미래 예측 질문 오류 없음
- [ ] 통합 Retrieval 회귀 PASS
- [ ] Q&A 실제 PASS
- [ ] STT 실제 PASS
- [ ] Development PASS
- [ ] Production PASS
- [ ] 모바일 PWA PASS

---

## 18. 배포 차단 조건

아래 중 하나라도 발생하면 Production 완료 처리 금지.

```text
Red 질문이 Green List OFF 때문에 통과됨
Crisis 처리에 영향 발생
다른 아이 대화가 섞임
부모 문장이 그대로 아이에게 전달됨
질문이 부모 승인 없이 등록됨
Green List/fallback 등 내부 용어 노출
일반 부모–케이 대화가 PQR 때문에 차단됨
Dev에서만 수정하고 Prod 미적용
실제 모바일/PWA 검증 없음
```

---

## 19. 결과 보고 형식

```text
1. 기존 Green List gate 실제 코드 위치
2. 기본 대화에 영향을 주던 경로
3. Green List 임시 비활성화 구현 방식
4. Red gate 유지 확인
5. Crisis gate 유지 확인
6. 일반 부모–케이 대화 테스트
7. 케이 관계 질문 테스트
8. 미래 예측 질문 테스트
9. "아이에게 물어봐줘" 후속 맥락 테스트
10. Red 질문 테스트
11. 내부 용어 노출 검색 결과
12. 안서아/안서현 격리 결과
13. 통합 Retrieval 회귀 결과
14. Q&A 실제 E2E
15. STT 실제 E2E
16. Development Commit/URL
17. Production Commit/URL
18. 모바일/PWA 결과
19. 남은 제한사항
20. Green List 재활성화 방법
```

---

## 20. 보안

Production service role key, API key, token, password 등 비밀정보는:

- 평문 하드코딩 금지
- 로그 출력 금지
- 임시 파일 저장 금지
- 테스트 스크립트 삽입 금지

기존 Secret Manager, Vercel/Supabase Secrets 또는 안전한 런타임 환경변수만 사용한다.
