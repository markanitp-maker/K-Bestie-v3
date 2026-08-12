# 부모–케이 대화 맥락 유지 및 질문 수정 흐름 구현 요청

## 1. 목적
부모–케이 대화에서 부모의 후속 설명·정정·질문 수정 요청을 새로운 기록 조회로 오인하지 않고, 직전 대화 맥락과 미완성 질문 초안을 이어서 처리하도록 수정한다. Development와 Production 모두 적용·검증한다.

## 2. 재현 사례
대상 아이: 안서아

```text
부모: 우리 서아는 스트레스 안 받나?
케이: 확인 가능한 기록에는 관련된 구체적인 내용이 없어요. 학교생활, 친구, 기분 중 궁금한 부분을 말씀해 주세요.
부모: 방학이라 학교 안 가. 학원으로 질문 변경해.
현재: 같은 기록 없음 fallback 반복
```

문제:
- 직전 질문 맥락 미유지
- 후속 정정·수정 의도 미인식
- “학원으로 질문 변경”을 신규 기록 조회로 오인
- 같은 fallback·버튼 반복
- 부모–케이 일반 대화 불가
- pending 질문 초안 상태 미유지

## 3. 정상 동작
```text
부모: 우리 서아는 스트레스 안 받나?
케이: 현재 기록만으로 정확히 알기 어려워요. 학교, 학원, 친구 중 어느 부분이 궁금하세요?
부모: 방학이라 학교 안 가. 학원으로 질문 변경해.
케이: 알겠어요. 학교 대신 학원 생활에서 힘든 점이 있는지 묻는 질문으로 바꿀게요.
→ 학년별 Parent Query Router 재판정
→ 안전한 경우 부모 확인용 질문 초안 모달
```

예시:
```text
부모 확인용:
요즘 학원에서 마음에 걸리는 일이 있는지 물어볼까요?

아이 실제 질문:
요즘 학원에서 마음에 걸리는 일 있어?
```

실제 문구는 대상 학년 정책을 반드시 통과해야 한다.

## 4. 필요한 대화 경로
최소 아래 네 경로를 분리한다.

```text
1. 부모–케이 일반 대화
2. 아이 기록 조회
3. 아이에게 물어보기 질문 초안 생성·수정
4. 민감 질문 Red/Crisis 처리
```

## 5. 후속 의도 분류
세션 중 부모 후속 입력을 아래 중 하나로 판정한다.

```text
NEW_QUERY
FOLLOW_UP
CORRECTION
SCOPE_CHANGE
DRAFT_EDIT
CONFIRM
CANCEL
GENERAL_CHAT
```

강한 후속 신호:
```text
변경해
바꿔
빼줘
취소해
그걸로 해줘
조금 더 부드럽게 해줘
학교 말고 학원으로
```

pending 질문 초안이 있으면 후속 수정 의도를 일반 기록 조회보다 먼저 판정한다.

## 6. 세션 상태
최소 아래 상태를 child_id·conversation_id 기준으로 유지한다.

```text
last_user_intent
last_child_scope
last_topic
pending_question_draft
pending_question_area
pending_question_status
last_router_route
last_router_rule_id
```

질문 초안 상태:
```text
NONE
DRAFTING
AWAITING_PARENT_CONFIRMATION
REGISTERED
CANCELLED
```

클라이언트 메모리만 사용해 새로고침 시 전부 유실시키지 않는다. 기존 chat session metadata, parent_questions draft 상태 또는 별도 안전한 session 저장소 중 현재 아키텍처에 맞는 방식을 사용한다.

## 7. 라우팅 우선순위
```text
1. Crisis
2. Red
3. Pending draft follow-up/correction/cancel
4. Parent Query Request
5. Child record lookup
6. General parent–K conversation
7. Fallback clarification
```

질문 수정 후에도 반드시 학년별 Parent Query Router를 다시 통과한다. 문구 수정이 Red 정책 우회 수단이 되어서는 안 된다.

## 8. Parent Query Router 연동
예:
```text
초기: 학교에서 스트레스 받는지 물어봐
수정: 방학이라 학교 안 가. 학원으로 질문 변경해
```

처리:
```text
target_context=academy
→ 학년별 CRISIS/RED/GREEN/DEFAULT_RED 재판정
```

“스트레스 받는지”처럼 감정 원인 확인은 Red일 수 있다. 이 경우 자동 등록하지 말고 안전한 대안을 제안한 뒤 부모 승인을 받는다.

예:
```text
그 표현은 아이가 부담을 느낄 수 있어요.
대신 “요즘 학원에서 마음에 걸리는 일 있어?”처럼 물어볼까요?
```

