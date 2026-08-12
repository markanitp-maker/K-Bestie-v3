# 부모 질문 주제 맥락 유실 및 무관한 질문 초안 생성 문제 수정 요청

## 1. 목적
부모가 특정 주제에 대해 궁금해했는데 `아이에게 물어보기`를 누르면 원래 주제와 무관한 기본 Green 질문이 생성되는 문제를 수정한다. Development와 Production 모두 적용·검증한다.

## 2. 재현
```text
부모: 왜 서현이는 친구 관계 정보가 부족해? 질문 안 했니?
케이: 관련 기록이 없어요.
부모: 아이에게 물어보기
현재 초안: 오늘 학교에서 가장 재밌었던 순간이 무엇인지 물어볼까요?
```

문제:
```text
원래 주제: 친구 관계
생성 영역: school_fun
```

## 3. 정상 동작
```text
부모 질문
→ requested_topic=peer_relationship
→ 기록 조회
→ 정보 없음
→ 아이에게 물어보기
→ requested_topic 유지
→ 학년별 Parent Query Router 재판정
→ 같은 주제 안에서 안전한 질문 초안 생성
```

예:
```text
부모 확인용:
요즘 학교에서 같이 지내기 편한 친구가 있는지 물어볼까요?

아이 실제 질문:
요즘 학교에서 같이 있으면 편한 친구 있어?
```

안전 정책상 직접 질문이 어렵다면 같은 주제 안에서 안전하게 완화한다. 전혀 다른 `school_fun`, `weekend`, `food_pref` 등으로 바꾸지 않는다.

## 4. 핵심 요구사항
1. 기록 조회 실패 후에도 `requested_topic`, `requested_area` 유지
2. `아이에게 물어보기` 클릭 시 직전 부모 질문 맥락 전달
3. 초안 생성 API에 최소 아래 값 전달
```text
conversation_id
child_id
parent_intent
requested_topic
requested_area
last_user_message_id
policy_version
source_grade
```
4. `requested_area`가 없으면 임의 기본 Green 질문 생성 금지
5. `school_fun` 하드코딩 fallback 제거
6. Red인 경우 같은 주제의 안전 대안만 제시
7. 안전 대안도 불가하면 Red 코칭으로 종료
8. 무관한 질문 초안 승인 금지
9. 모달에 `원래 궁금한 주제`와 `최종 질문 영역` 표시
10. Development·Production 동일 응답 계약 사용

## 5. 원인 분석 대상
### 버튼 payload
- `아이에게 물어보기` onClick
- `conversation_id`
- `last_message_id`
- `requested_topic`
- `requested_area`

### 기본값
아래 하드코딩 존재 여부 확인:
```text
default_area='school_fun'
default_green_id='G-02'
fallback_question='오늘 학교에서 가장 재밌었던 순간이 무엇인지 물어볼까요?'
```

### 라우터
초안 생성 전에 아래 결과가 실제 존재하는지 확인:
```text
route
rule_id
green_id/red_id
requested_area
final_area
policy_version
source_grade
```

### 안전 대안
잘못된 예:
```text
peer_relationship → school_fun
```
정상 예:
```text
peer_relationship → peer_relationship_safe
```

## 6. 데이터 상태
최소 저장값:
```text
conversation_id
child_id
parent_intent
requested_topic
requested_area
router_route
router_rule_id
safe_alternative_area
pending_parent_draft
pending_child_question
pending_status
updated_at
```

금지:
- 클라이언트 메모리만 사용
- 다른 아이로 전환 시 이전 topic 재사용
- 새로고침 후 무관한 기본 질문 생성
- 실제 아이 원본 데이터 수정

## 7. UI
모달 예:
```text
아이에게 이렇게 물어볼까요?

대상 아이: 안서현
원래 궁금한 주제: 친구 관계
질문 영역: 친구 관계

질문 초안:
요즘 학교에서 같이 지내기 편한 친구가 있는지 물어볼까요?
```

원래 주제와 최종 area가 다르면 승인 버튼 비활성화. 단, 사전 정의된 동일 주제 안전 대안은 허용.

## 8. 주제 매핑
```text
친구 관계, 누구와 지내는지, 친구 정보 부족
→ peer_relationship

학교에서 재미있었던 일
→ school_fun

요즘 좋아하는 것
→ interest

주말에 하고 싶은 것
→ weekend

먹고 싶은 것
→ food_pref
```

장소와 주제를 구분한다. “학교에서 친구 관계”의 핵심 area는 `peer_relationship`이다.

## 9. 테스트
### A. 친구 관계
```text
왜 친구 관계 정보가 부족해?
→ 아이에게 물어보기
```
기대:
```text
requested_area=peer_relationship
final_area=peer_relationship 또는 peer_relationship_safe
school_fun 금지
```

### B. 학교 재미
```text
학교에서 뭐가 제일 재밌는지 궁금해
```
기대:
```text
requested_area=school_fun
final_area=school_fun
```

### C. Red
```text
친구가 괴롭히는지 몰래 물어봐줘
```
기대:
- Red 또는 Crisis 검토
- 질문 등록 없음
- school_fun 대체 금지

### D. 아이 전환
- 다른 아이에게 기존 pending topic 노출 금지

### E. 새로고침
- 원래 topic 유지 또는 명시적 재선택
- default school_fun 자동 생성 금지

## 10. Development
1. 첨부 사례 재현
2. 버튼 payload 확인
3. topic 유실 지점 확인
4. school_fun fallback 확인·제거
5. 라우터 재판정 연결
6. 동일 주제 안전 대안 구현
7. 단위 테스트
8. 타입 검사·린트·빌드
9. Development 배포
10. 모바일·PWA E2E
11. 기존 4학년 Router 회귀 테스트

## 11. Production
Development 검증 후 동일 Commit을 Production에 반영한다.
1. 코드·환경·DB 차이 점검
2. Production 배포
3. QA 계정 동일 시나리오 검증
4. 실제 아이 데이터 훼손 없음 확인
5. 친구 관계 → peer_relationship 유지 확인

## 12. 완료 기준
- [ ] 원래 질문 주제 유지
- [ ] 버튼 클릭 시 컨텍스트 전달
- [ ] requested_topic/requested_area 유실 없음
- [ ] school_fun 하드코딩 fallback 제거
- [ ] 같은 주제 안전 대안만 생성
- [ ] 불가 시 Red 코칭
- [ ] 무관한 질문 초안 생성 금지
- [ ] 모달에 원래 주제·최종 area 표시
- [ ] 다른 아이 세션 혼입 없음
- [ ] Development E2E PASS
- [ ] Production E2E PASS
- [ ] 모바일 브라우저·PWA PASS
- [ ] 기존 Parent Query Router 회귀 PASS

## 13. 결과 보고 형식
```text
1. 재현 결과
2. 실제 root cause
3. 컨텍스트 유실 지점
4. 수정 파일·함수
5. 기존 fallback 동작
6. requested_topic/requested_area 전달 구조
7. 안전 대안 매핑
8. Development 배포·검증
9. Production 배포·검증
10. 회귀 테스트
11. 남은 제한사항
```

보안 환경변수, API key, 토큰, 비밀번호는 평문 하드코딩·로그 출력·임시 파일 저장 금지. 기존 Secret Manager, Vercel/Supabase Secrets 또는 안전한 런타임 환경변수만 사용하고 값은 마스킹한다.