## 9. UI/UX
- 질문 수정 중임을 표시
- 같은 기록 없음 fallback 반복 금지
- `아이에게 물어보기` 선택 후 텍스트 수정 시 기존 draft 업데이트
- 취소 시 `CANCELLED`, quota 미차감, 질문 미등록
- 다른 아이로 전환하면 기존 pending draft 혼입 금지

## 10. 오류 처리
- pending draft 조회 실패 시 동일 fallback 반복 금지
- 세션 상태 불일치 시 짧은 확인 질문
- 초안 생성 실패 시 반쪽 저장 금지
- 수정 실패 시 기존 초안 유지
- quota는 최종 승인·등록 성공 시에만 차감
- 재시도 시 중복 질문 생성 금지
- 동일 수정 요청 멱등 처리

## 11. 테스트
### A. 기록 없음 → 범위 수정
```text
부모: 우리 아이 스트레스 안 받나?
케이: 기록 없음 + 범위 확인
부모: 방학이라 학교 안 가. 학원으로 변경해
```
기대:
- SCOPE_CHANGE
- 학교→학원 수정
- 같은 fallback 반복 없음
- 안전한 초안 또는 Red 코칭

### B. 문구 수정
```text
부모: 주말에 뭐 하고 싶은지 물어봐줘
케이: 초안 생성
부모: 너무 딱딱해. 좀 부드럽게 바꿔줘
```
기대:
- DRAFT_EDIT
- 기존 초안 수정
- 신규 기록 조회 금지
- 중복 row 금지

### C. 취소
```text
부모: 그 질문은 취소해
```
기대:
- CANCEL
- 질문 등록 없음
- quota 미차감

### D. 일반 대화
pending draft 없이:
```text
방학이라 학교는 안 가
```
기대:
- 일반 대화 또는 명확화
- 무조건 기록 조회 fallback 금지

### E. Red 우회 방지
```text
부모: 친구가 괴롭히는지 몰래 물어봐
케이: Red
부모: 그럼 그냥 친구 얘기로 바꿔
```
기대:
- 재판정
- 안전 조건 미충족 시 계속 Red

### F. 아이 전환·새로고침
- 다른 아이에게 pending draft 노출 금지
- 새로고침 후 복원 또는 명시적 취소
- 유실과 quota 차감 동시 발생 금지

## 12. Development 작업
1. 첨부 사례 재현
2. 현재 intent routing·세션 상태·버튼 흐름 점검
3. 실제 root cause 확정
4. pending draft 상태 구현 또는 기존 상태 복구
5. follow-up intent 분류 추가
6. Parent Query Router 재검증 연결
7. 단위 테스트
8. 타입 검사·린트·빌드
9. Development 배포
10. 모바일 브라우저·PWA E2E
11. 기록 조회·일반 대화·Q&A 회귀 테스트

## 13. Production 적용
Development 검증 완료 후 동일 수정 Commit을 Production에 반영한다.

1. Production 세션·DB·feature flag 차이 점검
2. 필요한 migration 검토
3. Production 배포
4. QA 계정으로 동일 시나리오 검증
5. 실제 아이 데이터 보존 확인
6. child_id별 pending draft 분리 확인
7. 기록 조회·일반 대화·질문 수정·취소 검증

Development만 수정하고 종료하지 않는다.

## 14. 완료 기준
- [ ] 부모 후속 설명을 직전 맥락으로 이해
- [ ] 변경/수정/취소 의도 분류
- [ ] 기록 조회와 질문 수정 분리
- [ ] 같은 fallback 반복 제거
- [ ] pending draft 상태 유지
- [ ] 부모–케이 일반 대화 가능
- [ ] 수정 후 학년별 정책 재판정
- [ ] Red 우회 불가
- [ ] 최종 승인 전 질문 등록·quota 차감 없음
- [ ] 다른 아이 세션 혼입 없음
- [ ] Development E2E PASS
- [ ] Production E2E PASS
- [ ] 모바일 브라우저·PWA PASS
- [ ] 기존 기록 조회·Q&A·4학년 Router 회귀 PASS

## 15. 결과 보고 형식
```text
1. 재현 결과
2. 실제 root cause
3. 수정한 파일·함수
4. 기존 intent routing 구조
5. 추가한 follow-up intent
6. pending draft 저장 방식
7. Parent Query Router 재판정 방식
8. 일반 대화 처리 방식
9. Development 배포 Commit/URL
10. Development E2E 결과
11. Production 배포 Commit/URL
12. Production E2E 결과
13. 회귀 테스트 결과
14. 남은 제한사항
```

보안 환경변수, API key, 토큰, 비밀번호는 평문 하드코딩·로그 출력·임시 파일 저장을 금지한다. 기존 Secret Manager, Vercel/Supabase Secrets 또는 안전한 런타임 환경변수만 사용하고 값은 마스킹한다.
